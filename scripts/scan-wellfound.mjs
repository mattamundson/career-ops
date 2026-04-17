#!/usr/bin/env node
/**
 * scan-wellfound.mjs — Wellfound (formerly AngelList) job scanner via Playwright
 *
 * Wellfound is a React SPA that uses infinite scroll for job listings.
 * Previous version returned pagination pages — this rewrite handles client-side rendering.
 *
 * Usage:
 *   node scripts/scan-wellfound.mjs [--query "data architect"] [--limit 50] [--scroll-cycles 5] [--json] [--live]
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
const scrollIdx = args.indexOf('--scroll-cycles');
const scrollCycles = scrollIdx >= 0 ? parseInt(args[scrollIdx + 1]) : 5;

const SOURCE = 'wellfound';

function randomDelay(min = 2000, max = 5000) {
  return Math.floor(Math.random() * (max - min) + min);
}

async function scrapeWellfound(searchQuery) {
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

    const url = `https://wellfound.com/jobs?remote=true&role=${encodeURIComponent(searchQuery)}`;
    console.error(`[${SOURCE}] Loading: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    // Scroll to load more results (infinite scroll)
    let prevCount = 0;
    for (let cycle = 0; cycle < scrollCycles; cycle++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(randomDelay(2000, 4000));

      const currentCount = await page.evaluate(() =>
        document.querySelectorAll('[class*="styles_jobCard"], [class*="JobCard"], a[href*="/jobs/"]').length
      );

      console.error(`[${SOURCE}]   Scroll ${cycle + 1}/${scrollCycles}: ${currentCount} job cards loaded`);

      if (currentCount === prevCount) {
        console.error(`[${SOURCE}]   No new jobs loaded — stopping scroll.`);
        break;
      }
      prevCount = currentCount;
    }

    // Extract job listings
    const jobs = await page.evaluate(() => {
      const results = [];
      // Wellfound job cards — try multiple selector strategies
      const cards = document.querySelectorAll(
        '[class*="styles_jobCard"], [class*="JobCard"], [class*="job-listing"]'
      );

      for (const card of cards) {
        try {
          const titleEl = card.querySelector('h2, [class*="Title"], [class*="title"] a');
          const companyEl = card.querySelector('[class*="Company"], [class*="company"], h3');
          const locationEl = card.querySelector('[class*="Location"], [class*="location"]');
          const linkEl = card.querySelector('a[href*="/jobs/"]') || card.closest('a[href*="/jobs/"]');
          const salaryEl = card.querySelector('[class*="Salary"], [class*="salary"], [class*="compensation"]');

          if (!titleEl && !linkEl) continue;

          const title = titleEl?.textContent?.trim() || linkEl?.textContent?.trim() || '';
          const company = companyEl?.textContent?.trim() || 'Unknown';
          const location = locationEl?.textContent?.trim() || 'Remote';
          const salary = salaryEl?.textContent?.trim() || '';

          let url = '';
          if (linkEl) {
            const href = linkEl.getAttribute('href') || '';
            url = href.startsWith('http') ? href : `https://wellfound.com${href}`;
          }

          if (title && url) {
            results.push({ title, company, location, url, salary });
          }
        } catch { /* skip malformed card */ }
      }

      // Fallback: extract from any job-related links
      if (results.length === 0) {
        const links = document.querySelectorAll('a[href*="/jobs/"]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          if (href.includes('/jobs/') && !href.endsWith('/jobs') && !href.includes('page')) {
            const title = link.textContent?.trim() || '';
            const url = href.startsWith('http') ? href : `https://wellfound.com${href}`;
            if (title && title.length > 5 && title.length < 200) {
              results.push({ title, company: 'Unknown', location: 'Remote', url });
            }
          }
        }
      }

      return results;
    });

    console.error(`[${SOURCE}]   Total extracted: ${jobs.length} jobs`);
    allJobs.push(...jobs);

    await context.close();
  } finally {
    await browser.close();
  }

  return allJobs;
}

(async () => {
  const seen = loadSeenUrls();
  const jobs = await scrapeWellfound(query);
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
      type: 'scanner.wellfound.completed',
      status: 'success',
      summary: `Wellfound scan: ${fresh.length} new jobs for "${query}"`,
      details: { query, newCount: fresh.length, totalFound: jobs.length, scrollCycles },
    });
    console.log(`Written ${fresh.length} entries to pipeline.md`);
  }
})();
