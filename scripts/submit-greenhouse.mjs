#!/usr/bin/env node
/**
 * submit-greenhouse.mjs
 * Automates application submission to Greenhouse-hosted job postings.
 * Greenhouse has the simplest/fastest direct-apply flow of all major ATSs:
 * - Single page form
 * - Typically NO captcha
 * - File upload via <input type="file">
 * - Submit button triggers confirmation page
 *
 * Usage:
 *   node scripts/submit-greenhouse.mjs --url "https://job-boards.greenhouse.io/agilityrobotics/jobs/5841009004" --slug agility-robotics
 *   node scripts/submit-greenhouse.mjs --url <url> --resume <pdf-path> --cover <txt-path> --dry-run
 *
 * Flags:
 *   --url       Full Greenhouse job URL (required)
 *   --slug      Company slug for auto-finding PDF/CL in output/ (optional)
 *   --resume    Explicit resume PDF path (overrides slug lookup)
 *   --cover     Explicit cover letter path (overrides slug lookup)
 *   --dry-run   Fill form but don't click Submit (prints would-be submission)
 *   --headless  Run in headless mode (default: false, for Matt to watch)
 *
 * Staging: PDFs/CLs are copied into the repo’s `.playwright-mcp/` (same as screenshot output)
 * so `setInputFiles` always gets a path under a known, writable directory.
 */

import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { getFormFields, getResumePath, getCoverLetterPath } from './profile-fields.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const PLAYWRIGHT_ROOT = resolve(ROOT, '.playwright-mcp');

// ---- arg parsing ----
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  return args[i + 1] ?? true;
}

const url = getArg('url');
const slug = getArg('slug');
const resumePath = getArg('resume') || getArg('pdf');
const coverPath = getArg('cover') || getArg('cover-letter');
const dryRun = args.includes('--dry-run');
const headless = args.includes('--headless');

if (!url) {
  console.error('Usage: node scripts/submit-greenhouse.mjs --url <greenhouse-job-url> [--slug company-slug] [--dry-run]');
  process.exit(1);
}

if (!url.includes('greenhouse.io') && !url.includes('job-boards.greenhouse')) {
  console.error(`[submit-greenhouse] URL doesn't look like Greenhouse: ${url}`);
  console.error('Greenhouse URLs contain "greenhouse.io" or "job-boards.greenhouse"');
  process.exit(1);
}

// ---- Resolve files ----
const profile = getFormFields();
const pdf = resumePath || getResumePath(slug);
const cl = coverPath || getCoverLetterPath(slug);

if (!pdf || !existsSync(pdf)) {
  console.error(`[submit-greenhouse] Resume PDF not found. Provide --pdf/--resume <path> or --slug <slug>`);
  console.error(`Tried: ${pdf}`);
  process.exit(1);
}

// Ensure Playwright MCP allowed dir exists
if (!existsSync(PLAYWRIGHT_ROOT)) {
  try { mkdirSync(PLAYWRIGHT_ROOT, { recursive: true }); } catch {}
}

// Copy resume to allowed dir
const pdfInAllowed = resolve(PLAYWRIGHT_ROOT, basename(pdf));
try {
  copyFileSync(pdf, pdfInAllowed);
  console.log(`[submit-greenhouse] Cached resume → ${pdfInAllowed}`);
} catch (err) {
  console.error(`[submit-greenhouse] Failed to cache resume: ${err.message}`);
  process.exit(1);
}

// Optional cover letter
let clInAllowed = null;
if (cl && existsSync(cl)) {
  clInAllowed = resolve(PLAYWRIGHT_ROOT, basename(cl));
  try {
    copyFileSync(cl, clInAllowed);
    console.log(`[submit-greenhouse] Cached cover letter → ${clInAllowed}`);
  } catch (err) {
    console.warn(`[submit-greenhouse] Cover letter copy failed (non-fatal): ${err.message}`);
    clInAllowed = null;
  }
}

// ---- Load cover letter text (for paste-in-field case) ----
let coverText = '';
if (clInAllowed) {
  try { coverText = readFileSync(clInAllowed, 'utf8'); } catch {}
}

// ---- Launch Playwright ----
console.log(`[submit-greenhouse] Navigating to: ${url}`);
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);

  // Greenhouse apply forms can be inline or require "Apply" button click
  const applyBtn = await page.$('button:has-text("Apply"), a:has-text("Apply for this job")').catch(() => null);
  if (applyBtn) {
    await applyBtn.click().catch(() => {});
    await page.waitForTimeout(2000);
  }

  // ---- Fill standard fields ----
  console.log('[submit-greenhouse] Filling standard fields...');

  // First name
  await page.fill('input[id*="first_name" i], input[name*="first_name" i], input[autocomplete="given-name"]', profile.first_name).catch(() => {});
  await page.fill('input[id*="last_name" i], input[name*="last_name" i], input[autocomplete="family-name"]', profile.last_name).catch(() => {});
  await page.fill('input[id*="email" i], input[type="email"], input[autocomplete="email"]', profile.email).catch(() => {});
  await page.fill('input[id*="phone" i], input[type="tel"], input[autocomplete="tel"]', profile.phone).catch(() => {});
  await page.fill('input[id*="linkedin" i], input[name*="linkedin" i]', profile.linkedin).catch(() => {});
  await page.fill('input[id*="github" i], input[name*="github" i]', profile.github).catch(() => {});
  await page.fill('input[id*="website" i], input[name*="website" i]', profile.github).catch(() => {});

  // Location fields — Greenhouse commonly uses a single "Location (City)" field
  await page.fill('input[id*="location" i], input[name*="location" i], input[id*="city" i]', `${profile.city}, ${profile.state}`).catch(() => {});

  // Current company / title
  await page.fill('input[id*="current_company" i], input[name*="current_company" i], input[id*="company" i]', profile.current_employer).catch(() => {});

  // ---- Upload resume ----
  console.log('[submit-greenhouse] Uploading resume...');
  const resumeInputs = await page.$$('input[type="file"]');
  if (resumeInputs.length === 0) {
    console.warn('[submit-greenhouse] No file inputs found — form may not be a standard Greenhouse form');
  } else {
    // First file input is usually the resume
    await resumeInputs[0].setInputFiles(pdfInAllowed).catch(err => {
      console.warn(`[submit-greenhouse] Resume upload failed: ${err.message}`);
    });
    // If a second file input exists, it's the cover letter
    if (resumeInputs.length > 1 && clInAllowed) {
      console.log('[submit-greenhouse] Uploading cover letter as file...');
      await resumeInputs[1].setInputFiles(clInAllowed).catch(err => {
        console.warn(`[submit-greenhouse] Cover letter upload failed: ${err.message}`);
      });
    }
  }

  // If there's a cover letter TEXTAREA (instead of a file input), paste text
  if (coverText && resumeInputs.length < 2) {
    const clTextarea = await page.$('textarea[id*="cover" i], textarea[name*="cover" i]').catch(() => null);
    if (clTextarea) {
      console.log('[submit-greenhouse] Pasting cover letter into textarea...');
      await clTextarea.fill(coverText).catch(() => {});
    }
  }

  // ---- Work authorization ----
  // Common Greenhouse fields: "Are you legally authorized to work in the US?" / "Will you require sponsorship?"
  // These are usually select or radio inputs — try common patterns
  const authSelect = await page.$('select[id*="authoriz" i], select[name*="authoriz" i]').catch(() => null);
  if (authSelect) {
    await authSelect.selectOption({ label: 'Yes' }).catch(() => {});
  }
  const sponsorSelect = await page.$('select[id*="sponsor" i], select[name*="sponsor" i]').catch(() => null);
  if (sponsorSelect) {
    await sponsorSelect.selectOption({ label: 'No' }).catch(() => {});
  }

  await page.waitForTimeout(1500);

  // ---- Dry run exit (no top-level return — this try is at module scope) ----
  if (dryRun) {
    console.log('[submit-greenhouse] DRY RUN — form filled but NOT submitted');
    console.log('[submit-greenhouse] Screenshot in .playwright-mcp/ — review before live submit');
    await page.screenshot({ path: resolve(ROOT, '.playwright-mcp', `submit-dryrun-${Date.now()}.png`), fullPage: true }).catch(() => {});
    console.log('[submit-greenhouse] Screenshot saved.');
    await page.waitForTimeout(2000);
  } else {
    // ---- SUBMIT ----
    console.log('[submit-greenhouse] Clicking Submit...');
    const submitBtn = await page.$('button[type="submit"], button:has-text("Submit"), button:has-text("Apply")').catch(() => null);
    if (!submitBtn) {
      console.error('[submit-greenhouse] Submit button not found');
      await page.screenshot({ path: resolve(ROOT, '.playwright-mcp', `submit-error-${Date.now()}.png`) }).catch(() => {});
    } else {
      await submitBtn.click();
      await page.waitForTimeout(5000);

      // Check for confirmation page
      const currentUrl = page.url();
      const pageText = await page.textContent('body').catch(() => '');
      const isConfirmed =
        /thank you|application (submitted|received)|we('|v)e received/i.test(pageText) ||
        /confirmation|submitted|thank/i.test(currentUrl);

      if (isConfirmed) {
        console.log('[submit-greenhouse] ✅ SUBMISSION CONFIRMED');
        console.log(`[submit-greenhouse] URL: ${currentUrl}`);
        // Auto-log to responses.md
        try {
          execSync(`node "${resolve(__dir, 'log-response.mjs')}" --new --company "${slug || 'UNKNOWN'}" --role "Greenhouse submission" --ats Greenhouse --date ${new Date().toISOString().slice(0,10)} --notes "Auto-submitted via submit-greenhouse.mjs"`, { cwd: ROOT, stdio: 'inherit' });
        } catch { /* non-fatal */ }
      } else {
        console.warn('[submit-greenhouse] ⚠️ Confirmation unclear — check screenshot');
      }

      await page.screenshot({ path: resolve(ROOT, '.playwright-mcp', `submit-${slug || 'job'}-${Date.now()}.png`), fullPage: true }).catch(() => {});
    }
  }
} catch (err) {
  console.error(`[submit-greenhouse] ERROR: ${err.message}`);
  await page.screenshot({ path: resolve(ROOT, '.playwright-mcp', `submit-error-${Date.now()}.png`) }).catch(() => {});
} finally {
  // Always close so the Node process exits (apply-review / submit-dispatch use execSync).
  await browser.close().catch(() => {});
}
