#!/usr/bin/env node
/**
 * submit-lever.mjs — JSON / multipart submitter for Lever-hosted postings.
 *
 * Lever exposes a public application POST endpoint that accepts multipart
 * form-data (required for resume upload):
 *
 *   POST https://api.lever.co/v0/postings/{clientName}/{postingId}?key={siteKey}
 *
 * The `clientName` and `postingId` are both visible in the job URL. No
 * employer API key is required. Requests are rate-limited (429 on abuse).
 *
 * See: https://github.com/lever/postings-api
 *
 * Default mode is DRY-RUN: prints the payload it would POST and exits 0
 * without touching the network. Pass --live to actually submit. Matt must
 * review the draft before --live is added.
 *
 * Usage:
 *   node scripts/submit-lever.mjs --url "https://jobs.lever.co/acme/abc123" --resume resume.pdf [--cover cl.txt] [--dry-run|--live]
 *
 * Flags:
 *   --url       Full Lever posting URL (required)
 *   --resume    Path to resume PDF (required for live submit)
 *   --cover     Path to cover letter (optional)
 *   --company   Company name (for logging/events)
 *   --role      Role title (for logging/events)
 *   --app-id    Application id in the tracker (for event correlation)
 *   --dry-run   Print payload, do not POST (default)
 *   --live      Actually POST to Lever
 *
 * Exit codes:
 *   0 — success (or dry-run complete)
 *   1 — malformed URL, missing resume, or POST failed
 *   2 — Lever rejected payload (4xx) — dispatcher can try Playwright fallback
 *   3 — network error / rate-limited (429) — dispatcher can retry or fall back
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { isMainEntry } from './lib/main-entry.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

export function parseLeverUrl(url) {
  // Canonical shapes:
  //   https://jobs.lever.co/{client}/{postingId}
  //   https://jobs.lever.co/{client}/{postingId}/apply
  //   https://api.lever.co/v0/postings/{client}/{postingId}
  if (!url || typeof url !== 'string') return null;
  const re = /lever\.co\/(?:v0\/postings\/)?([a-zA-Z0-9-]+)\/([a-f0-9-]{8,})/i;
  const m = url.match(re);
  if (!m) return null;
  return { clientName: m[1], postingId: m[2] };
}

export function buildLeverApplicationPayload({ profile, resumePath, coverPath }) {
  // Lever requires: name + email. Accepts additional candidate fields.
  // We keep the payload conservative — only the fields Lever documents
  // as widely available; employer-customized custom-fields are not covered
  // here, which is one reason --dry-run is the default.
  const payload = new FormData();
  if (profile?.full_name) payload.append('name', profile.full_name);
  if (profile?.email) payload.append('email', profile.email);
  if (profile?.phone) payload.append('phone', profile.phone);
  if (profile?.linkedin_url) payload.append('urls[LinkedIn]', profile.linkedin_url);
  if (profile?.portfolio_url) payload.append('urls[Portfolio]', profile.portfolio_url);
  if (profile?.location?.city) payload.append('location', `${profile.location.city}, ${profile.location.state || ''}`.trim());
  if (resumePath && existsSync(resumePath)) {
    const buf = readFileSync(resumePath);
    payload.append('resume', new Blob([buf], { type: 'application/pdf' }), basename(resumePath));
  }
  if (coverPath && existsSync(coverPath)) {
    const buf = readFileSync(coverPath);
    payload.append('comments', buf.toString('utf-8'));
  }
  return payload;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i++; }
    else args[key] = true;
  }
  return {
    url: typeof args.url === 'string' ? args.url : null,
    resume: typeof args.resume === 'string' ? args.resume : null,
    cover: typeof args.cover === 'string' ? args.cover : null,
    company: typeof args.company === 'string' ? args.company : null,
    role: typeof args.role === 'string' ? args.role : null,
    appId: typeof args['app-id'] === 'string' ? args['app-id'] : null,
    live: Boolean(args.live),
    dryRun: args['dry-run'] !== undefined ? Boolean(args['dry-run']) : !args.live,
  };
}

function loadProfile() {
  try {
    const { getFormFields } = require('./profile-fields.mjs'); // eslint-disable-line no-undef
    return getFormFields();
  } catch {
    // profile-fields is an ES module in this repo — fall back to a tiny YAML read.
    try {
      const yaml = readFileSync(resolve(ROOT, 'config/profile.yml'), 'utf-8');
      const fm = {};
      for (const line of yaml.split('\n')) {
        const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*):\s*"?([^"#]+)"?\s*(#.*)?$/);
        if (m) fm[m[1]] = m[2].trim();
      }
      return {
        full_name: fm.full_name,
        email: fm.email,
        phone: fm.phone,
        linkedin_url: fm.linkedin_url,
        portfolio_url: fm.portfolio_url,
      };
    } catch { return {}; }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.url) {
    console.error('[submit-lever] --url is required');
    process.exit(1);
  }
  const parsed = parseLeverUrl(opts.url);
  if (!parsed) {
    console.error(`[submit-lever] URL does not match Lever pattern: ${opts.url}`);
    process.exit(1);
  }

  const profile = loadProfile();
  const resumePath = opts.resume ? resolve(ROOT, opts.resume) : null;
  if (opts.live && !resumePath) {
    console.error('[submit-lever] --resume is required for --live submit');
    process.exit(1);
  }
  if (resumePath && !existsSync(resumePath)) {
    console.error(`[submit-lever] resume not found: ${resumePath}`);
    process.exit(1);
  }

  const coverPath = opts.cover ? resolve(ROOT, opts.cover) : null;
  const endpoint = `https://api.lever.co/v0/postings/${parsed.clientName}/${parsed.postingId}`;

  const details = {
    endpoint,
    clientName: parsed.clientName,
    postingId: parsed.postingId,
    resume: resumePath ? basename(resumePath) : null,
    cover: coverPath ? basename(coverPath) : null,
    resume_bytes: resumePath ? statSync(resumePath).size : 0,
    company: opts.company,
    role: opts.role,
    app_id: opts.appId,
  };

  if (opts.dryRun) {
    console.log('[submit-lever] DRY-RUN — would POST to:');
    console.log(`  ${endpoint}`);
    console.log('  Fields:');
    console.log(`    name:  ${profile?.full_name || '(missing)'}`);
    console.log(`    email: ${profile?.email || '(missing)'}`);
    console.log(`    phone: ${profile?.phone || '(missing)'}`);
    console.log(`    resume: ${details.resume || '(none)'} (${details.resume_bytes} bytes)`);
    console.log(`    cover:  ${details.cover || '(none)'}`);
    console.log('  Re-run with --live to actually submit.');
    appendAutomationEvent(ROOT, {
      type: 'submit-lever.dry_run',
      status: 'success',
      summary: `Dry-run for Lever posting ${parsed.clientName}/${parsed.postingId}`,
      details,
    });
    process.exit(0);
  }

  console.log(`[submit-lever] Submitting LIVE to ${endpoint}`);
  const payload = buildLeverApplicationPayload({ profile, resumePath, coverPath });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: payload,
      headers: { 'User-Agent': 'career-ops-submit-lever/1.0' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error(`[submit-lever] Network error: ${err.message}`);
    appendAutomationEvent(ROOT, {
      type: 'submit-lever.failed',
      status: 'failure',
      summary: `Network error: ${err.message}`,
      details,
    });
    process.exit(3);
  }

  if (response.status === 429) {
    console.error('[submit-lever] Rate-limited (429). Back off and retry.');
    appendAutomationEvent(ROOT, {
      type: 'submit-lever.rate_limited',
      status: 'failure',
      summary: `Rate-limited for ${parsed.clientName}/${parsed.postingId}`,
      details,
    });
    process.exit(3);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[submit-lever] Lever rejected payload (HTTP ${response.status}): ${body.slice(0, 300)}`);
    appendAutomationEvent(ROOT, {
      type: 'submit-lever.rejected',
      status: 'failure',
      summary: `HTTP ${response.status} from Lever`,
      details: { ...details, http_status: response.status, body_prefix: body.slice(0, 300) },
    });
    process.exit(2);
  }

  console.log(`[submit-lever] Submitted successfully (HTTP ${response.status}).`);
  appendAutomationEvent(ROOT, {
    type: 'submit-lever.submitted',
    status: 'success',
    summary: `Submitted to ${parsed.clientName}/${parsed.postingId}`,
    details: { ...details, http_status: response.status },
  });
  process.exit(0);
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    console.error(`[submit-lever] Fatal: ${err.message}`);
    process.exit(1);
  });
}
