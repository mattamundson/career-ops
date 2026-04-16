#!/usr/bin/env node
/**
 * resolve-aggregator-urls.mjs — Resolves LinkedIn/Indeed aggregator URLs to actual ATS apply pages
 *
 * Many job listings in apply-queue.md point to LinkedIn or Indeed pages instead of
 * the company's actual ATS (Greenhouse, Lever, Ashby, etc.). This script follows
 * the "Apply on company website" links to extract the real ATS URL.
 *
 * Usage:
 *   node scripts/resolve-aggregator-urls.mjs [--apply] [--limit 10]
 *
 * Default: dry-run (reports what would be resolved).
 * --apply: Actually updates apply-queue.md with resolved URLs.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
const applyChanges = args.includes('--apply');
const limitIdx = args.indexOf('--limit');
const maxResolve = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 10;

const APPLY_QUEUE = resolve(ROOT, 'data', 'apply-queue.md');

// Known ATS domains that indicate a resolved URL
const ATS_DOMAINS = [
  'greenhouse.io', 'boards.greenhouse.io', 'job-boards.greenhouse.io',
  'lever.co', 'jobs.lever.co',
  'ashbyhq.com', 'jobs.ashbyhq.com',
  'myworkdayjobs.com',
  'icims.com',
  'smartrecruiters.com', 'jobs.smartrecruiters.com',
  'workable.com', 'apply.workable.com',
  'bamboohr.com',
  'recruitee.com',
  'jobvite.com',
  'ultipro.com',
  'taleo.net',
];

function isAggregatorUrl(url) {
  return /linkedin\.com\/jobs/i.test(url) || /indeed\.com\/(viewjob|jobs)/i.test(url);
}

function detectAtsType(url) {
  for (const domain of ATS_DOMAINS) {
    if (url.includes(domain)) return domain.split('.')[0];
  }
  return 'unknown';
}

function extractAggregatorUrls(text) {
  const urls = [];
  for (const line of text.split('\n')) {
    const match = line.match(/(https?:\/\/(?:www\.)?(?:linkedin\.com\/jobs\/view\/\S+|indeed\.com\/viewjob\S+))/i);
    if (match) {
      urls.push({ url: match[1], line });
    }
  }
  return urls;
}

async function resolveUrl(page, aggregatorUrl) {
  const result = { original: aggregatorUrl, resolved: null, atsType: null, error: null };

  try {
    await page.goto(aggregatorUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000 + Math.random() * 3000);

    // Look for "Apply on company website" or external apply link
    const externalUrl = await page.evaluate(() => {
      // LinkedIn: "Apply on company site" button
      const linkedInApply = document.querySelector(
        'a[data-tracking-control-name*="apply"], ' +
        'button[aria-label*="Apply on company"], ' +
        'a[href*="greenhouse"], a[href*="lever.co"], a[href*="ashby"], ' +
        'a[href*="workday"], a[href*="icims"], a[href*="smartrecruiters"]'
      );
      if (linkedInApply) {
        return linkedInApply.getAttribute('href') || null;
      }

      // Indeed: "Apply on company site" link
      const indeedApply = document.querySelector(
        '#applyButtonLinkContainer a, ' +
        'a[href*="greenhouse"], a[href*="lever.co"], a[href*="ashby"], ' +
        'a[href*="workday"], a[href*="icims"]'
      );
      if (indeedApply) {
        return indeedApply.getAttribute('href') || null;
      }

      // Check all links for known ATS domains
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        if (/(greenhouse|lever\.co|ashby|workday|icims|smartrecruiters)/i.test(href)) {
          return href;
        }
      }

      return null;
    });

    const AUTH_WALL_RE = /\/(signup|login|authwall|m\/login|uas\/login|checkpoint|cold-join)/i;

    if (externalUrl) {
      if (AUTH_WALL_RE.test(externalUrl)) {
        result.error = 'auth-required (try LinkedIn MCP get_job_details)';
      } else {
        // Follow the link to get the final URL (after redirects)
        try {
          await page.goto(externalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          const finalUrl = page.url();
          const atsType = detectAtsType(finalUrl);
          if (atsType === 'unknown' || AUTH_WALL_RE.test(finalUrl)) {
            // Landed on another auth wall or non-ATS domain — reject
            result.error = 'auth-required (try LinkedIn MCP get_job_details)';
          } else {
            result.resolved = finalUrl;
            result.atsType = atsType;
          }
        } catch {
          // Navigation failed — only accept the extracted URL if it's a known ATS
          const atsType = detectAtsType(externalUrl);
          if (atsType !== 'unknown') {
            result.resolved = externalUrl;
            result.atsType = atsType;
          } else {
            result.error = 'navigation-failed';
          }
        }
      }
    } else {
      result.error = 'no-external-apply-link';
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

async function main() {
  if (!existsSync(APPLY_QUEUE)) {
    console.log('No apply-queue.md found.');
    return;
  }

  const text = readFileSync(APPLY_QUEUE, 'utf8');
  const aggregatorUrls = extractAggregatorUrls(text);

  if (aggregatorUrls.length === 0) {
    console.log('No LinkedIn/Indeed aggregator URLs found in apply-queue.md');
    return;
  }

  console.log(`Found ${aggregatorUrls.length} aggregator URLs in apply-queue.md`);
  console.log(`Resolving up to ${maxResolve}...`);
  console.log('');

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Playwright not installed. Run: pnpm add playwright');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const results = [];
  const toResolve = aggregatorUrls.slice(0, maxResolve);

  for (let i = 0; i < toResolve.length; i++) {
    const { url, line } = toResolve[i];
    console.log(`[${i + 1}/${toResolve.length}] Resolving: ${url}`);

    const result = await resolveUrl(page, url);
    results.push(result);

    if (result.resolved) {
      console.log(`  ✅ → ${result.resolved} (${result.atsType})`);
    } else {
      console.log(`  ❌ ${result.error || 'Could not resolve'}`);
    }

    // Rate limit between resolutions
    if (i < toResolve.length - 1) {
      await page.waitForTimeout(3000 + Math.random() * 4000);
    }
  }

  await context.close();
  await browser.close();

  // Summary
  console.log('');
  console.log('━'.repeat(50));
  const resolved = results.filter(r => r.resolved);
  const failed = results.filter(r => !r.resolved);
  console.log(`Resolved: ${resolved.length} / ${results.length}`);
  console.log(`Failed:   ${failed.length}`);

  if (resolved.length > 0) {
    console.log('');
    console.log('Resolved mappings:');
    for (const r of resolved) {
      console.log(`  ${r.original}`);
      console.log(`  → ${r.resolved} [${r.atsType}]`);
    }
  }

  // Apply changes to apply-queue.md
  if (applyChanges && resolved.length > 0) {
    let updatedText = text;
    for (const r of resolved) {
      updatedText = updatedText.replace(r.original, r.resolved);
    }
    writeFileSync(APPLY_QUEUE, updatedText, 'utf8');
    console.log('');
    console.log(`✅ Updated ${resolved.length} URLs in apply-queue.md`);

    appendAutomationEvent(ROOT, {
      type: 'resolver.aggregator_urls.completed',
      status: 'success',
      summary: `Resolved ${resolved.length}/${results.length} aggregator URLs`,
      details: {
        resolved: resolved.map(r => ({ from: r.original, to: r.resolved, ats: r.atsType })),
        failed: failed.map(r => ({ url: r.original, error: r.error })),
      },
    });
  } else if (!applyChanges && resolved.length > 0) {
    console.log('');
    console.log('DRY-RUN — use --apply to update apply-queue.md');
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
