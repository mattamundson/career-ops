#!/usr/bin/env node
/**
 * pipeline-hygiene.mjs — Run pipeline dedupe then tracker prune in one step.
 *
 *   node scripts/pipeline-hygiene.mjs           # both dry-run
 *   node scripts/pipeline-hygiene.mjs --apply   # both write + .bak
 *
 * Extra args after -- are forwarded to both scripts (e.g. only one file is not supported; use individual scripts).
 */

import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const apply = process.argv.includes('--apply');

function run(script, args) {
  const r = spawnSync(process.execPath, [resolve(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  return r.status ?? 1;
}

const args = apply ? ['--apply'] : [];

console.log('\n=== pipeline-hygiene: dedupe-pipeline-md ===\n');
if (run('scripts/dedupe-pipeline-md.mjs', args) !== 0) process.exit(1);

console.log('\n=== pipeline-hygiene: prune-pipeline-tracked ===\n');
if (run('scripts/prune-pipeline-tracked.mjs', args) !== 0) process.exit(1);

console.log('\n✅ pipeline-hygiene complete.\n');
