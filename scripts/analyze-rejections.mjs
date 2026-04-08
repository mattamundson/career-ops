#!/usr/bin/env node
/**
 * Feature 6: Rejection Pattern Analysis
 * Reads applications.md, groups by terminal state, correlates scores/archetypes/keywords/gaps
 * with outcomes, and outputs actionable recommendations.
 *
 * Usage: node scripts/analyze-rejections.mjs [--min-data=N]
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const DEFAULT_MIN_DATA = 10;

const TERMINAL_REJECTED = new Set(['Rejected', 'Discarded']);
const TERMINAL_POSITIVE = new Set(['Offer', 'Interview']);
const ACTIVE_STATES    = new Set(['Evaluated', 'Applied', 'Responded', 'Contact']);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let minData = DEFAULT_MIN_DATA;

for (const arg of args) {
  const m = arg.match(/^--min-data=(\d+)$/);
  if (m) minData = parseInt(m[1], 10);
}

// ---------------------------------------------------------------------------
// Parse applications.md
// ---------------------------------------------------------------------------

function parseApplications() {
  const path = join(ROOT, 'data', 'applications.md');
  if (!existsSync(path)) {
    console.error(`ERROR: applications.md not found at ${path}`);
    process.exit(1);
  }

  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n');

  const apps = [];

  for (const line of lines) {
    // Match table rows (skip header and separator lines)
    if (!line.startsWith('|') || line.startsWith('| #') || line.startsWith('|---')) continue;

    // Split pipe-delimited row
    const cells = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 9) continue;

    const [num, date, company, role, scoreRaw, status, pdf, reportRaw, notes] = cells;

    // Parse score: "3.8/5" → 3.8
    const scoreMatch = scoreRaw.match(/^([\d.]+)\//);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

    // Parse report link: "[002](reports/002-valtech-2026-04-06.md)" → "reports/002-..."
    const reportMatch = reportRaw.match(/\[.*?\]\(([^)]+)\)/);
    const reportRelPath = reportMatch ? reportMatch[1] : null;

    apps.push({
      num: num.trim(),
      date: date.trim(),
      company: company.trim(),
      role: role.trim(),
      score,
      status: status.trim(),
      reportRelPath,
      notes: notes ? notes.trim() : '',
    });
  }

  return apps;
}

// ---------------------------------------------------------------------------
// Parse a report file — extract archetype, keywords, gaps
// ---------------------------------------------------------------------------

function parseReport(relPath) {
  const absPath = join(ROOT, relPath);
  if (!existsSync(absPath)) return null;

  const raw = readFileSync(absPath, 'utf8');

  // Archetype — header field: "**Archetype:** Applied AI / Solutions Architect ..."
  const archetypeMatch = raw.match(/\*\*Archetype:\*\*\s*(.+)/);
  const archetype = archetypeMatch ? archetypeMatch[1].trim() : null;

  // Keywords — everything under "## Extracted Keywords" until next heading or EOF
  const kwMatch = raw.match(/## Extracted Keywords\s*\n([\s\S]*?)(?=\n##|\n---|\n#|$)/);
  let keywords = [];
  if (kwMatch) {
    const block = kwMatch[1];
    // Could be comma-separated on one or more lines, or numbered list
    const items = block
      .split(/[\n,]/)
      .map(s => s.replace(/^\d+\.\s*/, '').trim())
      .filter(s => s.length > 0);
    keywords = items;
  }

  // Gaps — rows in the Gaps Assessment table in Block B
  // Pattern: "| Gap text | Severity | Mitigation |"
  const gapRows = [];
  const gapTableMatch = raw.match(/### Gaps(?:.*?)\n([\s\S]*?)(?=\n##|\n---|\n#|$)/);
  if (gapTableMatch) {
    const block = gapTableMatch[1];
    for (const line of block.split('\n')) {
      if (!line.startsWith('|') || line.startsWith('| Gap') || line.startsWith('|---')) continue;
      const cells = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
      if (cells.length >= 2) {
        // Strip markdown bold/emphasis
        const gapText = cells[0].replace(/\*\*/g, '').trim();
        const severity = cells[1].replace(/\*\*/g, '').trim();
        if (gapText) gapRows.push({ gap: gapText, severity });
      }
    }
  }

  return { archetype, keywords, gaps: gapRows };
}

// ---------------------------------------------------------------------------
// Classify applications into groups
// ---------------------------------------------------------------------------

function classify(apps) {
  const rejected = [];
  const positive = [];
  const active   = [];
  const unknown  = [];

  for (const app of apps) {
    if (TERMINAL_REJECTED.has(app.status))      rejected.push(app);
    else if (TERMINAL_POSITIVE.has(app.status)) positive.push(app);
    else if (ACTIVE_STATES.has(app.status))     active.push(app);
    else                                         unknown.push(app);
  }

  return { rejected, positive, active, unknown };
}

// ---------------------------------------------------------------------------
// Enrich apps with report data
// ---------------------------------------------------------------------------

function enrich(apps) {
  return apps.map(app => {
    const reportData = app.reportRelPath ? parseReport(app.reportRelPath) : null;
    return { ...app, ...reportData };
  });
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

function scoreThresholdAnalysis(rejected, positive) {
  const rejScores = rejected.map(a => a.score).filter(s => s !== null);
  const posScores = positive.map(a => a.score).filter(s => s !== null);

  if (rejScores.length === 0 && posScores.length === 0) return null;

  const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 'N/A';
  const min = arr => arr.length ? Math.min(...arr).toFixed(2) : 'N/A';
  const max = arr => arr.length ? Math.max(...arr).toFixed(2) : 'N/A';

  return {
    rejected: { count: rejScores.length, avg: avg(rejScores), min: min(rejScores), max: max(rejScores), scores: rejScores },
    positive: { count: posScores.length, avg: avg(posScores), min: min(posScores), max: max(posScores), scores: posScores },
  };
}

function archetypeRejectionRates(rejected, positive, active) {
  const all = [...rejected, ...positive, ...active];
  const byArchetype = {};

  for (const app of all) {
    const arch = app.archetype || 'Unknown';
    // Normalize hybrid archetypes to primary (first part before "+")
    const primary = arch.split('+')[0].trim();

    if (!byArchetype[primary]) byArchetype[primary] = { total: 0, rejected: 0, positive: 0, active: 0 };
    byArchetype[primary].total++;
    if (TERMINAL_REJECTED.has(app.status)) byArchetype[primary].rejected++;
    else if (TERMINAL_POSITIVE.has(app.status)) byArchetype[primary].positive++;
    else byArchetype[primary].active++;
  }

  return byArchetype;
}

function keywordSignals(rejected, positive) {
  const rejKws = {};
  const posKws = {};

  for (const app of rejected) {
    for (const kw of (app.keywords || [])) {
      const k = kw.toLowerCase();
      rejKws[k] = (rejKws[k] || 0) + 1;
    }
  }
  for (const app of positive) {
    for (const kw of (app.keywords || [])) {
      const k = kw.toLowerCase();
      posKws[k] = (posKws[k] || 0) + 1;
    }
  }

  // Keywords only in rejected — potential rejection signals
  const rejOnly = Object.keys(rejKws)
    .filter(k => !posKws[k])
    .sort((a, b) => rejKws[b] - rejKws[a]);

  // Keywords only in positive — potential success signals
  const posOnly = Object.keys(posKws)
    .filter(k => !rejKws[k])
    .sort((a, b) => posKws[b] - posKws[a]);

  return { rejOnly, posOnly, rejKws, posKws };
}

function gapFrequency(rejected, positive) {
  const rejGaps = {};
  const posGaps = {};

  const normalize = g => g.toLowerCase().replace(/\s*\(.*?\)/g, '').trim();

  for (const app of rejected) {
    for (const { gap, severity } of (app.gaps || [])) {
      const k = normalize(gap);
      if (!rejGaps[k]) rejGaps[k] = { count: 0, severity };
      rejGaps[k].count++;
    }
  }
  for (const app of positive) {
    for (const { gap, severity } of (app.gaps || [])) {
      const k = normalize(gap);
      if (!posGaps[k]) posGaps[k] = { count: 0, severity };
      posGaps[k].count++;
    }
  }

  const topRejGaps = Object.entries(rejGaps)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  return { topRejGaps, posGaps };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function hr(char = '─', len = 60) {
  return char.repeat(len);
}

function section(title) {
  console.log('');
  console.log(hr('═'));
  console.log(`  ${title}`);
  console.log(hr('═'));
}

function sub(title) {
  console.log('');
  console.log(`  ${hr('─', 56)}`);
  console.log(`  ${title}`);
  console.log(`  ${hr('─', 56)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const apps = parseApplications();
const { rejected, positive, active, unknown } = classify(apps);

const totalTerminal = rejected.length + positive.length;
const totalAll = apps.length;

// ---------------------------------------------------------------------------
// Raw data summary — always shown
// ---------------------------------------------------------------------------

section('REJECTION PATTERN ANALYSIS — career-ops');

console.log('');
console.log('  Raw Data Summary');
console.log(`  Total applications : ${totalAll}`);
console.log(`  Rejected/Discarded : ${rejected.length}`);
console.log(`  Offer/Interview    : ${positive.length}`);
console.log(`  Active (pipeline)  : ${active.length}`);
console.log(`  Unknown status     : ${unknown.length}`);
console.log(`  Terminal total     : ${totalTerminal}`);
console.log('');

// Print each application
console.log('  Applications on record:');
console.log(`  ${'#'.padEnd(5)} ${'Company'.padEnd(20)} ${'Role'.padEnd(35)} ${'Score'.padEnd(7)} Status`);
console.log(`  ${hr('─', 75)}`);
for (const app of apps) {
  const score = app.score !== null ? `${app.score}/5` : '  N/A';
  console.log(`  ${app.num.padEnd(5)} ${app.company.padEnd(20)} ${app.role.substring(0, 34).padEnd(35)} ${score.padEnd(7)} ${app.status}`);
}

// ---------------------------------------------------------------------------
// Insufficient data check
// ---------------------------------------------------------------------------

if (totalTerminal < minData) {
  console.log('');
  console.log(hr('═'));
  console.log(`  INSUFFICIENT DATA (N=${totalTerminal}) — need ${minData} terminal entries for pattern analysis.`);
  console.log(`  (Pass --min-data=N to adjust threshold.)`);
  console.log('');
  console.log('  What we have so far:');
  console.log(`  - ${rejected.length} rejected/discarded application${rejected.length !== 1 ? 's' : ''}`);
  console.log(`  - ${positive.length} offer/interview application${positive.length !== 1 ? 's' : ''}`);
  console.log(`  - ${active.length} active/in-pipeline application${active.length !== 1 ? 's' : ''}`);
  console.log('');
  console.log('  Partial report (all available data):');
  console.log(hr('═'));

  // Still show whatever partial data we have
  const allEnriched = enrich(apps);

  for (const app of allEnriched) {
    console.log('');
    console.log(`  [${app.num}] ${app.company} — ${app.role}`);
    console.log(`       Score     : ${app.score !== null ? `${app.score}/5` : 'N/A'}`);
    console.log(`       Status    : ${app.status}`);
    console.log(`       Archetype : ${app.archetype || 'N/A'}`);
    if (app.keywords && app.keywords.length > 0) {
      console.log(`       Keywords  : ${app.keywords.slice(0, 8).join(', ')}${app.keywords.length > 8 ? ` (+${app.keywords.length - 8} more)` : ''}`);
    }
    if (app.gaps && app.gaps.length > 0) {
      console.log(`       Gaps      :`);
      for (const { gap, severity } of app.gaps.slice(0, 4)) {
        console.log(`                   ${severity.padEnd(14)} ${gap}`);
      }
    }
  }

  console.log('');
  console.log(hr('═'));
  console.log('  Keep adding applications. Run this script again when you have more data.');
  console.log(hr('═'));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Full analysis (sufficient data path)
// ---------------------------------------------------------------------------

const rejEnriched = enrich(rejected);
const posEnriched = enrich(positive);
const actEnriched = enrich(active);

// Score thresholds
section('1. SCORE THRESHOLD ANALYSIS');
const scoreStats = scoreThresholdAnalysis(rejEnriched, posEnriched);
if (scoreStats) {
  if (scoreStats.rejected.count > 0) {
    console.log(`  Rejected  — avg: ${scoreStats.rejected.avg}/5  min: ${scoreStats.rejected.min}  max: ${scoreStats.rejected.max}  (n=${scoreStats.rejected.count})`);
  }
  if (scoreStats.positive.count > 0) {
    console.log(`  Positive  — avg: ${scoreStats.positive.avg}/5  min: ${scoreStats.positive.min}  max: ${scoreStats.positive.max}  (n=${scoreStats.positive.count})`);
  }

  const rejAvg = parseFloat(scoreStats.rejected.avg);
  const posAvg = parseFloat(scoreStats.positive.avg);
  if (!isNaN(rejAvg) && !isNaN(posAvg)) {
    const threshold = ((rejAvg + posAvg) / 2).toFixed(2);
    console.log('');
    console.log(`  Midpoint threshold: ${threshold}/5`);
    console.log(`  Interpretation: Applications scoring below ${threshold}/5 are more likely to result in rejection.`);
  }
} else {
  console.log('  No score data available.');
}

// Archetype rejection rates
section('2. ARCHETYPE REJECTION RATES');
const archetypes = archetypeRejectionRates(rejEnriched, posEnriched, actEnriched);
for (const [arch, data] of Object.entries(archetypes).sort((a, b) => b[1].total - a[1].total)) {
  const rejRate = data.total > 0 ? ((data.rejected / data.total) * 100).toFixed(0) : 0;
  const posRate = data.total > 0 ? ((data.positive / data.total) * 100).toFixed(0) : 0;
  console.log(`  ${arch.substring(0, 45).padEnd(45)}  total: ${String(data.total).padStart(2)}  rejected: ${String(data.rejected).padStart(2)} (${rejRate}%)  positive: ${String(data.positive).padStart(2)} (${posRate}%)`);
}

// Keyword signals
section('3. KEYWORD SIGNALS');
const kws = keywordSignals(rejEnriched, posEnriched);
if (kws.rejOnly.length > 0) {
  sub('Keywords appearing only in rejected applications (caution signals)');
  for (const kw of kws.rejOnly.slice(0, 15)) {
    console.log(`  [${String(kws.rejKws[kw]).padStart(2)}x]  ${kw}`);
  }
} else {
  console.log('  No rejection-exclusive keywords identified yet.');
}
if (kws.posOnly.length > 0) {
  sub('Keywords appearing only in positive outcomes (strength signals)');
  for (const kw of kws.posOnly.slice(0, 15)) {
    console.log(`  [${String(kws.posKws[kw]).padStart(2)}x]  ${kw}`);
  }
}

// Gap frequency
section('4. GAP FREQUENCY IN REJECTED APPLICATIONS');
const gaps = gapFrequency(rejEnriched, posEnriched);
if (gaps.topRejGaps.length > 0) {
  console.log('  Most common gaps in rejected/discarded applications:');
  for (const [gap, data] of gaps.topRejGaps) {
    console.log(`  [${String(data.count).padStart(2)}x]  ${data.severity.padEnd(16)} ${gap}`);
  }
} else {
  console.log('  No gap data available from rejected applications.');
}

// Recommendations
section('5. ACTIONABLE RECOMMENDATIONS');

const recommendations = [];

// Score-based
if (scoreStats && scoreStats.rejected.count > 0 && scoreStats.positive.count > 0) {
  const rejAvg = parseFloat(scoreStats.rejected.avg);
  const posAvg = parseFloat(scoreStats.positive.avg);
  const threshold = ((rejAvg + posAvg) / 2).toFixed(1);
  recommendations.push(`Score gate: Apply cutoff of ${threshold}/5 — applications below this have historically trended toward rejection.`);
}

// Archetype-based
const highRejArchetypes = Object.entries(archetypes)
  .filter(([, d]) => d.total >= 2 && d.rejected / d.total >= 0.6)
  .map(([a]) => a);
if (highRejArchetypes.length > 0) {
  recommendations.push(`High-rejection archetypes: ${highRejArchetypes.join(', ')} — consider refining targeting or CV positioning for these role types.`);
}

// Gap-based
if (gaps.topRejGaps.length > 0) {
  const hardGaps = gaps.topRejGaps
    .filter(([, d]) => /hard/i.test(d.severity))
    .map(([g]) => g);
  if (hardGaps.length > 0) {
    recommendations.push(`Hard gaps recurring in rejections: ${hardGaps.slice(0, 3).join('; ')} — prioritize these for upskilling or honest positioning.`);
  }
}

// Keyword-based
if (kws.rejOnly.length > 5) {
  recommendations.push(`${kws.rejOnly.length} keywords appear only in rejected apps — these JD keyword clusters may signal role types where your CV under-performs. Review whether these terms reflect genuine gaps or positioning issues.`);
}

if (recommendations.length === 0) {
  console.log('  More data needed for statistically meaningful recommendations.');
  console.log(`  Currently tracking ${totalTerminal} terminal outcomes; target ${minData}+ for reliable patterns.`);
} else {
  for (let i = 0; i < recommendations.length; i++) {
    console.log(`  ${i + 1}. ${recommendations[i]}`);
  }
}

console.log('');
console.log(hr('═'));
console.log(`  Analysis complete. Terminal outcomes: ${totalTerminal}. Active pipeline: ${active.length}.`);
console.log(hr('═'));
console.log('');
