#!/usr/bin/env node
/**
 * velocity-report.mjs
 * Application velocity dashboard for career-ops tracker.
 * Usage:
 *   node scripts/velocity-report.mjs          → writes reports/velocity-YYYY-MM-DD.md
 *   node scripts/velocity-report.mjs --json   → JSON to stdout
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const APPLICATIONS_MD = join(ROOT, 'data', 'applications.md');
const TODAY = '2026-04-07';

const JSON_MODE = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// Parse applications.md
// ---------------------------------------------------------------------------

function parseApplications(md) {
  const lines = md.split('\n');
  const entries = [];

  for (const line of lines) {
    // Match table data rows (skip header and separator)
    if (!line.startsWith('|') || line.startsWith('| #') || line.startsWith('|---')) continue;

    const cols = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cols.length < 9) continue;

    const [num, date, company, role, scoreRaw, status, pdf, reportRaw, notes] = cols;

    // Parse score: "3.8/5" → 3.8
    const scoreMatch = scoreRaw.match(/([\d.]+)\s*\/\s*[\d.]+/);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

    // Parse report link: "[001](reports/001-panopto-2026-04-06.md)" → "reports/001-panopto-2026-04-06.md"
    const reportMatch = reportRaw.match(/\[.*?\]\((.*?)\)/);
    const reportPath = reportMatch ? reportMatch[1] : null;

    // Parse entry number (strip leading zeros for sorting, keep original)
    const numClean = num.replace(/^0+/, '') || num;

    entries.push({
      num: numClean,
      date: date || null,
      company: company || '',
      role: role || '',
      score,
      status: status || 'Unknown',
      hasPdf: pdf === '✅',
      reportPath,
      notes: notes || '',
      archetype: null, // filled in below
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Extract archetype from report file
// ---------------------------------------------------------------------------

function extractArchetype(reportRelPath) {
  const absPath = join(ROOT, reportRelPath);
  if (!existsSync(absPath)) return null;
  try {
    const content = readFileSync(absPath, 'utf8');
    // Match: **Archetype:** Some Text (on its own line)
    const m = content.match(/\*\*Archetype:\*\*\s*(.+)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function weekStart(dateStr) {
  // Monday-based ISO week start
  const d = parseDate(dateStr);
  if (!d) return null;
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

function isoMonth(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7); // "YYYY-MM"
}

const todayDate = parseDate(TODAY);
const thisWeekStart = weekStart(TODAY);
const thisMonth = isoMonth(TODAY);

// ---------------------------------------------------------------------------
// Compute metrics
// ---------------------------------------------------------------------------

function computeMetrics(entries) {
  const n = entries.length;

  // --- Status counts ---
  const statusCounts = {};
  for (const e of entries) {
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
  }

  // --- This week / this month ---
  const thisWeekEntries = entries.filter(e => weekStart(e.date) === thisWeekStart);
  const thisMonthEntries = entries.filter(e => isoMonth(e.date) === thisMonth);

  // --- Avg score by archetype ---
  const archetypeMap = {}; // archetype → [scores]
  for (const e of entries) {
    if (!e.archetype || e.score === null) continue;
    if (!archetypeMap[e.archetype]) archetypeMap[e.archetype] = [];
    archetypeMap[e.archetype].push(e.score);
  }
  const avgByArchetype = {};
  for (const [arch, scores] of Object.entries(archetypeMap)) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    avgByArchetype[arch] = { avg: Math.round(avg * 100) / 100, n: scores.length };
  }

  // --- Conversion funnel ---
  // Ordered stages — each subsequent stage is a subset of prior
  const FUNNEL_STAGES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer'];
  const stageCounts = {};
  for (const stage of FUNNEL_STAGES) {
    stageCounts[stage] = 0;
  }
  // An entry at stage X contributes to all stages <= X in funnel order
  const stageIndex = Object.fromEntries(FUNNEL_STAGES.map((s, i) => [s, i]));
  for (const e of entries) {
    const idx = stageIndex[e.status];
    if (idx === undefined) continue;
    // Count it at its exact stage only (we'll compute cumulative below)
    for (let i = 0; i <= idx; i++) {
      stageCounts[FUNNEL_STAGES[i]] = (stageCounts[FUNNEL_STAGES[i]] || 0) + 1;
    }
  }
  // Also add entries not in funnel stages (e.g. "Rejected") to "Evaluated" if they went through evaluation
  // Actually: treat any entry as having passed through Evaluated
  // Re-derive: Evaluated = all entries (they're all evaluated before other stages)
  stageCounts['Evaluated'] = n;

  const funnelRows = FUNNEL_STAGES.map((stage, i) => {
    const count = stageCounts[stage] || 0;
    const prevCount = i === 0 ? n : (stageCounts[FUNNEL_STAGES[i - 1]] || 0);
    const dropPct = prevCount === 0
      ? null
      : Math.round((1 - count / prevCount) * 100);
    return { stage, count, dropPct };
  });

  // --- Score histogram ---
  // Buckets: <2.0, 2.0-2.9, 3.0-3.4, 3.5-3.9, 4.0-4.4, 4.5+
  const buckets = [
    { label: '< 2.0', min: -Infinity, max: 2.0 },
    { label: '2.0–2.9', min: 2.0, max: 3.0 },
    { label: '3.0–3.4', min: 3.0, max: 3.5 },
    { label: '3.5–3.9', min: 3.5, max: 4.0 },
    { label: '4.0–4.4', min: 4.0, max: 4.5 },
    { label: '4.5+', min: 4.5, max: Infinity },
  ];
  const scoredEntries = entries.filter(e => e.score !== null);
  for (const b of buckets) {
    b.count = scoredEntries.filter(e => e.score >= b.min && e.score < b.max).length;
  }

  // --- Overall stats ---
  const scores = scoredEntries.map(e => e.score);
  const avgScore = scores.length > 0
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
    : null;
  const maxScore = scores.length > 0 ? Math.max(...scores) : null;
  const minScore = scores.length > 0 ? Math.min(...scores) : null;

  return {
    n,
    statusCounts,
    thisWeekCount: thisWeekEntries.length,
    thisMonthCount: thisMonthEntries.length,
    avgByArchetype,
    funnelRows,
    scoreBuckets: buckets,
    avgScore,
    maxScore,
    minScore,
    scoredCount: scores.length,
  };
}

// ---------------------------------------------------------------------------
// Render markdown
// ---------------------------------------------------------------------------

function bar(count, total, width = 20) {
  if (total === 0) return ' '.repeat(width);
  const filled = Math.round((count / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmt(val, fallback = '—') {
  if (val === null || val === undefined) return fallback;
  return String(val);
}

function renderMarkdown(entries, metrics, generatedAt) {
  const lines = [];

  lines.push(`# Application Velocity Report`);
  lines.push(`**Generated:** ${generatedAt}  `);
  lines.push(`**Total applications:** ${metrics.n}`);
  lines.push('');

  // --- Summary ---
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total evaluated | ${metrics.n} |`);
  lines.push(`| This week | ${metrics.thisWeekCount} |`);
  lines.push(`| This month | ${metrics.thisMonthCount} |`);
  lines.push(`| Avg score | ${metrics.avgScore !== null ? metrics.avgScore + '/5' : '—'} |`);
  lines.push(`| Score range | ${metrics.minScore !== null ? `${metrics.minScore}–${metrics.maxScore}/5` : '—'} |`);
  lines.push('');

  // --- Status breakdown ---
  lines.push('## Status Breakdown');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|--------|-------|');
  const sortedStatuses = Object.entries(metrics.statusCounts).sort((a, b) => b[1] - a[1]);
  for (const [status, count] of sortedStatuses) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push('');

  // --- Conversion funnel ---
  lines.push('## Conversion Funnel');
  lines.push('');
  lines.push('| Stage | Count | Drop-off |');
  lines.push('|-------|-------|----------|');
  for (const row of metrics.funnelRows) {
    const drop = row.dropPct === null ? '—' : (row.dropPct === 0 ? '0%' : `-${row.dropPct}%`);
    lines.push(`| ${row.stage} | ${row.count} | ${drop} |`);
  }
  if (metrics.n < 5) {
    lines.push('');
    lines.push('> **Note:** Funnel percentages unreliable at N < 5.');
  }
  lines.push('');

  // --- Score distribution ---
  lines.push('## Score Distribution');
  lines.push('');
  lines.push('| Range | Count | Distribution |');
  lines.push('|-------|-------|--------------|');
  const maxBucketCount = Math.max(...metrics.scoreBuckets.map(b => b.count), 1);
  for (const b of metrics.scoreBuckets) {
    const display = b.count > 0 ? `${bar(b.count, maxBucketCount, 15)} ${b.count}` : `${'░'.repeat(15)} 0`;
    lines.push(`| ${b.label} | ${b.count} | \`${display}\` |`);
  }
  lines.push('');

  // --- Avg score by archetype ---
  lines.push('## Avg Score by Archetype');
  lines.push('');
  const archetypeEntries = Object.entries(metrics.avgByArchetype);
  if (archetypeEntries.length === 0) {
    lines.push('_No archetype data available._');
  } else {
    lines.push('| Archetype | Avg Score | N |');
    lines.push('|-----------|-----------|---|');
    const sorted = archetypeEntries.sort((a, b) => b[1].avg - a[1].avg);
    for (const [arch, data] of sorted) {
      const note = data.n === 1 ? ' _(N=1)_' : '';
      lines.push(`| ${arch} | ${data.avg}/5${note} | ${data.n} |`);
    }
  }
  lines.push('');

  // --- Application log ---
  lines.push('## Application Log');
  lines.push('');
  lines.push('| # | Date | Company | Role | Score | Status | Archetype |');
  lines.push('|---|------|---------|------|-------|--------|-----------|');
  // Sort by date desc
  const sorted = [...entries].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
  for (const e of sorted) {
    const scoreStr = e.score !== null ? `${e.score}/5` : '—';
    const arch = e.archetype ? e.archetype : '—';
    lines.push(`| ${e.num} | ${e.date || '—'} | ${e.company} | ${e.role} | ${scoreStr} | ${e.status} | ${arch} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push(`_Generated by velocity-report.mjs on ${generatedAt}_`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!existsSync(APPLICATIONS_MD)) {
    console.error(`ERROR: ${APPLICATIONS_MD} not found`);
    process.exit(1);
  }

  const md = readFileSync(APPLICATIONS_MD, 'utf8');
  const entries = parseApplications(md);

  if (entries.length === 0) {
    console.error('No application entries found in applications.md');
    process.exit(1);
  }

  // Enrich with archetypes
  for (const e of entries) {
    if (e.reportPath) {
      e.archetype = extractArchetype(e.reportPath);
    }
  }

  const metrics = computeMetrics(entries);

  if (JSON_MODE) {
    console.log(JSON.stringify({ generatedAt: TODAY, entries, metrics }, null, 2));
    return;
  }

  const reportMd = renderMarkdown(entries, metrics, TODAY);

  const reportsDir = join(ROOT, 'reports');
  const outPath = join(reportsDir, `velocity-${TODAY}.md`);
  writeFileSync(outPath, reportMd, 'utf8');

  console.log(`Velocity report written → ${outPath}`);
  console.log(`  ${metrics.n} application(s) | avg score: ${metrics.avgScore !== null ? metrics.avgScore + '/5' : '—'} | this week: ${metrics.thisWeekCount} | this month: ${metrics.thisMonthCount}`);
}

main();
