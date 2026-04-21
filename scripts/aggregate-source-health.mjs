#!/usr/bin/env node
/**
 * aggregate-source-health.mjs — Compute per-source reliability + yield metrics
 * from data/events/*.jsonl over a rolling window. Writes data/source-health.json.
 *
 * Runs post-scan (from auto-scan.mjs) and on-demand for the dashboard generator.
 *
 * Usage:
 *   node scripts/aggregate-source-health.mjs [--days=14] [--out=data/source-health.json]
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isMainEntry } from './lib/main-entry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

function parseArgs(argv) {
  const args = argv.slice(2);
  const getNum = (name, dflt) => {
    const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i < 0) return dflt;
    const eq = args[i].indexOf('=');
    const raw = eq >= 0 ? args[i].slice(eq + 1) : args[i + 1];
    const v = parseInt(raw, 10);
    return Number.isFinite(v) ? v : dflt;
  };
  const getStr = (name, dflt) => {
    const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i < 0) return dflt;
    const eq = args[i].indexOf('=');
    return eq >= 0 ? args[i].slice(eq + 1) : args[i + 1] || dflt;
  };
  return {
    days: getNum('days', 14),
    out: getStr('out', 'data/source-health.json'),
  };
}

function readEvents(eventsDir, sinceMs) {
  if (!existsSync(eventsDir)) return [];
  const files = readdirSync(eventsDir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort();
  const events = [];
  for (const f of files) {
    const path = join(eventsDir, f);
    try {
      if (statSync(path).mtimeMs < sinceMs - 86400 * 1000) continue;
    } catch {}
    let content;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        const ts = Date.parse(e.recorded_at || e.timestamp || e.ts || e.at || '');
        if (!Number.isFinite(ts) || ts < sinceMs) continue;
        events.push({ ...e, _ts: ts });
      } catch {
        // malformed line — skip
      }
    }
  }
  return events;
}

function classifySource(eventType) {
  // scanner.<source>.completed → source
  // scanner.run.completed        → 'run' (aggregate)
  // scanner.run.failed           → 'run' (aggregate)
  const m = /^scanner\.([^.]+)\.(completed|failed|partial)$/.exec(eventType || '');
  if (!m) return null;
  return m[1];
}

function aggregate(events, windowDays) {
  const sources = {};
  for (const e of events) {
    const source = classifySource(e.type);
    if (!source) continue;
    const bucket = sources[source] || (sources[source] = {
      last_run: null,
      last_success: null,
      last_failure: null,
      last_partial: null,
      runs: 0,
      successes: 0,
      partials: 0,
      failures: 0,
      errors: 0,
      total_yield: 0,
      yield_samples: 0,
      recent_status: null,
      sparkline: [], // newest last; values: 's' success, 'p' partial, 'e' error/failure
    });
    const tsIso = e.recorded_at || new Date(e._ts).toISOString();
    bucket.runs += 1;
    bucket.last_run = !bucket.last_run || tsIso > bucket.last_run ? tsIso : bucket.last_run;
    const status = (e.status || '').toLowerCase();
    if (status === 'success') {
      bucket.successes += 1;
      bucket.last_success = !bucket.last_success || tsIso > bucket.last_success ? tsIso : bucket.last_success;
      bucket.sparkline.push({ ts: e._ts, mark: 's' });
    } else if (status === 'partial' || status === 'partial_success') {
      bucket.partials += 1;
      bucket.last_partial = !bucket.last_partial || tsIso > bucket.last_partial ? tsIso : bucket.last_partial;
      bucket.sparkline.push({ ts: e._ts, mark: 'p' });
    } else if (status === 'failure' || status === 'error' || status === 'failed') {
      bucket.failures += 1;
      bucket.last_failure = !bucket.last_failure || tsIso > bucket.last_failure ? tsIso : bucket.last_failure;
      bucket.sparkline.push({ ts: e._ts, mark: 'e' });
    }
    // Yield: newCount | pipeline_additions | new_added
    const d = e.details || {};
    const yieldVal = Number(d.newCount ?? d.new_added ?? d.pipeline_additions);
    if (Number.isFinite(yieldVal) && yieldVal >= 0) {
      bucket.total_yield += yieldVal;
      bucket.yield_samples += 1;
    }
    if (Array.isArray(d.errors)) bucket.errors += d.errors.length;
  }
  // Finalize
  for (const [name, b] of Object.entries(sources)) {
    b.sparkline.sort((a, b2) => a.ts - b2.ts);
    b.sparkline = b.sparkline.slice(-14).map((x) => x.mark);
    b.success_rate = b.runs > 0 ? Math.round((b.successes / b.runs) * 1000) / 1000 : null;
    b.partial_rate = b.runs > 0 ? Math.round((b.partials / b.runs) * 1000) / 1000 : null;
    b.failure_rate = b.runs > 0 ? Math.round((b.failures / b.runs) * 1000) / 1000 : null;
    b.avg_yield = b.yield_samples > 0 ? Math.round((b.total_yield / b.yield_samples) * 10) / 10 : null;
    // Most-recent status wins
    const recent = b.sparkline[b.sparkline.length - 1];
    b.recent_status = recent === 's' ? 'success' : recent === 'p' ? 'partial' : recent === 'e' ? 'error' : null;
    sources[name] = b;
  }
  return {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    total_events: events.length,
    sources,
  };
}

export function computeSourceHealth({ days = 14 } = {}) {
  const sinceMs = Date.now() - days * 86400 * 1000;
  const events = readEvents(join(ROOT, 'data', 'events'), sinceMs);
  return aggregate(events, days);
}

export function writeSourceHealth({ days = 14, outPath = 'data/source-health.json' } = {}) {
  const report = computeSourceHealth({ days });
  const abs = resolve(ROOT, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(report, null, 2));
  return { report, path: abs };
}

async function main() {
  const { days, out } = parseArgs(process.argv);
  const { report, path } = writeSourceHealth({ days, outPath: out });
  const summary = Object.entries(report.sources)
    .map(([name, s]) => `  ${name.padEnd(20)} runs=${String(s.runs).padStart(3)} success=${(s.success_rate ?? 0 * 100).toFixed(1)} last=${s.recent_status || 'n/a'}`)
    .join('\n');
  console.log(`source-health written to ${path}`);
  console.log(`window=${days}d, total_events=${report.total_events}`);
  console.log(summary || '  (no sources found in window)');
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    console.error('[aggregate-source-health] Fatal:', err.message);
    process.exit(1);
  });
}
