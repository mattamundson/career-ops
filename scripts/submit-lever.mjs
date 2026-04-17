#!/usr/bin/env node
/**
 * submit-lever.mjs
 * Submits applications to Lever Postings API (public JSON endpoint with file upload)
 *
 * Lever endpoint:
 *   POST https://api.lever.co/v0/postings/{site}/{posting_id}?mode=apply
 *   Content-Type: multipart/form-data
 *   Required fields: name, email, phone, resume (file)
 *   Optional: comments (cover letter text), custom EEO fields
 *   Auth: None (public endpoint)
 *
 * Extract site & posting_id from Lever URL:
 *   https://jobs.lever.co/{site}/jobs/{posting_id}
 *   Example: https://jobs.lever.co/acme-corp/12345678-1234-1234-1234-123456789012
 *   → site = "acme-corp", posting_id = "12345678-1234-1234-1234-123456789012"
 *
 * Usage:
 *   node scripts/submit-lever.mjs --app-id 025 --pdf resume.pdf --cover-letter cl.txt --dry-run
 *   node scripts/submit-lever.mjs --app-id 025 --pdf resume.pdf --dry-run --live
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
  console.error('Usage: node scripts/submit-lever.mjs --app-id <N> [--url <lever_url>] --pdf <path> [--cover-letter <path>] [--dry-run|--live]');
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

if (!applyUrl || !applyUrl.includes('lever.co')) {
  console.error(`[submit-lever] Could not resolve Lever URL for app-id=${appId}. Pass --url explicitly or ensure apply-queue.md has an "**Apply URL:** https://...lever.co..." entry.`);
  process.exit(1);
}

console.log(`[submit-lever] Found apply_url: ${applyUrl}`);

// ---- Extract site & posting_id from URL ----
// Patterns:
//   https://jobs.lever.co/{site}/{uuid}          (current)
//   https://jobs.lever.co/{site}/jobs/{uuid}     (legacy)
const urlObj = new URL(applyUrl);
const pathParts = urlObj.pathname.split('/').filter(Boolean);
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let site = null;
let postingId = null;

const uuidIdx = pathParts.findIndex(p => uuidRe.test(p));
if (uuidIdx >= 1) {
  postingId = pathParts[uuidIdx];
  site = pathParts.find(p => p !== 'jobs' && !uuidRe.test(p)) || null;
} else {
  const jobsIdx = pathParts.indexOf('jobs');
  if (jobsIdx > 0) {
    site = pathParts[jobsIdx - 1];
    postingId = pathParts[jobsIdx + 1];
  }
}

if (!site || !postingId) {
  console.error(`[submit-lever] Could not extract site/posting_id from ${applyUrl}`);
  console.error(`  Expected: https://jobs.lever.co/{site}/{uuid} or https://jobs.lever.co/{site}/jobs/{uuid}`);
  process.exit(1);
}

// ---- Resolve files ----
if (!pdfPath || !existsSync(pdfPath)) {
  console.error(`[submit-lever] Resume PDF not found at ${pdfPath}`);
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
formData.append('name', `${profile.first_name} ${profile.last_name}`);
formData.append('email', profile.email);
formData.append('phone', profile.phone);

// Attach resume
const resumeBuffer = readFileSync(pdfPath);
formData.append('resume', new Blob([resumeBuffer], { type: 'application/pdf' }), 'resume.pdf');

// Attach cover letter as text (Lever uses "comments" field)
if (coverPath && existsSync(coverPath)) {
  const coverText = readFileSync(coverPath, 'utf8');
  formData.append('comments', coverText);
}

// ---- Prepare request ----
const endpoint = `https://api.lever.co/v0/postings/${site}/${postingId}?mode=apply`;
const method = 'POST';

// ---- Dry-run ----
if (dryRun && !live) {
  console.log('[submit-lever] DRY-RUN: would send POST request');
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Method: ${method}`);
  console.log(`  Site: ${site}`);
  console.log(`  Posting ID: ${postingId}`);
  console.log(`  Form fields: name, email, phone, resume${coverPath ? ', comments' : ''}`);
  console.log(`  Name: ${profile.first_name} ${profile.last_name}`);
  console.log(`  Email: ${profile.email}`);
  console.log(`  Phone: ${profile.phone}`);
  console.log(`  Resume file: ${pdfPath}`);
  if (coverPath && existsSync(coverPath)) {
    console.log(`  Cover letter file: ${coverPath}`);
  }
  console.log('\n[submit-lever] To submit live, use --live flag');
  process.exit(0);
}

// ---- LIVE SUBMISSION ----
if (live) {
  console.log('[submit-lever] Submitting live to Lever...');
  const appRecord = getApplicationRecord(ROOT, appId);
  try {
    const response = await fetch(endpoint, {
      method,
      body: formData
    });

    const status = response.status;
    const rawBody = await response.text();
    let body = rawBody;
    try { body = JSON.parse(rawBody); } catch { /* keep as text */ }

    console.log(`[submit-lever] Response status: ${status}`);
    console.log(`[submit-lever] Response body:`, body);

    if (status >= 200 && status < 300) {
      console.log(`[submit-lever] ✅ Submission successful`);
      // Log to responses.md
      try {
        execSync(`node "${resolve(__dir, 'log-response.mjs')}" --app-id ${appId} --event submitted --ats Lever --notes "Auto-submitted via submit-lever.mjs"`, { cwd: ROOT, stdio: 'inherit' });
        if (appRecord) {
          console.log(`[submit-lever] Logged response for ${appRecord.company} — ${appRecord.role}`);
        }
      } catch (err) {
        console.warn(`[submit-lever] Failed to log response: ${err.message}`);
      }
      process.exit(0);
    } else {
      console.error(`[submit-lever] ❌ Submission failed with status ${status}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[submit-lever] ERROR: ${err.message}`);
    process.exit(1);
  }
}
