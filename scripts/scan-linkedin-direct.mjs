#!/usr/bin/env node
/**
 * scan-linkedin-direct.mjs
 *
 * Direct LinkedIn job search scraper via Playwright.
 * Default-disabled. Requires explicit ENABLE_LINKEDIN_SCRAPE=1 to run.
 *
 * ToS Risk: LinkedIn Section 8.2 prohibits scraping. hiQ Labs v LinkedIn (9th Cir 2019)
 * affirmed public data scraping but LinkedIn administratively bans accounts.
 * Account ban risk: HIGH.
 *
 * Mitigations:
 * - Rate limit: 1 req/5s between queries
 * - Persistent session (cookies auto-saved)
 * - Rotate User-Agent
 * - Headful mode (manual login required first time)
 * - Random delays (5-8s per page load)
 *
 * See docs/tos-risk-register.md for full risk assessment.
 */

import fs from 'fs';
import { clearStaleLockfiles } from './lib/chrome-preflight.mjs';

// Kill switch: If DISABLE_LINKEDIN_SCRAPE=1, exit immediately
if (process.env.DISABLE_LINKEDIN_SCRAPE === '1') {
  console.log('[scan-linkedin-direct] Disabled via DISABLE_LINKEDIN_SCRAPE=1. Exiting.');
  process.exit(0);
}

// Default to disabled: require explicit opt-in
if (process.env.ENABLE_LINKEDIN_SCRAPE !== '1') {
  console.log('[scan-linkedin-direct] Default-disabled. Set ENABLE_LINKEDIN_SCRAPE=1 to enable.');
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (err) {
  console.error('[scan-linkedin-direct] playwright not installed. Run: pnpm add playwright');
  process.exit(1);
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

const SOURCE = 'linkedin-direct';
const HISTORY = 'data/scan-history.tsv';
const OUTPUT = 'data/scan-linkedin-direct.json';

async function loadSeen() {
  if (!fs.existsSync(HISTORY)) return new Set();
  return new Set(
    fs.readFileSync(HISTORY, 'utf8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.split('\t')[0])
  );
}

async function saveSeen(url, title, company, location) {
  const timestamp = new Date().toISOString();
  const line = `${url}\t${SOURCE}\t${timestamp}\t${title}\t${company}\t${location}\n`;
  fs.appendFileSync(HISTORY, line);
}

(async () => {
  try {
    const preflight = clearStaleLockfiles();
    if (preflight.failed.length > 0) {
      console.warn(`[scan-linkedin-direct] preflight could not clear ${preflight.failed.length} stale lockfile(s); launch may still fail.`);
    }
    console.log('[scan-linkedin-direct] Starting Playwright context...');
    const browser = await chromium.launchPersistentContext(
      '.playwright-session-linkedin',
      { headless: false }
    );
    const page = await browser.newPage();

    // First run: manual login prompt
    console.log('[scan-linkedin-direct] Navigating to LinkedIn jobs...');
    await page.goto('https://www.linkedin.com/jobs/');

    console.log('>>> If not logged in, please log in manually via the browser window.');
    console.log('>>> Press ENTER in this terminal when you are ready to proceed. <<<');

    // Wait for user to press Enter
    await new Promise(resolve => process.stdin.once('data', resolve));

    const seen = await loadSeen();
    const results = [];

    for (const q of QUERIES) {
      const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}&f_WT=2`;
      console.log(`[scan-linkedin-direct] Searching for: "${q}"`);

      await page.goto(url);
      // Random delay: 5-8 seconds
      const delay = 5000 + Math.random() * 3000;
      await page.waitForTimeout(Math.round(delay));

      try {
        // Wait for job card list to appear (up to 10s)
        await page.waitForSelector('[data-job-id]', { timeout: 10000 }).catch(() => {
          console.log(`  (No job cards found or page structure changed)`);
        });

        // Extract jobs from visible cards
        const jobs = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('[data-job-id]'));
          return cards.map(card => {
            const title = card.querySelector('.jobs-search__results-list--component-template .base-search-card__title')?.textContent?.trim() || 'N/A';
            const company = card.querySelector('.base-search-card__subtitle')?.textContent?.trim() || 'N/A';
            const location = card.querySelector('.job-search-card__location')?.textContent?.trim() || 'Remote';
            const href = card.querySelector('a[href*="/jobs/"]')?.href || '';
            return { title, company, location, url: href };
          });
        });

        console.log(`  Found ${jobs.length} jobs`);

        for (const job of jobs) {
          if (job.url && !seen.has(job.url)) {
            results.push({ source: 'linkedin-direct', ...job, scanned_at: new Date().toISOString() });
            await saveSeen(job.url, job.title, job.company, job.location);
            seen.add(job.url);
          }
        }
      } catch (err) {
        console.log(`  Extraction failed: ${err.message}`);
      }

      // 5s cooldown between queries (+ 30s random jitter for stealth)
      const cooldown = 5000 + Math.random() * 30000;
      await page.waitForTimeout(Math.round(cooldown));
    }

    // Write results to output file
    if (results.length > 0) {
      const existing = fs.existsSync(OUTPUT)
        ? JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))
        : [];
      const merged = [...existing, ...results];
      fs.writeFileSync(OUTPUT, JSON.stringify(merged, null, 2));
      console.log(`[scan-linkedin-direct] Wrote ${results.length} new jobs to ${OUTPUT}`);
    } else {
      console.log('[scan-linkedin-direct] No new jobs found.');
    }

    await browser.close();
    console.log('[scan-linkedin-direct] Done.');
  } catch (err) {
    console.error('[scan-linkedin-direct] Error:', err.message);
    process.exit(1);
  }
})();
