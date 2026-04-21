#!/usr/bin/env node
/**
 * scan-linkedin-mcp.mjs — LinkedIn job scanner via stickerdaniel/linkedin-mcp-server
 *
 * Spawns `uvx linkedin-scraper-mcp@latest` as a child process, talks MCP over
 * JSON-RPC stdio, and calls the `search_jobs` tool. Requires an authenticated
 * LinkedIn session on the first run (the server will launch a headful
 * Chromium window; user must sign in to linkedin.com there). Session persists
 * to ~/.linkedin-mcp/ between runs.
 *
 * Priority (config/profile.yml work_modes): on-site MSP > hybrid MSP > remote.
 * Default location is Minneapolis MN (surfaces on-site + hybrid first). Pass
 * --location=Remote to scan the remote bucket instead.
 *
 * Usage:
 *   node scripts/scan-linkedin-mcp.mjs [--query "data architect"] [--location "Minneapolis, MN"]
 *                                      [--limit 50] [--json] [--live]
 *
 * ToS Risk: browser automation against LinkedIn. Account restriction possible.
 * See docs/tos-risk-register.md.
 */

import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync, rmSync, existsSync } from 'fs';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { McpClient, parseJsonTextContent } from './lib/mcp-client.mjs';
import { isMainEntry } from './lib/main-entry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const MCP_HOME = join(homedir(), '.linkedin-mcp');
const KEEP_SNAPSHOTS = 1;

const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const jsonMode = args.includes('--json');
const queryIdx = args.indexOf('--query');
const locationIdx = args.indexOf('--location');
const location = locationIdx >= 0 ? args[locationIdx + 1] : 'Minneapolis, Minnesota, United States';
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 50;

const SOURCE = 'linkedin-mcp';

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

// --- Response parsing -----------------------------------------------------

function parseJobsFromMcpResponse(data) {
  const jobIds = Array.isArray(data.job_ids) ? data.job_ids : [];
  const refs = (data.references && data.references.search_results) || [];
  const text = (data.sections && data.sections.search_results) || '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  return jobIds.map(id => {
    const ref = refs.find(r => r.kind === 'job' && r.url && r.url.includes(id));
    const rawTitle = ref?.text || 'Untitled';
    const title = rawTitle.replace(/\s+with verification$/i, '').trim();

    // Company: scan the unstructured text block for the title line, then take
    // the line after the possibly-duplicated title row. Fallback to "LinkedIn".
    let company = 'LinkedIn';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === title) {
        const next = lines[i + 1];
        if (next && (next === title || next === rawTitle)) {
          company = lines[i + 2] || 'LinkedIn';
        } else if (next) {
          company = next;
        }
        break;
      }
    }

    return {
      url: `https://www.linkedin.com/jobs/view/${id}`,
      title,
      company,
      location,
    };
  });
}

function isSessionError(msg) {
  return /no valid LinkedIn session|login.*progress|setup is not complete|not authenticated/i.test(msg);
}

function isProfileLockError(msg) {
  return /WinError 32|WinError 5|PermissionError|being used by another process|Stored runtime profile is invalid/i.test(msg);
}

// --- Preflight cleanup ----------------------------------------------------

function killStaleLinkedInChrome() {
  if (process.platform !== 'win32') return { killed: 0, skipped: true };
  try {
    const psCmd = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*linkedin-mcp*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId } | Measure-Object | Select-Object -ExpandProperty Count`;
    const out = execSync(`powershell.exe -NoProfile -Command "${psCmd}"`, { encoding: 'utf-8', timeout: 15000 });
    const killed = parseInt(out.trim()) || 0;
    if (killed > 0) {
      console.error(`[${SOURCE}] preflight: killed ${killed} stale Chrome process(es) on linkedin-mcp profile`);
    }
    return { killed, skipped: false };
  } catch (err) {
    console.error(`[${SOURCE}] preflight: kill-stale-chrome failed (non-fatal): ${err.message}`);
    return { killed: 0, skipped: false, error: err.message };
  }
}

function pruneInvalidStateSnapshots() {
  if (!existsSync(MCP_HOME)) return { pruned: 0, bytes: 0 };
  try {
    const entries = readdirSync(MCP_HOME)
      .filter((n) => n.startsWith('invalid-state-'))
      .map((n) => ({ name: n, path: join(MCP_HOME, n), mtime: statSync(join(MCP_HOME, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const toDelete = entries.slice(KEEP_SNAPSHOTS);
    let bytes = 0;
    for (const e of toDelete) {
      try {
        const size = dirSizeBytes(e.path);
        rmSync(e.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        bytes += size;
      } catch (err) {
        console.error(`[${SOURCE}] preflight: could not remove ${e.name}: ${err.message}`);
      }
    }
    if (toDelete.length > 0) {
      console.error(`[${SOURCE}] preflight: pruned ${toDelete.length} invalid-state snapshot(s) (${(bytes / 1e6).toFixed(0)}MB reclaimed, kept ${Math.min(KEEP_SNAPSHOTS, entries.length)})`);
    }
    return { pruned: toDelete.length, bytes };
  } catch (err) {
    console.error(`[${SOURCE}] preflight: snapshot prune failed (non-fatal): ${err.message}`);
    return { pruned: 0, bytes: 0, error: err.message };
  }
}

function dirSizeBytes(path) {
  let total = 0;
  try {
    for (const name of readdirSync(path)) {
      const p = join(path, name);
      const st = statSync(p);
      total += st.isDirectory() ? dirSizeBytes(p) : st.size;
    }
  } catch { /* swallow — size is advisory only */ }
  return total;
}

function preflight() {
  killStaleLinkedInChrome();
  pruneInvalidStateSnapshots();
}

// --- Main ------------------------------------------------------------------

async function runQueries(seen, allJobs, errors) {
  const client = new McpClient('uvx', ['linkedin-scraper-mcp@latest'], { stderrPrefix: 'mcp:linkedin' });
  let profileLockHit = false;
  try {
    for (const query of queries) {
      try {
        const result = await client.callTool('search_jobs', {
          keywords: query,
          location,
          date_posted: 'past_24_hours',
          max_pages: 1,
        });
        const data = parseJsonTextContent(result);
        if (!data) {
          console.error(`[${SOURCE}] empty or non-JSON content for "${query}"`);
          continue;
        }
        const jobs = parseJobsFromMcpResponse(data);
        for (const j of jobs) {
          if (!seen.has(j.url)) allJobs.push(j);
        }
        console.error(`[${SOURCE}] query="${query}" → ${jobs.length} results (${allJobs.length} new total)`);
      } catch (err) {
        errors.push({ query, error: err.message });
        if (isProfileLockError(err.message)) {
          console.error(`[${SOURCE}] profile lock detected on "${query}" — aborting batch for retry`);
          profileLockHit = true;
          break;
        }
        if (isSessionError(err.message)) {
          console.error(`[${SOURCE}] session not ready — authenticate the uvx server first (it launches a login browser on first call). Aborting.`);
          break;
        }
        console.error(`[${SOURCE}] error on "${query}": ${err.message}`);
      }
    }
  } finally {
    client.close();
  }
  return { profileLockHit };
}

async function main() {
  preflight();

  const seen = loadSeenUrls();
  const allJobs = [];
  const errors = [];

  let { profileLockHit } = await runQueries(seen, allJobs, errors);

  if (profileLockHit && allJobs.length === 0) {
    console.error(`[${SOURCE}] retry #1 after profile lock — cleaning up and waiting 5s`);
    preflight();
    await new Promise((r) => setTimeout(r, 5000));
    const retry = await runQueries(seen, allJobs, errors);
    profileLockHit = retry.profileLockHit;
    if (profileLockHit && allJobs.length === 0) {
      console.error(`[${SOURCE}] retry failed — giving up. JobSpy + Firecrawl queries cover LinkedIn coverage for this run.`);
    }
  }

  const fresh = allJobs.slice(0, limit);

  if (jsonMode) {
    process.stdout.write(JSON.stringify(fresh));
    return;
  }

  console.log(`[${SOURCE}] ${fresh.length} new jobs found (${allJobs.length} candidates across ${queries.length} queries, ${errors.length} query errors)`);

  if (dryRun) {
    console.log('DRY-RUN — not writing');
    fresh.slice(0, 5).forEach(j => console.log(JSON.stringify(j)));
    return;
  }

  if (fresh.length > 0) {
    appendScanResults(fresh, { portal: `direct/${SOURCE}`, status: 'added' });
    appendAutomationEvent(ROOT, {
      type: 'scanner.linkedin_mcp.completed',
      status: errors.length ? 'partial' : 'success',
      summary: `LinkedIn MCP scan: ${fresh.length} new jobs from ${queries.length} queries`,
      details: { queries, newCount: fresh.length, totalFound: allJobs.length, errors },
    });
    console.log(`Written ${fresh.length} entries to pipeline.md`);
  }
}

export { main, preflight, killStaleLinkedInChrome, pruneInvalidStateSnapshots, isProfileLockError };

if (isMainEntry(import.meta.url)) {
  main().catch(err => {
    console.error(`[${SOURCE}] Fatal: ${err.message}`);
    if (jsonMode) process.stdout.write('[]');
    process.exit(1);
  });
}
