#!/usr/bin/env node

import { launchBrowser, safeFill, safeClick, pauseForCaptcha, getAccessibleNames, CANDIDATE } from './submit-playwright-shared.mjs';
import { attachApplyArtifact, createApplyRunContext, finalizeApplyRun, recordApplyStep } from './ats-run-state.mjs';
import fs from 'fs';
import path from 'path';

/**
 * iCIMS Application Automation
 *
 * Usage:
 *   node submit-icims.mjs --apply-url "https://..." --pdf "path/to/resume.pdf" --cover-letter "path/to/cover-letter.txt" --dry-run
 *   node submit-icims.mjs --apply-url "https://..." --pdf "path/to/resume.pdf" --cover-letter "path/to/cover-letter.txt" --live
 *
 * v13 Gotchas (see docs/playwright-submit-gotchas.md):
 *   1. Playwright MCP sandboxes uploads to .playwright-mcp/ — use raw playwright pkg instead
 *   2. iCIMS token-based URLs (eem, pnumber, ccode, code) invalidate on reload
 *   3. Double file-chooser bug on label clicks — use page.click() directly on inputs
 *   4. Post-resume-parse: DOM re-renders, ref hints become stale — re-query after each step
 *   5. hCaptcha final gate — pause for manual solve
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

console.log('📋 iCIMS Application Automation');
console.log(`Mode: ${isDryRun ? 'DRY-RUN (inspect only)' : 'LIVE (submit)'}`);
console.log(`Apply URL: ${applyUrl}`);
if (pdfAbsPath) console.log(`Resume: ${pdfAbsPath}`);
if (clAbsPath) console.log(`Cover Letter: ${clAbsPath}`);
console.log('');

async function run() {
  let context;
  const runCtx = createApplyRunContext(path.resolve('.'), {
    appId,
    ats: 'iCIMS',
    company,
    role,
    applyUrl,
    mode: isDryRun ? 'dry-run' : 'live',
  });
  try {
    recordApplyStep(runCtx, 'launch_browser');
    context = await launchBrowser();
    const page = await context.newPage();

    // CRITICAL: iCIMS uses token-based URLs. DO NOT reload or navigate away mid-flow.
    // Tokens (eem, pnumber, ccode, code) become invalid on reload.
    console.log(`⏳ Navigating to ${applyUrl}...`);
    console.log('⚠️  WARNING: iCIMS session tokens are time-limited. Do not reload or navigate away.');
    recordApplyStep(runCtx, 'navigate', applyUrl);
    await page.goto(applyUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Allow page to settle
    await page.waitForTimeout(2000);

    // DRY-RUN: inspect form structure
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

    // LIVE MODE: Fill iCIMS form
    console.log('🔄 LIVE MODE: Filling iCIMS application...\n');

    // GOTCHA #4: DOM re-renders after resume parsing. Re-query field refs after each major step.
    // GOTCHA #3: Use page.click() directly on file inputs; label clicks trigger double file-chooser.

    try {
      // Step 1: Personal info (usually first page)
      console.log('📄 STEP 1: Personal Information');
      recordApplyStep(runCtx, 'fill_personal_info');
      await safeFill(page, 'input[name*="firstName"]', CANDIDATE.firstName);
      await safeFill(page, 'input[name*="lastName"]', CANDIDATE.lastName);
      await safeFill(page, 'input[type="email"]', CANDIDATE.email);
      await safeFill(page, 'input[name*="phone"]', CANDIDATE.phone);

      console.log('  ✓ Personal info filled');

      // Step 2: Resume upload (CRITICAL: Gotcha #3)
      // NEVER click the label; click the file input directly
      if (pdfAbsPath) {
        console.log('📄 STEP 2: Resume Upload');
        recordApplyStep(runCtx, 'upload_resume', pdfAbsPath);
        const fileInputSelector = 'input[type="file"]';
        const fileInput = await page.$(fileInputSelector);
        if (fileInput) {
          // Use setInputFiles, not click -> file dialog
          await fileInput.setInputFiles(pdfAbsPath);
          console.log('  ✓ Resume uploaded');

          // GOTCHA #4: After resume upload, DOM re-renders (iCIMS parses resume).
          // Wait for parsing and re-query all fields.
          await page.waitForTimeout(2000);
          console.log('  ⏳ Waiting for resume parsing to complete...');
          await page.waitForTimeout(2000);
        } else {
          console.warn('  ⚠️  File input not found; skipping resume upload');
        }
      }

      // Step 3: Address fields (re-query due to DOM shift)
      console.log('📄 STEP 3: Address Information (re-querying after resume parse)');
      recordApplyStep(runCtx, 'fill_address');
      // Use fresh getAccessibleNames() to locate address fields
      const fieldsAfterParse = await getAccessibleNames(page);
      const cityField = fieldsAfterParse.find(f => f.label?.includes('City') || f.ariaLabel?.includes('City'));
      if (cityField?.name) {
        await safeFill(page, `input[name="${cityField.name}"]`, CANDIDATE.city);
      }
      const stateField = fieldsAfterParse.find(f => f.label?.includes('State') || f.ariaLabel?.includes('State'));
      if (stateField?.name) {
        await safeFill(page, `input[name="${stateField.name}"]`, CANDIDATE.state);
      }
      const zipField = fieldsAfterParse.find(f => f.label?.includes('Zip') || f.ariaLabel?.includes('Zip'));
      if (zipField?.name) {
        await safeFill(page, `input[name="${zipField.name}"]`, CANDIDATE.zip);
      }
      console.log('  ✓ Address filled');

      // Step 4: Cover letter if provided
      if (clAbsPath) {
        console.log('📄 STEP 4: Cover Letter');
        recordApplyStep(runCtx, 'fill_cover_letter', clAbsPath);
        const clText = fs.readFileSync(clAbsPath, 'utf-8');
        const clField = await page.$('textarea[name*="cover"], textarea[name*="letter"]');
        if (clField) {
          await safeFill(page, 'textarea[name*="cover"], textarea[name*="letter"]', clText);
          console.log('  ✓ Cover letter filled');
        } else {
          console.log('  ⚠️  Cover letter field not found');
        }
      }

      // Step 5: Click Next/Continue to advance form (if multi-page)
      console.log('📄 STEP 5: Advancing form');
      recordApplyStep(runCtx, 'advance_form');
      const continueBtn = await page.$('button:has-text("Next"), button:has-text("Continue")');
      if (continueBtn) {
        await safeClick(page, 'button:has-text("Next"), button:has-text("Continue")');
        await page.waitForTimeout(1500);
        console.log('  ✓ Advanced to next page');
      }

      // TODO: Additional iCIMS steps (voluntary questions, etc.) as needed

    } catch (e) {
      console.warn(`⚠️  Error filling form: ${e.message}`);
      console.log('   Continuing to captcha step...');
    }

    // GOTCHA #5: hCaptcha blocks final submission
    // Pause for human to solve it
    console.log('\n🔐 STEP FINAL: hCaptcha');
    recordApplyStep(runCtx, 'captcha_pause');
    await pauseForCaptcha(page, 'Solve hCaptcha (if present) and press ENTER to finalize', {
      appId,
      ats: 'iCIMS',
      company,
      role,
      applyUrl,
      runCtx,
    });

    // Attempt final submission
    console.log('  • Attempting to click Submit...');
    recordApplyStep(runCtx, 'attempt_submit');
    const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Apply")');
    if (submitBtn) {
      await safeClick(page, 'button:has-text("Submit"), button:has-text("Apply")');
      await page.waitForTimeout(2000);
      console.log('✅ Submission sent. Check browser for confirmation.\n');
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
