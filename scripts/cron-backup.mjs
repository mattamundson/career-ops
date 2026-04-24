#!/usr/bin/env node
/**
 * cron-backup.mjs — Nightly / scheduled snapshot of allowlisted career-ops data
 *
 * Wires to Windows Task Scheduler via run-nightly-backup.bat; emits
 * task.start / task.complete / task.failed via runCronTask.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCronTask } from './lib/cron-wrap.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

runCronTask(
  'cron-backup',
  () => {
    const script = resolve(__dir, 'backup-career-data.mjs');
    const r = spawnSync(process.execPath, [script], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const err = (r.stderr || '') + (r.stdout || '');
    if (r.status !== 0) {
      throw new Error(err.slice(0, 400) || `backup-career-data exited ${r.status}`);
    }
    return { exit: 0, preview: (r.stdout || '').slice(0, 200) };
  },
  { singleInstance: true },
);
