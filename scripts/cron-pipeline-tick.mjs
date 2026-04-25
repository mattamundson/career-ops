#!/usr/bin/env node
/**
 * cron-pipeline-tick.mjs — Full pipeline orchestrator for 24/7 automation
 *
 * Chains four steps sequentially on each tick (runs 8x/day via Task Scheduler):
 *   1. auto-scan.mjs        — discover new jobs, append to pipeline.md
 *   2. cron-prefilter.mjs   — score + promote ≥4.0 entries to GO
 *   3. prep-queue.mjs       — package GO entries (CV/CL/form answers)
 *   4. cron-autosubmit.mjs  — submit up to 3 Ready-to-Submit entries per tick
 *
 * Non-zero exit from any step is logged as a warning but does NOT abort
 * downstream steps — a scan outage should not block a submission drain.
 *
 * Replace the single 6 AM scan task with this orchestrator to get the full
 * pipeline running on every tick.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCronTask } from './lib/cron-wrap.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

function runNode(label, script, extraArgs = [], timeoutMs = 45 * 60_000) {
  const r = spawnSync(
    process.execPath,
    [resolve(__dir, script), ...extraArgs],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs },
  );
  if (r.stdout) process.stdout.write(`[${label}] ${r.stdout}`);
  if (r.stderr) process.stderr.write(`[${label}] ${r.stderr}`);
  const status = r.status === null ? 1 : r.status;
  if (status !== 0) {
    process.stderr.write(`[${label}] WARNING: exited ${status} — continuing pipeline\n`);
  }
  return { label, status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null };
}

runCronTask(
  'cron-pipeline-tick',
  async () => {
    const steps = [];

    // 1. Scan — discover new jobs
    steps.push(runNode('scan', 'auto-scan.mjs', [], 45 * 60_000));

    // 2. Prefilter — score + promote (runs even if scan had issues)
    steps.push(runNode('prefilter', 'cron-prefilter.mjs', [], 30 * 60_000));

    // 3. Prep queue — package GO entries for the high-score subset
    steps.push(runNode('prep', 'prep-queue.mjs', ['--min-score=4.0', '--limit=20'], 30 * 60_000));

    // 4. Autosubmit — drain up to 3 per tick (respects daily cap)
    steps.push(runNode('autosubmit', 'cron-autosubmit.mjs', ['--max', '3'], 20 * 60_000));

    const anyFailed = steps.filter(s => s.status !== 0);
    return {
      steps: steps.map(s => ({ step: s.label, exit: s.status })),
      warnings: anyFailed.length,
    };
  },
  { singleInstance: true },
);
