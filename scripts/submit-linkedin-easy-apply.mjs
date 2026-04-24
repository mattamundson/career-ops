#!/usr/bin/env node
/**
 * submit-linkedin-easy-apply.mjs — LinkedIn Easy Apply prep (Playwright)
 *
 * LinkedIn's Terms of Service restrict automation. This script is for your own
 * account, human-supervised: it opens the job, starts Easy Apply, steps through
 * wizard pages filling from config/profile.yml, and stops for review (no final
 * submit unless you pass --auto-submit, which is discouraged).
 *
 * Session directory: .playwright-session-linkedin/ if it exists, else
 * .playwright-session. Override with CAREER_OPS_LINKEDIN_SESSION_DIR.
 * Log in once headfully if the flow hits the auth wall.
 *
 * Usage:
 *   node scripts/submit-linkedin-easy-apply.mjs --url "https://www.linkedin.com/jobs/view/..." --pdf out/cv-matt-x.pdf [--cover-letter out/cover.txt] [--live]
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChromePreflight } from './lib/chrome-preflight.mjs';
import { loadProjectEnv } from './load-env.mjs';
import { getFormFields } from './profile-fields.mjs';
import { runStandardAtsFill } from './lib/ats-form-fill.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

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
  console.error('[linkedin-easy-apply] CAREER_OPS_AUTOAPPLY_DISABLED=1 — exiting.');
  process.exit(0);
}
if (process.env.CAREER_OPS_LINKEDIN_EASYAPPLY === '0') {
  console.error('[linkedin-easy-apply] CAREER_OPS_LINKEDIN_EASYAPPLY=0 — exiting.');
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

if (!applyUrl || !/linkedin\.com\/jobs\//i.test(applyUrl)) {
  console.error(
    'Usage: job URL must be a LinkedIn jobs page, e.g. https://www.linkedin.com/jobs/view/123',
  );
  console.error('  node scripts/submit-linkedin-easy-apply.mjs --url <url> --pdf <resume.pdf> [--cover-letter f.txt] [--live]');
  process.exit(1);
}

let formFields;
try {
  formFields = getFormFields();
} catch (e) {
  console.error(`[linkedin-easy-apply] ${e.message}`);
  process.exit(1);
}

const linkedinSession = process.env.CAREER_OPS_LINKEDIN_SESSION_DIR
  ? resolve(ROOT, process.env.CAREER_OPS_LINKEDIN_SESSION_DIR)
  : existsSync(resolve(ROOT, '.playwright-session-linkedin'))
    ? resolve(ROOT, '.playwright-session-linkedin')
    : resolve(ROOT, '.playwright-session');

console.log(`[linkedin-easy-apply] URL: ${applyUrl}`);
console.log(`[linkedin-easy-apply] Session: ${linkedinSession}`);
console.log(
  `[linkedin-easy-apply] Mode: ${LIVE ? (AUTO_SUBMIT ? 'LIVE + AUTO-SUBMIT' : 'LIVE') : 'DRY-RUN'}`,
);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('[linkedin-easy-apply] Playwright not installed.');
  process.exit(1);
}

runChromePreflight('linkedin-easy-apply');
const launchHeadless = LIVE ? HEADLESS : (HEADLESS || true);

let browser;
try {
  mkdirSync(linkedinSession, { recursive: true });
  browser = await chromium.launchPersistentContext(linkedinSession, {
    headless: launchHeadless,
    viewport: { width: 1280, height: 900 },
  });
} catch (err) {
  const fallbackSessionDir = resolve(ROOT, '.playwright-session-fallback', `li-${Date.now()}`);
  mkdirSync(fallbackSessionDir, { recursive: true });
  console.warn(`[linkedin-easy-apply] Session launch failed, retry: ${fallbackSessionDir}`);
  browser = await chromium.launchPersistentContext(fallbackSessionDir, {
    headless: launchHeadless,
    viewport: { width: 1280, height: 900 },
  });
}

const page = await browser.newPage();

try {
  console.log('[linkedin-easy-apply] Loading job page…');
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(4000);

  const easyCandidates = [
    () => page.getByRole('button', { name: /easy apply/i }),
    () => page.locator('button[aria-label*="Easy Apply" i]'),
    () => page.locator('.jobs-apply-button--top-card button').first(),
    () => page.locator('button:has-text("Easy Apply")'),
  ];
  let opened = false;
  for (const getLoc of easyCandidates) {
    const el = getLoc();
    try {
      if (await el.count() > 0) {
        await el.first().click({ timeout: 12_000 });
        opened = true;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!opened) {
    throw new Error(
      'Could not find Easy Apply — log in to LinkedIn (use --live without --headless) or see docs/tos-risk-register.md',
    );
  }
  await page.waitForTimeout(3000);

  for (let step = 0; step < 12; step++) {
    const scope = page.locator('[role="dialog"]').last();
    await scope.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
    console.log(`[linkedin-easy-apply] Filling step ${step + 1}…`);
    await runStandardAtsFill(scope, formFields, { pdfPath, coverPath });

    const submit = scope.getByRole('button', { name: /^submit( application)?$/i }).first();
    if (await submit.count() > 0 && (await submit.isVisible().catch(() => false))) {
      if (DRY_RUN || !AUTO_SUBMIT) {
        console.log('[linkedin-easy-apply] Reached submit step — not clicking (use --auto-submit to force).');
        break;
      }
      await submit.click();
      await page.waitForTimeout(4000);
      break;
    }

    const next1 = scope.getByRole('button', { name: /^(Next|Continue)$/i });
    const next2 = scope.locator('button[aria-label*="Continue" i]');
    let advance = (await next1.count()) > 0 ? next1.first() : (await next2.count()) > 0 ? next2.first() : null;
    if (!advance) break;
    await advance.click();
    await page.waitForTimeout(2500);
  }

  const shotDir = resolve(ROOT, '.playwright-mcp');
  mkdirSync(shotDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const shotPath = resolve(shotDir, `linkedin-easy-apply-${appId || 'no-id'}-${ts}.png`);
  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
  console.log(`[linkedin-easy-apply] 📸 Screenshot: ${shotPath}`);

  appendAutomationEvent(ROOT, {
    type: 'linkedin_easy_apply.dry_run',
    status: 'success',
    app_id: appId,
    url: applyUrl,
    screenshot: shotPath,
  });

  if (LIVE && !AUTO_SUBMIT) {
    console.log('[linkedin-easy-apply] Review the Easy Apply flow in the window; press ENTER when done…');
    await new Promise((r) => process.stdin.once('data', r));
  }
} catch (err) {
  console.error(`[linkedin-easy-apply] ${err.message}`);
  appendAutomationEvent(ROOT, {
    type: 'linkedin_easy_apply.failed',
    status: 'failure',
    app_id: appId,
    url: applyUrl,
    error: err.message,
  });
  process.exitCode = 1;
} finally {
  console.log('[linkedin-easy-apply] Closing browser…');
  await browser.close();
}
