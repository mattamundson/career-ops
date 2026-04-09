#!/usr/bin/env node
/**
 * check-liveness.mjs — Validate URLs in pipeline.md are still live
 *
 * Usage:
 *   node scripts/check-liveness.mjs          → report only, writes data/liveness-YYYY-MM-DD.md
 *   node scripts/check-liveness.mjs --prune  → also removes dead entries from pipeline.md
 *   node scripts/check-liveness.mjs --json   → JSON summary to stdout (no file write)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const ROOT   = resolve(__dir, '..');
const PIPELINE  = join(ROOT, 'data', 'pipeline.md');
const PRUNE  = process.argv.includes('--prune');
const JSON_MODE = process.argv.includes('--json');
const BATCH  = 10;  // concurrent HEAD requests per batch

// ---------------------------------------------------------------------------
// Parse pipeline.md — handles both formats:
//   - [ ] https://url | Company | Title
//   - [x] https://url | Company | Title
// ---------------------------------------------------------------------------
function parsePipelineEntries(md) {
  const entries = [];
  for (const line of md.split('\n')) {
    // Match checkbox lines with a URL
    const m = line.match(/^- \[[ x]\] (https?:\/\/\S+)/);
    if (!m) continue;
    const url = m[1].split(' ')[0].split('|')[0].trim(); // strip trailing pipe/space
    const rest = line.slice(line.indexOf(url) + url.length).trim();
    const parts = rest.split('|').map(s => s.trim());
    entries.push({
      url,
      company: parts[0] || '',
      title:   parts[1] || '',
      rawLine: line,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// HEAD request with timeout — follows redirects
// ---------------------------------------------------------------------------
async function checkUrl(url) {
  try {
    const resp = await fetch(url, {
      method:   'HEAD',
      signal:   AbortSignal.timeout(10000),
      redirect: 'follow',
      headers:  { 'User-Agent': 'career-ops-liveness-check/1.0' },
    });
    // Treat 2xx and 3xx as alive; 4xx/5xx as dead
    const alive = resp.status < 400;
    return { alive, status: resp.status };
  } catch (err) {
    // Timeout, DNS failure, network error
    return { alive: false, status: 0, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(PIPELINE)) {
    console.error(`pipeline.md not found: ${PIPELINE}`);
    process.exit(1);
  }

  const md      = readFileSync(PIPELINE, 'utf8');
  const entries = parsePipelineEntries(md);

  if (entries.length === 0) {
    console.log('No pipeline entries found.');
    process.exit(0);
  }

  if (!JSON_MODE) console.log(`Checking ${entries.length} pipeline URLs (batch=${BATCH})...`);

  // Run in batches to avoid overwhelming the system
  const results = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const checked = await Promise.all(
      batch.map(async e => ({ ...e, ...(await checkUrl(e.url)) }))
    );
    results.push(...checked);
    if (!JSON_MODE) process.stdout.write('.');
  }
  if (!JSON_MODE) console.log('');

  const alive   = results.filter(r => r.alive);
  const dead    = results.filter(r => !r.alive);
  const today   = new Date().toISOString().slice(0, 10);

  if (JSON_MODE) {
    console.log(JSON.stringify({ date: today, total: results.length, alive: alive.length, dead: dead.length, deadUrls: dead.map(r => ({ url: r.url, status: r.status, company: r.company, title: r.title })) }, null, 2));
    return;
  }

  console.log(`\n${alive.length} alive | ${dead.length} dead | ${results.length} total`);

  // Write liveness report
  const reportPath = join(ROOT, 'data', `liveness-${today}.md`);
  const lines = [
    `# Liveness Report ${today}`,
    ``,
    `**Total:** ${results.length} | **Alive:** ${alive.length} | **Dead:** ${dead.length}`,
    ``,
  ];
  if (dead.length > 0) {
    lines.push(`## Dead URLs`);
    lines.push('');
    for (const r of dead) {
      const statusLabel = r.status === 0 ? 'timeout/DNS' : `HTTP ${r.status}`;
      lines.push(`- **${r.company || 'Unknown'}** — ${r.title || r.url}`);
      lines.push(`  - URL: ${r.url}`);
      lines.push(`  - Status: ${statusLabel}`);
    }
  } else {
    lines.push('All pipeline URLs are live.');
  }
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`Report written: ${reportPath}`);

  // --prune: remove dead entries from pipeline.md
  if (PRUNE && dead.length > 0) {
    const deadUrls = new Set(dead.map(r => r.url));
    const prunedLines = md.split('\n').filter(line => {
      const m = line.match(/^- \[[ x]\] (https?:\/\/\S+)/);
      if (!m) return true; // keep non-entry lines
      const url = m[1].split(' ')[0].split('|')[0].trim();
      return !deadUrls.has(url);
    });
    writeFileSync(PIPELINE, prunedLines.join('\n'));
    console.log(`Pruned ${dead.length} dead entries from pipeline.md`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
