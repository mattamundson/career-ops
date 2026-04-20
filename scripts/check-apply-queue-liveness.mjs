#!/usr/bin/env node
/**
 * check-apply-queue-liveness.mjs
 *
 * For every GO / Conditional GO / Ready to Submit app, HEAD the apply URL
 * and flag listings that are dead (404, 410, redirected to a careers root).
 *
 * Why this exists: V4C.ai #015 was "GO" with a workable apply_url, but the
 * URL bounced to the careers landing page — listing was closed. The full
 * apply-review prepare cycle ran for nothing. A 30-second liveness pass
 * before any prepare avoids that waste.
 *
 * Usage:
 *   node scripts/check-apply-queue-liveness.mjs            → report to stdout + data/apply-liveness-YYYY-MM-DD.md
 *   node scripts/check-apply-queue-liveness.mjs --json     → JSON to stdout, no file write
 *   node scripts/check-apply-queue-liveness.mjs --limit=10 → only top N by score
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplicationIndex } from './lib/career-data.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
const JSON_MODE = args.includes('--json');
const RENDER = args.includes('--render');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const SPA_HOSTS = /workable\.com|lever\.co|ashbyhq\.com|greenhouse\.io|smartrecruiters\.com/;

const QUEUE_STATUSES = new Set(['GO', 'Conditional GO', 'Ready to Submit']);

function classify(url, status, location) {
  if (status === 404 || status === 410) return { state: 'DEAD', reason: `HTTP ${status}` };
  if (status === 0) return { state: 'UNREACHABLE', reason: 'network/timeout' };

  // Redirect-to-careers heuristic: final URL has no job-id segment.
  // Per-ATS patterns:
  //   workable.com/{company}/j/{ID}/  — DEAD if final URL drops /j/{ID}/
  //   greenhouse.io/{company}/jobs/{ID}  — DEAD if final URL drops jobs/
  //   lever.co/{company}/{ID}  — DEAD if redirected to /{company} root
  //   ashbyhq.com/{company}/{slug}  — DEAD if /{company} only
  if (location && location !== url) {
    const u = new URL(location);
    const path = u.pathname;
    if (/workable\.com/.test(u.host) && !/\/j\/[A-Z0-9]+/i.test(path)) return { state: 'REDIRECTED', reason: 'workable → careers' };
    if (/greenhouse\.io/.test(u.host) && !/\/jobs\/\d+/i.test(path)) return { state: 'REDIRECTED', reason: 'greenhouse → careers' };
    if (/lever\.co/.test(u.host) && path.split('/').filter(Boolean).length < 2) return { state: 'REDIRECTED', reason: 'lever → company root' };
    if (/ashbyhq\.com/.test(u.host) && path.split('/').filter(Boolean).length < 2) return { state: 'REDIRECTED', reason: 'ashby → company root' };
    return { state: 'OK', reason: `redirected → ${u.host}${path}` };
  }

  if (status >= 200 && status < 300) return { state: 'OK', reason: `HTTP ${status}` };
  if (status >= 300 && status < 400) return { state: 'OK', reason: `HTTP ${status} (no Location)` };
  return { state: 'UNKNOWN', reason: `HTTP ${status}` };
}

async function probe(url) {
  // Try HEAD first (cheap), fall back to GET if HEAD is blocked (some sites 405).
  for (const method of ['HEAD', 'GET']) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const r = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'career-ops-liveness/1.0' },
      });
      clearTimeout(t);
      // For GET, also peek at body for soft-closed signals (Workable, Lever)
      let bodyText = '';
      if (method === 'GET' && r.status >= 200 && r.status < 300) {
        try { bodyText = (await r.text()).slice(0, 50_000); } catch {}
      }
      return { status: r.status, location: r.url, bodyText };
    } catch (e) {
      if (method === 'GET') return { status: 0, error: e.message, bodyText: '' };
    }
  }
  return { status: 0, error: 'unknown', bodyText: '' };
}

const SOFT_CLOSED_SIGNALS = [
  /this job is no longer available/i,
  /position has been filled/i,
  /no longer accepting applications/i,
  /job posting (?:has )?expired/i,
  /opportunity is no longer available/i,
  /this job is no longer (?:active|published|posted)/i,
];

function detectSoftClosed(bodyText) {
  if (!bodyText) return null;
  for (const re of SOFT_CLOSED_SIGNALS) {
    const m = bodyText.match(re);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

// Render-time detection for SPA-based ATSs. Returns null if renderer unavailable
// or page is OK; returns { reason } if soft-closed or apply button missing.
async function deepRenderCheck(url) {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { return { error: 'playwright_unavailable' }; }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(2500);
    const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    const softHit = detectSoftClosed(bodyText);
    if (softHit) return { state: 'DEAD', reason: `rendered: "${softHit}"` };
    // Apply-button heuristic: rendered SPAs put an Apply CTA. Absence after
    // 2.5s = likely a careers landing page, not a job page.
    const hasApply = await page.evaluate(() => {
      const txt = (document.body.innerText || '').toLowerCase();
      return /apply (?:for this job|now)|submit application/.test(txt);
    });
    if (!hasApply) return { state: 'DEAD', reason: 'rendered: no apply button' };
    return { state: 'OK', reason: 'rendered + apply button found' };
  } catch (e) {
    return { error: e.message.slice(0, 100) };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

const snapshot = buildApplicationIndex(ROOT);
let queue = snapshot.records
  .filter((a) => QUEUE_STATUSES.has(a.status))
  .filter((a) => a.applyUrl)
  .sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0));

if (LIMIT) queue = queue.slice(0, LIMIT);

if (!JSON_MODE) {
  console.log(`[apply-liveness] Probing ${queue.length} apps with apply URLs (status ∈ ${[...QUEUE_STATUSES].join('/')})...`);
}

const results = [];
for (const app of queue) {
  const { status, location, bodyText } = await probe(app.applyUrl);
  let verdict = classify(app.applyUrl, status, location);
  if (verdict.state === 'OK') {
    const softHit = detectSoftClosed(bodyText);
    if (softHit) verdict = { state: 'DEAD', reason: `soft-closed: "${softHit}"` };
  }
  // Optional deeper SPA render check — only when --render and host is SPA-based
  if (RENDER && verdict.state === 'OK') {
    try {
      const u = new URL(app.applyUrl);
      if (SPA_HOSTS.test(u.host)) {
        const deep = await deepRenderCheck(app.applyUrl);
        if (deep && deep.state) verdict = deep;
      }
    } catch { /* bad URL — leave verdict as-is */ }
  }
  results.push({
    id: app.id,
    company: app.company,
    role: app.role,
    score: app.score,
    status: app.status,
    apply_url: app.applyUrl,
    final_url: location || app.applyUrl,
    http_status: status,
    state: verdict.state,
    reason: verdict.reason,
  });
  if (!JSON_MODE) {
    const icon = verdict.state === 'OK' ? '✅' : verdict.state === 'DEAD' || verdict.state === 'REDIRECTED' ? '❌' : '⚠️';
    console.log(`  ${icon} #${app.id} ${app.company.padEnd(28).slice(0, 28)} ${verdict.state.padEnd(11)} ${verdict.reason}`);
  }
}

const dead = results.filter((r) => r.state === 'DEAD' || r.state === 'REDIRECTED');
const unreachable = results.filter((r) => r.state === 'UNREACHABLE' || r.state === 'UNKNOWN');
const ok = results.filter((r) => r.state === 'OK');

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({ generated_at: new Date().toISOString(), totals: { ok: ok.length, dead: dead.length, unreachable: unreachable.length }, results }, null, 2) + '\n');
} else {
  console.log(`\n[apply-liveness] OK ${ok.length} · DEAD ${dead.length} · UNREACHABLE ${unreachable.length}`);

  // Markdown report
  const today = new Date().toISOString().slice(0, 10);
  const out = [
    `# Apply-Queue Liveness — ${today}`,
    '',
    `Probed ${results.length} apps in GO / Conditional GO / Ready to Submit.`,
    '',
    `| Result | Count |`,
    `|---|---|`,
    `| OK | ${ok.length} |`,
    `| DEAD / REDIRECTED | ${dead.length} |`,
    `| UNREACHABLE | ${unreachable.length} |`,
    '',
  ];

  if (dead.length > 0) {
    out.push('## Dead listings (recommend → Discarded)', '');
    out.push('| # | Company | Role | Score | Reason | URL |', '|---|---|---|---|---|---|');
    for (const d of dead) {
      out.push(`| ${d.id} | ${d.company} | ${d.role} | ${d.score} | ${d.reason} | <${d.apply_url}> |`);
    }
    out.push('');
  }

  if (unreachable.length > 0) {
    out.push('## Unreachable (re-check later, transient)', '');
    for (const u of unreachable) out.push(`- #${u.id} ${u.company} — ${u.reason}`);
    out.push('');
  }

  const reportPath = resolve(ROOT, 'data', `apply-liveness-${today}.md`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, out.join('\n') + '\n', 'utf8');
  console.log(`[apply-liveness] Report: ${reportPath}`);
}

appendAutomationEvent(ROOT, {
  type: 'apply-liveness.run.completed',
  totals: { ok: ok.length, dead: dead.length, unreachable: unreachable.length },
  probed: results.length,
});

process.exit(dead.length > 0 ? 0 : 0); // exit 0 always; report drives action
