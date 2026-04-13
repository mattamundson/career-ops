#!/usr/bin/env node
/**
 * tune-filters.mjs — Suggest title_filter improvements from scan history
 *
 * Reads scan-history.tsv and portals.yml to:
 *   1. Show keyword effectiveness (which positive keywords are actually matching)
 *   2. Surface common title phrases in skipped_title rows (potential false negatives)
 *   3. Show which positive keywords have never matched anything (dead weight)
 *
 * Usage:
 *   node scripts/tune-filters.mjs              → full report (last 30 days)
 *   node scripts/tune-filters.mjs --days=60    → extend look-back window
 *   node scripts/tune-filters.mjs --min-hits=2 → min phrase frequency to surface
 *   node scripts/tune-filters.mjs --json       → JSON output
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { portalDisplayLabel } from './lib/source-labels.mjs';

const __dir   = dirname(fileURLToPath(import.meta.url));
const ROOT    = resolve(__dir, '..');
const HISTORY = join(ROOT, 'data', 'scan-history.tsv');
const PORTALS = join(ROOT, 'portals.yml');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args      = process.argv.slice(2);
let DAYS        = 30;
let MIN_HITS    = 3;
const JSON_MODE = args.includes('--json');

for (const arg of args) {
  let m;
  if ((m = arg.match(/^--days=(\d+)$/)))     DAYS     = parseInt(m[1], 10);
  if ((m = arg.match(/^--min-hits=(\d+)$/))) MIN_HITS = parseInt(m[1], 10);
}

// ---------------------------------------------------------------------------
// Minimal YAML parser — extract title_filter section only
// ---------------------------------------------------------------------------
function loadTitleFilter() {
  if (!existsSync(PORTALS)) return { positive: [], negative: [], seniority_boost: [] };
  const text = readFileSync(PORTALS, 'utf8');
  const lines = text.split('\n');

  let inFilter = false;
  let currentKey = null;
  const filter = { positive: [], negative: [], seniority_boost: [] };

  for (const line of lines) {
    if (line.match(/^title_filter:/)) { inFilter = true; continue; }
    if (inFilter && line.match(/^[a-z_]/) && !line.match(/^  /)) { inFilter = false; break; }
    if (!inFilter) continue;

    const keyMatch = line.match(/^  (\w+):/);
    if (keyMatch) { currentKey = keyMatch[1]; continue; }

    const itemMatch = line.match(/^    - "(.+)"/);
    if (itemMatch && currentKey && filter[currentKey]) {
      filter[currentKey].push(itemMatch[1].toLowerCase());
    }
  }
  return filter;
}

// ---------------------------------------------------------------------------
// Parse scan-history.tsv
// ---------------------------------------------------------------------------
function loadHistory(days) {
  if (!existsSync(HISTORY)) {
    return { added: [], skipped: [], rows: [] };
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const lines  = readFileSync(HISTORY, 'utf8').split('\n');
  if (lines.length < 2) return { added: [], skipped: [], rows: [] };

  const header = lines[0].split('\t').map(h => h.trim());
  const idx = {
    first_seen: header.indexOf('first_seen'),
    title:      header.indexOf('title'),
    status:     header.indexOf('status'),
    portal:     header.indexOf('portal'),
  };

  const added   = [];
  const skipped = [];
  const rows = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const date = cols[idx.first_seen]?.trim() || '';
    if (date < cutoff) continue; // outside window

    const title  = (cols[idx.title]  || '').trim().toLowerCase();
    const status = (cols[idx.status] || '').trim();
    const portal = (cols[idx.portal] || '').trim() || 'unknown';

    rows.push({ portal, status, title });

    if (status === 'added')         added.push(title);
    if (status === 'skipped_title') skipped.push(title);
  }

  return { added, skipped, rows };
}

// ---------------------------------------------------------------------------
// Extract bigrams and trigrams from a title string
// ---------------------------------------------------------------------------
function extractPhrases(title) {
  // Remove common noise words that don't make meaningful phrases
  const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'at', 'to', 'for', 'and', 'or',
                        'with', 'on', 'by', 'is', 'are', 'be', 'as', 'from', 'us', 'ii']);

  const words = title
    .replace(/[^a-z0-9\s&/]/g, ' ')   // keep & and / for "bi/analytics"
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP.has(w));

  const phrases = [];
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length) phrases.push(`${words[i]} ${words[i+1]}`);
    if (i + 2 < words.length) phrases.push(`${words[i]} ${words[i+1]} ${words[i+2]}`);
  }
  return phrases;
}

// ---------------------------------------------------------------------------
// Count keyword matches across titles
// ---------------------------------------------------------------------------
function countKeywordMatches(titles, keywords) {
  const counts = {};
  for (const kw of keywords) counts[kw] = 0;
  for (const title of titles) {
    for (const kw of keywords) {
      if (title.includes(kw)) counts[kw]++;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Count phrase frequency across titles
// ---------------------------------------------------------------------------
function countPhrases(titles) {
  const freq = {};
  for (const title of titles) {
    const seen = new Set(); // dedup per title
    for (const phrase of extractPhrases(title)) {
      if (!seen.has(phrase)) {
        freq[phrase] = (freq[phrase] || 0) + 1;
        seen.add(phrase);
      }
    }
  }
  return freq;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const filter  = loadTitleFilter();
const history = loadHistory(DAYS);

const { added, skipped, rows } = history;

/** Added vs title-skipped counts by portal (for dashboard / operator truth). */
function buildSourceRollup(historyRows) {
  const by = new Map();
  for (const r of historyRows) {
    const p = r.portal || 'unknown';
    if (!by.has(p)) {
      by.set(p, {
        portal: p,
        label: portalDisplayLabel(p),
        added: 0,
        skippedTitle: 0,
        other: 0,
      });
    }
    const e = by.get(p);
    if (r.status === 'added') e.added++;
    else if (r.status === 'skipped_title') e.skippedTitle++;
    else e.other++;
  }
  return [...by.values()]
    .map((e) => ({
      ...e,
      total: e.added + e.skippedTitle + e.other,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 24);
}

// 1. Keyword effectiveness: how many added titles matched each positive keyword
const addedMatches   = countKeywordMatches(added,   filter.positive);
const skippedMatches = countKeywordMatches(skipped, filter.positive);

// 2. Phrase discovery in skipped titles
const skippedPhrases = countPhrases(skipped);

// Find phrases not already covered by any positive keyword
const novelPhrases = Object.entries(skippedPhrases)
  .filter(([phrase, count]) => {
    if (count < MIN_HITS) return false;
    // Skip if any positive keyword is a substring (or vice versa)
    return !filter.positive.some(kw => phrase.includes(kw) || kw.includes(phrase));
  })
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

// 3. Dead keywords: positive keywords that matched 0 added titles in the window
const deadKeywords = filter.positive.filter(kw => addedMatches[kw] === 0);

// 4. Top performing keywords
const topKeywords = Object.entries(addedMatches)
  .sort((a, b) => b[1] - a[1])
  .filter(([, c]) => c > 0);

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({
    window:        DAYS,
    added:         added.length,
    skipped:       skipped.length,
    topKeywords:   topKeywords.slice(0, 10).map(([kw, c]) => ({ kw, count: c })),
    deadKeywords,
    novelPhrases:  novelPhrases.map(([phrase, count]) => ({ phrase, count })),
    sourceRollup:  buildSourceRollup(rows || []),
  }, null, 2) + '\n');
  process.exit(0);
}

// ── Human-readable report ──────────────────────────────────────────────────

const hr = (c = '─', n = 60) => c.repeat(n);

console.log('');
console.log(hr('═'));
console.log(`  TITLE FILTER TUNING REPORT — last ${DAYS} days`);
console.log(hr('═'));
console.log(`  Added to pipeline : ${added.length}`);
console.log(`  Skipped by title  : ${skipped.length}`);
console.log(`  Noise ratio       : ${added.length + skipped.length > 0 ? ((skipped.length / (added.length + skipped.length)) * 100).toFixed(1) : 'N/A'}% skipped`);
console.log('');

// Source mix (same window as keywords)
const rollup = buildSourceRollup(rows || []);
if (rollup.length > 0) {
  console.log(hr('─'));
  console.log('  SOURCE MIX (added vs skipped_title by portal)');
  console.log(hr('─'));
  for (const s of rollup.slice(0, 20)) {
    console.log(
      `  ${String(s.added).padStart(4)} add / ${String(s.skippedTitle).padStart(4)} skip  —  ${s.label}  [${s.portal}]`,
    );
  }
  if (rollup.length > 20) console.log(`  … ${rollup.length - 20} more portals`);
  console.log('');
}

// Top performing keywords
console.log(hr('─'));
console.log('  KEYWORD EFFECTIVENESS (top matches in window)');
console.log(hr('─'));
if (topKeywords.length === 0) {
  console.log('  No keyword matches in this window.');
} else {
  for (const [kw, count] of topKeywords) {
    const bar = '█'.repeat(Math.min(30, Math.round((count / topKeywords[0][1]) * 30)));
    console.log(`  ${String(count).padStart(4)}  ${kw.padEnd(35)} ${bar}`);
  }
}
console.log('');

// Dead keywords
if (deadKeywords.length > 0) {
  console.log(hr('─'));
  console.log('  ZERO-MATCH KEYWORDS (no hits in window — consider removing or reviewing)');
  console.log(hr('─'));
  for (const kw of deadKeywords) {
    const inSkipped = skippedMatches[kw] || 0;
    console.log(`  "${kw}"  →  appeared ${inSkipped}x in skipped (title matched but wrong for another reason)`);
  }
  console.log('');
}

// Novel phrases (discovery)
if (novelPhrases.length > 0) {
  console.log(hr('─'));
  console.log(`  DISCOVERY — common phrases in SKIPPED titles not covered by current filter (min ${MIN_HITS} hits)`);
  console.log('  Consider adding high-frequency phrases to title_filter.positive');
  console.log(hr('─'));
  for (const [phrase, count] of novelPhrases) {
    console.log(`  ${String(count).padStart(4)}  "${phrase}"`);
  }
  console.log('');
  console.log('  To add to portals.yml:');
  console.log('    title_filter:');
  console.log('      positive:');
  for (const [phrase] of novelPhrases.slice(0, 5)) {
    console.log(`        - "${phrase}"`);
  }
}

console.log('');
console.log(hr('═'));
console.log(`  Run with --days=N or --min-hits=N to adjust sensitivity.`);
console.log(hr('═'));
console.log('');
