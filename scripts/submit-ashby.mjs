#!/usr/bin/env node
/**
 * submit-ashby.mjs
 * Submits applications to Ashby Posting API (public JSON endpoint with two-step file upload)
 *
 * Ashby has a two-step application flow:
 *   Step 1: Upload resume/cover letter files → receive fileHandle
 *   Step 2: Submit application with fileHandle + form data
 *
 * Endpoints:
 *   POST https://api.ashbyhq.com/posting-api/file-upload
 *     Body: { file: <binary> } (multipart/form-data)
 *     Returns: { fileHandle: "file_<uuid>" }
 *
 *   POST https://api.ashbyhq.com/posting-api/apply/{jobPostingId}
 *     Body: { applicationForm: { ... }, resume: { fileHandle }, coverLetter: { fileHandle } }
 *     Returns: { success: true }
 *
 * Extract jobPostingId from Ashby URL:
 *   https://jobs.ashbyhq.com/{company-slug}/posting/{jobPostingId}
 *   Example: https://jobs.ashbyhq.com/example-corp/posting/550e8400-e29b-41d4-a716-446655440000
 *
 * Usage:
 *   node scripts/submit-ashby.mjs --app-id 025 --pdf resume.pdf --cover-letter cl.txt --dry-run
 *   node scripts/submit-ashby.mjs --app-id 025 --pdf resume.pdf --dry-run --live
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { getApplicationRecord } from './lib/career-data.mjs';

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
const pdfPath = getArg('pdf');
const coverPath = getArg('cover-letter');
const urlOverride = getArg('url');
const dryRun = !args.includes('--live');
const live = args.includes('--live');

if (!appId && !urlOverride) {
  console.error('Usage: node scripts/submit-ashby.mjs --app-id <N> [--url <ashby_url>] --pdf <path> [--cover-letter <path>] [--dry-run|--live]');
  process.exit(1);
}

// ---- Resolve apply_url: --url override > apply-queue.md lookup ----
let applyUrl = typeof urlOverride === 'string' ? urlOverride : null;
if (!applyUrl && appId) {
  const normId = String(appId).padStart(3, '0');
  const queueFile = resolve(ROOT, 'data', 'apply-queue.md');
  if (existsSync(queueFile)) {
    const qL = readFileSync(queueFile, 'utf8').split('\n');
    const hi = qL.findIndex(l => /^### /.test(l) && (l.includes(`[${appId} `) || l.includes(`[${normId} `)));
    if (hi !== -1) {
      for (let i = hi; i < Math.min(hi + 15, qL.length); i++) {
        const m = qL[i].match(/\*\*Apply URL:\*\*\s*(https?:\/\/\S+)/);
        if (m) { applyUrl = m[1]; break; }
      }
    }
  }
}

if (!applyUrl || !applyUrl.includes('ashby')) {
  console.error(`[submit-ashby] Could not resolve Ashby URL for app-id=${appId}. Pass --url explicitly or ensure apply-queue.md has an "**Apply URL:** https://...ashby..." entry.`);
  process.exit(1);
}

console.log(`[submit-ashby] Found apply_url: ${applyUrl}`);

// ---- Extract jobPostingId from URL ----
// Pattern: https://jobs.ashbyhq.com/{company}/posting/{jobPostingId}
// Patterns:
//   https://jobs.ashbyhq.com/{company}/{jobPostingId}          (current)
//   https://jobs.ashbyhq.com/{company}/posting/{jobPostingId}  (legacy)
// jobPostingId is a UUID.
const urlObj = new URL(applyUrl);
const pathParts = urlObj.pathname.split('/').filter(Boolean);
const uuidReA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let jobPostingId = pathParts.find(p => uuidReA.test(p)) || null;

if (!jobPostingId) {
  const postingIdx = pathParts.indexOf('posting');
  if (postingIdx >= 0 && pathParts[postingIdx + 1]) jobPostingId = pathParts[postingIdx + 1];
}

if (!jobPostingId) {
  console.error(`[submit-ashby] Could not extract jobPostingId from ${applyUrl}`);
  console.error(`  Expected: https://jobs.ashbyhq.com/{company}/{uuid} or https://jobs.ashbyhq.com/{company}/posting/{uuid}`);
  process.exit(1);
}

// ---- Resolve files ----
if (!pdfPath || !existsSync(pdfPath)) {
  console.error(`[submit-ashby] Resume PDF not found at ${pdfPath}`);
  process.exit(1);
}

// ---- Load profile data ----
const profile = {
  first_name: 'Matthew',
  last_name: 'Amundson',
  email: 'MattMAmundson@gmail.com',
  phone: '612-877-1189',
  linkedin: 'linkedin.com/in/mmamundson',
  github: 'github.com/mattamundson'
};

// ---- Dry-run ----
if (dryRun && !live) {
  console.log('[submit-ashby] DRY-RUN: Ashby two-step file upload + application flow');
  console.log(`  Job Posting ID: ${jobPostingId}`);
  console.log('\n  Step 1: Upload resume file');
  console.log(`    Endpoint: POST https://api.ashbyhq.com/posting-api/file-upload`);
  console.log(`    File: ${pdfPath} (${basename(pdfPath)})`);
  console.log(`    Expected response: { fileHandle: "file_<uuid>" }`);

  if (coverPath && existsSync(coverPath)) {
    console.log('\n  Step 1b: Upload cover letter file');
    console.log(`    Endpoint: POST https://api.ashbyhq.com/posting-api/file-upload`);
    console.log(`    File: ${coverPath} (${basename(coverPath)})`);
  }

  console.log(`\n  Step 2: Submit application with fileHandles`);
  console.log(`    Endpoint: POST https://api.ashbyhq.com/posting-api/apply/${jobPostingId}`);
  console.log(`    Fields: first_name, last_name, email, phone, resume { fileHandle }, coverLetter { fileHandle }`);
  console.log(`    Name: ${profile.first_name} ${profile.last_name}`);
  console.log(`    Email: ${profile.email}`);
  console.log(`    Phone: ${profile.phone}`);
  console.log('\n[submit-ashby] To submit live, use --live flag');
  process.exit(0);
}

// ---- LIVE SUBMISSION ----
if (live) {
  console.log('[submit-ashby] Submitting live to Ashby...');
  const appRecord = getApplicationRecord(ROOT, appId);
  try {
    // Step 1: Upload resume
    console.log('[submit-ashby] Step 1: Uploading resume...');
    const resumeFormData = new FormData();
    const resumeBuffer = readFileSync(pdfPath);
    resumeFormData.append('file', new Blob([resumeBuffer], { type: 'application/pdf' }), 'resume.pdf');

    let resumeResponse = await fetch('https://api.ashbyhq.com/posting-api/file-upload', {
      method: 'POST',
      body: resumeFormData
    });

    let resumeData = {};
    const resumeText = await resumeResponse.text();
    try {
      resumeData = JSON.parse(resumeText);
    } catch {
      console.error(`[submit-ashby] Resume upload failed: ${resumeResponse.status} ${resumeText}`);
      process.exit(1);
    }

    const resumeFileHandle = resumeData.fileHandle;
    if (!resumeFileHandle) {
      console.error(`[submit-ashby] No fileHandle in resume upload response:`, resumeData);
      process.exit(1);
    }
    console.log(`[submit-ashby] Resume uploaded → fileHandle: ${resumeFileHandle}`);

    // Step 1b: Upload cover letter if provided
    let coverFileHandle = null;
    if (coverPath && existsSync(coverPath)) {
      console.log('[submit-ashby] Step 1b: Uploading cover letter...');
      const coverFormData = new FormData();
      const coverBuffer = readFileSync(coverPath);
      coverFormData.append('file', new Blob([coverBuffer], { type: 'text/plain' }), 'cover-letter.txt');

      let coverResponse = await fetch('https://api.ashbyhq.com/posting-api/file-upload', {
        method: 'POST',
        body: coverFormData
      });

      let coverData = {};
      const coverText = await coverResponse.text();
      try {
        coverData = JSON.parse(coverText);
      } catch {
        console.warn(`[submit-ashby] Cover letter upload failed (non-fatal): ${coverText.slice(0, 200)}`);
      }

      if (coverData.fileHandle) {
        coverFileHandle = coverData.fileHandle;
        console.log(`[submit-ashby] Cover letter uploaded → fileHandle: ${coverFileHandle}`);
      }
    }

    // Step 2: Submit application
    console.log(`[submit-ashby] Step 2: Submitting application to job ${jobPostingId}...`);
    const submitData = {
      applicationForm: {
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        phone: profile.phone
      },
      resume: {
        fileHandle: resumeFileHandle
      }
    };

    if (coverFileHandle) {
      submitData.coverLetter = {
        fileHandle: coverFileHandle
      };
    }

    const submitResponse = await fetch(`https://api.ashbyhq.com/posting-api/apply/${jobPostingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitData)
    });

    const submitStatus = submitResponse.status;
    const submitText = await submitResponse.text();
    let submitBody = submitText;
    try {
      submitBody = JSON.parse(submitText);
    } catch { /* keep as text */ }

    console.log(`[submit-ashby] Response status: ${submitStatus}`);
    console.log(`[submit-ashby] Response body:`, submitBody);

    if (submitStatus >= 200 && submitStatus < 300) {
      console.log(`[submit-ashby] ✅ Submission successful`);
      // Log to responses.md
      try {
        execSync(`node "${resolve(__dir, 'log-response.mjs')}" --app-id ${appId} --event submitted --ats Ashby --notes "Auto-submitted via submit-ashby.mjs"`, { cwd: ROOT, stdio: 'inherit' });
        if (appRecord) {
          console.log(`[submit-ashby] Logged response for ${appRecord.company} — ${appRecord.role}`);
        }
      } catch (err) {
        console.warn(`[submit-ashby] Failed to log response: ${err.message}`);
      }
      process.exit(0);
    } else {
      console.error(`[submit-ashby] ❌ Submission failed with status ${submitStatus}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[submit-ashby] ERROR: ${err.message}`);
    process.exit(1);
  }
}
