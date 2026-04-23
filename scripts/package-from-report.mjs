#!/usr/bin/env node
/**
 * package-from-report.mjs — Meta-orchestrator for eval → application package
 *
 * Takes a completed evaluation report and builds the full application
 * package so Matt only has to review + click Submit.
 *
 * Runs:
 *   1. Parse report metadata (URL, company, role, score, portal hints)
 *   2. Locate matching JD file (jds/<slug>.md or jds/<slug>.txt)
 *   3. ATS preflight (score → gate) — HARD HALT below threshold
 *   4. CV PDF generation via cv-docx-to-pdf.mjs --from-report (halt on error)
 *   5. Cover letter via generate-cover-letter.mjs --app-id (warn on error)
 *   6. Apply URL + portal detection via resolve-apply-urls.mjs
 *   7. Portal-branch artifact:
 *        greenhouse|lever|ashby → apply-flow.md (checklist + essay stubs)
 *        email                  → email.eml via apply-via-email.mjs --draft
 *        workday|icims|universal|unknown → apply-preview.md (manual checklist)
 *   8. Tracker update: row status GO → Ready to Submit
 *   9. Emit package.ready event
 *
 * Usage:
 *   node scripts/package-from-report.mjs --report-num 219
 *   node scripts/package-from-report.mjs --report-num 219 --dry-run
 *   node scripts/package-from-report.mjs --report-num 219 --skip-pdf
 *   node scripts/package-from-report.mjs --report-num 219 --no-tracker
 *
 * Output: packages/<app_id>/
 *   cv.pdf                 # symlink/copy of output/cv-pdfs/
 *   cover-letter.md        # symlink/copy of output/cover-letters/
 *   apply-flow.md          # OR email.eml OR apply-preview.md
 *   manifest.json
 *   warnings.jsonl
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  appendFileSync,
  statSync,
} from 'node:fs';
import { dirname, resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { parseApplicationsTracker } from './lib/career-data.mjs';
import { isMainEntry } from './lib/main-entry.mjs';
import { parseApplyUrl } from './lib/parse-apply-url.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// ── Args ────────────────────────────────────────────────────────────────────

export function parsePackageArgs(argv) {
  const out = {
    reportNum: null,
    dryRun: false,
    skipPdf: false,
    noTracker: false,
    noAts: false,
    threshold: 60,
  };
  for (const a of argv) {
    if (a.startsWith('--report-num=')) out.reportNum = a.slice(13);
    else if (a === '--report-num') continue;
    else if (a.startsWith('--threshold=')) out.threshold = Number(a.slice(12)) || 60;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-pdf') out.skipPdf = true;
    else if (a === '--no-tracker') out.noTracker = true;
    else if (a === '--no-ats') out.noAts = true;
    else if (/^\d+$/.test(a) && out.reportNum === null) out.reportNum = a;
  }
  // Handle `--report-num 219` (space-separated)
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--report-num' && /^\d+$/.test(argv[i + 1])) {
      out.reportNum = argv[i + 1];
    }
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function padId(id) {
  return String(id).padStart(3, '0');
}

function findReportFile(reportNum) {
  const id = padId(reportNum);
  const reportsDir = resolve(ROOT, 'reports');
  if (!existsSync(reportsDir)) return null;
  const files = readdirSync(reportsDir)
    .filter((f) => f.startsWith(`${id}-`) && f.endsWith('.md'))
    .sort()
    .reverse();
  return files.length > 0 ? resolve(reportsDir, files[0]) : null;
}

function parseReportMeta(reportPath) {
  const body = readFileSync(reportPath, 'utf8');
  const meta = { path: reportPath };
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^([a-zA-Z_]+):\s*["']?(.*?)["']?\s*$/);
      if (m) meta[m[1].toLowerCase()] = m[2].trim();
    }
  }
  // Bold-text metadata pattern used in actual reports (e.g. 219-pivot-bio)
  const readBold = (key) =>
    body.match(new RegExp(`^\\*\\*${key}:\\*\\*\\s+(.+?)\\s*$`, 'm'))?.[1]?.trim() || null;
  meta.date = meta.date || readBold('Date');
  meta.score = meta.score || readBold('Score');
  meta.url = meta.url || readBold('URL');
  meta.applyUrl = meta.apply_url || readBold('Apply URL') || readBold('Apply');
  meta.location = meta.location || readBold('Location');
  meta.salary = meta.salary || readBold('Salary');
  meta.archetype = meta.archetype || readBold('Archetype');
  // Phase 2.2 scan-enrichment fields — optional bold-text metadata that
  // makes portal branching + city-token exclusion deterministic without
  // URL parsing. Reports may include them per modes/_shared.md convention.
  meta.ghJid = readBold('gh_jid') || readBold('GH JID');
  meta.leverId = readBold('lever_id') || readBold('Lever ID');
  meta.officeCity = readBold('Office City') || readBold('office_city');
  meta.closeDate = readBold('Close Date');
  meta.repostedAgeDays = readBold('Reposted Age Days') || readBold('reposted_age_days');

  // Title line: "# Evaluation: <Company> — <Role>"
  const title = body.match(/^#\s+Evaluation:\s+(.+?)\s*$/m)?.[1] || null;
  if (title) {
    const sep = title.match(/\s+[—–-]\s+/);
    if (sep) {
      meta.company = meta.company || title.slice(0, sep.index).trim();
      meta.role = meta.role || title.slice(sep.index + sep[0].length).trim();
    } else {
      meta.company = meta.company || title.trim();
    }
  }
  return meta;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function detectPortal(url) {
  // Deterministic parse via parse-apply-url (handles gh_jid, lever UUID,
  // ashby UUID, workday, icims, smartrecruiters, workable, aggregators).
  const parsed = parseApplyUrl(url);
  return parsed.portal || 'unknown';
}

function extractGhJid(url) {
  const p = parseApplyUrl(url);
  return p.portal === 'greenhouse' ? p.jobId : null;
}

function findJdFile(reportMeta) {
  const jdsDir = resolve(ROOT, 'jds');
  if (!existsSync(jdsDir)) return null;
  const companySlug = slugify(reportMeta.company);
  const roleSlug = slugify(reportMeta.role);
  const candidates = readdirSync(jdsDir).filter((f) => /\.(md|txt)$/.test(f));

  // Try exact match first: <company>-<role>.<ext>, then <company>-<short-role>.<ext>
  const tryPatterns = [
    `${companySlug}-${roleSlug}`,
    `${companySlug}`,
    roleSlug,
  ];
  for (const pat of tryPatterns) {
    const match = candidates.find((f) => f.startsWith(pat));
    if (match) return resolve(jdsDir, match);
  }
  // Fallback: any file containing the company slug
  const fuzzy = candidates.find((f) => f.includes(companySlug));
  return fuzzy ? resolve(jdsDir, fuzzy) : null;
}

function appendWarning(pkgDir, stage, message, extra = {}) {
  if (!existsSync(pkgDir)) mkdirSync(pkgDir, { recursive: true });
  const line = JSON.stringify({
    recorded_at: new Date().toISOString(),
    stage,
    message,
    ...extra,
  });
  appendFileSync(resolve(pkgDir, 'warnings.jsonl'), line + '\n', 'utf8');
}

function runStep(label, cmd, args, opts = {}) {
  const r = spawnSync(process.execPath, [cmd, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    ...opts,
  });
  return {
    status: r.status === null ? 1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error || null,
    label,
  };
}

// ── Pipeline stages ─────────────────────────────────────────────────────────

function stageAtsPreflight(meta, jdFile, pkgDir, opts) {
  if (opts.noAts) {
    appendWarning(pkgDir, 'ats', 'skipped (--no-ats)');
    return { passed: true, skipped: true };
  }
  if (!jdFile) {
    appendWarning(pkgDir, 'ats', 'skipped (no JD file found — orchestrator could not locate a jds/ entry)', { company: meta.company, role: meta.role });
    return { passed: true, skipped: true };
  }
  const writeJson = resolve(pkgDir, 'ats-score.json');
  // Prefer the tailored variant (output/cv-variants/cv-matt-<slug>.md) when it
  // exists — that's what actually gets submitted. Fall back to canonical cv.md.
  const variantSlug = slugify(`${meta.company}-${meta.role}`);
  const variantPath = resolve(ROOT, 'output', 'cv-variants', `cv-matt-${variantSlug}.md`);
  const cvForScoring = existsSync(variantPath) ? variantPath : null;
  // Always exclude company-name + location tokens — structural noise inflates
  // false-negatives on "missing". --company / --location default-safe to empty
  // if meta didn't extract them.
  const preflightArgs = [
    `--jd=${jdFile}`,
    `--write-json=${writeJson}`,
    `--threshold=${opts.threshold}`,
    '--json',
    '--exclude-structural',
  ];
  if (cvForScoring) preflightArgs.unshift(`--cv=${cvForScoring}`);
  if (meta.company) preflightArgs.push(`--company=${meta.company}`);
  // Prefer explicit Office City metadata when present (Phase 2.2 enrichment);
  // fall back to extracting a city-like token from the Location prose.
  const locToken =
    meta.officeCity ||
    (meta.location || '').match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/)?.[0];
  if (locToken) preflightArgs.push(`--location=${locToken}`);
  const r = runStep(
    'ats-preflight',
    resolve(__dir, 'ats-preflight.mjs'),
    preflightArgs,
    { stdio: 'pipe' }
  );
  if (r.status !== 0) {
    // Halt: gate failure is non-negotiable per CLAUDE.md
    return {
      passed: false,
      status: r.status,
      writeJson,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  }
  return { passed: true, writeJson, stdout: r.stdout };
}

function stageGeneratePdf(meta, pkgDir, opts) {
  if (opts.skipPdf) {
    appendWarning(pkgDir, 'pdf', 'skipped (--skip-pdf)');
    return { skipped: true };
  }
  const slug = slugify(`${meta.company}-${meta.role}`);
  const outBase = resolve(ROOT, 'output', 'cv-pdfs', `cv-matt-${slug}`);
  const pdfPath = `${outBase}.pdf`;
  const docxPath = `${outBase}.docx`;
  // Ensure dir
  mkdirSync(dirname(outBase), { recursive: true });

  const r = runStep(
    'cv-docx-to-pdf',
    resolve(__dir, 'cv-docx-to-pdf.mjs'),
    ['--from-report', meta.path, '--out', outBase],
    { stdio: 'pipe' }
  );
  if (r.status !== 0) {
    // Word/COM conversion is occasionally flaky on Windows (locked files, SaveAs errors).
    // If we already have a prior PDF for this same app slug, reuse it so packaging can proceed.
    if (existsSync(pdfPath)) {
      copyFileSync(pdfPath, resolve(pkgDir, 'cv.pdf'));
      if (existsSync(docxPath)) copyFileSync(docxPath, resolve(pkgDir, 'cv.docx'));
      appendWarning(pkgDir, 'pdf', 'conversion failed; reused existing output/cv-pdfs PDF');
      return { reusedExisting: true, outBase, pdfPath, docxPath, failed: false };
    }
    // No reusable artifact — halt.
    return { failed: true, status: r.status, stderr: r.stderr, stdout: r.stdout };
  }
  // Copy into package dir if produced
  if (existsSync(pdfPath)) copyFileSync(pdfPath, resolve(pkgDir, 'cv.pdf'));
  if (existsSync(docxPath)) copyFileSync(docxPath, resolve(pkgDir, 'cv.docx'));
  return { outBase, pdfPath, docxPath };
}

function stageGenerateCoverLetter(meta, pkgDir, opts) {
  if (opts.dryRun) {
    appendWarning(pkgDir, 'cover-letter', 'skipped (--dry-run)');
    return { skipped: true };
  }
  const r = runStep(
    'generate-cover-letter',
    resolve(__dir, 'generate-cover-letter.mjs'),
    ['--app-id', padId(opts.reportNum)],
    { stdio: 'pipe' }
  );
  if (r.status !== 0) {
    // Continue-with-warning — CL is important but non-blocking
    appendWarning(pkgDir, 'cover-letter', 'generation failed', {
      exit: r.status,
      stderr: (r.stderr || '').slice(0, 400),
    });
    return { failed: true };
  }
  // Try to locate the produced file
  const clDir = resolve(ROOT, 'output', 'cover-letters');
  const slug = slugify(meta.company);
  if (existsSync(clDir)) {
    const match = readdirSync(clDir).find((f) => f.startsWith(slug));
    if (match) {
      const src = resolve(clDir, match);
      copyFileSync(src, resolve(pkgDir, 'cover-letter.md'));
      return { src };
    }
  }
  appendWarning(pkgDir, 'cover-letter', 'generated but file not located', {});
  return {};
}

function stageApplyFlow(meta, portal, pkgDir, opts, parsed = null) {
  if (portal === 'greenhouse' || portal === 'lever' || portal === 'ashby') {
    // Prefer explicit Phase-2.2 metadata; fall back to URL regex.
    const gh_jid = meta.ghJid || extractGhJid(meta.applyUrl || meta.url);
    const essays = [
      {
        q: 'Why do you want this role?',
        a: 'DRAFT — pull from report Section E (Personalization Plan). Lead with the 1-2 strongest reasons specific to this company + role.',
      },
      {
        q: 'What is your approach to ambiguous architecture problems?',
        a: 'DRAFT — 4-step heuristic: domain boundaries → thin vertical slice → reversible-vs-irreversible decision classification → POC-first validation.',
      },
      {
        q: 'Describe your experience with the company\'s stack (if Databricks/Snowflake/etc. preferred but not required).',
        a: 'DRAFT — honest "X-adjacent" framing if gap exists, with 30-day ramp commitment. See Pivot Bio cover letter template for pattern.',
      },
      {
        q: 'Salary expectation',
        a: 'DRAFT — reference report Section F hard-stops. Typical: midpoint of stated range, floor at -10%, walk-away below that.',
      },
    ];
    const body = [
      `# Apply Flow — ${meta.company} / ${meta.role}`,
      '',
      `**Portal:** ${portal}${gh_jid ? ` (gh_jid=${gh_jid})` : ''}`,
      `**Apply URL:** ${meta.applyUrl || meta.url || '(resolve via resolve-apply-urls.mjs)'}`,
      '',
      '## Checklist',
      '',
      '- [ ] Tailored CV PDF attached (see `cv.pdf`)',
      '- [ ] Cover letter attached (see `cover-letter.md` → convert to PDF if portal requires)',
      '- [ ] Email field: `MattMAmundson@gmail.com` (NOT greenfieldmetalsales.com — revoked)',
      '- [ ] GitHub field: leave blank (mattamundson github has no public projects)',
      '- [ ] LinkedIn URL',
      '- [ ] Phone',
      '- [ ] Work authorization: US Citizen, no sponsorship required',
      `- [ ] Location preference: per report (see location field: ${meta.location || 'check report'})`,
      '- [ ] Salary expectation: see report Section F hard-stops',
      '',
      '## Essay Answers (Draft — review before submit)',
      '',
      ...essays.flatMap((e) => [`### ${e.q}`, '', e.a, '']),
      '## Strategic Notes',
      '',
      '- Warm-intros: check report for Warm Intros section. If empty, manual LinkedIn search is the fallback.',
      '- Post-submit: edit `data/applications.md` row → status `Applied` with today\'s date in notes.',
      '- 14-day ghost-detection will auto-queue follow-up via existing scheduled task if no response.',
      '',
    ].join('\n');
    writeFileSync(resolve(pkgDir, 'apply-flow.md'), body, 'utf8');
    return { kind: 'apply-flow', portal, gh_jid };
  }

  if (portal === 'email') {
    // Delegate to apply-via-email.mjs --draft (may not exist yet)
    const emailScript = resolve(__dir, 'apply-via-email.mjs');
    if (existsSync(emailScript)) {
      const emailArgs = ['--app-id', padId(opts.reportNum), '--draft', '--package-dir', pkgDir];
      // parseApplyUrl stores the extracted address on parsed.email — pass
      // it through so apply-via-email doesn't have to re-parse the prose.
      if (parsed?.email) emailArgs.push('--to', parsed.email);
      const r = runStep(
        'apply-via-email',
        emailScript,
        emailArgs,
        { stdio: 'pipe' }
      );
      if (r.status !== 0) {
        appendWarning(pkgDir, 'apply-flow', 'email draft failed', { stderr: (r.stderr || '').slice(0, 400) });
      }
      return { kind: 'email', ok: r.status === 0 };
    }
    appendWarning(pkgDir, 'apply-flow', 'email portal detected but apply-via-email.mjs not yet built — stub emitted');
    writeFileSync(
      resolve(pkgDir, 'email-stub.md'),
      `# Email apply stub — ${meta.company}\n\nTarget email: (fill in)\nAttach cv.pdf + cover-letter.md (convert to PDF).\nSubject: Application: ${meta.role}\n`,
      'utf8'
    );
    return { kind: 'email-stub' };
  }

  // Universal/Workday/iCIMS/unknown
  const body = [
    `# Apply Preview — ${meta.company} / ${meta.role}`,
    '',
    `**Portal:** ${portal} (not auto-prefillable from this orchestrator)`,
    `**Apply URL:** ${meta.applyUrl || meta.url || '(none captured)'}`,
    '',
    '## Manual Checklist',
    '',
    '- [ ] Open Apply URL in browser',
    '- [ ] Upload `cv.pdf`',
    '- [ ] Paste body of `cover-letter.md` or attach as PDF',
    '- [ ] Complete portal-specific fields manually',
    '- [ ] Consider running `scripts/apply-review.mjs --prepare <id>` for a screenshot dry-run (if supported ATS)',
    '',
  ].join('\n');
  writeFileSync(resolve(pkgDir, 'apply-preview.md'), body, 'utf8');
  return { kind: 'apply-preview', portal };
}

function stageTrackerUpdate(meta, opts) {
  if (opts.noTracker || opts.dryRun) {
    return { skipped: true };
  }
  const appsPath = resolve(ROOT, 'data', 'applications.md');
  if (!existsSync(appsPath)) return { failed: true, reason: 'applications.md not found' };

  const id = padId(opts.reportNum);
  const body = readFileSync(appsPath, 'utf8');
  const lines = body.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    const cells = line.split('|');
    if (cells.length < 10) continue;
    const rowId = cells[1].trim();
    if (rowId !== id) continue;
    const currentStatus = cells[6].trim();
    if (currentStatus === 'GO' || currentStatus === 'Conditional GO') {
      cells[6] = ' Ready to Submit ';
      lines[i] = cells.join('|');
      changed = true;
    }
    break;
  }
  if (!changed) return { changed: false, reason: 'row not found or status not GO/Conditional GO' };
  writeFileSync(appsPath, lines.join('\n'), 'utf8');
  return { changed: true };
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function packageFromReport(opts) {
  const { reportNum } = opts;
  if (!reportNum) {
    throw new Error('missing --report-num');
  }
  const appId = padId(reportNum);
  const started = new Date();

  appendAutomationEvent(ROOT, {
    type: 'package.start',
    app_id: appId,
    dry_run: !!opts.dryRun,
  });

  // 1. Locate report
  const reportPath = findReportFile(reportNum);
  if (!reportPath) {
    appendAutomationEvent(ROOT, { type: 'package.failed', app_id: appId, stage: 'locate', error: 'report not found' });
    throw new Error(`Report #${appId} not found in reports/`);
  }

  // 2. Parse metadata
  const meta = parseReportMeta(reportPath);
  if (!meta.company) {
    appendAutomationEvent(ROOT, { type: 'package.failed', app_id: appId, stage: 'parse', error: 'company not parseable' });
    throw new Error(`Could not parse company from ${reportPath}`);
  }

  // 3. Set up package dir
  const pkgDir = resolve(ROOT, 'packages', appId);
  mkdirSync(pkgDir, { recursive: true });

  // 4. Find JD (optional)
  const jdFile = findJdFile(meta);

  // 5. ATS preflight (HARD HALT on fail)
  const atsResult = stageAtsPreflight(meta, jdFile, pkgDir, opts);
  if (!atsResult.passed) {
    appendAutomationEvent(ROOT, {
      type: 'package.failed',
      app_id: appId,
      stage: 'ats',
      exit: atsResult.status,
    });
    throw new Error(`ATS gate failed for #${appId}; see ${pkgDir}/ats-score.json`);
  }

  // 6. PDF (HARD HALT on fail)
  const pdfResult = stageGeneratePdf(meta, pkgDir, opts);
  if (pdfResult.failed) {
    appendAutomationEvent(ROOT, {
      type: 'package.failed',
      app_id: appId,
      stage: 'pdf',
      stderr: (pdfResult.stderr || '').slice(0, 200),
    });
    throw new Error(`PDF generation failed for #${appId}`);
  }

  // 7. Cover letter (WARN on fail)
  const clResult = stageGenerateCoverLetter(meta, pkgDir, { ...opts, reportNum });

  // 8. Detect portal + parse job IDs from URL
  const urlCandidate = meta.applyUrl || meta.url || '';
  const parsedUrl = parseApplyUrl(urlCandidate);
  let portal = parsedUrl.portal || 'unknown';
  let effectiveParse = parsedUrl;
  // If the main URL is a proxy (LinkedIn/Indeed/BuiltIn) but the apply URL
  // is a direct ATS link, prefer the direct ATS detection.
  if (['linkedin-proxy', 'indeed-proxy', 'builtin-proxy', 'unknown', 'universal'].includes(portal) && meta.applyUrl && meta.applyUrl !== meta.url) {
    const altParse = parseApplyUrl(meta.applyUrl);
    if (altParse.portal && !['linkedin-proxy', 'indeed-proxy', 'builtin-proxy', 'unknown', 'universal'].includes(altParse.portal)) {
      portal = altParse.portal;
      effectiveParse = altParse;
    }
  }

  // 9. Apply-flow artifact (portal-specific)
  const flowResult = stageApplyFlow(meta, portal, pkgDir, { ...opts, reportNum }, effectiveParse);

  // 10. Tracker update
  const trackerResult = stageTrackerUpdate(meta, { ...opts, reportNum });

  // 11. Write manifest
  const manifest = {
    app_id: appId,
    company: meta.company,
    role: meta.role,
    score: meta.score,
    portal,
    job_id: parsedUrl.jobId || null,
    board: parsedUrl.board || null,
    url: meta.url,
    apply_url: meta.applyUrl,
    location: meta.location,
    salary: meta.salary,
    archetype: meta.archetype,
    jd_file: jdFile ? basename(jdFile) : null,
    ats_passed: !!atsResult.passed,
    ats_skipped: !!atsResult.skipped,
    pdf_generated: !pdfResult.skipped && !pdfResult.failed,
    cover_letter_generated: !clResult.skipped && !clResult.failed,
    apply_flow: flowResult.kind,
    tracker_updated: !!trackerResult.changed,
    generated_at: new Date().toISOString(),
    elapsed_ms: Date.now() - started.getTime(),
  };
  writeFileSync(resolve(pkgDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 12. Emit package.ready event
  appendAutomationEvent(ROOT, {
    type: 'package.ready',
    app_id: appId,
    company: meta.company,
    role: meta.role,
    portal,
    score: meta.score,
    package_dir: `packages/${appId}`,
    pdf: manifest.pdf_generated,
    cover_letter: manifest.cover_letter_generated,
    tracker_updated: manifest.tracker_updated,
    elapsed_ms: manifest.elapsed_ms,
  });

  return { pkgDir, manifest };
}

function main() {
  const opts = parsePackageArgs(process.argv.slice(2));
  if (!opts.reportNum) {
    console.error(
      'Usage: node scripts/package-from-report.mjs --report-num <N> [--dry-run] [--skip-pdf] [--no-tracker] [--no-ats] [--threshold=60]'
    );
    process.exit(2);
  }
  packageFromReport(opts).then(
    ({ pkgDir, manifest }) => {
      console.log(`\n✓ Package ready: ${pkgDir}`);
      console.log(`  app_id: ${manifest.app_id}`);
      console.log(`  company: ${manifest.company}`);
      console.log(`  role: ${manifest.role}`);
      console.log(`  portal: ${manifest.portal}`);
      console.log(`  pdf: ${manifest.pdf_generated ? '✓' : '✗'}  cover-letter: ${manifest.cover_letter_generated ? '✓' : '✗'}  tracker: ${manifest.tracker_updated ? '✓ Ready to Submit' : '(unchanged)'}`);
      console.log(`  next: review ${pkgDir}/ then submit via ${manifest.apply_url || manifest.url || '(see report)'}`);
      process.exit(0);
    },
    (err) => {
      console.error(`✗ package-from-report failed: ${err.message}`);
      process.exit(1);
    }
  );
}

if (isMainEntry(import.meta.url)) {
  main();
}
