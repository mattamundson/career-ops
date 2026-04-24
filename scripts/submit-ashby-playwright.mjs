#!/usr/bin/env node
/**
 * submit-ashby-playwright.mjs — Ashby-optimized Playwright application prep
 *
 * There is no public candidate-side JSON API for Ashby; employer keys gate
 * applicationForm.submit. This script is the first-class path from
 * submit-dispatch: Ashby-specific Apply/iframe heuristics + shared
 * profile-based fill (config/profile.yml).
 *
 * Does not auto-click final submit unless --auto-submit (discouraged; see CLAUDE.md).
 *
 * Usage: same as submit-universal-playwright.mjs
 */
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runChromePreflight } from './lib/chrome-preflight.mjs';
import { loadProjectEnv } from './load-env.mjs';
import { getFormFields } from './profile-fields.mjs';
import { runPlaywrightAtsApplyFlow, ASHBY_APPLY_SELECTORS } from './lib/run-playwright-ats-apply.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  return args[i + 1] ?? true;
}

const appId = getArg('app-id');
const urlOverride = getArg('url');
const pdfPath = getArg('pdf') || resolve(ROOT, 'output', 'Matt_Amundson_TOP_2026.docx');
const coverPath = getArg('cover-letter');
const LIVE = args.includes('--live');
const AUTO_SUBMIT = args.includes('--auto-submit');
const HEADLESS = args.includes('--headless');
const DRY_RUN = !LIVE;

if (process.env.CAREER_OPS_AUTOAPPLY_DISABLED === '1') {
  console.error('[ashby-playwright] CAREER_OPS_AUTOAPPLY_DISABLED=1 — exiting.');
  process.exit(0);
}

let applyUrl = typeof urlOverride === 'string' ? urlOverride : null;
if (!applyUrl && appId) {
  const queueFile = resolve(ROOT, 'data', 'apply-queue.md');
  if (existsSync(queueFile)) {
    const lines = readFileSync(queueFile, 'utf8').split('\n');
    const normId = String(appId).padStart(3, '0');
    const hIdx = lines.findIndex(
      (l) => /^### /.test(l) && (l.includes(`[${appId} `) || l.includes(`[${normId} `)),
    );
    if (hIdx !== -1) {
      for (let i = hIdx; i < Math.min(hIdx + 15, lines.length); i++) {
        const m = lines[i].match(/\*\*Apply URL:\*\*\s*(https?:\/\/\S+)/);
        if (m) {
          applyUrl = m[1];
          break;
        }
      }
    }
  }
}

if (!applyUrl) {
  console.error('Usage: node scripts/submit-ashby-playwright.mjs --url <ashby_url> --pdf <resume.pdf> [--cover-letter cl.txt] [--live]');
  process.exit(1);
}

let formFields;
try {
  formFields = getFormFields();
} catch (e) {
  console.error(`[ashby-playwright] ${e.message}`);
  process.exit(1);
}

console.log(`[ashby-playwright] URL: ${applyUrl}`);
console.log(`[ashby-playwright] Resume: ${pdfPath}`);
console.log(
  `[ashby-playwright] Mode: ${LIVE ? (AUTO_SUBMIT ? 'LIVE + AUTO-SUBMIT' : 'LIVE (manual submit)') : 'DRY-RUN'}`,
);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('[ashby-playwright] Playwright not installed. Run: pnpm add playwright');
  process.exit(1);
}

runChromePreflight('ashby-playwright');

const launchHeadless = LIVE ? HEADLESS : (HEADLESS || true);

let browser;
try {
  browser = await chromium.launchPersistentContext('.playwright-session', {
    headless: launchHeadless,
    viewport: { width: 1280, height: 900 },
  });
} catch (err) {
  const fallbackSessionDir = resolve(ROOT, '.playwright-session-fallback', String(Date.now()));
  mkdirSync(fallbackSessionDir, { recursive: true });
  console.warn(
    `[ashby-playwright] Persistent session failed (${err.message}). Retrying: ${fallbackSessionDir}`,
  );
  browser = await chromium.launchPersistentContext(fallbackSessionDir, {
    headless: launchHeadless,
    viewport: { width: 1280, height: 900 },
  });
}

try {
  await runPlaywrightAtsApplyFlow(ROOT, {
    browser,
    applyUrl,
    pdfPath,
    coverPath,
    appId,
    DRY_RUN,
    AUTO_SUBMIT,
    formFields,
    logPrefix: '[ashby-playwright]',
    applySelectors: ASHBY_APPLY_SELECTORS,
    automationTypePrefix: 'ashby_playwright',
  });
} catch {
  process.exitCode = 1;
} finally {
  console.log('[ashby-playwright] Closing browser...');
  await browser.close();
}
