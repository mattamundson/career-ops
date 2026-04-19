#!/usr/bin/env node
/**
 * scan-weworkremotely.mjs — WeWorkRemotely RSS scraper
 *
 * Key insights from probing the live RSS 2026-04-10:
 *   - Title format is "{Company}: {Role}" — split on first colon.
 *   - <region> tag holds location (often "Anywhere in the World" or a country name).
 *   - <description> contains HTML; not useful for company extraction.
 *   - Programming RSS alone misses data/BI roles — we also pull devops & product categories.
 */
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const jsonOutput = args.includes('--json');
const queryIdx = args.indexOf('--query');
const singleQuery = queryIdx >= 0 ? args[queryIdx + 1] : null;
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 50;

const SOURCE = 'weworkremotely';

// Pull multiple RSS categories — WWR doesn't have a pure "data" category,
// so we harvest broadly and filter by title keywords.
const FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
  'https://weworkremotely.com/categories/remote-product-jobs.rss',
  'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss'
];

// Matt's target-role keyword filter (case-insensitive substring match on title).
const TITLE_KEYWORDS = [
  'data', 'analytics', 'analyst', 'bi ', 'business intelligence',
  'power bi', 'fabric', 'architect', 'reports', 'reporting',
  'automation', 'etl', 'warehouse', 'dashboard', 'snowflake',
  'databricks', 'looker', 'dbt', 'sql'
];

function matchesTarget(title, q) {
  const t = (title || '').toLowerCase();
  if (q) return t.includes(q.toLowerCase());
  return TITLE_KEYWORDS.some(kw => t.includes(kw));
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function parseFeed(xml) {
  const jobs = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const titleMatch = /<title>(.*?)<\/title>/s.exec(item);
    const linkMatch = /<link>(.*?)<\/link>/s.exec(item);
    const regionMatch = /<region>(.*?)<\/region>/s.exec(item);
    const pubMatch = /<pubDate>(.*?)<\/pubDate>/s.exec(item);

    if (!titleMatch || !linkMatch) continue;
    const rawTitle = decodeEntities(titleMatch[1].trim());
    // Format is "{Company}: {Role}" — split on first colon
    const colonIdx = rawTitle.indexOf(':');
    let company = 'Unknown';
    let title = rawTitle;
    if (colonIdx > 0 && colonIdx < 60) {
      company = rawTitle.substring(0, colonIdx).trim();
      title = rawTitle.substring(colonIdx + 1).trim();
    }

    jobs.push({
      url: linkMatch[1].trim(),
      title,
      company,
      location: regionMatch ? decodeEntities(regionMatch[1].trim()) : 'Remote',
      posted_at: pubMatch ? pubMatch[1].trim() : ''
    });
  }
  return jobs;
}

async function fetchFeed(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'career-ops-local-scanner/1.0' } });
    if (!res.ok) {
      console.error(`[${SOURCE}] HTTP ${res.status} for ${url}`);
      return [];
    }
    return parseFeed(await res.text());
  } catch (err) {
    console.error(`[${SOURCE}] fetch error for ${url}: ${err.message}`);
    return [];
  }
}

(async () => {
  const seen = loadSeenUrls();
  const allJobs = [];
  const seenInThisRun = new Set();

  for (const feed of FEEDS) {
    const jobs = await fetchFeed(feed);
    for (const j of jobs) {
      if (!j.url || seenInThisRun.has(j.url)) continue;
      seenInThisRun.add(j.url);
      allJobs.push(j);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const onTarget = allJobs.filter(j => matchesTarget(j.title, singleQuery));
  const fresh = onTarget.filter(j => !seen.has(j.url)).slice(0, limit);

  if (jsonOutput) {
    console.log(JSON.stringify(fresh));
    return;
  }

  console.log(`[${SOURCE}] ${FEEDS.length} feeds → ${allJobs.length} raw → ${onTarget.length} title-matched → ${fresh.length} new`);

  if (dryRun) {
    console.log('DRY-RUN — not writing');
    fresh.slice(0, 5).forEach(j => console.log(JSON.stringify(j)));
    return;
  }
  if (fresh.length === 0) return;
  appendScanResults(fresh, { portal: `direct/${SOURCE}` });
  console.log(`[${SOURCE}] Wrote ${fresh.length} rows`);
})();
