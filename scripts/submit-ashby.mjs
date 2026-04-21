#!/usr/bin/env node
/**
 * submit-ashby.mjs — Ashby application submitter (Playwright-delegated).
 *
 * Ashby exposes `applicationForm.submit` under `developers.ashbyhq.com`, but
 * the endpoint requires an **employer-side** API key (HTTP Basic auth with
 * the `candidatesWrite` permission). There is no public, candidate-side
 * submission endpoint.
 *
 * Rather than silently falling back from a "file not found" in the dispatcher,
 * this stub exists to make the architectural decision explicit:
 *
 *   ashby is browser-automation-only from the candidate side
 *
 * It exits with code 2 so submit-dispatch.mjs detects "JSON submitter said
 * no" and routes to submit-universal-playwright.mjs. This preserves the
 * ethical-use rule (Matt reviews before submit) because the Playwright path
 * always surfaces the form for visual confirmation.
 *
 * Usage (called by dispatcher, not typically by hand):
 *   node scripts/submit-ashby.mjs --url "https://jobs.ashbyhq.com/acme/abc"
 *
 * Exit codes:
 *   2 — unsupported via JSON API, dispatcher should fall back to Playwright
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { isMainEntry } from './lib/main-entry.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

export function isAshbyUrl(url) {
  return Boolean(url && /ashby(hq)?\.com/i.test(url));
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
    appId: typeof args['app-id'] === 'string' ? args['app-id'] : null,
    company: typeof args.company === 'string' ? args.company : null,
    role: typeof args.role === 'string' ? args.role : null,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const url = opts.url;

  const reason = 'Ashby applicationForm.submit requires employer API key (candidatesWrite). No public candidate endpoint exists.';

  console.log('[submit-ashby] Ashby JSON-API submission is not available without employer credentials.');
  console.log(`[submit-ashby] Reason: ${reason}`);
  console.log('[submit-ashby] Signaling dispatcher to fall back to Playwright form-fill (exit code 2).');

  appendAutomationEvent(ROOT, {
    type: 'submit-ashby.skipped_no_api',
    status: 'partial_success',
    summary: 'Ashby requires employer API key — deferring to Playwright',
    details: {
      url,
      app_id: opts.appId,
      company: opts.company,
      role: opts.role,
      reason,
    },
  });

  // Exit 2: dispatcher treats non-zero as "submitter said no", triggers Playwright fallback.
  process.exit(2);
}

if (isMainEntry(import.meta.url)) {
  main();
}
