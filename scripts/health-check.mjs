#!/usr/bin/env node
/**
 * health-check.mjs
 *
 * One-shot system-health probe. Prints a colored report; exits non-zero when
 * any hard check fails. Designed to be:
 *   - Run by hand: `pnpm run health`
 *   - Wired into a Win Task (low frequency, e.g. every 6h) that fires notify()
 *     on failure
 *   - Surfaced in the dashboard's freshness panel (already done in
 *     generateFreshnessBadges())
 *
 * Checks (each scored pass/warn/fail):
 *   1. expected scheduled tasks have fired in the last expectedHours × 1.5
 *      (warn at ×1.5, fail at ×3) — read from data/events/*.jsonl
 *   2. no task.failed events in the last 24h (warn at 1+, fail at 5+)
 *   3. applications.md parses cleanly (fail otherwise)
 *   4. stale-application count ≤ 10 (warn at 5+, fail at 10+)
 *   5. brain coverage ≥ 95% (warn at <95%, fail at <80%) — skipped if brain unreachable
 *
 * Exit codes: 0 = all pass or warn-only, 1 = at least one fail, 2 = internal error.
 *
 * Flags:
 *   --json           → emit JSON instead of human text (for cron/dashboard ingest)
 *   --no-brain       → skip brain check (offline/CI)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './load-env.mjs';
import { buildApplicationIndex } from './lib/career-data.mjs';
import { isBrainAvailable, getBrainStats } from './lib/brain-client.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has('--json');
const NO_BRAIN = args.has('--no-brain');

const RESULTS = []; // { name, status: 'pass'|'warn'|'fail', detail }

function add(name, status, detail) {
  RESULTS.push({ name, status, detail });
}

// ── Event loader ────────────────────────────────────────────────────────────

function loadRecentEvents(maxAgeMs) {
  const dir = join(ROOT, 'data', 'events');
  if (!existsSync(dir)) return [];
  const cutoff = Date.now() - maxAgeMs;
  const out = [];
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  // Newest 5 day files cover any 24-72h window.
  files.sort();
  for (const f of files.slice(-5)) {
    let body;
    try { body = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt;
      try { evt = JSON.parse(trimmed); } catch { continue; }
      const ts = new Date(evt.recorded_at || evt.timestamp || evt.ts || evt.at || 0).getTime();
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      out.push({ ...evt, _ts: ts });
    }
  }
  return out;
}

// ── Check 1: scheduled-task freshness ───────────────────────────────────────

function checkTaskFreshness(events) {
  const tasks = [
    { id: 'dashboard',   types: ['dashboard.generated'],                                          expectedHours: 1 },
    { id: 'scanner',     types: ['scanner.run.completed', 'auto-scan.run.completed'],             expectedHours: 24 },
    { id: 'prefilter',   types: ['prefilter_templates_generated'],                                expectedHours: 24 },
    { id: 'gmail-sync',  types: ['gmail-sync.run.success', 'gmail-sync.run.completed'],           expectedHours: 1 },
    { id: 'cadence',     types: ['cadence-alert.run.completed', 'cadence-alert.run.success'],     expectedHours: 24 },
  ];
  const now = Date.now();
  for (const t of tasks) {
    const matches = events.filter((e) => t.types.includes(e.type));
    if (matches.length === 0) {
      add(`task:${t.id}`, 'warn', `no event in last 72h (expected every ${t.expectedHours}h)`);
      continue;
    }
    const last = Math.max(...matches.map((e) => e._ts));
    const ageMs = now - last;
    const ageHours = ageMs / (60 * 60 * 1000);
    if (ageHours > t.expectedHours * 3) {
      add(`task:${t.id}`, 'fail', `${ageHours.toFixed(1)}h since last (expected ${t.expectedHours}h, fail at ${t.expectedHours * 3}h)`);
    } else if (ageHours > t.expectedHours * 1.5) {
      add(`task:${t.id}`, 'warn', `${ageHours.toFixed(1)}h since last (expected ${t.expectedHours}h)`);
    } else {
      add(`task:${t.id}`, 'pass', `${ageHours.toFixed(1)}h since last`);
    }
  }
}

// ── Check 2: task.failed events ─────────────────────────────────────────────

function checkRecentFailures(events) {
  const failures = events.filter((e) => e.type === 'task.failed');
  if (failures.length === 0) {
    add('failures:24h', 'pass', '0 task.failed events in last 24h');
    return;
  }
  const summary = failures.slice(0, 3).map((f) => `${f.job || f.task || 'unknown'}: ${(f.error || '').slice(0, 60)}`).join('; ');
  if (failures.length >= 5) add('failures:24h', 'fail', `${failures.length} failures — ${summary}`);
  else add('failures:24h', 'warn', `${failures.length} failure(s) — ${summary}`);
}

// ── Check 3: applications.md parse ─────────────────────────────────────────

function checkApplicationsParse() {
  try {
    const snap = buildApplicationIndex(ROOT);
    add('applications:parse', 'pass', `${snap.records.length} rows parsed cleanly`);
    return snap.records;
  } catch (e) {
    add('applications:parse', 'fail', `parse error: ${e.message}`);
    return [];
  }
}

// ── Check 4: stale apps ─────────────────────────────────────────────────────

function checkStaleApps() {
  let files = [];
  try {
    files = readdirSync(join(ROOT, 'data')).filter((f) => /^stale-alert-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  } catch { add('stale:count', 'warn', 'data/stale-alert-*.md files unreadable'); return; }
  if (files.length === 0) { add('stale:count', 'pass', 'no stale-alert files (clean)'); return; }
  const latest = files[files.length - 1];
  const dateStr = latest.match(/(\d{4}-\d{2}-\d{2})/)[1];
  const ageDays = Math.floor((Date.now() - new Date(dateStr + 'T00:00:00Z').getTime()) / (24 * 60 * 60 * 1000));
  if (ageDays > 2) { add('stale:count', 'warn', `latest stale-alert is ${ageDays}d old (cadence-alert may not be running)`); return; }
  let body;
  try { body = readFileSync(join(ROOT, 'data', latest), 'utf8'); } catch { add('stale:count', 'warn', 'cannot read stale-alert'); return; }
  const re = /^\s*\d+\.\s+.+?\s+\|\s+.+?\s+\|\s+.+?\s+\|\s+\d+d\s+\([+-]?\d+d\s+(?:over|left)\)/;
  const count = body.split('\n').filter((l) => re.test(l)).length;
  if (count >= 10) add('stale:count', 'fail', `${count} stale apps (>= 10)`);
  else if (count >= 5) add('stale:count', 'warn', `${count} stale apps`);
  else add('stale:count', 'pass', `${count} stale apps (${dateStr})`);
}

// ── Check 5: brain coverage ─────────────────────────────────────────────────

async function checkBrainCoverage() {
  if (NO_BRAIN) { add('brain:coverage', 'pass', 'skipped (--no-brain)'); return; }
  try {
    const available = await isBrainAvailable();
    if (!available) { add('brain:coverage', 'warn', 'brain MCP unreachable'); return; }
    const stats = await getBrainStats();
    if (!stats || stats.available === false || typeof stats.chunks !== 'number') {
      add('brain:coverage', 'warn', 'brain stats unavailable'); return;
    }
    // If the configured brain has no career-ops content (e.g. shared DB pointed
    // at another project), don't fail this project's health on it.
    const careerPages = (stats.byType?.evaluation || 0) + (stats.byType?.company || 0)
      + (stats.byType?.application || 0) + (stats.byType?.person || 0);
    if (careerPages === 0 && (stats.pages || 0) > 0) {
      add('brain:coverage', 'warn', `brain has ${stats.pages} pages but 0 career-ops pages — DB may be pointed at another project (see runbook)`);
      return;
    }
    const total = stats.chunks || 0;
    const embedded = stats.embedded || 0;
    const pct = total > 0 ? (embedded / total) * 100 : 0;
    if (pct < 80) add('brain:coverage', 'fail', `${pct.toFixed(1)}% (${embedded}/${total})`);
    else if (pct < 95) add('brain:coverage', 'warn', `${pct.toFixed(1)}% (${embedded}/${total})`);
    else add('brain:coverage', 'pass', `${pct.toFixed(1)}% (${embedded}/${total})`);
  } catch (e) {
    add('brain:coverage', 'warn', `check error: ${e.message}`);
  }
}

// ── Run + report ────────────────────────────────────────────────────────────

async function main() {
  const events24h = loadRecentEvents(24 * 60 * 60 * 1000);
  const events72h = loadRecentEvents(72 * 60 * 60 * 1000);

  checkTaskFreshness(events72h);
  checkRecentFailures(events24h);
  checkApplicationsParse();
  checkStaleApps();
  await checkBrainCoverage();

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const r of RESULTS) counts[r.status]++;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      generated_at: new Date().toISOString(),
      summary: counts,
      checks: RESULTS,
    }, null, 2));
  } else {
    const ICON = { pass: '✅', warn: '⚠ ', fail: '✖ ' };
    const COLOR = { pass: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m' };
    const RESET = '\x1b[0m';
    console.log(`\n  Career-Ops Health — ${new Date().toISOString()}\n`);
    for (const r of RESULTS) {
      console.log(`  ${COLOR[r.status]}${ICON[r.status]}${RESET} ${r.name.padEnd(22)} ${r.detail}`);
    }
    console.log(`\n  Summary: ${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail\n`);
  }

  process.exitCode = counts.fail > 0 ? 1 : 0;
}

await main();
