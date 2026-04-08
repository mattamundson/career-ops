#!/usr/bin/env node
/**
 * Feature 10.4: Outreach Stats
 * Reads data/applications.md, parses [variant:{id}] tags from the Notes column,
 * and outputs a response-rate summary table per variant.
 *
 * Usage:
 *   node scripts/outreach-stats.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const APPLICATIONS_PATH = join(ROOT, 'data', 'applications.md');

// Statuses that count as a "response / progression"
const PROGRESSED_STATUSES = new Set(['Responded', 'Interview', 'Offer']);

// ---------------------------------------------------------------------------
// Parse applications.md
// ---------------------------------------------------------------------------

function parseApplications(raw) {
  const entries = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    // Skip header, separator, blank, and non-table lines
    if (!trimmed.startsWith('|')) continue;
    if (trimmed.startsWith('|---') || trimmed.startsWith('| #') || trimmed.startsWith('| --')) continue;

    // Split pipe-delimited columns
    const cols = trimmed.split('|').map(c => c.trim()).filter(Boolean);

    // Expect at minimum: #, Date, Company, Role, Score, Status, PDF, Report, Notes (9 cols)
    if (cols.length < 6) continue;

    // Column indices based on the header:
    // | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
    const rowNum = cols[0];
    if (!/^\d+$/.test(rowNum)) continue; // skip header row that slipped through

    const status = cols[5] || '';
    const notes  = cols[8] || '';

    // Extract all [variant:xxx] tags from the Notes column
    const variantMatches = [...notes.matchAll(/\[variant:([^\]]+)\]/g)];
    const variantIds = variantMatches.map(m => m[1].trim());

    entries.push({ rowNum, status, notes, variantIds });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Compute stats
// ---------------------------------------------------------------------------

function computeStats(entries) {
  // Map: variantId → { uses: number, progressed: number }
  const stats = {};

  for (const entry of entries) {
    for (const vid of entry.variantIds) {
      if (!stats[vid]) stats[vid] = { uses: 0, progressed: 0 };
      stats[vid].uses++;
      if (PROGRESSED_STATUSES.has(entry.status)) {
        stats[vid].progressed++;
      }
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Render table
// ---------------------------------------------------------------------------

function renderTable(stats) {
  const rows = Object.entries(stats).sort(([, a], [, b]) => {
    const rateA = a.uses ? a.progressed / a.uses : 0;
    const rateB = b.uses ? b.progressed / b.uses : 0;
    return rateB - rateA; // descending by response rate
  });

  if (!rows.length) {
    return 'No variant tags found in applications.md.\n' +
           'Add [variant:{id}] to the Notes column to track conversions.\n';
  }

  // Column widths
  const COL_ID    = Math.max(10, ...rows.map(([id]) => id.length));
  const COL_USES  = 6;
  const COL_PROG  = 10;
  const COL_RATE  = 12;

  const hr = (c) => '-'.repeat(c);
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);

  const header =
    `| ${pad('Variant ID', COL_ID)} | ${pad('Uses', COL_USES)} | ${pad('Progressed', COL_PROG)} | ${pad('Response %', COL_RATE)} |`;
  const sep =
    `|-${hr(COL_ID)}-|-${hr(COL_USES)}-|-${hr(COL_PROG)}-|-${hr(COL_RATE)}-|`;

  const lines = [header, sep];

  for (const [id, { uses, progressed }] of rows) {
    const rate = uses > 0 ? ((progressed / uses) * 100).toFixed(1) + '%' : 'n/a';
    lines.push(
      `| ${pad(id, COL_ID)} | ${padL(uses, COL_USES)} | ${padL(progressed, COL_PROG)} | ${padL(rate, COL_RATE)} |`
    );
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(APPLICATIONS_PATH)) {
  process.stderr.write(`Error: applications.md not found at ${APPLICATIONS_PATH}\n`);
  process.exit(1);
}

const raw     = readFileSync(APPLICATIONS_PATH, 'utf-8');
const entries = parseApplications(raw);
const stats   = computeStats(entries);

const totalEntries  = entries.length;
const taggedEntries = entries.filter(e => e.variantIds.length > 0).length;
const totalVariants = Object.keys(stats).length;

process.stdout.write(`Outreach Stats\n`);
process.stdout.write(`==============\n`);
process.stdout.write(`Applications parsed : ${totalEntries}\n`);
process.stdout.write(`With variant tags   : ${taggedEntries}\n`);
process.stdout.write(`Unique variants     : ${totalVariants}\n`);
process.stdout.write(`Progressed statuses : ${[...PROGRESSED_STATUSES].join(', ')}\n`);
process.stdout.write('\n');
process.stdout.write(renderTable(stats));

if (taggedEntries === 0) {
  process.stdout.write('\nTip: Add [variant:recruiter-a] (or any variant_id) to the Notes column\n');
  process.stdout.write('     in data/applications.md to start tracking conversion data.\n');
}
