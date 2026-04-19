#!/usr/bin/env node
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const queryIdx = args.indexOf('--query');
const query = queryIdx >= 0 ? args[queryIdx+1] : 'data architect';
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx+1]) : 50;

const SOURCE = 'remoteok';

async function fetchJobs(q) {
  try {
    const res = await fetch('https://remoteok.com/api');
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return [];
    // Skip first entry (legal notice) and filter by query terms
    return data.slice(1)
      .filter(job => {
        const tags = (job.tags || []).map(t => t.toLowerCase());
        const title = (job.title || '').toLowerCase();
        return tags.some(t => q.toLowerCase().split(' ').some(qt => t.includes(qt))) ||
               title.includes(q.toLowerCase());
      })
      .map(job => ({
        url: job.url || '',
        title: job.title || 'Untitled',
        company: job.company || 'Unknown',
        location: 'Remote',
        posted_at: job.date_posted || ''
      }));
  } catch (err) {
    console.error(`[${SOURCE}] fetch error: ${err.message}`);
    return [];
  }
}

(async () => {
  const seen = loadSeenUrls();
  const jobs = await fetchJobs(query);
  const fresh = jobs.filter(j => !seen.has(j.url)).slice(0, limit);
  console.log(`[${SOURCE}] Query="${query}" → ${fresh.length} new (${jobs.length} total)`);
  if (dryRun) {
    console.log('DRY-RUN — not writing');
    fresh.slice(0, 5).forEach(j => console.log(JSON.stringify(j)));
    return;
  }
  if (fresh.length > 0) {
    appendScanResults(fresh, { portal: `direct/${SOURCE}` });
  }
})();
