#!/usr/bin/env node
/**
 * cron-prefilter.mjs — Nightly auto-scoring + promotion wrapper
 *
 * Wraps prefilter-pipeline.mjs --auto-score and (on success with promotions)
 * promote-prefilter.mjs + merge-tracker.mjs into a single event-emitting
 * cron task.
 *
 * Emits task.start / task.complete / task.failed events via cron-wrap so
 * verify-all.mjs + dashboard Operator Health can surface failed nightly
 * scores.
 *
 * Called from run-daily-prefilter.bat (already scheduled for 7:00 AM CT
 * via Career-Ops Prefilter Windows Task).
 *
 * Summary object emitted on task.complete:
 *   { scored, promoted, merged, skipped, errors }
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCronTask } from './lib/cron-wrap.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const MAX_AUTO_SCORE = Number(process.env.PREFILTER_MAX || 50);
const SKIP_PROMOTE = process.argv.includes('--skip-promote');
const SKIP_SCORE = process.argv.includes('--skip-score');

function runNode(label, script, args) {
  const r = spawnSync(process.execPath, [resolve(__dir, script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30 * 60_000, // 30 min per step
  });
  // Echo to our stdout for the scheduler log
  if (r.stdout) process.stdout.write(`[${label}] ${r.stdout}`);
  if (r.stderr) process.stderr.write(`[${label}] ${r.stderr}`);
  return {
    label,
    status: r.status === null ? 1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error || null,
  };
}

function parseSummary(stdout) {
  // prefilter-pipeline.mjs prints lines like "Scored N templates", "Promoted N"
  const out = { scored: 0, promoted: 0, generated: 0 };
  const scored = stdout.match(/Scored\s+(\d+)/i)?.[1];
  const promoted = stdout.match(/Promoted\s+(\d+)/i)?.[1];
  const generated = stdout.match(/Generated\s+(\d+)\s+prefilter/i)?.[1];
  if (scored) out.scored = Number(scored);
  if (promoted) out.promoted = Number(promoted);
  if (generated) out.generated = Number(generated);
  return out;
}

runCronTask('cron-prefilter', async () => {
  const summary = { scored: 0, promoted: 0, merged: 0, generated: 0, steps: [] };

  if (!SKIP_SCORE) {
    // 1. Generate templates + auto-score new prefilter entries
    const scoreArgs = ['--auto-score', `--max=${MAX_AUTO_SCORE}`];
    const r = runNode('prefilter', 'prefilter-pipeline.mjs', scoreArgs);
    summary.steps.push({ step: 'prefilter', exit: r.status });
    if (r.status !== 0) {
      const err = new Error(
        `prefilter-pipeline exited ${r.status}: ${(r.stderr || '').slice(0, 200)}`
      );
      err.retryLabel = 'prefilter-pipeline';
      throw err;
    }
    const parsed = parseSummary(r.stdout);
    Object.assign(summary, parsed);
  }

  if (!SKIP_PROMOTE) {
    // 2. Promote any scored >= 4.0 + EVALUATE to TSV additions
    const promoteR = runNode('promote', 'promote-prefilter.mjs', []);
    summary.steps.push({ step: 'promote', exit: promoteR.status });
    if (promoteR.status !== 0) {
      // Don't hard-fail the whole task; promote is idempotent and may legitimately skip
      const err = new Error(
        `promote-prefilter exited ${promoteR.status}: ${(promoteR.stderr || '').slice(0, 200)}`
      );
      err.retryLabel = 'promote-prefilter';
      throw err;
    }
    const promoted = promoteR.stdout.match(/Promoted\s+(\d+)/i)?.[1];
    if (promoted) summary.promoted = Number(promoted);

    // 3. Merge TSVs into applications.md — only if promotions happened
    if (summary.promoted > 0) {
      const mergeR = runNode('merge', '../merge-tracker.mjs', []);
      summary.steps.push({ step: 'merge', exit: mergeR.status });
      if (mergeR.status === 0) {
        summary.merged = summary.promoted;
      } else {
        // Log but don't fail
        summary.steps[summary.steps.length - 1].warning =
          (mergeR.stderr || '').slice(0, 200) || 'merge exited non-zero';
      }
    }
  }

  return summary;
});
