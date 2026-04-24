#!/usr/bin/env node
/**
 * submit-dispatch.mjs
 * Routes applications to the correct ATS submitter based on domain detection
 *
 * Reads data/applications.md, finds row by --app-id, extracts apply_url,
 * detects ATS from URL domain, and invokes the appropriate submitter.
 *
 * Supported ATSs:
 *   - Greenhouse → submit-greenhouse.mjs
 *   - Ashby → submit-ashby-playwright.mjs (no public candidate JSON API; profile-driven fill)
 *   - LinkedIn jobs → submit-linkedin-easy-apply.mjs (ToS: supervised use; see docs/tos-risk-register.md)
 *   - Lever → submit-lever.mjs
 *   - SmartRecruiters / Workable → submit-*.mjs or missing-file → universal Playwright
 *   - Workday / iCIMS → dedicated Playwright (warnings below)
 *   - Unknown / long tail → submit-universal-playwright.mjs
 *
 * Usage:
 *   node scripts/submit-dispatch.mjs --app-id 025 --pdf resume.pdf --cover-letter cl.txt --dry-run
 *   node scripts/submit-dispatch.mjs --app-id 025 --pdf resume.pdf --dry-run --live
 *
 * The dispatcher passes through all CLI args to the selected submitter.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { writeApplicationIndex } from './lib/career-data.mjs';
import { selectBestResume } from './lib/resume-selector.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// ---- Parse CLI args ----
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  return args[i + 1] ?? true;
}

const appId = getArg('app-id');

if (!appId) {
  console.error('Usage: node scripts/submit-dispatch.mjs --app-id <N> --pdf <path> [--cover-letter <path>] [--dry-run|--live]');
  process.exit(1);
}

const normId = appId.padStart(3, '0');
const { snapshot, filePath: indexPath } = writeApplicationIndex(ROOT);
const appRecord = snapshot.records.find((record) => record.id === normId) || null;
const applyUrl = appRecord?.applyUrl || null;
const appMeta = {
  company: appRecord?.company || null,
  role: appRecord?.role || null,
};

if (!applyUrl) {
  appendAutomationEvent(ROOT, {
    type: 'dispatch_lookup_failed',
    app_id: normId,
    reason: 'missing_apply_url',
  });
  console.error(`[submit-dispatch] Could not locate apply_url for app-id=${appId}.`);
  console.error(`  Checked canonical snapshot: ${indexPath}`);
  console.error('  Fix: add the app row to data/applications.md (tracker), or add a matching ### section with **Apply URL:** in data/apply-queue.md.');
  process.exit(1);
}

console.log(`[submit-dispatch] Found apply_url: ${applyUrl}`);

// ---- Detect ATS from domain ----
let ats = 'unknown';
let submitter = null;

if (applyUrl.includes('greenhouse')) {
  ats = 'greenhouse';
  submitter = 'submit-greenhouse.mjs';
} else if (/linkedin\.com\/jobs\//i.test(applyUrl)) {
  ats = 'linkedin';
  submitter = 'submit-linkedin-easy-apply.mjs';
} else if (applyUrl.includes('ashby')) {
  ats = 'ashby';
  submitter = 'submit-ashby-playwright.mjs';
} else if (applyUrl.includes('lever.co')) {
  ats = 'lever';
  submitter = 'submit-lever.mjs';
} else if (applyUrl.includes('smartrecruiters')) {
  ats = 'smartrecruiters';
  submitter = 'submit-smartrecruiters.mjs';
} else if (applyUrl.includes('workable.com')) {
  ats = 'workable';
  submitter = 'submit-workable.mjs';
} else if (applyUrl.includes('workday.com')) {
  ats = 'workday';
  submitter = 'submit-workday.mjs';
  console.warn('[submit-dispatch] ⚠️ WorkDay requires Playwright-based form filling. Use submit-workday.mjs directly.');
} else if (applyUrl.includes('icims')) {
  ats = 'icims';
  submitter = 'submit-icims.mjs';
  console.warn('[submit-dispatch] ⚠️ iCIMS requires Playwright-based form filling. Use submit-icims.mjs directly.');
} else {
  appendAutomationEvent(ROOT, {
    type: 'dispatch_lookup_failed',
    app_id: normId,
    reason: 'unknown_ats',
    apply_url: applyUrl,
  });
  ats = 'unknown';
  submitter = 'submit-universal-playwright.mjs';
  console.warn(`[submit-dispatch] Unknown ATS for URL: ${applyUrl}`);
  console.warn('[submit-dispatch] Falling back to submit-universal-playwright.mjs for generic form automation.');
}

console.log(`[submit-dispatch] Detected ATS: ${ats}`);
console.log(`[submit-dispatch] Routing to: ${submitter}`);

// ---- Invoke submitter with pass-through args ----
let submitterPath = resolve(__dir, submitter);
if (!existsSync(submitterPath)) {
  // Missing script on disk (e.g. long-tail SmartRecruiters/Workable). Implement or use universal fallback.
  const universal = resolve(__dir, 'submit-universal-playwright.mjs');
  if (existsSync(universal)) {
    console.warn(`[submit-dispatch] Submitter file not found: ${submitter}. Falling back to submit-universal-playwright.mjs.`);
    submitter = 'submit-universal-playwright.mjs';
    submitterPath = universal;
  } else {
    console.error(`[submit-dispatch] Submitter not found and no fallback: ${submitterPath}`);
    process.exit(1);
  }
}

// Auto-resume selection: if --auto-resume is passed and no --pdf, pick best resume
if (args.includes('--auto-resume') && !args.includes('--pdf')) {
  const outputDir = resolve(ROOT, 'output');
  const cvPath = resolve(ROOT, 'cv.md');
  const cvText = existsSync(cvPath) ? readFileSync(cvPath, 'utf8') : '';
  const jdProxy = `Job Title: ${appMeta.role || ''}\nCompany: ${appMeta.company || ''}\nATS: ${ats}`;
  try {
    const ranked = await selectBestResume(jdProxy, outputDir, { cvText });
    if (ranked.length > 0) {
      console.log(`[submit-dispatch] Auto-resume selected: ${ranked[0].path}`);
      console.log(`[submit-dispatch]   Focus: ${ranked[0].focus} | Score: ${ranked[0].score.toFixed(3)} | ${ranked[0].reason}`);
      args.push('--pdf', ranked[0].path);
    } else {
      console.warn('[submit-dispatch] No resume PDFs found in output/ — skipping auto-resume');
    }
  } catch (err) {
    console.warn(`[submit-dispatch] Auto-resume failed: ${err.message} — provide --pdf manually`);
  }
}

// Inject --url so sub-submitters don't have to re-discover it from applications.md.
// If args already contains --url, leave the user's override in place.
let childArgs = args.includes('--url') ? args.slice() : [...args, '--url', applyUrl];
if (!childArgs.includes('--company') && appMeta.company) childArgs = [...childArgs, '--company', appMeta.company];
if (!childArgs.includes('--role') && appMeta.role) childArgs = [...childArgs, '--role', appMeta.role];

function writeDispatchResult(status, extra = {}) {
  const dir = resolve(ROOT, 'data', 'apply-runs');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+/, 'Z');
  const path = resolve(dir, `dispatch-${normId}-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify({
    appId: normId,
    ats,
    submitter,
    applyUrl,
    status,
    at: new Date().toISOString(),
    ...extra,
  }, null, 2)}\n`, 'utf8');
  console.log(`[submit-dispatch] Result artifact: ${path}`);
}

try {
  appendAutomationEvent(ROOT, {
    type: 'dispatch_started',
    app_id: normId,
    ats,
    submitter,
    apply_url: applyUrl,
    company: appMeta.company,
    role: appMeta.role,
  });
  console.log(`[submit-dispatch] Executing: node "${submitterPath}" ${childArgs.join(' ')}`);
  execSync(`node "${submitterPath}" ${childArgs.map(a => `"${a}"`).join(' ')}`, {
    cwd: ROOT,
    stdio: 'inherit'
  });
  writeDispatchResult('success', { company: appMeta.company, role: appMeta.role });
  appendAutomationEvent(ROOT, {
    type: 'dispatch_succeeded',
    app_id: normId,
    ats,
    submitter,
    apply_url: applyUrl,
    company: appMeta.company,
    role: appMeta.role,
  });
  process.exit(0);
} catch (err) {
  // Fallback: if JSON API submitter fails, try Playwright form-fill
  const playwrightFallback = resolve(__dir, 'submit-universal-playwright.mjs');
  if (existsSync(playwrightFallback) && !args.includes('--no-fallback')) {
    console.warn(`[submit-dispatch] JSON API submitter failed — falling back to Playwright form-fill`);
    console.warn(`[submit-dispatch] Reason: ${err.message.split('\n')[0]}`);
    try {
      const pwArgs = ['--url', applyUrl, '--app-id', normId];
      if (args.includes('--pdf')) pwArgs.push('--pdf', getArg('pdf'));
      if (args.includes('--cover-letter')) pwArgs.push('--cover-letter', getArg('cover-letter'));
      if (args.includes('--live')) pwArgs.push('--live');
      console.log(`[submit-dispatch] Playwright fallback: node "${playwrightFallback}" ${pwArgs.join(' ')}`);
      execSync(`node "${playwrightFallback}" ${pwArgs.map(a => `"${a}"`).join(' ')}`, {
        cwd: ROOT,
        stdio: 'inherit',
      });
      writeDispatchResult('success-playwright-fallback', { company: appMeta.company, role: appMeta.role });
      appendAutomationEvent(ROOT, {
        type: 'dispatch_succeeded_playwright_fallback',
        app_id: normId,
        ats,
        apply_url: applyUrl,
        company: appMeta.company,
        role: appMeta.role,
      });
      process.exit(0);
    } catch (pwErr) {
      console.error(`[submit-dispatch] Playwright fallback also failed: ${pwErr.message.split('\n')[0]}`);
    }
  }

  writeDispatchResult('failure', { company: appMeta.company, role: appMeta.role, error: err.message });
  appendAutomationEvent(ROOT, {
    type: 'dispatch_failed',
    app_id: normId,
    ats,
    submitter,
    apply_url: applyUrl,
    company: appMeta.company,
    role: appMeta.role,
    error: err.message,
  });
  console.error(`[submit-dispatch] Submitter failed: ${err.message}`);
  process.exit(1);
}
