#!/usr/bin/env node
/**
 * scan-remotive.mjs — Remotive public JSON API scraper
 *
 * ToS compliance notes (from Remotive API warning banner 2026-04-10):
 *   - MAX 4 calls/day per Remotive's advice (this scraper makes 1 call per query × N queries).
 *   - DO NOT submit Remotive jobs to third-party job boards; this scraper writes to local
 *     data/pipeline.md and data/scan-history.tsv only.
 *   - Attribute source as "remotive" in TSV (done via SOURCE constant).
 *   - Jobs are delayed by 24h on the public API (paid API available for $5k/mo+).
 */
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const queryIdx = args.indexOf('--query');
const singleQuery = queryIdx >= 0 ? args[queryIdx + 1] : null;
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 50;

const SOURCE = 'remotive';

// Use broader category-style queries that match Remotive's ontology better.
// Remotive categorizes: "Data Analysis", "Software Development", "DevOps / Sysadmin", etc.
const DEFAULT_QUERIES = [
  'data',
  'analytics',
  'business intelligence',
  'architect',
  'automation',
  'power bi'
];

const QUERIES = singleQuery ? [singleQuery] : DEFAULT_QUERIES;

// Matt's target-role keyword filter (case-insensitive substring match against title).
const TITLE_KEYWORDS = [
  'data', 'analytics', 'analyst', 'bi ', 'business intelligence',
  'power bi', 'fabric', 'architect', 'reports', 'reporting',
  'automation', 'etl', 'warehouse', 'dashboard', 'looker'
];

function matchesTarget(title) {
  const t = (title || '').toLowerCase();
  return TITLE_KEYWORDS.some(kw => t.includes(kw));
}

async function fetchJobsForQuery(q) {
  try {
    const encoded = encodeURIComponent(q);
    const res = await fetch(`https://remotive.com/api/remote-jobs?search=${encoded}`, {
      headers: { 'User-Agent': 'career-ops-local-scanner/1.0 (+personal job search)' }
    });
    if (!res.ok) {
      console.error(`[${SOURCE}] HTTP ${res.status} for query="${q}"`);
      return [];
    }
    const data = await res.json();
    if (!data.jobs || !Array.isArray(data.jobs)) return [];
    return data.jobs.map(job => ({
      url: job.url || '',
      title: job.title || 'Untitled',
      company: job.company_name || 'Unknown',
      location: job.candidate_required_location || 'Remote',
      posted_at: job.publication_date || '',
      category: job.category || '',
      salary: job.salary || ''
    }));
  } catch (err) {
    console.error(`[${SOURCE}] fetch error for "${q}": ${err.message}`);
    return [];
  }
}

(async () => {
  const seen = loadSeenUrls();
  const allJobs = [];
  const seenInThisRun = new Set();

  for (const q of QUERIES) {
    const jobs = await fetchJobsForQuery(q);
    for (const j of jobs) {
      if (!j.url || seenInThisRun.has(j.url)) continue;
      seenInThisRun.add(j.url);
      allJobs.push(j);
    }
    // Polite sleep between calls (Remotive caps advised at 4 calls/day; we use ~1s gap defensively)
    await new Promise(r => setTimeout(r, 1000));
  }

  // Title-match filter before dedup against history
  const onTarget = allJobs.filter(j => matchesTarget(j.title));
  const fresh = onTarget.filter(j => !seen.has(j.url)).slice(0, limit);

  console.log(`[${SOURCE}] Queried ${QUERIES.length} terms → ${allJobs.length} raw → ${onTarget.length} title-matched → ${fresh.length} new`);

  if (dryRun) {
    console.log('DRY-RUN — not writing');
    fresh.slice(0, 5).forEach(j => console.log(JSON.stringify(j)));
    return;
  }
  if (fresh.length === 0) return;
  appendScanResults(fresh, { portal: `direct/${SOURCE}` });
  console.log(`[${SOURCE}] Wrote ${fresh.length} rows to data/scan-history.tsv + data/pipeline.md`);
})();
