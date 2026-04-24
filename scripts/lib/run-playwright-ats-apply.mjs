/**
 * Shared Playwright flow: session → page → apply CTA click → optional iframe → runStandardAtsFill → screenshot / submit.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { appendAutomationEvent } from './automation-events.mjs';
import { runStandardAtsFill } from './ats-form-fill.mjs';

const DEFAULT_UNIVERSAL_SELECTORS = [
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

/** Ashby job boards: primary apply entry points, then fall back to universal list. */
export const ASHBY_APPLY_SELECTORS = [
  'a[href*="/application"]',
  'a[href*="apply"]',
  'button:has-text("Apply for this job")',
  'button:has-text("Apply")',
  'a:has-text("Apply")',
  ...DEFAULT_UNIVERSAL_SELECTORS,
];

/**
 * @param {string} root - repo root
 * @param {object} p
 * @param {import('playwright').Browser} p.browser
 * @param {string} p.applyUrl
 * @param {string} p.pdfPath
 * @param {string} [p.coverPath]
 * @param {string|null} p.appId
 * @param {boolean} p.DRY_RUN
 * @param {boolean} p.AUTO_SUBMIT
 * @param {ReturnType<import('../profile-fields.mjs').getFormFields>} p.formFields
 * @param {string} [p.logPrefix]
 * @param {string[]} [p.applySelectors]
 * @param {string} [p.automationTypePrefix] - e.g. 'playwright_submit' | 'ashby_playwright'
 */
export async function runPlaywrightAtsApplyFlow(root, p) {
  const {
    browser,
    applyUrl,
    pdfPath,
    coverPath,
    appId,
    DRY_RUN,
    AUTO_SUBMIT,
    formFields,
    logPrefix = '[playwright-submit]',
    applySelectors = DEFAULT_UNIVERSAL_SELECTORS,
    automationTypePrefix = 'playwright_submit',
  } = p;

  const page = await browser.newPage();
  try {
    console.log(`${logPrefix} Navigating to apply page...`);
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3000);

    for (const sel of applySelectors) {
      const btn = page.locator(sel).first();
      try {
        if (await btn.count() > 0 && (await btn.isVisible({ timeout: 2000 }))) {
          console.log(`${logPrefix} Found Apply button (${sel}) — clicking...`);
          await btn.click();
          await page.waitForTimeout(4000);
          break;
        }
      } catch {
        /* try next */
      }
    }

    const iframes = page.frameLocator('iframe');
    let formPage = page;
    try {
      const iframeForm = iframes.first.locator('input[type="text"], input[type="email"]');
      if (await iframeForm.count() > 0) {
        console.log(`${logPrefix} Form detected inside iframe — switching context`);
        formPage = iframes.first;
      }
    } catch {
      /* main page */
    }

    await runStandardAtsFill(formPage, formFields, { pdfPath, coverPath });

    console.log('');
    console.log(`${logPrefix} ✅ Form filling complete!`);

    if (DRY_RUN) {
      const shotDir = resolve(root, '.playwright-mcp');
      mkdirSync(shotDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const shotPath = resolve(shotDir, `submit-${appId || 'no-id'}-${ts}.png`);
      try {
        await page.screenshot({ path: shotPath, fullPage: true });
        console.log(`${logPrefix} 📸 Screenshot saved: ${shotPath}`);
      } catch (e) {
        console.warn(`${logPrefix} Screenshot failed: ${e.message}`);
      }
      appendAutomationEvent(root, {
        type: `${automationTypePrefix}.dry_run`,
        status: 'success',
        app_id: appId,
        url: applyUrl,
        screenshot: shotPath,
      });
      console.log(`${logPrefix} DRY-RUN done. Use --live to open browser for manual review/submit.`);
    } else if (AUTO_SUBMIT) {
      const submitBtn = formPage
        .locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply")')
        .last();
      if (await submitBtn.count() > 0) {
        console.log(`${logPrefix} 🔴 AUTO-SUBMITTING...`);
        await submitBtn.click();
        await page.waitForTimeout(5000);
        console.log(`${logPrefix} ✅ Form submitted!`);
        appendAutomationEvent(root, {
          type: `${automationTypePrefix}.completed`,
          status: 'success',
          app_id: appId,
          url: applyUrl,
          summary: 'Playwright auto-submitted application',
        });
      }
    } else {
      console.log(`${logPrefix} 🟡 Review the form in the browser window, then click Submit manually.`);
      console.log(`${logPrefix} Press ENTER in this terminal when done...`);
      await new Promise((r) => process.stdin.once('data', r));
      appendAutomationEvent(root, {
        type: `${automationTypePrefix}.manual`,
        status: 'success',
        app_id: appId,
        url: applyUrl,
        summary: 'Playwright form-filled, manual submit by user',
      });
    }
  } catch (err) {
    console.error(`${logPrefix} Error: ${err.message}`);
    appendAutomationEvent(root, {
      type: `${automationTypePrefix}.failed`,
      status: 'failure',
      app_id: appId,
      url: applyUrl,
      error: err.message,
    });
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}

export { DEFAULT_UNIVERSAL_SELECTORS as STANDARD_ATS_APPLY_SELECTORS };
