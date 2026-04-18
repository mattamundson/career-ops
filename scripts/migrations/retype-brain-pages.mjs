#!/usr/bin/env node
// Re-imports reports/ and data/company-intel/ with explicit type frontmatter.
// Brain currently has all of these as type=concept. After this runs:
//   - reports/NNN-*.md → type=evaluation pages
//   - data/company-intel/*.md → type=company pages
//
// Uses gbrain-staging-reports/ and gbrain-staging-intel/ as throwaway
// directories (gitignored) so source files stay untouched.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORTS_DIR = join(ROOT, 'reports');
const INTEL_DIR = join(ROOT, 'data', 'company-intel');
const STAGE_REPORTS = join(ROOT, 'data', 'brain-staging-reports');
const STAGE_INTEL = join(ROOT, 'data', 'brain-staging-intel');

mkdirSync(STAGE_REPORTS, { recursive: true });
mkdirSync(STAGE_INTEL, { recursive: true });

function tagFrontmatter(raw, type, slug) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    // Has existing frontmatter — inject `type:` if absent
    const fmBody = fmMatch[1];
    const rest = fmMatch[2];
    if (/^type\s*:/m.test(fmBody)) {
      // Replace existing type
      const newFm = fmBody.replace(/^type\s*:.*$/m, `type: ${type}`);
      return `---\n${newFm}\n---\n${rest}`;
    }
    return `---\ntype: ${type}\n${fmBody}\n---\n${rest}`;
  }
  // No frontmatter — prepend a fresh block
  return `---\ntype: ${type}\nslug: ${slug}\n---\n\n${raw}`;
}

function restage(sourceDir, stageDir, type) {
  const files = readdirSync(sourceDir).filter((f) => f.endsWith('.md'));
  let count = 0;
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    const raw = readFileSync(join(sourceDir, f), 'utf8');
    const out = tagFrontmatter(raw, type, slug);
    writeFileSync(join(stageDir, f), out, 'utf8');
    count++;
  }
  return count;
}

const reportCount = restage(REPORTS_DIR, STAGE_REPORTS, 'evaluation');
console.log(`[retype] staged ${reportCount} reports as type=evaluation → ${STAGE_REPORTS}`);

const intelCount = restage(INTEL_DIR, STAGE_INTEL, 'company');
console.log(`[retype] staged ${intelCount} intel files as type=company → ${STAGE_INTEL}`);

console.log('\nNext:');
console.log(`  cd vendor/gbrain && bun run src/cli.ts import ${STAGE_REPORTS} --no-embed`);
console.log(`  cd vendor/gbrain && bun run src/cli.ts import ${STAGE_INTEL} --no-embed`);
