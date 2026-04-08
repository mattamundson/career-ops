#!/usr/bin/env node
/**
 * scan-report.mjs — Post-scan summary report for career-ops
 * Usage: node scripts/scan-report.mjs [--since=Nd]
 *
 * Reads:
 *   data/pipeline.md       — pending/processed job entries
 *   data/scan-history.tsv  — url, first_seen, portal, title, company, status
 *
 * Prints:
 *   - N new matches added (status=added)
 *   - Top matches by title keyword score
 *   - Companies with no new roles this run
 *   - Companies with errors (status=error or fetch failures)
 *
 * No external dependencies — ESM only, native Node.js.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT         = resolve(__dir, '..');
const HISTORY_TSV  = resolve(ROOT, 'data', 'scan-history.tsv');
const PIPELINE_MD  = resolve(ROOT, 'data', 'pipeline.md');
const PORTALS_YML  = resolve(ROOT, 'portals.yml');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);

function getSinceDays() {
  const flag = argv.find(a => a.startsWith('--since='));
  if (!flag) return null; // null = all-time (no filter)
  const val = flag.split('=')[1];
  const n = parseInt(val, 10);
  if (isNaN(n)) { console.error(`Invalid --since value: ${val}`); process.exit(1); }
  return n;
}
const SINCE_DAYS = getSinceDays();

// ---------------------------------------------------------------------------
// Title keyword scoring
// Keywords drawn from portals.yml title_filter + seniority_boost.
// Score = sum of matched keyword weights.
// ---------------------------------------------------------------------------
const KEYWORD_WEIGHTS = {
  // Seniority (boosts) — highest weight
  'director':    5,
  'head of':     5,
  'principal':   4,
  'staff':       4,
  'lead':        3,
  'senior':      3,
  'manager':     3,
  // Role keywords
  'data architect':       4,
  'solutions architect':  4,
  'data platform':        3,
  'analytics engineer':   3,
  'data engineer':        3,
  'ai engineer':          3,
  'ml engineer':          3,
  'applied ai':           3,
  'analytics lead':       3,
  'data lead':            3,
  'analytics manager':    3,
  'data manager':         3,
  'bi engineer':          2,
  'business intelligence':2,
  'power bi':             2,
  'ai automation':        2,
  'automation engineer':  2,
  'workflow automation':  2,
  'data architect':       2,
  'business systems':     2,
  'operations analytics': 2,
  'erp analyst':          2,
};

function scoreTitle(title) {
  const lower = title.toLowerCase();
  let score = 0;
  const matched = [];
  for (const [kw, weight] of Object.entries(KEYWORD_WEIGHTS)) {
    if (lower.includes(kw)) {
      score += weight;
      matched.push(kw);
    }
  }
  return { score, matched };
}

// ---------------------------------------------------------------------------
// Read portals.yml — minimal line-scan for company names
// (no full YAML parse needed; we just want the list of tracked company names)
// ---------------------------------------------------------------------------
function loadTrackedCompanyNames() {
  if (!existsSync(PORTALS_YML)) return [];
  const text = readFileSync(PORTALS_YML, 'utf8');
  const companies = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s+-?\s*name:\s*["']?([^"'\n]+)["']?/);
    if (m) companies.push(m[1].trim());
  }
  return companies;
}

// ---------------------------------------------------------------------------
// Parse scan-history.tsv
// Columns: url  first_seen  portal  title  company  status
// ---------------------------------------------------------------------------
function loadHistory() {
  if (!existsSync(HISTORY_TSV)) return [];

  const text = readFileSync(HISTORY_TSV, 'utf8');
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split('\t').map(h => h.trim());
  const idx = {
    url:        header.indexOf('url'),
    first_seen: header.indexOf('first_seen'),
    portal:     header.indexOf('portal'),
    title:      header.indexOf('title'),
    company:    header.indexOf('company'),
    status:     header.indexOf('status'),
  };

  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    rows.push({
      url:        cols[idx.url]        || '',
      first_seen: cols[idx.first_seen] || '',
      portal:     cols[idx.portal]     || '',
      title:      cols[idx.title]      || '',
      company:    cols[idx.company]    || '',
      status:     (cols[idx.status]    || '').trim(),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Parse pipeline.md — extract entries from ## Pending section
// Format: - [ ] <url> | <company> | <title>
// ---------------------------------------------------------------------------
function loadPipelinePending() {
  if (!existsSync(PIPELINE_MD)) return [];
  const text  = readFileSync(PIPELINE_MD, 'utf8');
  const entries = [];

  let inPending = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('## Pending')) { inPending = true; continue; }
    if (line.startsWith('## '))        { inPending = false; continue; }
    if (!inPending) continue;

    // "- [ ] https://... | Company | Title"
    const m = line.match(/^-\s+\[[ x]\]\s+(https?:\/\/\S+)\s*\|\s*([^|]+)\|\s*(.+)/i);
    if (m) {
      entries.push({
        url:     m[1].trim(),
        company: m[2].trim(),
        title:   m[3].trim(),
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Filter rows by --since window (based on first_seen date)
// ---------------------------------------------------------------------------
function filterByWindow(rows, sinceDays) {
  if (!sinceDays) return rows;
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return rows.filter(r => {
    if (!r.first_seen) return true;
    const d = new Date(r.first_seen);
    return isNaN(d) || d >= cutoff;
  });
}

// ---------------------------------------------------------------------------
// Render horizontal bar (text)
// ---------------------------------------------------------------------------
function miniBar(score, maxScore, width = 12) {
  if (maxScore === 0) return '░'.repeat(width);
  const filled = Math.round((score / maxScore) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Main report
// ---------------------------------------------------------------------------
function main() {
  const today = new Date().toISOString().slice(0, 10);

  console.log('');
  console.log(`Scan Report — ${today}`);
  console.log('━'.repeat(50));
  if (SINCE_DAYS) {
    console.log(`  Window: last ${SINCE_DAYS} day(s)`);
  } else {
    console.log('  Window: all-time');
  }
  console.log('');

  // Load data
  const allRows       = loadHistory();
  const trackedNames  = loadTrackedCompanyNames();
  const pendingItems  = loadPipelinePending();

  if (allRows.length === 0 && pendingItems.length === 0) {
    console.log('  No scan data found. Run auto-scan.mjs first.');
    console.log('');
    return;
  }

  // Apply window filter
  const rows = filterByWindow(allRows, SINCE_DAYS);

  // Partition by status
  const addedRows   = rows.filter(r => r.status === 'added');
  const errorRows   = rows.filter(r => r.status === 'error');
  const skippedRows = rows.filter(r => r.status.startsWith('skipped'));
  const dupRows     = rows.filter(r => r.status === 'skipped_dup');

  // ── Section 1: Summary counts ───────────────────────────────────────────
  console.log('SUMMARY');
  console.log('─'.repeat(50));
  console.log(`  New matches added to pipeline : ${addedRows.length}`);
  console.log(`  Duplicates deduped            : ${dupRows.length}`);
  console.log(`  Title-filtered (skipped)      : ${skippedRows.length - dupRows.length}`);
  console.log(`  Errors                        : ${errorRows.length}`);
  console.log(`  Total rows in window          : ${rows.length}`);
  console.log('');

  // ── Section 2: Top matches by keyword score ─────────────────────────────
  console.log('TOP MATCHES (by title keyword score)');
  console.log('─'.repeat(50));

  // Score all added rows + pending pipeline items together (avoid double-counting)
  const addedUrls = new Set(addedRows.map(r => r.url));

  // Combine: history added rows + pipeline pending entries (those not in history = manually added)
  const candidates = [
    ...addedRows.map(r => ({ url: r.url, company: r.company, title: r.title, source: 'scan' })),
    ...pendingItems
      .filter(p => !addedUrls.has(p.url))
      .map(p => ({ url: p.url, company: p.company, title: p.title, source: 'pipeline' })),
  ];

  if (candidates.length === 0) {
    console.log('  No new matches to display.');
    console.log('');
  } else {
    const scored = candidates.map(c => {
      const { score, matched } = scoreTitle(c.title);
      return { ...c, score, matched };
    }).sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));

    const maxScore = scored[0]?.score || 1;
    const topN     = scored.slice(0, 15); // cap at 15

    for (const item of topN) {
      const bar    = miniBar(item.score, maxScore);
      const boost  = item.matched.some(m => ['senior','lead','principal','staff','director','head of','manager'].includes(m))
        ? ' [BOOST]' : '';
      console.log(`  ${bar} ${item.score.toString().padStart(2)} | ${item.company} — ${item.title}${boost}`);
      if (item.matched.length > 0) {
        console.log(`              keywords: ${item.matched.join(', ')}`);
      }
      console.log(`              ${item.url}`);
    }

    if (scored.length > 15) {
      console.log(`  … and ${scored.length - 15} more (use pipeline to review all)`);
    }
    console.log('');
  }

  // ── Section 3: Companies with no new roles ──────────────────────────────
  console.log('COMPANIES — NO NEW ROLES');
  console.log('─'.repeat(50));

  const companiesWithNew = new Set(addedRows.map(r => r.company.toLowerCase()));
  const companiesScanned = new Set(rows.map(r => r.company.toLowerCase()));

  // Companies that were scanned (appear in history window) but had no "added" rows
  const noNew = trackedNames.filter(name => {
    const lower = name.toLowerCase();
    return companiesScanned.has(lower) && !companiesWithNew.has(lower);
  });

  // Also include tracked companies that didn't appear in history at all (not yet scanned / API missing)
  const notScanned = trackedNames.filter(name => {
    const lower = name.toLowerCase();
    return !companiesScanned.has(lower);
  });

  if (noNew.length === 0 && notScanned.length === 0) {
    console.log('  All scanned companies had at least one new match.');
  } else {
    if (noNew.length > 0) {
      console.log('  Scanned — no new roles:');
      for (const n of noNew) console.log(`    • ${n}`);
    }
    if (notScanned.length > 0) {
      console.log('  Not yet scanned (no API / not in history):');
      for (const n of notScanned) console.log(`    • ${n}`);
    }
  }
  console.log('');

  // ── Section 4: Companies with errors ───────────────────────────────────
  console.log('COMPANIES — ERRORS');
  console.log('─'.repeat(50));

  if (errorRows.length === 0) {
    console.log('  No errors recorded in this window.');
  } else {
    const errorsByCompany = {};
    for (const r of errorRows) {
      if (!errorsByCompany[r.company]) errorsByCompany[r.company] = [];
      errorsByCompany[r.company].push(r);
    }
    for (const [company, errs] of Object.entries(errorsByCompany)) {
      console.log(`  ${company}: ${errs.length} error(s)`);
      for (const e of errs) {
        const note = e.title || e.url;
        console.log(`    ↳ ${note}`);
      }
    }
  }
  console.log('');

  // ── Footer ──────────────────────────────────────────────────────────────
  if (addedRows.length > 0) {
    console.log(`→ ${addedRows.length} new role(s) waiting in pipeline.md — run /career-ops pipeline to evaluate.`);
  } else {
    console.log('→ No new roles added. Nothing to evaluate.');
  }
  console.log('');
}

main();
