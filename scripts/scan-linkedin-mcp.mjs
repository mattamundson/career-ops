#!/usr/bin/env node
/**
 * scan-linkedin-mcp.mjs — LinkedIn job scanner via MCP server
 *
 * Requires: stickerdaniel/linkedin-mcp-server configured in .mcp.json
 * Auth: Run `uvx linkedin-scraper-mcp@latest --login` once to authenticate.
 *
 * This script is designed to be called from auto-scan.mjs as a direct board scanner.
 * When called with --json flag, outputs JSON array of job objects to stdout.
 *
 * Usage:
 *   node scripts/scan-linkedin-mcp.mjs [--query "data architect"] [--limit 50] [--json] [--live]
 *
 * ToS Risk: Uses browser automation against LinkedIn. Account restriction possible.
 * See docs/tos-risk-register.md for risk assessment.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const jsonMode = args.includes('--json');
const queryIdx = args.indexOf('--query');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 50;

const SOURCE = 'linkedin-mcp';

// Default queries matching portals.yml title_filter.positive top keywords
const DEFAULT_QUERIES = [
  'power bi developer',
  'bi architect',
  'microsoft fabric',
  'analytics engineer',
  'data architect',
  'reports developer',
  'business intelligence developer',
  'solutions architect data',
];

const customQuery = queryIdx >= 0 ? args[queryIdx + 1] : null;
const queries = customQuery ? [customQuery] : DEFAULT_QUERIES;

/**
 * Attempt to call LinkedIn MCP search_jobs tool via child process.
 * Falls back gracefully if MCP server is not available.
 */
async function searchLinkedInJobs(query) {
  // The LinkedIn MCP server exposes tools via the MCP protocol.
  // When called from Claude Code, these tools are available natively.
  // For standalone execution, we use the MCP client approach.
  try {
    const { execFileSync } = await import('child_process');

    // Try uvx-based MCP tool call
    // The MCP server must be running. We'll attempt a direct HTTP call
    // to the MCP server if it's running locally, or fall back to
    // a Playwright-based search as a backup.

    // For auto-scan integration: this script outputs JSON to stdout
    // when called with --json. The actual MCP tool calls happen
    // when this scanner is invoked through Claude Code's MCP integration.

    // Standalone mode: use the search URL pattern
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&f_WT=2&sortBy=DD`;

    console.error(`[${SOURCE}] Query: "${query}" → ${searchUrl}`);
    console.error(`[${SOURCE}] Note: Full MCP integration requires Claude Code session with linkedin MCP server active.`);
    console.error(`[${SOURCE}] For standalone use, configure ENABLE_LINKEDIN_SCRAPE=1 and use scan-linkedin-direct.mjs`);

    return [];
  } catch (err) {
    console.error(`[${SOURCE}] Error searching for "${query}": ${err.message}`);
    return [];
  }
}

/**
 * Main scanner entry point.
 * When MCP server is active in Claude Code, this script will be enhanced
 * to use the native MCP tools (search_jobs, get_job_details).
 *
 * For now, this serves as the integration scaffold that auto-scan.mjs
 * can call, and outputs structured results when jobs are found.
 */
async function main() {
  const seen = loadSeenUrls();
  const allJobs = [];

  for (const query of queries) {
    const jobs = await searchLinkedInJobs(query);
    for (const job of jobs) {
      if (job.url && !seen.has(job.url)) {
        allJobs.push({
          url: job.url,
          title: job.title || 'Untitled',
          company: job.company || 'Unknown',
          location: job.location || 'Remote',
          source: SOURCE,
          posted_at: job.posted_at || '',
        });
      }
    }
  }

  const fresh = allJobs.slice(0, limit);

  if (jsonMode) {
    // Output for auto-scan.mjs consumption
    process.stdout.write(JSON.stringify(fresh));
    return;
  }

  console.log(`[${SOURCE}] ${fresh.length} new jobs found (${allJobs.length} total across ${queries.length} queries)`);

  if (dryRun) {
    console.log('DRY-RUN — not writing');
    fresh.slice(0, 5).forEach(j => console.log(JSON.stringify(j)));
    return;
  }

  if (fresh.length > 0) {
    appendScanResults(fresh, { portal: `direct/${SOURCE}` });
    appendAutomationEvent(ROOT, {
      type: 'scanner.linkedin_mcp.completed',
      status: 'success',
      summary: `LinkedIn MCP scan: ${fresh.length} new jobs added from ${queries.length} queries`,
      details: { queries, newCount: fresh.length, totalFound: allJobs.length },
    });
    console.log(`Written ${fresh.length} entries to pipeline.md`);
  }
}

main().catch(err => {
  console.error(`[${SOURCE}] Fatal: ${err.message}`);
  if (jsonMode) process.stdout.write('[]');
  process.exit(1);
});
