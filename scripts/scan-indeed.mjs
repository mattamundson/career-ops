#!/usr/bin/env node
/**
 * scan-indeed.mjs — Indeed job scanner via Playwright
 *
 * Indeed pages are JS-rendered, so we use Playwright to load and extract job listings.
 *
 * Priority (config/profile.yml work_modes): on-site MSP > hybrid MSP > remote.
 * Default location is Minneapolis MN (surfaces on-site + hybrid first). Pass
 * --location=Remote to scan the remote bucket instead.
 *
 * Usage:
 *   node scripts/scan-indeed.mjs [--query "data architect"] [--location "Minneapolis, MN"]
 *                                [--limit 50] [--max-pages 3] [--json] [--live]
 *
 * ToS Risk: Indeed Section 5 prohibits scraping. Account ban risk: MEDIUM.
 * Mitigations: random delays, limited pages, respectful rate limiting.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { runChromePreflight } from './lib/chrome-preflight.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const jsonMode = args.includes('--json');
const queryIdx = args.indexOf('--query');
const query = queryIdx >= 0 ? args[queryIdx + 1] : 'data architect';
const locationIdx = args.indexOf('--location');
const location = locationIdx >= 0 ? args[locationIdx + 1] : 'Minneapolis, MN';
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 50;
const maxPagesIdx = args.indexOf('--max-pages');
const maxPages = maxPagesIdx >= 0 ? parseInt(args[maxPagesIdx + 1]) : 3;

const SOURCE = 'indeed';

function randomDelay(min = 3000, max = 7000) {
  return Math.floor(Math.random() * (max - min) + min);
}

async function scrapeIndeed(searchQuery) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(`[${SOURCE}] Playwright not installed. Run: pnpm add playwright`);
    return [];
  }

  runChromePreflight(SOURCE);
  const browser = await chromium.launch({ headless: true });
  const allJobs = [];

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const start = pageNum * 10;
      const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(searchQuery)}&l=${encodeURIComponent(location)}&start=${start}&fromage=7&sort=date`;

      console.error(`[${SOURCE}] Page ${pageNum + 1}/${maxPages}: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(randomDelay(2000, 4000));

        // Wait for job cards to appear
        await page.waitForSelector('[class*="job_seen_beacon"], [class*="resultContent"], .jobsearch-ResultsList', { timeout: 10000 }).catch(() => {});

        const jobs = await page.evaluate(() => {
          const results = [];
          // Indeed uses multiple possible selectors depending on version
          const cards = document.querySelectorAll('[class*="job_seen_beacon"], .resultContent, [data-jk]');

          for (const card of cards) {
            try {
              const titleEl = card.querySelector('h2 a, [class*="jobTitle"] a, a[data-jk]');
              const companyEl = card.querySelector('[data-testid="company-name"], [class*="companyName"], .company');
              const locationEl = card.querySelector('[data-testid="text-location"], [class*="companyLocation"], .location');

              if (!titleEl) continue;

              const title = titleEl.textContent?.trim() || '';
              const company = companyEl?.textContent?.trim() || 'Unknown';
              const location = locationEl?.textContent?.trim() || 'Remote';

              // Extract job ID from data-jk or href
              let url = '';
              const jk = titleEl.getAttribute('data-jk') || card.getAttribute('data-jk');
              if (jk) {
                url = `https://www.indeed.com/viewjob?jk=${jk}`;
              } else {
                const href = titleEl.getAttribute('href') || '';
                url = href.startsWith('http') ? href : `https://www.indeed.com${href}`;
              }

              if (title && url) {
                results.push({ title, company, location, url });
              }
            } catch { /* skip malformed card */ }
          }
          return results;
        });

        console.error(`[${SOURCE}]   Found ${jobs.length} jobs on page ${pageNum + 1}`);
        allJobs.push(...jobs);

        // Check if there are more pages
        const hasNext = await page.$('a[data-testid="pagination-page-next"], a[aria-label="Next Page"]');
        if (!hasNext && pageNum < maxPages - 1) {
          console.error(`[${SOURCE}]   No more pages available.`);
          break;
        }

        // Respectful delay between pages
        if (pageNum < maxPages - 1) {
          await page.waitForTimeout(randomDelay(4000, 8000));
        }
      } catch (err) {
        console.error(`[${SOURCE}]   Page ${pageNum + 1} error: ${err.message}`);
        // Continue to next page on error
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return allJobs;
}

(async () => {
  const seen = loadSeenUrls();
  const jobs = await scrapeIndeed(query);
  const fresh = jobs.filter(j => j.url && !seen.has(j.url)).slice(0, limit);

  if (jsonMode) {
    process.stdout.write(JSON.stringify(fresh));
    return;
  }

  console.log(`[${SOURCE}] Query="${query}" Location="${location}" → ${fresh.length} new (${jobs.length} total)`);

  if (dryRun) {
    console.log('DRY-RUN — not writing');
    fresh.slice(0, 5).forEach(j => console.log(JSON.stringify(j)));
    return;
  }

  if (fresh.length > 0) {
    appendScanResults(fresh, { portal: `direct/${SOURCE}` });
    appendAutomationEvent(ROOT, {
      type: 'scanner.indeed.completed',
      status: 'success',
      summary: `Indeed scan: ${fresh.length} new jobs for "${query}" @ "${location}"`,
      details: { query, location, newCount: fresh.length, totalFound: jobs.length, pages: maxPages },
    });
    console.log(`Written ${fresh.length} entries to pipeline.md`);
  }
})();
