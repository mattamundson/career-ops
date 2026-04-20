#!/usr/bin/env node
/**
 * fix-brain-staging-slugs.mjs
 *
 * Strip the `slug:` line from frontmatter in data/{brain-staging-*,company-intel}/*.md
 * so gbrain sync uses the path-derived slug instead of rejecting the file.
 *
 * Background: gbrain enforces frontmatter slug == slugifyPath(relativePath).
 * Our files declare bare slugs (e.g. `slug: panopto`) while their path-derived
 * slug is `data/company-intel/panopto`, so they are rejected on sync.
 *
 * Targets (recursive .md scan):
 *   data/brain-staging-applications/
 *   data/brain-staging-intel/
 *   data/brain-staging-people/
 *   data/brain-staging-reports/
 *   data/company-intel/
 *
 * Usage:
 *   node scripts/fix-brain-staging-slugs.mjs            # dry-run (shows what would change)
 *   node scripts/fix-brain-staging-slugs.mjs --apply    # actually edit
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIRS = [
  'data/brain-staging-applications',
  'data/brain-staging-intel',
  'data/brain-staging-people',
  'data/brain-staging-reports',
  'data/company-intel',
];
const APPLY = process.argv.includes('--apply');

let totalChanged = 0;
let totalFiles = 0;

for (const rel of TARGET_DIRS) {
  const dir = join(ROOT, rel);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); }
  catch { console.log(`[fix-staging-slugs] skip missing ${rel}`); continue; }
  totalFiles += files.length;
  let changed = 0;
  for (const f of files) {
    const path = join(dir, f);
    const text = readFileSync(path, 'utf8');
    if (!/^---\s*$/m.test(text)) continue;
    // Only touch slug: lines inside the first frontmatter block (between first two ---).
    const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!fmMatch) continue;
    const fm = fmMatch[1];
    if (!/^slug:\s*\S+/m.test(fm)) continue;
    const newFm = fm.replace(/^slug:\s*\S+\s*$\n?/m, '');
    const updated = text.slice(0, fmMatch.index) + `---\n${newFm}\n---\n` + text.slice(fmMatch.index + fmMatch[0].length);
    if (updated === text) continue;
    changed++;
    if (APPLY) writeFileSync(path, updated, 'utf8');
  }
  totalChanged += changed;
  console.log(`  ${rel}: ${APPLY ? 'rewrote' : 'would rewrite'} ${changed}/${files.length}`);
}

console.log(`[fix-staging-slugs] ${APPLY ? 'rewrote' : 'would rewrite'} ${totalChanged}/${totalFiles} files total`);
if (!APPLY) console.log(`[fix-staging-slugs] Dry-run. Pass --apply to write.`);
