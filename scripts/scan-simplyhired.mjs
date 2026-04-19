#!/usr/bin/env node
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const jsonOutput = args.includes('--json');
const queryIdx = args.indexOf('--query');
const query = queryIdx >= 0 ? args[queryIdx+1] : 'data architect';
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx+1]) : 50;

const SOURCE = 'simplyhired';

async function fetchJobs(q) {
  try {
    const encoded = encodeURIComponent(q);
    const res = await fetch(`https://www.simplyhired.com/search?q=${encoded}&l=Remote`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();
    if (/Just a moment/i.test(html) || /Enable JavaScript and cookies to continue/i.test(html) || /_cf_chl_opt/i.test(html)) {
      console.warn(`[${SOURCE}] blocked by Cloudflare challenge; direct HTML parsing is not currently viable in this environment`);
      return [];
    }
    const jobs = [];

    // Regex parsing for job cards
    const cardRegex = /class="[^"]*job[^"]*"[^>]*>[^<]*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/gi;
    let match;
    const companyRegex = /class="[^"]*company[^"]*">([^<]+)<\/a?>/i;

    while ((match = cardRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      const section = html.substring(Math.max(0, match.index - 500), match.index + 500);
      const companyMatch = companyRegex.exec(section);

      jobs.push({
        url: url.startsWith('http') ? url : `https://www.simplyhired.com${url}`,
        title: title,
        company: companyMatch ? companyMatch[1].trim() : 'Unknown',
        location: 'Remote',
        posted_at: ''
      });
    }
    return jobs.slice(0, limit * 2);
  } catch (err) {
    console.error(`[${SOURCE}] fetch error: ${err.message}`);
    return [];
  }
}

(async () => {
  const seen = loadSeenUrls();
  const jobs = await fetchJobs(query);
  const fresh = jobs.filter(j => !seen.has(j.url) && j.url).slice(0, limit);
  if (jsonOutput) {
    console.log(JSON.stringify(fresh));
    return;
  }
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
