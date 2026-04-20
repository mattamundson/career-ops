#!/usr/bin/env node
/**
 * fix-brain-staging-slugs.mjs
 *
 * Strip the `slug:` line from frontmatter in data/brain-staging-applications/*.md
 * so gbrain sync uses the path-derived slug instead of rejecting the file.
 *
 * Background: gbrain enforces frontmatter slug == slugifyPath(relativePath).
 * Our staging files declare `slug: app-001` while their path-derived slug is
 * `data/brain-staging-applications/app-001`, so all 42 are rejected on sync.
 *
 * Usage:
 *   node scripts/fix-brain-staging-slugs.mjs            # dry-run (shows what would change)
 *   node scripts/fix-brain-staging-slugs.mjs --apply    # actually edit
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'brain-staging-applications');
const APPLY = process.argv.includes('--apply');

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
let changed = 0;
for (const f of files) {
  const path = join(DIR, f);
  const text = readFileSync(path, 'utf8');
  if (!/^---\s*$/m.test(text)) continue;
  const updated = text.replace(/^slug:\s*\S+\s*$\n?/m, '');
  if (updated === text) continue;
  changed++;
  if (APPLY) writeFileSync(path, updated, 'utf8');
}

console.log(`[fix-staging-slugs] ${APPLY ? 'rewrote' : 'would rewrite'} ${changed}/${files.length} files`);
if (!APPLY) console.log(`[fix-staging-slugs] Dry-run. Pass --apply to write.`);
