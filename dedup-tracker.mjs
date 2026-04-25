#!/usr/bin/env node
/**
 * dedup-tracker.mjs — Remove duplicate entries from applications.md
 *
 * Groups by normalized company + fuzzy role match.
 * Keeps entry with highest score. If discarded entry had more advanced status,
 * preserves that status. Merges notes.
 *
 * Run: node career-ops/dedup-tracker.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dedupeApplicationsMarkdown } from './scripts/lib/tracker-dedupe.mjs';

const CAREER_OPS = fileURLToPath(new URL('.', import.meta.url));
// Support both layouts: data/applications.md (boilerplate) and applications.md (original)
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const DRY_RUN = process.argv.includes('--dry-run');

// Read
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to dedup.');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const result = dedupeApplicationsMarkdown(content);

console.log(`📊 ${result.entries.length} entries loaded`);

for (const update of result.updated) {
  console.log(`  📝 #${update.num}: retained best status/notes`);
}
for (const dup of result.removed) {
  console.log(`🗑️  Remove #${dup.num} (${dup.company} — ${dup.role}; ${dup.reason}) → kept #${dup.keptNum}`);
}

console.log(`\n📊 ${result.removed.length} duplicates removed`);

if (!DRY_RUN && result.removed.length > 0) {
  copyFileSync(APPS_FILE, APPS_FILE + '.bak');
  writeFileSync(APPS_FILE, result.content);
  console.log('✅ Written to applications.md (backup: applications.md.bak)');
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No duplicates found');
}
