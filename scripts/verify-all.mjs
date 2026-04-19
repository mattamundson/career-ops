#!/usr/bin/env node
/**
 * verify-all.mjs — Single entrypoint for pre-session / CI health checks (6 steps).
 *
 * Usage:
 *   node scripts/verify-all.mjs [--stale-check] [--skip-missing-reports] [--skip-unit-tests]
 *
 * Forwards supported flags to verify-pipeline.mjs only.
 */

import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const skipUnitTests = process.argv.includes('--skip-unit-tests');

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
  console.log('\n=== 6/6 unit tests (skipped — use `pnpm test` or omit --skip-unit-tests) ===\n');
} else {
  console.log('\n=== 6/6 unit tests (node --test tests/*.test.mjs) ===\n');
  if (runUnitTests() !== 0) process.exit(1);
}

console.log(
  `\n✅ verify-all: pipeline + CV sync + index + dashboard + events JSONL${skipUnitTests ? '' : ' + unit tests'} OK\n`,
);
