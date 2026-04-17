#!/usr/bin/env node
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const queryIdx = args.indexOf('--query');
const query = queryIdx >= 0 ? args[queryIdx+1] : 'data architect';
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx+1]) : 50;

const SOURCE = 'hired';

async function fetchJobs(q) {
  // Hired.com requires authenticated session; public API not available
  console.log(`[${SOURCE}] ⚠ Hired.com requires authenticated session — see docs/new-board-integrations.md`);
  return [];
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
