#!/usr/bin/env node
/**
 * scan-indeed-direct.mjs
 *
 * Direct Indeed job search scraper.
 * Attempts raw fetch with User-Agent header first; falls back to Playwright.
 * Default-disabled. Requires explicit ENABLE_INDEED_SCRAPE=1 to run.
 *
 * ToS Risk: Indeed robots.txt allows limited crawling but aggressive scraping
 * triggers 403 Forbidden and potential IP ban. Account ban risk: MEDIUM.
 *
 * Mitigations:
 * - Rate limit: 1 req/2s between queries
 * - User-Agent rotation
 * - Cloudflare detection evasion (Playwright)
 * - Random delays (2-5s per request)
 *
 * See docs/tos-risk-register.md for full risk assessment.
 */

import fs from 'fs';
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';
import { runChromePreflight } from './lib/chrome-preflight.mjs';

// Kill switch: If DISABLE_LINKEDIN_SCRAPE=1, exit (shared kill switch for all direct scrapers)
if (process.env.DISABLE_LINKEDIN_SCRAPE === '1') {
  console.log('[scan-indeed-direct] Disabled via DISABLE_LINKEDIN_SCRAPE=1. Exiting.');
  process.exit(0);
}

// Default to disabled: require explicit opt-in
if (process.env.ENABLE_INDEED_SCRAPE !== '1') {
  console.log('[scan-indeed-direct] Default-disabled. Set ENABLE_INDEED_SCRAPE=1 to enable.');
  process.exit(0);
}

const QUERIES = [
  "data architect",
  "bi architect",
  "power bi",
  "microsoft fabric",
  "analytics engineering lead",
  "reports developer",
  "ai automation engineer"
];

const SOURCE = 'indeed-direct';
const OUTPUT = 'data/scan-indeed-direct.json';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function tryFetchJobs(q) {
  const baseUrl = 'https://www.indeed.com/jobs';
  const params = new URLSearchParams({
    q,
    l: 'Remote',
    fromage: '7'
  });
  const url = `${baseUrl}?${params.toString()}`;
  const ua = getRandomUA();

  try {
    console.log(`  [fetch] Attempting raw fetch for "${q}"...`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000
    });

    if (res.status === 403) {
      console.log(`  [fetch] 403 Forbidden. Falling back to Playwright...`);
      return null;
    }

    if (!res.ok) {
      console.log(`  [fetch] ${res.status} ${res.statusText}. Falling back to Playwright...`);
      return null;
    }

    const html = await res.text();

    // Basic extraction: look for job card structure
    const jobPattern = /data-jobkey="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)/g;
    const jobs = [];

    let match;
    while ((match = jobPattern.exec(html)) !== null) {
      const jobId = match[1];
      const href = match[2].startsWith('http') ? match[2] : `https://www.indeed.com${match[2]}`;
      const title = match[3].trim();
      jobs.push({ id: jobId, url: href, title });
    }

    console.log(`  [fetch] Found ${jobs.length} jobs (raw pattern match)`);
    return jobs;
  } catch (err) {
    console.log(`  [fetch] Error: ${err.message}. Falling back to Playwright...`);
    return null;
  }
}

async function tryPlaywrightJobs(q) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.log('  [playwright] playwright not installed. Skipping Playwright fallback.');
    return [];
  }

  try {
    console.log(`  [playwright] Starting Playwright for "${q}"...`);
    runChromePreflight('scan-indeed-direct');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);

    const baseUrl = 'https://www.indeed.com/jobs';
    const params = new URLSearchParams({
      q,
      l: 'Remote',
      fromage: '7'
    });
    const url = `${baseUrl}?${params.toString()}`;

    await page.goto(url);

    // Random delay for page render
    const delay = 2000 + Math.random() * 3000;
    await page.waitForTimeout(Math.round(delay));

    // Extract job cards
    const jobs = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[data-jobkey]')
      );
      return cards.slice(0, 20).map(card => {
        const titleEl = card.querySelector('h2 a, .jobTitle a');
        const companyEl = card.querySelector('[data-company-name], .companyName');
        const locationEl = card.querySelector('[data-job-location], .location');
        const urlEl = card.querySelector('h2 a, .jobTitle a');

        return {
          url: urlEl?.href || '',
          title: titleEl?.textContent?.trim() || 'N/A',
          company: companyEl?.textContent?.trim() || 'N/A',
          location: locationEl?.textContent?.trim() || 'Remote'
        };
      });
    });

    await context.close();
    await browser.close();

    console.log(`  [playwright] Extracted ${jobs.length} jobs`);
    return jobs;
  } catch (err) {
    console.log(`  [playwright] Error: ${err.message}`);
    return [];
  }
}

(async () => {
  try {
    const seen = loadSeenUrls();
    const results = [];

    for (const q of QUERIES) {
      console.log(`[scan-indeed-direct] Searching for: "${q}"`);

      // Try fetch first (faster, less resource-intensive)
      let jobs = await tryFetchJobs(q);

      // Fall back to Playwright if fetch didn't work
      if (jobs === null) {
        jobs = await tryPlaywrightJobs(q);
      }

      // Save results
      for (const job of jobs) {
        if (job.url && !seen.has(job.url)) {
          results.push({
            source: 'indeed-direct',
            ...job,
            scanned_at: new Date().toISOString()
          });
          seen.add(job.url);
        }
      }

      // 2s cooldown between queries
      const cooldown = 2000 + Math.random() * 3000;
      await new Promise(r => setTimeout(r, Math.round(cooldown)));
    }

    if (results.length > 0) {
      appendScanResults(results, { portal: `direct/${SOURCE}` });

      // Write results to output file
      const existing = fs.existsSync(OUTPUT)
        ? JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))
        : [];
      const merged = [...existing, ...results];
      fs.writeFileSync(OUTPUT, JSON.stringify(merged, null, 2));
      console.log(`[scan-indeed-direct] Wrote ${results.length} new jobs to ${OUTPUT}`);
    } else {
      console.log('[scan-indeed-direct] No new jobs found.');
    }

    console.log('[scan-indeed-direct] Done.');
  } catch (err) {
    console.error('[scan-indeed-direct] Error:', err.message);
    process.exit(1);
  }
})();
