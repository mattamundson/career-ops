#!/usr/bin/env node
/**
 * apply-review-batch.mjs — Phase B': run apply-review for an approved ID list
 *
 * Still human-in-the-loop: you choose the IDs and mode. This only sequences
 * subprocess calls to apply-review.mjs (same guardrails: score, bundle age,
 * daily confirm cap of 5).
 *
 *   pnpm run apply-review:batch -- --prepare --ids=016,042
 *   pnpm run apply-review:batch -- --prepare 016 042 --force-low-score
 *   pnpm run apply-review:batch -- --prepare --file=data/apply-batch-ids.txt
 *   pnpm run apply-review:batch -- --confirm --ids=016 --accept-submit-risk
 *
 * --confirm requires --accept-submit-risk (explicit). Respects 5 confirms/day
 * (stops when cap reached). Use --dry-run to print the plan only.
 *
 * --delay-ms=8000 (default) pauses between steps so the browser can settle.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProjectEnv } from './load-env.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { isMainEntry } from './lib/main-entry.mjs';
import { todayConfirmCount } from './lib/apply-review-cap.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const APPLY_REVIEW = resolve(__dir, 'apply-review.mjs');
const APPLY_RUNS_DIR = resolve(ROOT, 'data', 'apply-runs');
loadProjectEnv(ROOT);

function normalizeId(id) {
  return String(id).padStart(3, '0');
}

export function parseBatchArgs(argv) {
  const out = {
    mode: null,
    ids: [],
    dryRun: false,
    forceLowScore: false,
    headless: false,
    delayMs: 8000,
    acceptSubmit: false,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--prepare') {
      out.mode = 'prepare';
      continue;
    }
    if (a === '--confirm') {
      out.mode = 'confirm';
      continue;
    }
    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (a === '--force-low-score') {
      out.forceLowScore = true;
      continue;
    }
    if (a === '--headless') {
      out.headless = true;
      continue;
    }
    if (a === '--accept-submit-risk') {
      out.acceptSubmit = true;
      continue;
    }
    if (a.startsWith('--ids=')) {
      a
        .slice(6)
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => seen.add(normalizeId(id)));
      continue;
    }
    if (a.startsWith('--file=')) {
      const p = resolve(ROOT, a.slice(7));
      if (existsSync(p)) {
        for (const line of readFileSync(p, 'utf8').split('\n')) {
          const m = line.match(/\b(\d{1,4})\b/);
          if (m) seen.add(normalizeId(m[1]));
        }
      }
      continue;
    }
    if (a.startsWith('--delay-ms=')) {
      const n = parseInt(a.slice(11), 10);
      if (Number.isFinite(n) && n >= 0) out.delayMs = n;
      continue;
    }
    if (/^\d{1,4}$/.test(a)) {
      seen.add(normalizeId(a));
    }
  }
  out.ids = [...seen];
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runApplyReviewBatch(opts) {
  if (!opts.mode || (opts.mode !== 'prepare' && opts.mode !== 'confirm')) {
    throw new Error('set --prepare or --confirm');
  }
  if (opts.mode === 'confirm' && !opts.acceptSubmit && !opts.dryRun) {
    throw new Error('refusing --confirm without --accept-submit-risk (see script header)');
  }
  if (opts.ids.length === 0) {
    throw new Error('no IDs — use --ids=1,2,3 and/or bare numeric args, or --file=path');
  }

  const results = { ok: [], fail: [], skipped: [] };

  if (opts.mode === 'confirm' && !opts.dryRun) {
    const already = todayConfirmCount(APPLY_RUNS_DIR);
    const cap = 5;
    if (already >= cap) {
      throw new Error(`daily confirm cap (${cap}) already reached — try tomorrow`);
    }
    const maxCan = cap - already;
    if (opts.ids.length > maxCan) {
      for (const id of opts.ids.slice(maxCan)) {
        results.skipped.push({ id, reason: `daily cap: ${already} already, max ${maxCan} more` });
      }
      opts.ids = opts.ids.slice(0, maxCan);
    }
    if (opts.ids.length === 0) {
      throw new Error('no confirm slots left today (5/day cap) for the requested batch');
    }
  }

  for (let i = 0; i < opts.ids.length; i += 1) {
    const id = opts.ids[i];
    if (opts.delayMs > 0 && i > 0 && !opts.dryRun) {
      await sleep(opts.delayMs);
    }

    if (opts.dryRun) {
      console.log(`[apply-review:batch] dry-run: would run --${opts.mode} ${id}`);
      results.ok.push(id);
      continue;
    }

    const childArgs = [APPLY_REVIEW, `--${opts.mode}`, id];
    if (opts.forceLowScore) childArgs.push('--force-low-score');
    if (opts.headless) childArgs.push('--headless');

    const r = spawnSync(process.execPath, childArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      encoding: 'utf8',
    });
    const code = r.status === null ? 1 : r.status;
    if (code === 0) {
      results.ok.push(id);
    } else {
      results.fail.push({ id, exit: code });
    }
  }

  appendAutomationEvent(ROOT, {
    type: 'apply-review.batch.completed',
    mode: opts.mode,
    dry_run: opts.dryRun,
    totals: {
      ok: results.ok.length,
      fail: results.fail.length,
      skipped: results.skipped.length,
    },
    ids: opts.ids,
  });

  return results;
}

async function main() {
  const raw = process.argv.slice(2);
  let opts;
  try {
    opts = parseBatchArgs(raw);
  } catch (e) {
    console.error(`[apply-review:batch] ${e.message}`);
    process.exit(2);
    return;
  }

  if (!opts.mode) {
    console.error(
      'Usage: node scripts/apply-review-batch.mjs --prepare --ids=016,042 [--force-low-score] [--headless] [--delay-ms=8000]\n' +
        '       node scripts/apply-review-batch.mjs --confirm --ids=016 --accept-submit-risk\n' +
        '       Add --dry-run to list planned steps only. IDs can be space-separated or from --file=.'
    );
    process.exit(2);
    return;
  }

  try {
    const results = await runApplyReviewBatch(opts);
    if (opts.dryRun) {
      console.log(`\n[apply-review:batch] dry-run: ${results.ok.length} step(s). Remove --dry-run to execute.\n`);
      process.exit(0);
      return;
    }
    console.log(
      `\n[apply-review:batch] done — ok: ${results.ok.length}  fail: ${results.fail.length}  skipped: ${results.skipped.length}\n`
    );
    if (results.skipped.length) {
      for (const s of results.skipped) {
        console.log(`  skipped #${s.id} — ${s.reason}`);
      }
    }
    process.exit(results.fail.length > 0 ? 1 : 0);
  } catch (e) {
    console.error(`[apply-review:batch] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

if (isMainEntry(import.meta.url)) {
  main();
}
