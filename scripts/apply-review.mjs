#!/usr/bin/env node
/**
 * apply-review.mjs
 *
 * Productized human-in-the-loop for application submission.
 *
 * Per CLAUDE.md ethical-use rule: the system NEVER clicks final Submit
 * without explicit human authorization on each application. This script
 * is the front door — it enforces the dry-run-first-then-confirm flow:
 *
 *   1. pnpm run apply-review                 → list pending GO/Conditional GO apps
 *   2. pnpm run apply-review --prepare 015   → dry-run fill + screenshot, save bundle
 *   3. (you review the screenshot)
 *   4. pnpm run apply-review --confirm 015   → actually submit via submit-dispatch
 *
 * Bundles live at data/apply-runs/review-{id}-{ts}/.
 * Confirm requires a bundle from the last 24h (otherwise force re-prepare).
 *
 * Hard guardrails (enforced here, NOT bypassable via flags):
 *   - score < 3.0 → refuse to even prepare
 *   - score < 3.5 → require --force-low-score on prepare
 *   - confirm without a recent prepare bundle → refused
 *   - confirm bundle older than 24h → refused (re-prepare)
 *   - max 5 confirms per UTC day → refused (per CLAUDE.md quality-over-quantity)
 *
 * Flags:
 *   --list                Show pending queue (default)
 *   --prepare <id>        Pre-fill + screenshot only, no submit
 *   --confirm <id>        Submit using most recent prepare bundle
 *   --status <id>         Show prepare/confirm history for one app
 *   --force-low-score     Allow prepare for 3.0–3.4 apps
 *   --headless            Run Playwright in headless mode (default: false)
 *   --no-post-submit      On --confirm: skip tracker + data/responses.md updates (rare: debugging)
 *   --no-refresh          On --confirm: after post-submit hooks, skip post-apply:refresh (index + dashboard)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { loadProjectEnv } from './load-env.mjs';
import { buildApplicationIndex } from './lib/career-data.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { todayConfirmCount, todayUtc } from './lib/apply-review-cap.mjs';
import { markApplicationApplied } from './lib/tracker-mark-applied.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

const APPLY_RUNS_DIR = resolve(ROOT, 'data', 'apply-runs');

// ── Argv parsing ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name) { return args.includes(`--${name}`); }
function valOf(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = args[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

const MODE = (() => {
  if (valOf('prepare')) return 'prepare';
  if (valOf('confirm')) return 'confirm';
  if (valOf('status')) return 'status';
  return 'list';
})();

const TARGET_ID = valOf('prepare') || valOf('confirm') || valOf('status') || null;
const FORCE_LOW_SCORE = flag('force-low-score');
const HEADLESS = flag('headless');
const NO_POST_SUBMIT = flag('no-post-submit');
const NO_DASHBOARD_REFRESH = flag('no-refresh');

// ── Shared helpers ──────────────────────────────────────────────────────────

function normalizeId(id) {
  return String(id).padStart(3, '0');
}

function urlFromReport(reportPath) {
  if (!reportPath) return null;
  const full = resolve(ROOT, reportPath);
  if (!existsSync(full)) return null;
  try {
    const body = readFileSync(full, 'utf8');
    const m = body.match(/^\*\*URL:\*\*\s+(https?:\/\/\S+)/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

function loadApps() {
  const snap = buildApplicationIndex(ROOT);
  return snap.records.map((a) => ({
    id: normalizeId(a.id),
    date: a.date,
    company: a.company,
    role: a.role,
    score: parseFloat(a.score) || null,
    status: a.status,
    applyUrl: a.applyUrl || urlFromReport(a.reportPath),
    hasPdf: String(a.pdf || '').includes('✅'),
    notes: a.notes,
    reportPath: a.reportPath,
  }));
}

function findApp(id) {
  const norm = normalizeId(id);
  const app = loadApps().find((a) => a.id === norm) || null;
  if (!app) return null;
  // Enrich: if applyUrl is missing from index, try the report file.
  if (!app.applyUrl && app.reportPath) {
    const reportFull = resolve(ROOT, app.reportPath);
    if (existsSync(reportFull)) {
      const body = readFileSync(reportFull, 'utf8');
      const m = body.match(/^\*\*URL:\*\*\s+(https?:\/\/\S+)/m);
      if (m) {
        app.applyUrl = m[1].trim();
        app.applyUrlSource = 'report';
      }
    }
  }
  return app;
}

function reviewBundles(appId) {
  const norm = normalizeId(appId);
  if (!existsSync(APPLY_RUNS_DIR)) return [];
  return readdirSync(APPLY_RUNS_DIR)
    .filter((f) => f.startsWith(`review-${norm}-`))
    .map((f) => {
      const p = resolve(APPLY_RUNS_DIR, f);
      const stat = statSync(p);
      return { path: p, name: f, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function detectAts(url) {
  if (!url) return 'unknown';
  if (url.includes('greenhouse')) return 'greenhouse';
  if (/linkedin\.com\/jobs\//i.test(url)) return 'linkedin';
  if (url.includes('ashby')) return 'ashby';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('smartrecruiters')) return 'smartrecruiters';
  if (url.includes('workable.com')) return 'workable';
  if (url.includes('workday.com')) return 'workday';
  if (url.includes('icims')) return 'icims';
  return 'unknown';
}

// classifyUrl returns one of:
//   direct-ats        — supported ATS, dispatch will handle it
//   linkedin          — needs manual resolution to underlying ATS or LinkedIn EasyApply
//   indeed            — needs manual resolution
//   company-site      — direct apply page, may work with universal-playwright
//   none              — no URL at all
function classifyUrl(url) {
  if (!url) return 'none';
  if (/linkedin\.com\/jobs\//i.test(url)) return 'direct-ats';
  const ats = detectAts(url);
  if (ats !== 'unknown') return 'direct-ats';
  if (/linkedin\.com/i.test(url)) return 'linkedin';
  if (/indeed\.com/i.test(url)) return 'indeed';
  return 'company-site';
}

const URL_KIND_HINT = {
  'direct-ats': 'auto-prep ready (includes LinkedIn jobs / Easy Apply — submit-linkedin-easy-apply)',
  'linkedin': 'LinkedIn non-jobs URL: resolve to company ATS or jobs/view URL',
  'indeed': 'manual: same as linkedin (Indeed proxies the ATS)',
  'company-site': 'try --prepare; universal-playwright may handle it',
  'none': 'no URL on file — populate report **URL:** field',
};

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findResume(slug) {
  if (!slug) return null;
  const outputDir = resolve(ROOT, 'output');
  if (!existsSync(outputDir)) return null;
  // Generators often drop or collapse separators (v4c-ai → v4cai),
  // so check both the original slug and its dash-stripped form.
  const compact = slug.replace(/-/g, '');
  const matches = (name) => {
    const lc = name.toLowerCase();
    return lc.endsWith('.pdf') && (lc.includes(slug) || lc.includes(compact));
  };
  const candidates = readdirSync(outputDir)
    .filter(matches)
    .sort()
    .reverse();
  return candidates[0] ? resolve(outputDir, candidates[0]) : null;
}

function findCoverLetter(slug) {
  if (!slug) return null;
  const clDir = resolve(ROOT, 'output', 'cover-letters');
  if (!existsSync(clDir)) return null;
  const compact = slug.replace(/-/g, '');
  const matches = (name) => {
    const lc = name.toLowerCase();
    return lc.endsWith('.txt') && (lc.includes(slug) || lc.includes(compact));
  };
  const candidates = readdirSync(clDir)
    .filter(matches)
    .sort()
    .reverse();
  return candidates[0] ? resolve(clDir, candidates[0]) : null;
}

// ── Mode: list ──────────────────────────────────────────────────────────────

function modeList() {
  const apps = loadApps()
    .filter((a) => a.status === 'GO' || a.status === 'Conditional GO' || a.status === 'Ready to Submit')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (apps.length === 0) {
    console.log('\nNo GO / Conditional GO / Ready to Submit applications. Queue is empty.\n');
    return;
  }

  const C = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', bold: '\x1b[1m' };
  console.log(`\n  ${C.bold}Apply-Review Queue${C.reset} — ${apps.length} candidate${apps.length === 1 ? '' : 's'}\n`);
  console.log(`  ${C.dim}ID   Status            Score  Kind           ATS         Pdf  Bundle  Company / Role${C.reset}`);
  console.log(`  ${C.dim}───  ───────────────   ─────  ─────────────  ──────────  ───  ──────  ──────────────${C.reset}`);

  const kindCounts = {};
  for (const a of apps) {
    const ats = detectAts(a.applyUrl);
    const kind = classifyUrl(a.applyUrl);
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    const bundles = reviewBundles(a.id);
    const lastBundle = bundles[0];
    const bundleAgeH = lastBundle ? Math.floor((Date.now() - lastBundle.mtime) / 3600_000) : null;
    const bundleStr = bundleAgeH === null
      ? `${C.dim}—${C.reset}`
      : bundleAgeH < 24
        ? `${C.green}${bundleAgeH}h${C.reset}`
        : `${C.yellow}${bundleAgeH}h${C.reset}`;
    const scoreColor = (a.score ?? 0) >= 4 ? C.green : (a.score ?? 0) >= 3.5 ? C.yellow : C.red;
    const pdfStr = a.hasPdf ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const kindColor = kind === 'direct-ats' ? C.green : kind === 'company-site' ? C.yellow : C.dim;
    const statusPad = (a.status || '').padEnd(15);
    const atsPad = ats.padEnd(10);
    const kindPad = (kindColor + kind.padEnd(13) + C.reset);

    console.log(`  ${C.cyan}${a.id}${C.reset}  ${statusPad}   ${scoreColor}${(a.score ?? 0).toFixed(1)}${C.reset}    ${kindPad}  ${atsPad}  ${pdfStr}    ${bundleStr.padEnd(15)}  ${a.company} · ${a.role}`);
  }

  console.log(`\n  ${C.dim}URL kinds:${C.reset} ${Object.entries(kindCounts).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  console.log(`  ${C.dim}Auto-preppable (direct-ats + company-site): ${(kindCounts['direct-ats'] || 0) + (kindCounts['company-site'] || 0)}${C.reset}`);
  console.log(`\n  Next: ${C.bold}pnpm run apply-review --prepare <id>${C.reset}\n`);
}

// ── Mode: prepare ───────────────────────────────────────────────────────────

function modePrepare() {
  const app = findApp(TARGET_ID);
  if (!app) {
    console.error(`[apply-review] No application found for id ${TARGET_ID}`);
    process.exit(1);
  }

  if (!app.applyUrl) {
    console.error(`[apply-review] App #${app.id} has no apply_url. Add **Apply URL:** to data/apply-queue.md for that id, or restore the row in data/applications.md.`);
    process.exit(1);
  }

  // Hard ethical guardrails
  if (app.score !== null && app.score < 3.0) {
    console.error(`[apply-review] HARD STOP: app #${app.id} scored ${app.score.toFixed(1)} (< 3.0). Quality-over-quantity rule (CLAUDE.md). Refusing.`);
    process.exit(1);
  }
  if (app.score !== null && app.score < 3.5 && !FORCE_LOW_SCORE) {
    console.error(`[apply-review] WARN: app #${app.id} scored ${app.score.toFixed(1)} (< 3.5). Re-run with --force-low-score if you really want to apply.`);
    process.exit(1);
  }

  const ats = detectAts(app.applyUrl);
  if (ats === 'unknown') {
    console.warn(`[apply-review] Could not detect ATS from URL: ${app.applyUrl}`);
    console.warn(`[apply-review] Will fall back to submit-universal-playwright.mjs.`);
  }

  const slug = slugify(app.company);
  const pdf = findResume(slug);
  const cl = findCoverLetter(slug);

  if (!pdf) {
    console.error(`[apply-review] No resume PDF found in output/ for slug "${slug}". Generate one first:`);
    console.error(`[apply-review]   node generate-pdf.mjs --app-id ${app.id}`);
    process.exit(1);
  }

  // Build bundle dir
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bundleDir = resolve(APPLY_RUNS_DIR, `review-${app.id}-${ts}`);
  mkdirSync(bundleDir, { recursive: true });

  console.log(`\n[apply-review] Preparing #${app.id} — ${app.company} · ${app.role}`);
  console.log(`[apply-review] ATS:    ${ats}`);
  console.log(`[apply-review] URL:    ${app.applyUrl}`);
  console.log(`[apply-review] Resume: ${pdf}`);
  console.log(`[apply-review] CL:     ${cl || '(none — will skip cover letter step)'}`);
  console.log(`[apply-review] Bundle: ${bundleDir}\n`);

  // Write metadata BEFORE running dispatch (so bundle exists even on failure)
  const metadata = {
    app_id: app.id,
    company: app.company,
    role: app.role,
    score: app.score,
    status: app.status,
    apply_url: app.applyUrl,
    ats,
    resume_pdf: pdf,
    cover_letter: cl,
    headless: HEADLESS,
    prepared_at: new Date().toISOString(),
    confirmed_at: null,
    confirmation_status: null,
  };
  writeFileSync(resolve(bundleDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');

  // Dispatch with --dry-run
  const dispatchPath = resolve(__dir, 'submit-dispatch.mjs');
  const dispatchArgs = [
    '--app-id', app.id,
    '--pdf', pdf,
    '--dry-run',
  ];
  if (cl) dispatchArgs.push('--cover-letter', cl);
  if (HEADLESS) dispatchArgs.push('--headless');

  console.log(`[apply-review] Running: node submit-dispatch.mjs ${dispatchArgs.join(' ')}`);
  console.log(`[apply-review] (Browser will open. Inspect the form, then close it manually.)\n`);

  let dispatchOk = false;
  let dispatchErr = null;
  try {
    execSync(`node "${dispatchPath}" ${dispatchArgs.map((a) => `"${a}"`).join(' ')}`, {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
    });
    dispatchOk = true;
  } catch (e) {
    dispatchErr = e.message.slice(0, 500);
    console.error(`[apply-review] Dispatch dry-run failed: ${dispatchErr}`);
  }

  // Update metadata with dispatch outcome
  metadata.dispatch_status = dispatchOk ? 'dry-run-success' : 'dry-run-failed';
  metadata.dispatch_error = dispatchErr;
  writeFileSync(resolve(bundleDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');

  // Try to copy any screenshot the dispatcher emitted into the bundle
  const screenshotDir = resolve(ROOT, '.playwright-mcp');
  if (existsSync(screenshotDir)) {
    const recentShots = readdirSync(screenshotDir)
      .filter((f) => f.startsWith('submit-') && f.endsWith('.png'))
      .map((f) => ({ f, mtime: statSync(resolve(screenshotDir, f)).mtimeMs }))
      .filter((s) => Date.now() - s.mtime < 10 * 60_000) // last 10 min
      .sort((a, b) => b.mtime - a.mtime);
    if (recentShots.length > 0) {
      const src = resolve(screenshotDir, recentShots[0].f);
      const dst = resolve(bundleDir, 'screenshot.png');
      try {
        const data = readFileSync(src);
        writeFileSync(dst, data);
        console.log(`[apply-review] Screenshot copied → ${dst}`);
        metadata.screenshot = dst;
        writeFileSync(resolve(bundleDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
      } catch (e) {
        console.warn(`[apply-review] Screenshot copy failed: ${e.message}`);
      }
    }
  }

  appendAutomationEvent(ROOT, {
    type: 'apply-review.prepared',
    app_id: app.id,
    company: app.company,
    role: app.role,
    ats,
    bundle: bundleDir,
    dispatch_status: metadata.dispatch_status,
  });

  console.log(`\n${dispatchOk ? '✅' : '⚠️ '}  Bundle ready: ${bundleDir}`);
  console.log(`\n  Review the screenshot and form, then:`);
  console.log(`    pnpm run apply-review --confirm ${app.id}\n`);
}

// ── Mode: confirm ───────────────────────────────────────────────────────────

function modeConfirm() {
  const app = findApp(TARGET_ID);
  if (!app) {
    console.error(`[apply-review] No application found for id ${TARGET_ID}`);
    process.exit(1);
  }

  // Daily limit (CLAUDE.md: quality over quantity)
  const todayCount = todayConfirmCount(APPLY_RUNS_DIR);
  if (todayCount >= 5) {
    console.error(`[apply-review] HARD STOP: ${todayCount} confirms already today. Daily cap is 5 (CLAUDE.md quality rule). Try tomorrow.`);
    process.exit(1);
  }

  const bundles = reviewBundles(app.id);
  if (bundles.length === 0) {
    console.error(`[apply-review] No prepare bundle for #${app.id}. Run --prepare first.`);
    process.exit(1);
  }

  const latest = bundles[0];
  const ageMs = Date.now() - latest.mtime;
  if (ageMs > 24 * 60 * 60 * 1000) {
    console.error(`[apply-review] Latest bundle is ${Math.floor(ageMs / 3600_000)}h old (> 24h). Re-prepare to be safe.`);
    process.exit(1);
  }

  const metaPath = resolve(latest.path, 'metadata.json');
  if (!existsSync(metaPath)) {
    console.error(`[apply-review] Bundle missing metadata.json: ${latest.path}`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

  if (meta.dispatch_status !== 'dry-run-success') {
    console.error(`[apply-review] Last dry-run did not succeed (status: ${meta.dispatch_status}). Re-prepare and verify before confirming.`);
    process.exit(1);
  }

  console.log(`\n[apply-review] CONFIRMING #${app.id} — ${app.company} · ${app.role}`);
  console.log(`[apply-review] ATS:     ${meta.ats}`);
  console.log(`[apply-review] URL:     ${meta.apply_url}`);
  console.log(`[apply-review] Resume:  ${meta.resume_pdf}`);
  console.log(`[apply-review] CL:      ${meta.cover_letter || '(none)'}`);
  console.log(`[apply-review] Bundle:  ${latest.path}`);
  console.log(`[apply-review] Today's confirm count: ${todayCount}/5\n`);

  // Write a CONFIRM-attempt artifact *before* dispatch fires so we have an
  // audit trail even if dispatch hangs/crashes.
  const confirmTs = new Date().toISOString().replace(/[:.]/g, '-');
  const confirmFile = resolve(APPLY_RUNS_DIR, `confirm-${app.id}-${confirmTs}.json`);
  writeFileSync(confirmFile, JSON.stringify({
    app_id: app.id,
    bundle_path: latest.path,
    confirmed_at: new Date().toISOString(),
    status: 'in-progress',
    metadata_snapshot: meta,
  }, null, 2) + '\n', 'utf8');

  // Dispatch LIVE (no --dry-run)
  const dispatchPath = resolve(__dir, 'submit-dispatch.mjs');
  const dispatchArgs = [
    '--app-id', app.id,
    '--pdf', meta.resume_pdf,
    '--live',
  ];
  if (meta.cover_letter) dispatchArgs.push('--cover-letter', meta.cover_letter);

  let liveOk = false;
  let liveErr = null;
  try {
    execSync(`node "${dispatchPath}" ${dispatchArgs.map((a) => `"${a}"`).join(' ')}`, {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 8 * 60 * 1000,
    });
    liveOk = true;
  } catch (e) {
    liveErr = e.message.slice(0, 500);
  }

  // Update artifact
  const finalStatus = liveOk ? 'submitted' : 'failed';
  writeFileSync(confirmFile, JSON.stringify({
    app_id: app.id,
    bundle_path: latest.path,
    confirmed_at: new Date().toISOString(),
    status: finalStatus,
    error: liveErr,
    metadata_snapshot: meta,
  }, null, 2) + '\n', 'utf8');

  // Update bundle metadata too
  meta.confirmed_at = new Date().toISOString();
  meta.confirmation_status = finalStatus;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');

  appendAutomationEvent(ROOT, {
    type: 'apply-review.confirmed',
    app_id: app.id,
    company: app.company,
    role: app.role,
    ats: meta.ats,
    bundle: latest.path,
    status: finalStatus,
    error: liveErr,
  });

  if (liveOk) {
    const day = todayUtc();
    if (!NO_POST_SUBMIT) {
      console.log(`\n✅ Live submit finished for #${app.id} — ${app.company}.`);
      const applied = markApplicationApplied(ROOT, app.id, {
        date: day,
        noteLine: `Submitted ${day} (apply-review --confirm).`,
      });
      if (!applied.ok) {
        if (applied.reason === 'row_not_found') {
          console.warn(
            `[apply-review] Tracker: no row for #${app.id} in data/applications.md — set Applied manually or add the row (id drift).`,
          );
        } else {
          console.warn(
            `[apply-review] Tracker update skipped: ${applied.reason}${applied.detail ? ` — ${applied.detail}` : ''}`,
          );
        }
      } else {
        console.log(`[apply-review] Tracker: Status → Applied, Date → ${day}`);
      }
      const lr = resolve(__dir, 'log-response.mjs');
      const ats = String((meta.ats && meta.ats !== 'unknown' && meta.ats) || '—');
      try {
        execFileSync(
          process.execPath,
          [
            lr,
            '--app-id',
            String(app.id),
            '--event',
            'submitted',
            '--date',
            day,
            '--company',
            app.company,
            '--role',
            app.role,
            '--ats',
            ats,
            '--notes',
            'apply-review --confirm',
          ],
          { cwd: ROOT, stdio: 'inherit' },
        );
        console.log('[apply-review] responses.md: submitted event recorded.\n');
      } catch (e) {
        console.warn(`[apply-review] log-response failed: ${e.message || e}`);
        console.warn(
          `  Run: node scripts/log-response.mjs --app-id ${app.id} --event submitted --date ${day} --company "${app.company}" --role "${app.role}" --ats ${ats}\n`,
        );
      }
      if (!NO_DASHBOARD_REFRESH) {
        const refreshPath = resolve(__dir, 'post-apply-refresh.mjs');
        try {
          console.log('[apply-review] Rebuilding data/index + dashboard.html (post-apply:refresh)…\n');
          execFileSync(process.execPath, [refreshPath], { cwd: ROOT, stdio: 'inherit' });
        } catch (e) {
          console.warn(`[apply-review] post-apply-refresh failed: ${e.message || e}`);
          console.warn('  Run: pnpm run post-apply:refresh\n');
        }
      } else {
        console.log('[apply-review] Skipped index/dashboard regen (--no-refresh). Run: pnpm run post-apply:refresh\n');
      }
    } else {
      console.log(
        '\n✅ Submitted (post-submit hooks skipped: --no-post-submit). Update tracker and responses.md yourself.\n',
      );
    }
  } else {
    console.error(`\n✖  Submission failed for #${app.id}. See error above. Bundle and confirm artifact: ${latest.path} ${confirmFile}\n`);
    process.exit(1);
  }
}

// ── Mode: status ────────────────────────────────────────────────────────────

function modeStatus() {
  const app = findApp(TARGET_ID);
  if (!app) {
    console.error(`[apply-review] No application found for id ${TARGET_ID}`);
    process.exit(1);
  }
  const bundles = reviewBundles(app.id);
  console.log(`\n  #${app.id} — ${app.company} · ${app.role}`);
  console.log(`  Status: ${app.status} · Score: ${app.score?.toFixed(1) ?? '—'} · URL: ${app.applyUrl || '(none)'}`);
  if (bundles.length === 0) {
    console.log(`\n  No prepare bundles. Run: pnpm run apply-review --prepare ${app.id}\n`);
    return;
  }
  console.log(`\n  Prepare bundles (${bundles.length}):`);
  for (const b of bundles) {
    const ageH = Math.floor((Date.now() - b.mtime) / 3600_000);
    let metaSummary = '';
    try {
      const meta = JSON.parse(readFileSync(resolve(b.path, 'metadata.json'), 'utf8'));
      metaSummary = ` · dispatch: ${meta.dispatch_status} · confirmed: ${meta.confirmation_status || '—'}`;
    } catch {}
    console.log(`    ${b.name} · ${ageH}h ago${metaSummary}`);
  }
  console.log('');
}

// ── Main ────────────────────────────────────────────────────────────────────

if (MODE === 'list') modeList();
else if (MODE === 'prepare') modePrepare();
else if (MODE === 'confirm') modeConfirm();
else if (MODE === 'status') modeStatus();
