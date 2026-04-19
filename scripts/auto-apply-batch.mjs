#!/usr/bin/env node
/**
 * auto-apply-batch.mjs — Automated batch application processor
 *
 * Reads the apply-queue.md, identifies applications ready to submit,
 * generates cover letters if missing, and submits via the ATS dispatcher.
 *
 * SAFETY: Requires explicit --live flag for real submissions.
 * Default mode: dry-run (shows what would be submitted, generates cover letters).
 *
 * Usage:
 *   node scripts/auto-apply-batch.mjs                         — dry-run, show plan
 *   node scripts/auto-apply-batch.mjs --generate-cl           — generate missing cover letters
 *   node scripts/auto-apply-batch.mjs --live --max 5          — submit up to 5 applications
 *   node scripts/auto-apply-batch.mjs --live --app-ids 025,024,023  — submit specific IDs
 *   node scripts/auto-apply-batch.mjs --status                — show apply queue status
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, execFileSync } from 'child_process';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { loadProjectEnv } from './load-env.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const DRY_RUN = !LIVE;
const GENERATE_CL = args.includes('--generate-cl');
const STATUS_ONLY = args.includes('--status');
const maxIdx = args.indexOf('--max');
const MAX_SUBMISSIONS = maxIdx >= 0 ? parseInt(args[maxIdx + 1]) : 10;
const idsIdx = args.indexOf('--app-ids');
const SPECIFIC_IDS = idsIdx >= 0 ? args[idsIdx + 1].split(',').map(s => s.trim().padStart(3, '0')) : null;

const APPLY_QUEUE = resolve(ROOT, 'data', 'apply-queue.md');
const APPLICATIONS = resolve(ROOT, 'data', 'applications.md');
const CV_PATH = resolve(ROOT, 'cv.md');
const OUTPUT_DIR = resolve(ROOT, 'output');
const CL_DIR = resolve(ROOT, 'output', 'cover-letters');
const RESUME_DOCX = resolve(ROOT, 'output', 'Matt_Amundson_TOP_2026.docx');

// ATS domains that submit-dispatch.mjs can handle
const SUPPORTED_ATS = [
  'greenhouse.io', 'boards.greenhouse.io', 'job-boards.greenhouse.io',
  'lever.co', 'jobs.lever.co',
  'ashbyhq.com', 'jobs.ashbyhq.com',
  'smartrecruiters.com', 'jobs.smartrecruiters.com',
  'workable.com', 'apply.workable.com',
];

function isSupportedAts(url) {
  return SUPPORTED_ATS.some(d => url.includes(d));
}

function detectAts(url) {
  if (url.includes('greenhouse')) return 'greenhouse';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('ashby')) return 'ashby';
  if (url.includes('smartrecruiters')) return 'smartrecruiters';
  if (url.includes('workable')) return 'workable';
  if (url.includes('workday')) return 'workday';
  if (url.includes('icims')) return 'icims';
  if (url.includes('linkedin.com')) return 'linkedin-aggregator';
  if (url.includes('indeed.com')) return 'indeed-aggregator';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Parse apply-queue.md — extract structured application entries
// ---------------------------------------------------------------------------
function parseApplyQueue() {
  if (!existsSync(APPLY_QUEUE)) return [];

  const text = readFileSync(APPLY_QUEUE, 'utf8');
  const lines = text.split('\n');
  const entries = [];
  let current = null;

  for (const line of lines) {
    // Match section headers: ### N. Company — Role [ID — Status]
    const headerMatch = line.match(/^###\s+\d+\.\s+(.+?)\s+—\s+(.+?)\s+\[(\d+)\s*—?\s*(.*?)\]/);
    if (headerMatch) {
      if (current) entries.push(current);
      current = {
        company: headerMatch[1].trim(),
        role: headerMatch[2].trim(),
        appId: headerMatch[3].padStart(3, '0'),
        queueStatus: headerMatch[4].trim(),
        applyUrl: null,
        pdfPath: null,
        clPath: null,
        salary: null,
        remote: null,
        status: 'pending',
        blockers: [],
      };
      continue;
    }

    if (!current) continue;

    // Extract fields from bullet points
    const urlMatch = line.match(/\*\*Apply URL:\*\*\s*(https?:\/\/\S+)/);
    if (urlMatch) current.applyUrl = urlMatch[1];

    const pdfMatch = line.match(/\*\*PDF:\*\*\s*(\S+)/);
    if (pdfMatch) current.pdfPath = pdfMatch[1];

    const clMatch = line.match(/\*\*CL:\*\*\s*(\S+)/);
    if (clMatch) current.clPath = clMatch[1];

    const salaryMatch = line.match(/\*\*Salary:\*\*\s*(.+)/);
    if (salaryMatch) current.salary = salaryMatch[1].trim();

    const remoteMatch = line.match(/\*\*Remote:\*\*\s*(.+)/);
    if (remoteMatch) current.remote = remoteMatch[1].trim();

    // Check for blockers
    if (line.match(/\[ \]\s+\*\*/) && line.match(/confirm|verify|resolve|check/i)) {
      current.blockers.push(line.replace(/^[\s-]*\[ \]\s*/, '').trim());
    }

    // Status line
    const statusMatch = line.match(/\*\*Status:\*\*\s*\[([x ])\]\s*(.*)/);
    if (statusMatch) {
      current.status = statusMatch[1] === 'x' ? 'submitted' : 'pending';
    }
  }
  if (current) entries.push(current);

  return entries;
}

// ---------------------------------------------------------------------------
// Generate cover letter using Claude API
// ---------------------------------------------------------------------------
async function generateCoverLetter(entry) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn(`  [CL] ANTHROPIC_API_KEY not set — cannot generate cover letter`);
    return null;
  }

  const cvText = existsSync(CV_PATH) ? readFileSync(CV_PATH, 'utf8').slice(0, 4000) : '';

  const prompt = `Write a concise, professional cover letter (250-350 words) for this job application.

Candidate: Matthew M. Amundson
Current Role: Director of IT & Analytics at Greenfield Metal Sales LLC
Key Skills: Power BI, Microsoft Fabric, Azure Data (ADF, Synapse, ADLS Gen2), SQL, Python, ERP Integration, DAX, Semantic Models

Target Company: ${entry.company}
Target Role: ${entry.role}
${entry.salary ? `Salary Range: ${entry.salary}` : ''}
${entry.remote ? `Remote: ${entry.remote}` : ''}

CV Summary:
${cvText.slice(0, 2000)}

Guidelines:
- Opening: Express genuine interest in the specific role and company
- Body: Connect 2-3 specific experiences from the CV to job requirements
- Include concrete metrics (e.g., "reduced review time from 2 hours to 5 minutes")
- Closing: Express enthusiasm and request next steps
- Tone: Professional but warm, confident but not arrogant
- NO generic filler — every sentence must add value
- Sign off with: Matthew M. Amundson

Output ONLY the cover letter text, no additional commentary.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.content[0]?.text || null;
  } catch (err) {
    console.warn(`  [CL] Generation failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Submit a single application
// ---------------------------------------------------------------------------
function submitApplication(entry) {
  const pdfPath = entry.pdfPath ? resolve(ROOT, entry.pdfPath) : RESUME_DOCX;
  const clPath = entry.clPath ? resolve(ROOT, entry.clPath) : null;

  if (!existsSync(pdfPath)) {
    console.error(`  [SUBMIT] Resume not found: ${pdfPath}`);
    return { success: false, error: 'resume-not-found' };
  }

  const cmdArgs = [
    'scripts/submit-dispatch.mjs',
    '--app-id', entry.appId,
    '--pdf', pdfPath,
  ];
  if (clPath && existsSync(clPath)) {
    cmdArgs.push('--cover-letter', clPath);
  }
  cmdArgs.push('--live');

  try {
    console.log(`  [SUBMIT] Dispatching: node ${cmdArgs.join(' ')}`);
    execFileSync(process.execPath, cmdArgs, { cwd: ROOT, stdio: 'inherit', timeout: 120000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const entries = parseApplyQueue();

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  AUTO-APPLY BATCH PROCESSOR');
  console.log(`  Mode: ${LIVE ? '🔴 LIVE — SUBMITTING FOR REAL' : '🟡 DRY RUN — no submissions'}`);
  console.log(`  Queue: ${entries.length} total entries`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Categorize entries
  const ready = entries.filter(e =>
    e.applyUrl &&
    e.status === 'pending' &&
    (e.queueStatus === 'GO' || e.queueStatus === 'Ready to Submit') &&
    e.blockers.length === 0 &&
    isSupportedAts(e.applyUrl)
  );
  const blocked = entries.filter(e => e.blockers.length > 0);
  const aggregator = entries.filter(e => e.applyUrl && (e.applyUrl.includes('linkedin.com') || e.applyUrl.includes('indeed.com')));
  const unsupported = entries.filter(e => e.applyUrl && !isSupportedAts(e.applyUrl) && !e.applyUrl.includes('linkedin.com') && !e.applyUrl.includes('indeed.com'));
  const noUrl = entries.filter(e => !e.applyUrl);

  console.log('QUEUE BREAKDOWN:');
  console.log(`  ✅ Ready to submit (supported ATS):  ${ready.length}`);
  console.log(`  🔗 Aggregator URLs (LinkedIn/Indeed): ${aggregator.length}`);
  console.log(`  ⛔ Blocked (unresolved blockers):     ${blocked.length}`);
  console.log(`  ❓ Unsupported ATS:                   ${unsupported.length}`);
  console.log(`  ❌ No apply URL:                      ${noUrl.length}`);
  console.log('');

  if (STATUS_ONLY) {
    console.log('READY TO SUBMIT:');
    for (const e of ready) {
      const ats = detectAts(e.applyUrl);
      const hasCl = e.clPath && existsSync(resolve(ROOT, e.clPath));
      const hasPdf = e.pdfPath && existsSync(resolve(ROOT, e.pdfPath));
      console.log(`  [${e.appId}] ${e.company} — ${e.role}`);
      console.log(`        ATS: ${ats} | PDF: ${hasPdf ? '✅' : '❌'} | CL: ${hasCl ? '✅' : '❌'} | ${e.salary || 'salary unknown'}`);
    }
    if (aggregator.length > 0) {
      console.log('');
      console.log('AGGREGATOR URLs (need resolve-aggregator-urls.mjs):');
      for (const e of aggregator) {
        console.log(`  [${e.appId}] ${e.company} — ${e.role} → ${e.applyUrl.slice(0, 60)}`);
      }
    }
    return;
  }

  // Filter to specific IDs if provided
  let toProcess = SPECIFIC_IDS
    ? ready.filter(e => SPECIFIC_IDS.includes(e.appId))
    : ready;
  toProcess = toProcess.slice(0, MAX_SUBMISSIONS);

  if (toProcess.length === 0) {
    console.log('No applications ready for submission.');
    if (aggregator.length > 0) {
      console.log(`\nTip: ${aggregator.length} applications have LinkedIn/Indeed URLs.`);
      console.log('Run: node scripts/resolve-aggregator-urls.mjs --apply');
    }
    return;
  }

  console.log(`PROCESSING ${toProcess.length} APPLICATION(S):`);
  console.log('');

  const results = { submitted: 0, clGenerated: 0, failed: 0, skipped: 0 };

  for (let i = 0; i < toProcess.length; i++) {
    const entry = toProcess[i];
    const ats = detectAts(entry.applyUrl);
    console.log(`[${i + 1}/${toProcess.length}] ${entry.company} — ${entry.role} (${ats})`);
    console.log(`  App ID: ${entry.appId} | URL: ${entry.applyUrl.slice(0, 80)}`);

    // Check/generate cover letter
    const clFullPath = entry.clPath ? resolve(ROOT, entry.clPath) : null;
    if (!clFullPath || !existsSync(clFullPath)) {
      if (GENERATE_CL || LIVE) {
        console.log('  [CL] Generating cover letter...');
        const clText = await generateCoverLetter(entry);
        if (clText) {
          mkdirSync(CL_DIR, { recursive: true });
          const slug = entry.company.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const clFile = resolve(CL_DIR, `${slug}-auto-${entry.appId}.txt`);
          writeFileSync(clFile, clText, 'utf8');
          entry.clPath = `output/cover-letters/${slug}-auto-${entry.appId}.txt`;
          console.log(`  [CL] ✅ Written: ${entry.clPath}`);
          results.clGenerated++;
        }
      } else {
        console.log('  [CL] ❌ Missing — use --generate-cl or --live to auto-generate');
      }
    } else {
      console.log(`  [CL] ✅ Found: ${entry.clPath}`);
    }

    // Check resume
    const pdfFullPath = entry.pdfPath ? resolve(ROOT, entry.pdfPath) : null;
    if (pdfFullPath && existsSync(pdfFullPath)) {
      console.log(`  [PDF] ✅ Found: ${entry.pdfPath}`);
    } else if (existsSync(RESUME_DOCX)) {
      console.log(`  [PDF] Using default: ${RESUME_DOCX}`);
    } else {
      console.log('  [PDF] ❌ No resume found — skipping');
      results.skipped++;
      continue;
    }

    // Submit
    if (LIVE) {
      console.log('  [SUBMIT] 🔴 SUBMITTING...');
      const result = submitApplication(entry);
      if (result.success) {
        console.log('  [SUBMIT] ✅ SUCCESS');
        results.submitted++;
      } else {
        console.log(`  [SUBMIT] ❌ FAILED: ${result.error}`);
        results.failed++;
      }
    } else {
      console.log('  [DRY-RUN] Would submit via submit-dispatch.mjs');
      results.skipped++;
    }

    console.log('');

    // Rate limit: 3 seconds between submissions
    if (LIVE && i < toProcess.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('RESULTS:');
  if (LIVE) {
    console.log(`  Submitted:       ${results.submitted}`);
    console.log(`  CL generated:    ${results.clGenerated}`);
    console.log(`  Failed:          ${results.failed}`);
  } else {
    console.log(`  Would submit:    ${toProcess.length}`);
    console.log(`  CL generated:    ${results.clGenerated}`);
    console.log('');
    console.log('  To submit for real: node scripts/auto-apply-batch.mjs --live');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  appendAutomationEvent(ROOT, {
    type: 'auto_apply_batch',
    status: LIVE ? 'live' : 'dry_run',
    summary: LIVE
      ? `Submitted ${results.submitted} applications (${results.failed} failed)`
      : `Dry run: ${toProcess.length} applications ready`,
    details: {
      ...results,
      processed: toProcess.map(e => ({ appId: e.appId, company: e.company, role: e.role, ats: detectAts(e.applyUrl) })),
    },
  });
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
