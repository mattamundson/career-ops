#!/usr/bin/env node
/**
 * prune-apply-runs.mjs — Remove old files and directories under data/apply-runs/
 *
 * Deletes top-level names whose newest nested mtime (or self mtime for files)
 * is older than --days (default: 60). Dry-run by default; use --apply to delete.
 *
 *   node scripts/prune-apply-runs.mjs
 *   node scripts/prune-apply-runs.mjs --apply
 *   node scripts/prune-apply-runs.mjs --days=30 --apply
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const APPLY = process.argv.includes('--apply');

function getDays() {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  if (!arg) return 60;
  const n = parseInt(arg.split('=')[1], 10);
  if (Number.isNaN(n) || n < 1) {
    console.error('[apply-runs:prune] invalid --days=');
    process.exit(1);
  }
  return n;
}

const DAYS = getDays();
const CUTOFF_MS = Date.now() - DAYS * 24 * 3600 * 1000;
const dir = join(ROOT, 'data', 'apply-runs');

function maxMtimeDeep(p) {
  const st = statSync(p);
  if (!st.isDirectory()) {
    return st.mtimeMs;
  }
  let m = st.mtimeMs;
  for (const name of readdirSync(p)) {
    m = Math.max(m, maxMtimeDeep(join(p, name)));
  }
  return m;
}

function main() {
  console.log(
    `[apply-runs:prune] keep entries with activity within last ${DAYS} day(s) (cutoff mtime: ${new Date(CUTOFF_MS).toISOString()})`,
  );
  console.log(`[apply-runs:prune] mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
  console.log('');

  if (!existsSync(dir)) {
    console.log(`[apply-runs:prune] ${dir} does not exist — nothing to do.`);
    return;
  }

  const names = readdirSync(dir, { withFileTypes: true });
  const remove = [];
  for (const ent of names) {
    const p = join(dir, ent.name);
    const mm = maxMtimeDeep(p);
    if (mm < CUTOFF_MS) {
      remove.push(p);
    }
  }

  if (remove.length === 0) {
    console.log('[apply-runs:prune] nothing to remove.');
    return;
  }

  for (const p of remove) {
    if (APPLY) {
      rmSync(p, { recursive: true, force: true });
      console.log(`  deleted ${p.replace(ROOT, '.')}`);
    } else {
      console.log(`  would delete ${p.replace(ROOT, '.')}`);
    }
  }
  console.log(
    '',
    APPLY
      ? `[apply-runs:prune] removed ${remove.length} item(s).`
      : `[apply-runs:prune] ${remove.length} item(s) would be removed — re-run with --apply.`,
  );
}

main();
