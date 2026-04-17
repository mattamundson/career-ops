#!/usr/bin/env node
/**
 * scan-report.mjs — Post-scan summary report for career-ops
 * Usage: node scripts/scan-report.mjs [--since=Nd]
 *
 * Date window: `--since=N` (1–90) if passed; else `CAREER_OPS_SCAN_REPORT_SINCE_DAYS` from `.env` when set;
 * else **all-time** (no `first_seen` filter). Loads `.env` via `load-env.mjs` before reading env.
 *
 * Reads:
 *   data/pipeline.md       — pending/processed job entries
 *   data/scan-history.tsv  — url, first_seen, portal, title, company, status
 *
 * Prints:
 *   - N new matches added (status=added)
 *   - Top matches by title keyword score
 *   - Tracked ATS companies with no new roles (portals.yml targets only — boards are not “companies”)
 *   - Source status rollups (portal → label, policy, counts)
 *   - Source-level vs tracked-company errors
 *
 * No external dependencies — ESM only, native Node.js.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { classifyWorkArrangement, scoreTitleAgainstFilter } from './lib/scoring-core.mjs';
import {
  operationalStatusLabel,
  portalDisplayLabel,
  rollupSourcesByPortal,
} from './lib/source-labels.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { loadProjectEnv } from './load-env.mjs';
import { resolveScanReportSinceDays } from './lib/scan-window.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT         = resolve(__dir, '..');
const HISTORY_TSV  = resolve(ROOT, 'data', 'scan-history.tsv');
const PIPELINE_MD  = resolve(ROOT, 'data', 'pipeline.md');
const PORTALS_YML  = resolve(ROOT, 'portals.yml');

loadProjectEnv(ROOT);

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);

let scanReportWindow;
try {
  scanReportWindow = resolveScanReportSinceDays({ argv });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const SINCE_DAYS = scanReportWindow.days;

// ---------------------------------------------------------------------------
// Title keyword scoring
// Keywords drawn from portals.yml title_filter + seniority_boost.
// Score = sum of matched keyword weights.
// ---------------------------------------------------------------------------
function loadTitleFilterConfig() {
  if (!existsSync(PORTALS_YML)) {
    return { positive: [], negative: [], seniority_boost: {} };
  }

  const text = readFileSync(PORTALS_YML, 'utf8');
  const positive = [];
  const negative = [];
  const seniority_boost = {};
  let section = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('title_filter:')) continue;
    if (line.startsWith('tracked_companies:')) break;
    if (line.match(/^\s{2}positive:/)) {
      section = 'positive';
      continue;
    }
    if (line.match(/^\s{2}negative:/)) {
      section = 'negative';
      continue;
    }
    if (line.match(/^\s{2}seniority_boost:/)) {
      section = 'seniority_boost';
      continue;
    }

    const listItem = line.match(/^\s{4}-\s+"?([^"\n]+)"?\s*$/);
    if (listItem && (section === 'positive' || section === 'negative')) {
      if (section === 'positive') positive.push(listItem[1].trim());
      else negative.push(listItem[1].trim());
      continue;
    }

    const boostItem = line.match(/^\s{4}"?([^":\n]+)"?:\s*([\d.]+)/);
    if (boostItem && section === 'seniority_boost') {
      seniority_boost[boostItem[1].trim()] = Number.parseFloat(boostItem[2]);
    }
  }

  return { positive, negative, seniority_boost };
}

// ---------------------------------------------------------------------------
// Read portals.yml — minimal line-scan for actual company sections only.
// Excludes query/source sections such as job_board_queries, builtin_queries,
// and direct_job_board_queries so reports do not display boards as companies.
// ---------------------------------------------------------------------------
function loadTrackedCompanyNames() {
  if (!existsSync(PORTALS_YML)) return [];
  const text = readFileSync(PORTALS_YML, 'utf8');
  const companySections = new Set([
    'tracked_companies',
    'ashby_companies',
    'lever_companies',
    'smartrecruiters_companies',
    'workday_companies',
    'icims_companies',
    'workable_companies',
  ]);
  const companies = new Set();
  let section = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;

    const sectionMatch = line.match(/^([a-zA-Z0-9_]+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    if (!companySections.has(section)) continue;

    const m = line.match(/^\s*-\s*name:\s*["']?([^"'\n]+)["']?/);
    if (m) {
      companies.add(m[1].trim());
    }
  }
  return [...companies];
}

// ---------------------------------------------------------------------------
// Parse scan-history.tsv
// Columns: url  first_seen  portal  title  company  status  [location]
// location is optional (7th col) — older rows may lack it; reader tolerates.
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
    location:   header.indexOf('location'),
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
      location:   idx.location >= 0 ? (cols[idx.location] || '').trim() : '',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Bucket rows by work arrangement using location + title as signal.
// Returns counts for: onsite_msp, hybrid_msp, remote, unknown.
// ---------------------------------------------------------------------------
function bucketByWorkArrangement(rows) {
  const counts = { onsite_msp: 0, hybrid_msp: 0, remote: 0, unknown: 0 };
  for (const r of rows) {
    const arrangement = classifyWorkArrangement({
      remote: r.location,
      role: r.title,
      notes: r.company,
    });
    counts[arrangement] = (counts[arrangement] || 0) + 1;
  }
  return counts;
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

    // "- [ ] https://... | Company | Title [| Location]"
    const m = line.match(/^-\s+\[[ x]\]\s+(https?:\/\/\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*(?:\|\s*(.+?)\s*)?$/i);
    if (m) {
      entries.push({
        url:      m[1].trim(),
        company:  m[2].trim(),
        title:    m[3].trim(),
        location: (m[4] || '').trim(),
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
  const titleFilter = loadTitleFilterConfig();

  console.log('');
  console.log(`Scan Report — ${today}`);
  console.log('━'.repeat(50));
  if (SINCE_DAYS != null) {
    console.log(`  Window: last ${SINCE_DAYS} day(s) (${scanReportWindow.source})`);
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
    appendAutomationEvent(ROOT, {
      type: 'scan.report.empty',
      status: 'skipped',
      summary: 'No scan-history rows and no pending pipeline items.',
      details: { since_days: SINCE_DAYS, since_source: scanReportWindow.source },
    });
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

  // ── Section 1a: Location buckets for new adds ──────────────────────────
  // Answers: "of what we actually added this window, how much is MSP vs remote?"
  // Classifier reads location column (7th col, added 2026-04-17). Pre-SSOT
  // rows lack location and will bucket as unknown — window-scoped reports
  // should surface mostly-populated buckets for recent scans.
  if (addedRows.length > 0) {
    const buckets = bucketByWorkArrangement(addedRows);
    console.log('LOCATION BUCKETS (new adds only)');
    console.log('─'.repeat(50));
    console.log(`  On-site MSP  : ${buckets.onsite_msp}`);
    console.log(`  Hybrid MSP   : ${buckets.hybrid_msp}`);
    console.log(`  Remote       : ${buckets.remote}`);
    console.log(`  Unknown      : ${buckets.unknown}`);
    const mspTotal = buckets.onsite_msp + buckets.hybrid_msp;
    const mspPct = addedRows.length > 0 ? Math.round((mspTotal / addedRows.length) * 100) : 0;
    console.log(`  MSP share    : ${mspTotal}/${addedRows.length} (${mspPct}%)`);
    console.log('');
  }

  // ── Section 1b: Source status (portals — not employers) ────────────────
  console.log('SOURCE STATUS (by portal)');
  console.log('─'.repeat(50));
  const roll = rollupSourcesByPortal(rows);
  for (const s of roll.slice(0, 40)) {
    const op = operationalStatusLabel(s.opStatus);
    console.log(
      `  ${s.displayLabel.padEnd(34)} | ${op.padEnd(22)} | rows ${String(s.total).padStart(5)} | added ${String(s.added).padStart(4)} | last ${s.lastSeen || '—'}`,
    );
  }
  if (roll.length > 40) console.log(`  … ${roll.length - 40} more portal(s)`);
  console.log('');

  const trackedSet = new Set(
    trackedNames.map((n) => n.toLowerCase().trim()).filter(Boolean),
  );

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
      const scoredTitle = scoreTitleAgainstFilter(c.title, titleFilter);
      return {
        ...c,
        score: scoredTitle.fitTitle,
        confidence: scoredTitle.confidence,
        matched: scoredTitle.matchedPhrases,
      };
    }).sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));

    const maxScore = scored[0]?.score || 1;
    const topN     = scored.slice(0, 15); // cap at 15

    for (const item of topN) {
      const bar    = miniBar(item.score, maxScore);
      const boost  = item.matched.some(m => ['senior','lead','principal','staff','director','head of','manager'].includes(String(m).toLowerCase()))
        ? ' [BOOST]' : '';
      console.log(`  ${bar} ${item.score.toString().padStart(2)} | ${item.company} — ${item.title}${boost}`);
      if (item.matched.length > 0) {
        console.log(`              keywords: ${item.matched.join(', ')}`);
      }
      console.log(`              confidence: ${Math.round(item.confidence * 100)}%`);
      console.log(`              ${item.url}`);
    }

    if (scored.length > 15) {
      console.log(`  … and ${scored.length - 15} more (use pipeline to review all)`);
    }
    console.log('');
  }

  // ── Section 3: Tracked ATS targets — no new roles ─────────────────────────
  console.log('TRACKED COMPANIES (portals.yml) — NO NEW ROLES');
  console.log('─'.repeat(50));
  console.log('  (Uses employer `company` only when it matches a tracked company name.)');
  console.log('');

  const companiesWithNew = new Set(
    addedRows
      .map((r) => (r.company || '').trim().toLowerCase())
      .filter((c) => trackedSet.has(c)),
  );
  const companiesScanned = new Set(
    rows
      .map((r) => (r.company || '').trim().toLowerCase())
      .filter((c) => trackedSet.has(c)),
  );

  const noNew = trackedNames.filter((name) => {
    const lower = name.toLowerCase();
    return companiesScanned.has(lower) && !companiesWithNew.has(lower);
  });

  const notScanned = trackedNames.filter((name) => {
    const lower = name.toLowerCase();
    return !companiesScanned.has(lower);
  });

  if (noNew.length === 0 && notScanned.length === 0) {
    console.log('  All tracked companies that appeared in history had at least one new add, or none matched.');
  } else {
    if (noNew.length > 0) {
      console.log('  Scanned — no new adds this window:');
      for (const n of noNew) console.log(`    • ${n}`);
    }
    if (notScanned.length > 0) {
      console.log('  No history rows for this company name in window (not scanned / no hits / name drift):');
      for (const n of notScanned) console.log(`    • ${n}`);
    }
  }
  console.log('');

  // ── Section 4: Errors — sources vs tracked companies ─────────────────────
  console.log('SOURCES — ERRORS (rows not tied to a tracked company name)');
  console.log('─'.repeat(50));

  const errTracked = errorRows.filter((r) =>
    trackedSet.has((r.company || '').trim().toLowerCase()),
  );
  const errSource = errorRows.filter(
    (r) => !trackedSet.has((r.company || '').trim().toLowerCase()),
  );

  if (errSource.length === 0) {
    console.log('  None.');
  } else {
    const byPortal = {};
    for (const r of errSource) {
      const p = r.portal || 'unknown';
      if (!byPortal[p]) byPortal[p] = [];
      byPortal[p].push(r);
    }
    for (const [portal, errs] of Object.entries(byPortal).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      console.log(`  ${portalDisplayLabel(portal)} — ${errs.length} error(s) [${portal}]`);
      for (const e of errs.slice(0, 6)) {
        const note = e.title || e.url;
        console.log(`    ↳ ${(e.company || '—').trim()} — ${note}`);
      }
      if (errs.length > 6) console.log(`    … ${errs.length - 6} more`);
    }
  }
  console.log('');

  console.log('TRACKED COMPANIES — ERRORS');
  console.log('─'.repeat(50));

  if (errTracked.length === 0) {
    console.log('  None.');
  } else {
    const byCo = {};
    for (const r of errTracked) {
      const c = r.company || '—';
      if (!byCo[c]) byCo[c] = [];
      byCo[c].push(r);
    }
    for (const [company, errs] of Object.entries(byCo).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
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

  const addedBuckets = bucketByWorkArrangement(addedRows);
  appendAutomationEvent(ROOT, {
    type: 'scan.report.completed',
    status: 'success',
    summary: `Scan report: ${addedRows.length} added, ${errorRows.length} errors, ${dupRows.length} dupes (window rows ${rows.length}).`,
    details: {
      since_days: SINCE_DAYS,
      since_source: scanReportWindow.source,
      added: addedRows.length,
      errors: errorRows.length,
      duplicates: dupRows.length,
      skipped_title: skippedRows.length - dupRows.length,
      rows_in_window: rows.length,
      added_onsite_msp: addedBuckets.onsite_msp,
      added_hybrid_msp: addedBuckets.hybrid_msp,
      added_remote:     addedBuckets.remote,
      added_unknown:    addedBuckets.unknown,
    },
  });
}

main();
