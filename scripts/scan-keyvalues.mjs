#!/usr/bin/env node
import fs from 'fs';
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const queryIdx = args.indexOf('--query');
const query = queryIdx >= 0 ? args[queryIdx+1] : 'data architect';
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx+1]) : 50;

const SOURCE = 'keyvalues';

async function fetchJobs(q) {
  try {
    const res = await fetch('https://www.keyvalues.com/jobs', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();
    const jobs = [];

    // Regex parsing for job listings
    const jobRegex = /<a[^>]*href="([^"]*jobs[^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
    let match;

    while ((match = jobRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      const company = match[3].trim();

      if (title.toLowerCase().includes(q.toLowerCase())) {
        jobs.push({
          url: url.startsWith('http') ? url : `https://www.keyvalues.com${url}`,
          title: title,
          company: company,
          location: 'Remote',
          posted_at: ''
        });
      }
    }
    return jobs;
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
