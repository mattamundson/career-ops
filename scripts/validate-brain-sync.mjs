#!/usr/bin/env node
// Validates that gbrain and career-ops markdown agree on key entity counts.
// Non-fatal by default — prints a report. Exit 1 if --strict and drift found.
//
// Gate for Phase 5 cutover: once markdown and brain have been equal for N
// consecutive days under production use, retiring the markdown is safe.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBrainAvailable, getBrainStats } from './lib/brain-client.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

function countMarkdownRows(file) {
  if (!existsSync(file)) return 0;
  const raw = readFileSync(file, 'utf8');
  return raw.split(/\r?\n/)
    .filter((l) => l.trim().startsWith('|') && !/^\|\s*[-]/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((r) => r.length >= 5 && /^\d+$/.test(r[0]))
    .length;
}

function countMarkdownFiles(dir, pattern = /\.md$/) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => pattern.test(f)).length;
}

const checks = [];

if (!isBrainAvailable()) {
  const payload = { brain_available: false, checks: [] };
  if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
  else console.log('[validate-brain-sync] brain runtime unavailable; skipping.');
  process.exit(0);
}

const stats = getBrainStats();
if (!stats.available) {
  console.error(`[validate-brain-sync] brain unreachable: ${stats.error}`);
  process.exit(STRICT ? 1 : 0);
}

const byType = stats.byType || {};

const applicationsMd = countMarkdownRows(join(ROOT, 'data', 'applications.md'));
const reportsCount = countMarkdownFiles(join(ROOT, 'reports'));
const intelCount = countMarkdownFiles(join(ROOT, 'data', 'company-intel'));

checks.push({
  entity: 'applications',
  markdown: applicationsMd,
  brain: byType.application || 0,
  drift: applicationsMd - (byType.application || 0),
});
checks.push({
  entity: 'reports (evaluation)',
  markdown: reportsCount,
  brain: byType.evaluation || 0,
  drift: reportsCount - (byType.evaluation || 0),
});
checks.push({
  entity: 'company-intel',
  markdown: intelCount,
  brain: byType.company || 0,
  drift: intelCount - (byType.company || 0),
});

const drift = checks.filter((c) => typeof c.drift === 'number' && c.drift !== 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ brain_available: true, stats, checks, drift_count: drift.length }, null, 2));
} else {
  console.log('[validate-brain-sync] brain snapshot:');
  console.log(`  pages=${stats.pages} chunks=${stats.chunks} links=${stats.links} timeline=${stats.timeline}`);
  console.log(`  byType=${JSON.stringify(byType)}`);
  console.log('');
  for (const c of checks) {
    const target = c.brain ?? c.brain_concept_pages;
    const driftStr = typeof c.drift === 'number' ? ` drift=${c.drift}` : '';
    console.log(`  - ${c.entity}: markdown=${c.markdown} brain=${target}${driftStr}${c.note ? `  [${c.note}]` : ''}`);
  }
  if (drift.length > 0) {
    console.log('');
    console.warn(`[validate-brain-sync] drift detected in ${drift.length} check(s)${STRICT ? ' — exiting 1' : ''}`);
  } else {
    console.log('');
    console.log('[validate-brain-sync] ✅ no drift on typed entities');
  }
}

process.exit(drift.length > 0 && STRICT ? 1 : 0);
