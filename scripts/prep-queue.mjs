#!/usr/bin/env node
/**
 * prep-queue.mjs — Phase A batch: GO / Conditional GO → package + Ready to Submit
 *
 * For every matching application (score ≥ min, evaluation report on disk):
 *   1. Optional: filter by apply-queue liveness (same probe as check-apply-queue-liveness)
 *   2. Run packageFromReport() — ATS preflight, PDF, cover letter, portal artifact, tracker bump
 *
 * Does NOT click Submit (see apply-review.mjs for prepare/confirm).
 *
 * Usage:
 *   node scripts/prep-queue.mjs --dry-run
 *   node scripts/prep-queue.mjs --min-score=3 --limit=5
 *   node scripts/prep-queue.mjs --skip-liveness
 *   node scripts/prep-queue.mjs --skip-pdf --no-tracker
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProjectEnv } from './load-env.mjs';
import { buildApplicationIndex } from './lib/career-data.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { isMainEntry } from './lib/main-entry.mjs';
import { packageFromReport } from './package-from-report.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

export function parsePrepQueueArgs(argv) {
  const out = {
    dryRun: false,
    skipLiveness: false,
    minScore: 3.0,
    limit: null,
    skipPdf: false,
    noTracker: false,
    noAts: false,
    threshold: 60,
    includeReady: false,
  };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--skip-liveness') out.skipLiveness = true;
    else if (a.startsWith('--min-score=')) out.minScore = Number(a.slice(12)) || 3;
    else if (a.startsWith('--limit=')) {
      const n = parseInt(a.slice(8), 10);
      out.limit = Number.isFinite(n) && n > 0 ? n : null;
    } else if (a === '--skip-pdf') out.skipPdf = true;
    else if (a === '--no-tracker') out.noTracker = true;
    else if (a === '--no-ats') out.noAts = true;
    else if (a.startsWith('--threshold=')) out.threshold = Number(a.slice(12)) || 60;
    else if (a === '--include-ready') out.includeReady = true;
  }
  return out;
}

function normalizeStatus(s) {
  return String(s || '').replace(/\*\*/g, '').trim();
}

function isTargetStatus(s, opts) {
  const n = normalizeStatus(s);
  if (n === 'GO' || n === 'Conditional GO') return true;
  if (opts.includeReady && n === 'Ready to Submit') return true;
  return false;
}

export function parseScoreValue(raw) {
  if (raw == null || raw === '') return null;
  const m = String(raw).match(/(\d+\.?\d*)\s*\/\s*5/);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function urlFromReportFile(reportPath) {
  if (!reportPath) return null;
  const full = resolve(ROOT, reportPath);
  if (!existsSync(full)) return null;
  try {
    const body = readFileSync(full, 'utf8');
    const apply =
      body.match(/^\*\*Apply URL:\*\*\s+(https?:\/\/\S+)/m)?.[1] ||
      body.match(/^\*\*Apply:\*\*\s+(https?:\/\/\S+)/m)?.[1];
    if (apply) return apply.trim();
    const m = body.match(/^\*\*URL:\*\*\s+(https?:\/\/\S+)/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function enrichRecord(r) {
  const score = parseScoreValue(r.score);
  let applyUrl = r.applyUrl || null;
  if (!applyUrl && r.reportPath) {
    applyUrl = urlFromReportFile(r.reportPath);
  }
  return { ...r, scoreNum: score, applyUrl };
}

/**
 * @returns {Map<string, { state: string, reason: string }>}
 */
function loadLivenessMap() {
  const script = resolve(__dir, 'check-apply-queue-liveness.mjs');
  const r = spawnSync(process.execPath, [script, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0 && !r.stdout) {
    throw new Error(`[prep-queue] liveness subprocess failed: ${(r.stderr || '').slice(0, 200)}`);
  }
  const data = JSON.parse(r.stdout);
  const map = new Map();
  for (const row of data.results || []) {
    map.set(String(row.id).padStart(3, '0'), { state: row.state, reason: row.reason || '' });
  }
  return map;
}

/**
 * @param {ReturnType<typeof parsePrepQueueArgs>} opts
 */
export async function runPrepQueue(opts) {
  const snap = buildApplicationIndex(ROOT);
  let candidates = snap.records
    .map(enrichRecord)
    .filter((a) => isTargetStatus(a.status, opts))
    .filter((a) => a.reportPath && existsSync(resolve(ROOT, a.reportPath)))
    .filter((a) => a.scoreNum !== null && a.scoreNum >= opts.minScore)
    .sort((a, b) => (b.scoreNum ?? 0) - (a.scoreNum ?? 0));

  if (opts.limit) {
    candidates = candidates.slice(0, opts.limit);
  }

  let liveness = null;
  if (!opts.skipLiveness && !opts.dryRun && candidates.length > 0) {
    liveness = loadLivenessMap();
  }

  const summary = {
    dry_run: opts.dryRun,
    min_score: opts.minScore,
    limit: opts.limit,
    skip_liveness: opts.skipLiveness,
    selected: [] /** @type {string[]} */,
    skipped: [] /** @type {{ id: string, reason: string }[]} */,
    packaged: [] /** @type {string[]} */,
    failed: [] /** @type {{ id: string, error: string }[]} */,
  };

  for (const a of candidates) {
    const id = String(a.id).padStart(3, '0');
    if (opts.dryRun) {
      let note = `score ${a.scoreNum} · ${a.company}`;
      if (!opts.skipLiveness && liveness) {
        const v = liveness.get(id);
        if (v) note += ` · liveness ${v.state}`;
      } else if (!opts.skipLiveness) {
        note += ' · liveness (would run)';
      }
      console.log(`  [dry-run] #${id}  ${note}`);
      summary.selected.push(id);
      continue;
    }

    if (!opts.skipLiveness) {
      if (!a.applyUrl) {
        summary.skipped.push({ id, reason: 'no apply URL (add to apply-queue or report **Apply URL:**)' });
        continue;
      }
      const v = liveness ? liveness.get(id) : { state: 'OK', reason: 'liveness not loaded' };
      if (v && v.state !== 'OK') {
        summary.skipped.push({ id, reason: `liveness ${v.state}: ${v.reason || ''}`.trim() });
        continue;
      }
    }

    const pkgOpts = {
      reportNum: String(parseInt(id, 10)),
      dryRun: false,
      skipPdf: opts.skipPdf,
      noTracker: opts.noTracker,
      noAts: opts.noAts,
      threshold: opts.threshold,
    };

    try {
      await packageFromReport(pkgOpts);
      summary.packaged.push(id);
      console.log(`  ✓ Packaged #${id}  ${a.company}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.failed.push({ id, error: msg });
      console.error(`  ✗ #${id}  ${msg}`);
    }
  }

  appendAutomationEvent(ROOT, {
    type: 'prep-queue.batch.completed',
    status: summary.failed.length ? 'partial' : 'ok',
    dry_run: opts.dryRun,
    totals: {
      selected: summary.selected.length,
      packaged: summary.packaged.length,
      skipped: summary.skipped.length,
      failed: summary.failed.length,
    },
    details: {
      min_score: opts.minScore,
      limit: opts.limit,
      skip_liveness: opts.skipLiveness,
    },
  });

  return summary;
}

function main() {
  const opts = parsePrepQueueArgs(process.argv.slice(2));
  console.log('[prep-queue] Phase A — package queue');
  console.log(`  min-score=${opts.minScore}  limit=${opts.limit ?? 'none'}  dry-run=${opts.dryRun}  skip-liveness=${opts.skipLiveness}`);

  runPrepQueue(opts).then(
    (s) => {
      if (opts.dryRun) {
        console.log(`\n[prep-queue] dry-run: ${s.selected.length} candidate(s). Run without --dry-run to package.\n`);
        process.exit(0);
        return;
      }
      console.log(
        `\n[prep-queue] done — packaged ${s.packaged.length} · skipped ${s.skipped.length} · failed ${s.failed.length}\n`
      );
      process.exit(s.failed.length > 0 ? 1 : 0);
    },
    (err) => {
      console.error(`[prep-queue] fatal: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  );
}

if (isMainEntry(import.meta.url)) {
  main();
}
