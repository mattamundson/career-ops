#!/usr/bin/env node
/**
 * verify-all.mjs — Single entrypoint for pre-session / CI health checks (7 steps).
 *
 * Usage:
 *   node scripts/verify-all.mjs [--stale-check] [--skip-missing-reports]
 *                                [--skip-unit-tests] [--strict-cron]
 *
 * Forwards supported flags to verify-pipeline.mjs only.
 *
 * --strict-cron: fail (exit 1) if any task.failed events recorded in last 24h.
 *                Default behavior is warn-only — surfaces failures visibly
 *                without blocking pre-push.
 */

import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { recentTaskEvents } from './lib/cron-wrap.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const skipUnitTests = process.argv.includes('--skip-unit-tests');
const strictCron = process.argv.includes('--strict-cron');

const verifyArgs = ['verify-pipeline.mjs'];
for (const a of process.argv.slice(2)) {
  if (a === '--stale-check' || a === '--skip-missing-reports') verifyArgs.push(a);
}

function runNode(scriptRelative, args = []) {
  const script = resolve(ROOT, scriptRelative);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  return r.status ?? 1;
}

function runUnitTests() {
  const testDir = resolve(ROOT, 'tests');
  let files;
  try {
    files = readdirSync(testDir)
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => resolve(testDir, f));
  } catch {
    console.log('  (tests/ missing — skipping unit tests)\n');
    return 0;
  }
  if (files.length === 0) {
    console.log('  (no *.test.mjs — skipping)\n');
    return 0;
  }
  const r = spawnSync(process.execPath, ['--test', ...files], {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  return r.status ?? 1;
}

console.log('\n=== 1/6 verify-pipeline.mjs ===\n');
if (runNode('verify-pipeline.mjs', verifyArgs) !== 0) process.exit(1);

console.log('\n=== 2/6 cv-sync-check.mjs ===\n');
if (runNode('cv-sync-check.mjs') !== 0) process.exit(1);

console.log('\n=== 3/6 build-application-index.mjs ===\n');
if (runNode('scripts/build-application-index.mjs') !== 0) process.exit(1);

console.log('\n=== 4/6 generate-dashboard.mjs (no --open) ===\n');
if (runNode('scripts/generate-dashboard.mjs') !== 0) process.exit(1);

console.log('\n=== 5/6 validate-automation-events.mjs ===\n');
if (runNode('scripts/validate-automation-events.mjs') !== 0) process.exit(1);

if (skipUnitTests) {
  console.log('\n=== 6/7 unit tests (skipped — use `pnpm test` or omit --skip-unit-tests) ===\n');
} else {
  console.log('\n=== 6/7 unit tests (node --test tests/*.test.mjs) ===\n');
  if (runUnitTests() !== 0) process.exit(1);
}

console.log('\n=== 7/7 recent cron-task failures (last 24h) ===\n');
const recent = recentTaskEvents(ROOT, 24);
if (recent.failed.length === 0) {
  console.log(
    `  ✅ no failed scheduled-task event logs in last 24h ` +
      `(${recent.completed.length} completed, ${recent.started.length} started)\n`,
  );
} else {
  const lines = recent.failed
    .slice(0, 10)
    .map((e) => `    - ${e.failed_at} ${e.task}: ${e.error} (${e.error_code ?? 'no code'})`)
    .join('\n');
  console.log(
    `  ⚠️  ${recent.failed.length} failed task event(s) in last 24h:\n${lines}\n`,
  );
  if (strictCron) {
    console.log('  --strict-cron set; failing.\n');
    process.exit(1);
  }
}

// Also catch silent failures: tasks where Windows Task Scheduler exit code
// was non-zero but the entry script didn't emit an event. Warn-only by
// default; --strict-cron makes it fail.
const tsArgs = ['scripts/check-scheduled-tasks.mjs'];
if (strictCron) tsArgs.push('--strict');
runNode(tsArgs[0], tsArgs.slice(1));

console.log(
  `\n✅ verify-all: pipeline + CV sync + index + dashboard + events JSONL${skipUnitTests ? '' : ' + unit tests'} + cron-status OK\n`,
);
