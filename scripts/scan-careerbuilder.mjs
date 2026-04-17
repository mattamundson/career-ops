#!/usr/bin/env node
/**
 * scan-careerbuilder.mjs — CareerBuilder job scanner via Playwright
 *
 * Usage:
 *   node scripts/scan-careerbuilder.mjs [--query "data architect"] [--limit 50] [--max-pages 3] [--json] [--live]
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
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 50;
const maxPagesIdx = args.indexOf('--max-pages');
const maxPages = maxPagesIdx >= 0 ? parseInt(args[maxPagesIdx + 1]) : 3;

const SOURCE = 'careerbuilder';

function randomDelay(min = 3000, max = 7000) {
  return Math.floor(Math.random() * (max - min) + min);
}

async function scrapeCareerBuilder(searchQuery) {
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

    // CareerBuilder redirects URL-based searches to homepage in headless mode.
    // Must fill the search form interactively.
    console.error(`[${SOURCE}] Loading CareerBuilder homepage...`);
    await page.goto('https://www.careerbuilder.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(randomDelay(2000, 4000));

    // Fill search form
    try {
      const keywordInput = page.locator('[data-testid="combobox"]').first();
      await keywordInput.fill(searchQuery);
      await page.waitForTimeout(1000);

      // Fill location
      const locationInputs = page.locator('input[placeholder*="location"], input[placeholder*="remote"]');
      if (await locationInputs.count() > 0) {
        await locationInputs.first().fill('Remote');
        await page.waitForTimeout(500);
      }

      // Submit search by pressing Enter (more reliable than clicking button)
      await keywordInput.press('Enter');
      await page.waitForURL(/\/jobs/, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(randomDelay(4000, 7000));
    } catch (err) {
      console.error(`[${SOURCE}] Search form interaction failed: ${err.message}`);
    }

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.error(`[${SOURCE}] Page ${pageNum}/${maxPages}: ${page.url()}`);

      try {
        await page.waitForTimeout(randomDelay(2000, 5000));

        // Wait for job listings — try multiple selector strategies
        await page.waitForSelector('a[href*="/job/"], [class*="JobCard"], [class*="job-listing"]', { timeout: 10000 }).catch(() => {});

        const jobs = await page.evaluate(() => {
          const results = [];
          // Primary: links containing /job/ path
          const jobLinks = document.querySelectorAll('a[href*="/job/"]');

          for (const link of jobLinks) {
            try {
              const href = link.getAttribute('href') || '';
              if (!href.includes('/job/')) continue;

              // Get the job card container (parent or grandparent)
              const card = link.closest('li, article, div[class*="Card"], div[class*="listing"]') || link.parentElement;

              const title = link.textContent?.trim() || '';
              // Try to find company and location in siblings/children
              const companyEl = card?.querySelector('[class*="company"], [class*="Company"], [class*="employer"]');
              const locationEl = card?.querySelector('[class*="location"], [class*="Location"]');

              const company = companyEl?.textContent?.trim() || 'Unknown';
              const location = locationEl?.textContent?.trim() || '';
              const url = href.startsWith('http') ? href : `https://www.careerbuilder.com${href}`;

              if (title && title.length > 3 && title.length < 200) {
                results.push({ title, company, location, url });
              }
            } catch { /* skip malformed card */ }
          }
          return results;
        });

        console.error(`[${SOURCE}]   Found ${jobs.length} jobs on page ${pageNum}`);
        allJobs.push(...jobs);

        if (jobs.length === 0) {
          console.error(`[${SOURCE}]   No jobs found — stopping pagination.`);
          break;
        }

        if (pageNum < maxPages) {
          await page.waitForTimeout(randomDelay(4000, 8000));
        }
      } catch (err) {
        console.error(`[${SOURCE}]   Page ${pageNum} error: ${err.message}`);
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
  const jobs = await scrapeCareerBuilder(query);
  const fresh = jobs.filter(j => j.url && !seen.has(j.url)).slice(0, limit);

  if (jsonMode) {
    process.stdout.write(JSON.stringify(fresh));
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
    appendAutomationEvent(ROOT, {
      type: 'scanner.careerbuilder.completed',
      status: 'success',
      summary: `CareerBuilder scan: ${fresh.length} new jobs for "${query}"`,
      details: { query, newCount: fresh.length, totalFound: jobs.length, pages: maxPages },
    });
    console.log(`Written ${fresh.length} entries to pipeline.md`);
  }
})();
