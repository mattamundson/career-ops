#!/usr/bin/env node
/**
 * backup-career-data.mjs — Copy canonical career-ops data files into backups/
 *
 * Never copies secrets (.env), credentials, or node_modules.
 * Missing optional files are recorded in manifest.json with status "missing".
 *
 * Usage:
 *   pnpm run backup:data
 *   node scripts/backup-career-data.mjs --dest my-snapshots/manual-2026-04-24
 *
 * Default output: backups/backup-<UTC-iso-sanitized>/
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const PATHS_REL = [
  'data/applications.md',
  'data/pipeline.md',
  'data/responses.md',
  'data/apply-queue.md',
  'data/scan-history.tsv',
  'cv.md',
  'article-digest.md',
  'config/profile.yml',
  'portals.yml',
  'templates/states.yml',
];

function getArg(name) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length) || null;
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : null;
}

const destOverride = getArg('dest');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = destOverride
  ? resolve(ROOT, destOverride)
  : resolve(ROOT, 'backups', `backup-${stamp}`);

mkdirSync(outDir, { recursive: true });

const manifest = { at: new Date().toISOString(), backup_root: outDir, files: [] };

for (const rel of PATHS_REL) {
  const src = resolve(ROOT, rel);
  if (!existsSync(src)) {
    manifest.files.push({ path: rel, status: 'missing' });
    continue;
  }
  const dest = join(outDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  manifest.files.push({ path: rel, status: 'copied' });
}

const manPath = join(outDir, 'manifest.json');
writeFileSync(manPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const copied = manifest.files.filter((f) => f.status === 'copied').length;
const missing = manifest.files.filter((f) => f.status === 'missing').length;
console.log(`[backup-career-data] ${copied} file(s) copied, ${missing} missing (see manifest).`);
console.log(`[backup-career-data] Output: ${outDir}`);
