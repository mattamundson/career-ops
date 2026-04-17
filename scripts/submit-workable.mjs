#!/usr/bin/env node
/**
 * submit-workable.mjs
 * Workable public application submitter.
 *
 * URL pattern:  https://apply.workable.com/{subdomain}/j/{shortcode}/
 * Apply API:    https://apply.workable.com/api/v3/accounts/{subdomain}/jobs/{shortcode}/candidates
 *               (JSON body + separate file upload flow)
 *
 * Workable's widget-backed public endpoint is less fully documented than
 * Greenhouse/Lever/Ashby. We implement the best-effort flow: resolve subdomain
 * and shortcode from the apply URL, build a JSON candidate payload, and POST.
 * Live submissions should be reviewed in recruiter dashboard to confirm receipt.
 *
 * Usage:
 *   node scripts/submit-workable.mjs --app-id 015 [--url <workable_url>] \
 *        --pdf output/cv-matt-v4cai-...pdf \
 *        --cover-letter output/cover-letters/v4cai-power-bi-architect.txt \
 *        --dry-run
 *
 *   node scripts/submit-workable.mjs --app-id 015 ... --live
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
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
  console.error('Usage: node scripts/submit-workable.mjs --app-id <N> [--url <workable_url>] --pdf <path> [--cover-letter <path>] [--dry-run|--live]');
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

if (!applyUrl || !applyUrl.includes('workable.com')) {
  console.error(`[submit-workable] Could not resolve Workable URL for app-id=${appId}. Pass --url explicitly or ensure apply-queue.md has an "**Apply URL:** https://apply.workable.com/..." entry.`);
  process.exit(1);
}

console.log(`[submit-workable] Found apply_url: ${applyUrl}`);

// ---- Extract subdomain + shortcode from URL ----
// Pattern: https://apply.workable.com/{subdomain}/j/{shortcode}/
const urlObj = new URL(applyUrl);
const pathParts = urlObj.pathname.split('/').filter(Boolean);
// Expect: [subdomain, 'j', shortcode] or [subdomain, shortcode]
let subdomain = null;
let shortcode = null;
const jIdx = pathParts.indexOf('j');
if (jIdx > 0 && pathParts[jIdx + 1]) {
  subdomain = pathParts[jIdx - 1];
  shortcode = pathParts[jIdx + 1];
} else if (pathParts.length >= 2) {
  subdomain = pathParts[0];
  shortcode = pathParts[pathParts.length - 1];
}

if (!subdomain || !shortcode) {
  console.error(`[submit-workable] Could not extract subdomain/shortcode from ${applyUrl}`);
  console.error(`  Expected pattern: https://apply.workable.com/{subdomain}/j/{shortcode}/`);
  process.exit(1);
}

// ---- Resolve files ----
if (!pdfPath || !existsSync(pdfPath)) {
  console.error(`[submit-workable] Resume PDF not found at ${pdfPath}`);
  process.exit(1);
}

// ---- Candidate profile ----
const profile = {
  firstname: 'Matthew',
  lastname: 'Amundson',
  email: 'MattMAmundson@gmail.com',
  headline: 'Analytics & AI Automation Leader — Power BI / Fabric / ERP-Connected Operational Intelligence',
  phone: '+16128771189',
  address: 'Minneapolis, MN, United States',
  summary: 'Analytics and automation leader with 10+ years designing ERP-connected reporting, operational intelligence, agentic workflows, and AI-enabled automation across manufacturing, utilities, financial services, and supply chain.',
  linkedin: 'https://linkedin.com/in/mmamundson',
  github: 'https://github.com/mattamundson',
  disclaimer_accepted: true
};

// ---- Build payload ----
// Workable's public widget candidate endpoint accepts JSON with candidate + resume as base64.
const resumeBuffer = readFileSync(pdfPath);
const resumeBase64 = resumeBuffer.toString('base64');
const resumeName = basename(pdfPath);

let coverLetterBase64 = null;
let coverLetterName = null;
if (coverPath && existsSync(coverPath)) {
  coverLetterBase64 = readFileSync(coverPath).toString('base64');
  coverLetterName = basename(coverPath);
}

const payload = {
  candidate: {
    firstname: profile.firstname,
    lastname: profile.lastname,
    email: profile.email,
    headline: profile.headline,
    phone: profile.phone,
    address: profile.address,
    summary: profile.summary,
    resume: {
      name: resumeName,
      data: resumeBase64
    },
    social_profiles: {
      linkedin: profile.linkedin,
      github: profile.github
    },
    disclaimer_accepted: profile.disclaimer_accepted
  }
};

if (coverLetterBase64) {
  payload.candidate.cover_letter = {
    name: coverLetterName,
    data: coverLetterBase64
  };
}

const endpoint = `https://apply.workable.com/api/v3/accounts/${subdomain}/jobs/${shortcode}/candidates`;

// ---- Dry-run ----
if (dryRun && !live) {
  console.log('[submit-workable] DRY-RUN: would send POST request');
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Method: POST`);
  console.log(`  Subdomain: ${subdomain}`);
  console.log(`  Shortcode: ${shortcode}`);
  console.log(`  Content-Type: application/json`);
  console.log(`  Candidate:`);
  console.log(`    Name: ${profile.firstname} ${profile.lastname}`);
  console.log(`    Email: ${profile.email}`);
  console.log(`    Phone: ${profile.phone}`);
  console.log(`    Headline: ${profile.headline}`);
  console.log(`  Resume: ${resumeName} (${(resumeBuffer.length / 1024).toFixed(1)} KB, base64 encoded)`);
  if (coverLetterName) console.log(`  Cover letter: ${coverLetterName}`);
  console.log(`  Payload size: ~${(JSON.stringify(payload).length / 1024).toFixed(1)} KB`);
  console.log('\n[submit-workable] To submit live, use --live flag');
  console.log('[submit-workable] NOTE: Workable API is less formally documented than Greenhouse/Lever. First live submission should be verified in recruiter dashboard.');
  process.exit(0);
}

// ---- LIVE SUBMISSION ----
if (live) {
  console.log('[submit-workable] Submitting live to Workable...');
  const appRecord = getApplicationRecord(ROOT, appId);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });

    const status = response.status;
    const rawBody = await response.text();
    let body = rawBody;
    try { body = JSON.parse(rawBody); } catch { /* keep as text */ }

    console.log(`[submit-workable] Response status: ${status}`);
    console.log(`[submit-workable] Response body:`, body);

    if (status >= 200 && status < 300) {
      console.log(`[submit-workable] ✅ Submission accepted by Workable`);
      try {
        execSync(`node "${resolve(__dir, 'log-response.mjs')}" --app-id ${appId} --event submitted --ats Workable --notes "Auto-submitted via submit-workable.mjs"`, { cwd: ROOT, stdio: 'inherit' });
        if (appRecord) {
          console.log(`[submit-workable] Logged response for ${appRecord.company} — ${appRecord.role}`);
        }
      } catch (err) {
        console.warn(`[submit-workable] Failed to log response: ${err.message}`);
      }
      process.exit(0);
    } else {
      console.error(`[submit-workable] ❌ Submission failed with status ${status}`);
      console.error('[submit-workable] Workable may require authenticated API access for this account. Manual submission via the apply URL may be necessary.');
      process.exit(1);
    }
  } catch (err) {
    console.error(`[submit-workable] ERROR: ${err.message}`);
    process.exit(1);
  }
}
