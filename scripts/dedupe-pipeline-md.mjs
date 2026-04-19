#!/usr/bin/env node
/**
 * dedupe-pipeline-md.mjs — Remove duplicate pending job lines (same primary job key: jid, Indeed, Lever, LinkedIn, etc.).
 *
 * Also removes from `pipeline-raw-intake.md` any pending line whose key already exists
 * in `data/pipeline.md` (main inbox wins).
 *
 * Default: dry-run (prints summary only).
 *   node scripts/dedupe-pipeline-md.mjs
 *   node scripts/dedupe-pipeline-md.mjs --apply
 *   node scripts/dedupe-pipeline-md.mjs --apply --only data/pipeline.md
 *
 * Keeps the **first** occurrence within each file. Writes .bak when --apply.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { primaryLineKey } from './lib/job-url-keys.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  if (i === -1 || !process.argv[i + 1]) return null;
  return resolve(ROOT, process.argv[i + 1].replace(/^\.\//, ''));
})();

const PIPE = resolve(ROOT, 'data', 'pipeline.md');
const RAW = resolve(ROOT, 'data', 'pipeline-raw-intake.md');

function lineKey(line) {
  const m = line.match(/https?:\/\/[^\s|)]+/i);
  if (!m) return null;
  return primaryLineKey(m[0].trim());
}

function isPendingLine(line) {
  return /^\s*-\s*\[\s*\]\s+https?:\/\//i.test(line);
}

function keysFromPendingLines(absPath) {
  const keys = new Set();
  if (!existsSync(absPath)) return keys;
  const lines = readFileSync(absPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!isPendingLine(line)) continue;
    const k = lineKey(line);
    if (k) keys.add(k);
  }
  return keys;
}

function processFile(absPath, options) {
  const { dropKeys = new Set(), label } = options;
  if (!existsSync(absPath)) {
    console.log(`Skip (missing): ${label}`);
    return { path: absPath, removed: 0, cross: 0, dup: 0, skipped: true };
  }
  const raw = readFileSync(absPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const seen = new Set();
  const out = [];
  let cross = 0;
  let dup = 0;

  for (const line of lines) {
    if (!isPendingLine(line)) {
      out.push(line);
      continue;
    }
    const k = lineKey(line);
    if (!k) {
      out.push(line);
      continue;
    }
    if (dropKeys.has(k)) {
      cross++;
      continue;
    }
    if (seen.has(k)) {
      dup++;
      continue;
    }
    seen.add(k);
    out.push(line);
  }

  const removed = cross + dup;
  const newText = out.join('\n');
  if (removed > 0 && APPLY) {
    copyFileSync(absPath, `${absPath}.bak`);
    writeFileSync(absPath, newText, 'utf8');
  }
  return {
    path: absPath,
    removed,
    cross,
    dup,
    skipped: false,
    label,
  };
}

console.log(`\ndedupe-pipeline-md ${APPLY ? '--apply' : '(dry-run)'}\n`);

if (ONLY) {
  const r = processFile(ONLY, { dropKeys: new Set(), label: ONLY.replace(ROOT + '/', '') });
  if (!r.skipped) {
    console.log(`${r.label}: remove ${r.removed} (${r.cross} cross-file, ${r.dup} within-file duplicates)`);
  }
  const n = r.removed || 0;
  if (!APPLY && n > 0) console.log('\nRe-run with --apply to write + .bak\n');
  else if (APPLY && n > 0) console.log('\nDone.\n');
  process.exit(0);
}

const keysMain = keysFromPendingLines(PIPE);
const rPipe = processFile(PIPE, { dropKeys: new Set(), label: 'data/pipeline.md' });
const rRaw = processFile(RAW, { dropKeys: keysMain, label: 'data/pipeline-raw-intake.md' });

for (const r of [rPipe, rRaw]) {
  if (r.skipped) continue;
  console.log(
    `${r.label}: remove ${r.removed} line(s) — ${r.cross} already in main inbox, ${r.dup} duplicate within file`
  );
}

const total = (rPipe.skipped ? 0 : rPipe.removed) + (rRaw.skipped ? 0 : rRaw.removed);
if (!APPLY && total > 0) {
  console.log('\nRe-run with --apply to write changes (+ .bak per modified file).\n');
} else if (APPLY && total > 0) {
  console.log('\nWrote changes; .bak backups next to modified files.\n');
} else {
  console.log('\nNo changes needed.\n');
}

process.exit(0);
