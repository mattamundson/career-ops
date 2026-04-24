#!/usr/bin/env node
/**
 * smoke.mjs — Fast regression: tracker parses, index builds, dashboard generates.
 *
 * Skips cv-sync, unit tests, automation-events validation, and cron checks
 * (use `pnpm run verify:ci` for the full pre-push suite).
 *
 * Usage:
 *   pnpm run smoke
 *   node scripts/smoke.mjs [--stale-check]
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const extra = process.argv.slice(2).filter((a) => a === '--stale-check');

function run(rel, args = []) {
  const r = spawnSync(process.execPath, [resolve(ROOT, rel), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  return r.status ?? 1;
}

console.log('\n[smoke] 1/3 verify-pipeline…\n');
if (run('verify-pipeline.mjs', ['--skip-missing-reports', ...extra]) !== 0) {
  process.exit(1);
}

console.log('\n[smoke] 2/3 build-application-index…\n');
if (run('scripts/build-application-index.mjs') !== 0) {
  process.exit(1);
}

console.log('\n[smoke] 3/3 generate-dashboard…\n');
if (run('scripts/generate-dashboard.mjs') !== 0) {
  process.exit(1);
}

console.log(
  '\n✅ smoke OK — pipeline + index + dashboard. Full CI: pnpm run verify:ci\n',
);
