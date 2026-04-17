#!/usr/bin/env node
/**
 * submit-smartrecruiters.mjs
 * Submits applications to SmartRecruiters Candidate API (public/authenticated endpoint)
 *
 * SmartRecruiters has a public apply endpoint, though authentication may be required:
 *   POST https://api.smartrecruiters.com/v1/postings/{postingId}/candidates
 *   Content-Type: multipart/form-data (or JSON)
 *   Required fields: firstName, lastName, email, phone, resume (file)
 *   Optional: coverLetter (file), externalId
 *
 * TODO: SmartRecruiters may require an API key for the authenticated endpoint.
 * If public endpoint fails, the authenticated endpoint requires investigation:
 *   Authentication via X-SmartRecruiters-Token header
 *   Endpoint may be private and require API key from the recruiting team
 *
 * Extract postingId from SmartRecruiters URL:
 *   https://company.smartrecruiters.com/jobs/posting/{postingId}
 *   Example: https://acme.smartrecruiters.com/jobs/posting/12345678-1234-1234-1234-123456789012
 *   → postingId = "12345678-1234-1234-1234-123456789012"
 *
 * Usage:
 *   node scripts/submit-smartrecruiters.mjs --app-id 025 --pdf resume.pdf --cover-letter cl.txt --dry-run
 *   node scripts/submit-smartrecruiters.mjs --app-id 025 --pdf resume.pdf --dry-run --live
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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
  console.error('Usage: node scripts/submit-smartrecruiters.mjs --app-id <N> [--url <sr_url>] --pdf <path> [--cover-letter <path>] [--dry-run|--live]');
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

if (!applyUrl || !applyUrl.includes('smartrecruiters')) {
  console.error(`[submit-smartrecruiters] Could not resolve SmartRecruiters URL for app-id=${appId}. Pass --url explicitly or ensure apply-queue.md has an "**Apply URL:** https://...smartrecruiters..." entry.`);
  process.exit(1);
}

console.log(`[submit-smartrecruiters] Found apply_url: ${applyUrl}`);

// ---- Extract postingId from URL ----
// Pattern: https://{company}.smartrecruiters.com/jobs/posting/{postingId}
const urlObj = new URL(applyUrl);
const pathParts = urlObj.pathname.split('/').filter(Boolean);
const postingIdx = pathParts.indexOf('posting');
const postingId = postingIdx >= 0 && pathParts[postingIdx + 1] ? pathParts[postingIdx + 1] : null;

if (!postingId) {
  console.error(`[submit-smartrecruiters] Could not extract postingId from ${applyUrl}`);
  console.error(`  Expected pattern: https://{company}.smartrecruiters.com/jobs/posting/{postingId}`);
  process.exit(1);
}

// ---- Resolve files ----
if (!pdfPath || !existsSync(pdfPath)) {
  console.error(`[submit-smartrecruiters] Resume PDF not found at ${pdfPath}`);
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

// ---- Build FormData payload ----
const formData = new FormData();
formData.append('firstName', profile.first_name);
formData.append('lastName', profile.last_name);
formData.append('email', profile.email);
formData.append('phone', profile.phone);

// Attach resume
const resumeBuffer = readFileSync(pdfPath);
formData.append('resume', new Blob([resumeBuffer], { type: 'application/pdf' }), 'resume.pdf');

// Attach cover letter if provided
if (coverPath && existsSync(coverPath)) {
  const coverBuffer = readFileSync(coverPath);
  formData.append('coverLetter', new Blob([coverBuffer], { type: 'text/plain' }), 'cover-letter.txt');
}

// ---- Prepare request ----
const endpoint = `https://api.smartrecruiters.com/v1/postings/${postingId}/candidates`;
const method = 'POST';
const headers = {};

// NOTE: SmartRecruiters may require authentication.
// If API key is needed, it would go here:
// headers['X-SmartRecruiters-Token'] = process.env.SMARTRECRUITERS_API_KEY;

// ---- Dry-run ----
if (dryRun && !live) {
  console.log('[submit-smartrecruiters] DRY-RUN: would send POST request');
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Method: ${method}`);
  console.log(`  Posting ID: ${postingId}`);
  console.log(`  Form fields: firstName, lastName, email, phone, resume${coverPath ? ', coverLetter' : ''}`);
  console.log(`  Name: ${profile.first_name} ${profile.last_name}`);
  console.log(`  Email: ${profile.email}`);
  console.log(`  Phone: ${profile.phone}`);
  console.log(`  Resume file: ${pdfPath}`);
  if (coverPath && existsSync(coverPath)) {
    console.log(`  Cover letter file: ${coverPath}`);
  }
  console.log('\n  NOTE: SmartRecruiters may require API authentication.');
  console.log('  If the live submission fails, check docs/submit-ats-notes.md for authentication details.');
  console.log('\n[submit-smartrecruiters] To submit live, use --live flag');
  process.exit(0);
}

// ---- LIVE SUBMISSION ----
if (live) {
  console.log('[submit-smartrecruiters] Submitting live to SmartRecruiters...');
  const appRecord = getApplicationRecord(ROOT, appId);
  try {
    const response = await fetch(endpoint, {
      method,
      body: formData,
      headers
    });

    const status = response.status;
    const rawBody = await response.text();
    let body = rawBody;
    try { body = JSON.parse(rawBody); } catch { /* keep as text */ }

    console.log(`[submit-smartrecruiters] Response status: ${status}`);
    console.log(`[submit-smartrecruiters] Response body:`, body);

    if (status >= 200 && status < 300) {
      console.log(`[submit-smartrecruiters] ✅ Submission successful`);
      // Log to responses.md
      try {
        execSync(`node "${resolve(__dir, 'log-response.mjs')}" --app-id ${appId} --event submitted --ats SmartRecruiters --notes "Auto-submitted via submit-smartrecruiters.mjs"`, { cwd: ROOT, stdio: 'inherit' });
        if (appRecord) {
          console.log(`[submit-smartrecruiters] Logged response for ${appRecord.company} — ${appRecord.role}`);
        }
      } catch (err) {
        console.warn(`[submit-smartrecruiters] Failed to log response: ${err.message}`);
      }
      process.exit(0);
    } else {
      console.error(`[submit-smartrecruiters] ❌ Submission failed with status ${status}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[submit-smartrecruiters] ERROR: ${err.message}`);
    process.exit(1);
  }
}
