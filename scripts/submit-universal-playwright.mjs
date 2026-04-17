#!/usr/bin/env node
/**
 * submit-universal-playwright.mjs — Playwright-based form-fill submitter
 *
 * Works with any ATS web form by:
 * 1. Navigating to the apply URL
 * 2. Detecting form fields (name, email, phone, resume upload, etc.)
 * 3. Auto-filling with profile data from config/profile.yml
 * 4. Uploading resume PDF and cover letter
 * 5. Submitting the form (or pausing for human review)
 *
 * Usage:
 *   node scripts/submit-universal-playwright.mjs --url <apply_url> --pdf <resume.pdf> [--cover-letter <cl.txt>] [--live]
 *   node scripts/submit-universal-playwright.mjs --app-id 025 --live
 *
 * SAFETY: Opens a visible browser window. In --live mode, auto-fills but
 * waits for you to verify before clicking Submit (unless --auto-submit is passed).
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { runChromePreflight } from './lib/chrome-preflight.mjs';
import { loadProjectEnv } from './load-env.mjs';

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

// Profile data
const PROFILE = {
  first_name: 'Matthew',
  last_name: 'Amundson',
  full_name: 'Matthew M. Amundson',
  email: 'MattMAmundson@gmail.com',
  phone: '612-877-1189',
  location: 'Minneapolis, MN',
  linkedin: 'https://linkedin.com/in/mmamundson',
  github: 'https://github.com/mattamundson',
  current_title: 'Director of IT & Analytics',
  current_employer: 'Greenfield Metal Sales LLC',
  years_experience: '10',
  work_authorization: 'US Citizen',
  sponsorship_needed: 'No',
};

// Resolve apply URL
let applyUrl = typeof urlOverride === 'string' ? urlOverride : null;
if (!applyUrl && appId) {
  const queueFile = resolve(ROOT, 'data', 'apply-queue.md');
  if (existsSync(queueFile)) {
    const lines = readFileSync(queueFile, 'utf8').split('\n');
    const normId = String(appId).padStart(3, '0');
    const hIdx = lines.findIndex(l => /^### /.test(l) && (l.includes(`[${appId} `) || l.includes(`[${normId} `)));
    if (hIdx !== -1) {
      for (let i = hIdx; i < Math.min(hIdx + 15, lines.length); i++) {
        const m = lines[i].match(/\*\*Apply URL:\*\*\s*(https?:\/\/\S+)/);
        if (m) { applyUrl = m[1]; break; }
      }
    }
  }
}

if (!applyUrl) {
  console.error('Usage: node scripts/submit-universal-playwright.mjs --url <apply_url> --pdf <resume.pdf> [--live]');
  process.exit(1);
}

console.log(`[playwright-submit] URL: ${applyUrl}`);
console.log(`[playwright-submit] Resume: ${pdfPath}`);
console.log(`[playwright-submit] Mode: ${LIVE ? (AUTO_SUBMIT ? 'LIVE + AUTO-SUBMIT' : 'LIVE (manual submit)') : 'DRY-RUN'}`);

if (!LIVE) {
  console.log('\n[playwright-submit] DRY-RUN — would open browser, fill form, and wait for human submit.');
  console.log('Use --live to open browser and fill the form.');
  process.exit(0);
}

// ---- Playwright form-fill logic ----
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('[playwright-submit] Playwright not installed. Run: pnpm add playwright');
  process.exit(1);
}

runChromePreflight('playwright-submit');

const browser = await chromium.launchPersistentContext('.playwright-session', {
  headless: false,
  viewport: { width: 1280, height: 900 },
});

const page = await browser.newPage();

try {
  console.log('[playwright-submit] Navigating to apply page...');
  await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Look for "Apply" button on job listing pages (Greenhouse, Lever show job details first)
  const applySelectors = [
    'a:has-text("Apply for this job")',
    'a:has-text("Apply Now")',
    'button:has-text("Apply for this job")',
    'button:has-text("Apply Now")',
    'a:has-text("Apply")',
    'button:has-text("Apply")',
    '#apply_button',
    '.apply-button',
    'a[data-toggle="greenhouse-application"]',
  ];
  for (const sel of applySelectors) {
    const btn = page.locator(sel).first();
    try {
      if (await btn.count() > 0 && await btn.isVisible({ timeout: 2000 })) {
        console.log(`[playwright-submit] Found Apply button (${sel}) — clicking...`);
        await btn.click();
        await page.waitForTimeout(4000);
        break;
      }
    } catch { /* try next selector */ }
  }

  // Handle iframes — Greenhouse embeds the form in an iframe
  const iframes = page.frameLocator('iframe');
  let formPage = page;
  try {
    const iframeForm = iframes.first.locator('input[type="text"], input[type="email"]');
    if (await iframeForm.count() > 0) {
      console.log('[playwright-submit] Form detected inside iframe — switching context');
      formPage = iframes.first;
    }
  } catch { /* no iframe, use main page */ }

  // ---- Auto-fill form fields ----
  console.log('[playwright-submit] Detecting and filling form fields...');

  // Field mapping: label patterns → profile values
  const fieldMappings = [
    { patterns: [/first.?name/i], value: PROFILE.first_name },
    { patterns: [/last.?name/i], value: PROFILE.last_name },
    { patterns: [/full.?name/i, /^name$/i], value: PROFILE.full_name },
    { patterns: [/email/i, /e-mail/i], value: PROFILE.email },
    { patterns: [/phone/i, /mobile/i, /cell/i], value: PROFILE.phone },
    { patterns: [/linkedin/i], value: PROFILE.linkedin },
    { patterns: [/github/i, /portfolio/i, /website/i], value: PROFILE.github },
    { patterns: [/location/i, /city/i, /address/i], value: PROFILE.location },
    { patterns: [/current.?title/i, /job.?title/i], value: PROFILE.current_title },
    { patterns: [/current.?company/i, /current.?employer/i, /company.?name/i], value: PROFILE.current_employer },
    { patterns: [/years?.?of?.?experience/i], value: PROFILE.years_experience },
  ];

  // Find all visible input fields and fill them
  const inputs = await formPage.locator('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea').all();

  for (const input of inputs) {
    try {
      if (!await input.isVisible()) continue;

      // Get field context: label, placeholder, name, aria-label
      const label = await input.evaluate(el => {
        const id = el.id;
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
        const ariaLabel = el.getAttribute('aria-label') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const name = el.getAttribute('name') || '';
        const parentLabel = el.closest('label')?.textContent?.trim() || '';
        return `${labelEl?.textContent || ''} ${ariaLabel} ${placeholder} ${name} ${parentLabel}`.trim();
      });

      if (!label) continue;

      // Match against field mappings
      for (const mapping of fieldMappings) {
        if (mapping.patterns.some(p => p.test(label))) {
          const currentValue = await input.inputValue().catch(() => '');
          if (!currentValue) {
            await input.fill(mapping.value);
            console.log(`  ✅ Filled: "${label.slice(0, 40)}" → "${mapping.value}"`);
          }
          break;
        }
      }
    } catch { /* skip inaccessible fields */ }
  }

  // Handle select dropdowns for work authorization, sponsorship, etc.
  const selects = await formPage.locator('select').all();
  for (const select of selects) {
    try {
      if (!await select.isVisible()) continue;
      const label = await select.evaluate(el => {
        const id = el.id;
        const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
        return (labelEl?.textContent || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim();
      });

      if (/sponsorship|visa|authorization|legally/i.test(label)) {
        // Try to select "No" for sponsorship, "Yes" for work authorization
        const options = await select.locator('option').allTextContents();
        if (/sponsorship/i.test(label)) {
          const noOption = options.find(o => /^no$/i.test(o.trim()));
          if (noOption) {
            await select.selectOption({ label: noOption });
            console.log(`  ✅ Selected: "${label.slice(0, 40)}" → "No"`);
          }
        } else if (/authorization|legally/i.test(label)) {
          const yesOption = options.find(o => /^yes$/i.test(o.trim()));
          if (yesOption) {
            await select.selectOption({ label: yesOption });
            console.log(`  ✅ Selected: "${label.slice(0, 40)}" → "Yes"`);
          }
        }
      }
    } catch { /* skip */ }
  }

  // ---- Upload resume ----
  const fileInputs = await formPage.locator('input[type="file"]').all();
  if (fileInputs.length > 0 && existsSync(pdfPath)) {
    try {
      await fileInputs[0].setInputFiles(pdfPath);
      console.log(`  ✅ Uploaded resume: ${pdfPath}`);

      // If there's a second file input and we have a cover letter, upload it
      if (fileInputs.length > 1 && coverPath && existsSync(coverPath)) {
        await fileInputs[1].setInputFiles(coverPath);
        console.log(`  ✅ Uploaded cover letter: ${coverPath}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ File upload failed: ${err.message}`);
    }
  } else {
    // Try clicking "Upload Resume" or "Attach" button
    const uploadBtn = formPage.locator('button:has-text("Upload"), button:has-text("Attach"), label:has-text("Upload"), label:has-text("Resume")').first();
    if (await uploadBtn.count() > 0) {
      console.log('  ℹ️ Found upload button — click it manually to attach resume');
    }
  }

  // ---- Handle cover letter text field ----
  if (coverPath && existsSync(coverPath)) {
    const clText = readFileSync(coverPath, 'utf8');
    const clTextarea = formPage.locator('textarea[name*="cover"], textarea[id*="cover"], textarea[aria-label*="cover"]').first();
    if (await clTextarea.count() > 0) {
      await clTextarea.fill(clText);
      console.log('  ✅ Filled cover letter textarea');
    }
  }

  console.log('');
  console.log('[playwright-submit] ✅ Form filling complete!');

  if (AUTO_SUBMIT) {
    // Find and click submit button
    const submitBtn = formPage.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply")').last();
    if (await submitBtn.count() > 0) {
      console.log('[playwright-submit] 🔴 AUTO-SUBMITTING...');
      await submitBtn.click();
      await page.waitForTimeout(5000);
      console.log('[playwright-submit] ✅ Form submitted!');

      appendAutomationEvent(ROOT, {
        type: 'playwright_submit.completed',
        status: 'success',
        app_id: appId,
        url: applyUrl,
        summary: `Playwright auto-submitted application`,
      });
    }
  } else {
    console.log('[playwright-submit] 🟡 Review the form in the browser window, then click Submit manually.');
    console.log('[playwright-submit] Press ENTER in this terminal when done...');
    await new Promise(resolve => process.stdin.once('data', resolve));

    appendAutomationEvent(ROOT, {
      type: 'playwright_submit.manual',
      status: 'success',
      app_id: appId,
      url: applyUrl,
      summary: `Playwright form-filled, manual submit by user`,
    });
  }

} catch (err) {
  console.error(`[playwright-submit] Error: ${err.message}`);
  appendAutomationEvent(ROOT, {
    type: 'playwright_submit.failed',
    status: 'failure',
    app_id: appId,
    url: applyUrl,
    error: err.message,
  });
} finally {
  console.log('[playwright-submit] Closing browser...');
  await browser.close();
}
