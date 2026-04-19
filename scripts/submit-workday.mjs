#!/usr/bin/env node

import { launchBrowser, safeFill, safeClick, pauseForCaptcha, getAccessibleNames, CANDIDATE } from './submit-playwright-shared.mjs';
import { attachApplyArtifact, createApplyRunContext, finalizeApplyRun, recordApplyStep } from './ats-run-state.mjs';
import fs from 'fs';
import path from 'path';

/**
 * WorkDay Application Automation
 *
 * Usage:
 *   node submit-workday.mjs --apply-url "https://..." --pdf "path/to/resume.pdf" --cover-letter "path/to/cover-letter.txt" --dry-run
 *   node submit-workday.mjs --apply-url "https://..." --pdf "path/to/resume.pdf" --cover-letter "path/to/cover-letter.txt" --live
 *
 * Flags:
 *   --apply-url       Application URL (required)
 *   --pdf             Path to resume PDF (required for --live)
 *   --cover-letter    Path to cover letter TXT (optional)
 *   --dry-run         Inspect form fields without submitting (default)
 *   --live            Actually fill form and submit
 */

const args = process.argv.slice(2);
const opts = {};

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const val = args[i + 1]?.startsWith('--') || !args[i + 1] ? true : args[i + 1];
    opts[key] = val;
    if (val !== true) i++;
  }
}

const isLive = opts.live === true;
const isDryRun = !isLive;
const applyUrl = opts['apply-url'];
const pdfPath = opts.pdf;
const clPath = opts['cover-letter'];
const appId = opts['app-id'];
const company = opts.company;
const role = opts.role;

if (!applyUrl) {
  console.error('❌ --apply-url is required');
  process.exit(1);
}

if (isLive && !pdfPath) {
  console.error('❌ --pdf is required for --live mode');
  process.exit(1);
}

const pdfAbsPath = pdfPath ? path.resolve(pdfPath) : null;
const clAbsPath = clPath ? path.resolve(clPath) : null;

console.log('📋 WorkDay Application Automation');
console.log(`Mode: ${isDryRun ? 'DRY-RUN (inspect only)' : 'LIVE (submit)'}`);
console.log(`Apply URL: ${applyUrl}`);
if (pdfAbsPath) console.log(`Resume: ${pdfAbsPath}`);
if (clAbsPath) console.log(`Cover Letter: ${clAbsPath}`);
console.log('');

async function run() {
  let context;
  const runCtx = createApplyRunContext(path.resolve('.'), {
    appId,
    ats: 'Workday',
    company,
    role,
    applyUrl,
    mode: isDryRun ? 'dry-run' : 'live',
  });
  try {
    recordApplyStep(runCtx, 'launch_browser');
    context = await launchBrowser();
    const page = await context.newPage();

    console.log(`⏳ Navigating to ${applyUrl}...`);
    recordApplyStep(runCtx, 'navigate', applyUrl);
    await page.goto(applyUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Allow page to settle
    await page.waitForTimeout(2000);

    // DRY-RUN: inspect accessible names
    if (isDryRun) {
      console.log('\n📝 DRY-RUN: Inspecting form fields...\n');
      const fields = await getAccessibleNames(page);
      console.log('Detected Form Fields:');
      fields.forEach((f, i) => {
        console.log(`  [${i}] ${f.tag}[${f.type}] name="${f.name}" id="${f.id}"`);
        if (f.label) console.log(`      label: "${f.label}"`);
        if (f.ariaLabel) console.log(`      aria-label: "${f.ariaLabel}"`);
        if (f.placeholder) console.log(`      placeholder: "${f.placeholder}"`);
      });
      console.log('\n✅ DRY-RUN complete. Adjust script and run with --live to submit.\n');
      recordApplyStep(runCtx, 'dry_run_complete', `fields_detected=${fields.length}`);
      const statePath = finalizeApplyRun(runCtx, 'success', { result: { mode: 'dry-run', fieldsDetected: fields.length } });
      console.log(`🧾 Run state: ${statePath}`);
      return;
    }

    // LIVE MODE: Fill form
    console.log('🔄 LIVE MODE: Filling application form...\n');

    // TODO: Field mapping varies widely across WorkDay instances.
    // Typical WorkDay form structure:
    //   - First Name, Last Name, Email, Phone
    //   - Address (City, State, Zip)
    //   - File upload for Resume
    //   - Optional: Cover Letter (text field or file upload)
    //
    // Customize refs below based on actual form inspection (from dry-run output).
    // Common WorkDay selectors:
    //   input[aria-label*="First Name"]
    //   input[aria-label*="Email"]
    //   input[type="file"]
    //   button:has-text("Next"), button:has-text("Submit")

    // Example skeleton (CUSTOMIZE THESE):
    try {
      // Attempt to fill personal info
      recordApplyStep(runCtx, 'fill_personal_info');
      const firstNameRef = 'input[aria-label*="First Name"], input[name*="firstName"]';
      const emailRef = 'input[aria-label*="Email"], input[name*="email"]';

      console.log('  • Filling First Name...');
      await safeFill(page, firstNameRef, CANDIDATE.firstName);

      console.log('  • Filling Last Name...');
      await safeFill(page, 'input[aria-label*="Last Name"], input[name*="lastName"]', CANDIDATE.lastName);

      console.log('  • Filling Email...');
      await safeFill(page, emailRef, CANDIDATE.email);

      console.log('  • Filling Phone...');
      await safeFill(page, 'input[aria-label*="Phone"], input[name*="phone"]', CANDIDATE.phone);

      // File upload
      if (pdfAbsPath) {
        console.log('  • Uploading Resume...');
        recordApplyStep(runCtx, 'upload_resume', pdfAbsPath);
        // Locate file input; use setInputFiles() instead of click-open
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(pdfAbsPath);
          await page.waitForTimeout(1000);
        } else {
          console.warn('    ⚠️  File input not found; skipping resume upload');
        }
      }

      // Cover letter if provided and text field exists
      if (clAbsPath) {
        const clText = fs.readFileSync(clAbsPath, 'utf-8');
        console.log('  • Filling Cover Letter...');
        recordApplyStep(runCtx, 'fill_cover_letter', clAbsPath);
        await safeFill(page, 'textarea[aria-label*="Cover"], textarea[name*="cover"]', clText);
      }

      // Click Next/Continue button
      console.log('  • Clicking Next button...');
      recordApplyStep(runCtx, 'advance_form');
      const nextBtn = await page.$('button:has-text("Next"), button:has-text("Continue")');
      if (nextBtn) {
        await safeClick(page, 'button:has-text("Next"), button:has-text("Continue")');
        await page.waitForTimeout(1500);
      }

      // TODO: Add additional form steps as needed (address, experience, etc.)
      // WorkDay forms often have multiple screens. Iterate through them,
      // filling fields from getAccessibleNames() inspection output.

    } catch (e) {
      console.warn(`⚠️  Error filling form: ${e.message}`);
      console.log('   This is normal if form structure differs from expected.');
    }

    // PAUSE FOR CAPTCHA
    recordApplyStep(runCtx, 'captcha_pause');
    await pauseForCaptcha(page, 'Verify captcha (if present) and press ENTER to finalize submission', {
      appId,
      ats: 'Workday',
      company,
      role,
      applyUrl,
      runCtx,
    });

    // TODO: Attempt to click Submit button (WorkDay-specific selector)
    console.log('  • Attempting to click Submit...');
    recordApplyStep(runCtx, 'attempt_submit');
    const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Apply")');
    if (submitBtn) {
      await safeClick(page, 'button:has-text("Submit"), button:has-text("Apply")');
      await page.waitForTimeout(2000);
      console.log('✅ Submission sent. Check browser for confirmation message.\n');
      recordApplyStep(runCtx, 'submit_clicked');
      const statePath = finalizeApplyRun(runCtx, 'success', { result: { mode: 'live', submitted: true } });
      console.log(`🧾 Run state: ${statePath}`);
    } else {
      console.log('⚠️  Submit button not found. Manual submission may be required.\n');
      recordApplyStep(runCtx, 'submit_button_missing');
      const shotPath = path.resolve('C:/Users/mattm/career-ops/data/apply-runs', `${runCtx.runId}-manual-submit-needed.png`);
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      attachApplyArtifact(runCtx, shotPath);
      const statePath = finalizeApplyRun(runCtx, 'blocked', { result: { mode: 'live', submitted: false, reason: 'submit_button_missing' } });
      console.log(`🧾 Run state: ${statePath}`);
    }

  } catch (e) {
    recordApplyStep(runCtx, 'error', e.message);
    const statePath = finalizeApplyRun(runCtx, 'failure', { error: e.message, result: { mode: isDryRun ? 'dry-run' : 'live' } });
    console.error(`🧾 Run state: ${statePath}`);
    console.error(`❌ Error: ${e.message}`);
    process.exit(1);
  } finally {
    if (context) await context.close();
  }
}

run();
