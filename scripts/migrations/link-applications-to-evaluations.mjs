#!/usr/bin/env node
// Creates directed links in gbrain: application → evaluated_by → evaluation
// Reads data/brain-staging-applications/app-NNN.md frontmatter (report_slug) to resolve target.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGING = join(ROOT, 'data', 'brain-staging-applications');
const GBRAIN_DIR = join(ROOT, 'vendor', 'gbrain');

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([a-z_]+):\s*(.*)$/);
    if (km) out[km[1]] = km[2].replace(/^"|"$/g, '').trim();
  }
  return out;
}

const files = readdirSync(STAGING).filter(f => f.endsWith('.md'));
let linked = 0;
let skipped = 0;
const failures = [];

for (const f of files) {
  const fm = parseFrontmatter(readFileSync(join(STAGING, f), 'utf8'));
  if (!fm.slug || !fm.report_slug) { skipped++; continue; }
  const res = spawnSync(
    'bun',
    ['run', 'src/cli.ts', 'link', fm.slug, fm.report_slug, '--link-type', 'evaluated_by'],
    { cwd: GBRAIN_DIR, encoding: 'utf8' }
  );
  if (res.status === 0) {
    linked++;
  } else {
    failures.push({ slug: fm.slug, target: fm.report_slug, stderr: (res.stderr || '').slice(0, 200) });
  }
}

console.log(`Linked: ${linked}, skipped: ${skipped}, failed: ${failures.length}`);
for (const f of failures.slice(0, 5)) console.log(`  FAIL ${f.slug} → ${f.target}: ${f.stderr}`);
