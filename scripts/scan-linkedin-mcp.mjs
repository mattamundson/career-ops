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
 * Usage:
 *   node scripts/scan-linkedin-mcp.mjs [--query "data architect"] [--limit 50] [--json] [--live]
 *
 * ToS Risk: browser automation against LinkedIn. Account restriction possible.
 * See docs/tos-risk-register.md.
 */

import { spawn } from 'child_process';
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

// --- MCP stdio JSON-RPC client -------------------------------------------

class McpClient {
  constructor(cmd, cmdArgs) {
    this.proc = spawn(cmd, cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.pending = new Map();
    this.nextId = 1;
    this.initialized = false;
    this.closed = false;
    this.proc.stdout.on('data', d => this._onData(d));
    this.proc.stderr.on('data', d => {
      const text = d.toString();
      // MCP servers often emit startup diagnostics to stderr; don't dump verbatim
      for (const line of text.split('\n')) {
        if (line.trim() && !/^(INFO|DEBUG)/i.test(line)) {
          process.stderr.write(`[mcp:linkedin] ${line}\n`);
        }
      }
    });
    this.proc.on('exit', code => {
      this.closed = true;
      for (const { reject } of this.pending.values()) {
        reject(new Error(`MCP server exited (code ${code}) before response`));
      }
      this.pending.clear();
    });
    this.proc.on('error', err => {
      this.closed = true;
      console.error(`[mcp:linkedin] spawn error: ${err.message}`);
    });
  }

  _onData(data) {
    this.buffer += data.toString();
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message || JSON.stringify(msg.error))) : res(msg.result);
      }
    }
  }

  request(method, params, timeoutMs = 60000) {
    if (this.closed) return Promise.reject(new Error('MCP client closed'));
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); res(v); },
        reject: e => { clearTimeout(timer); rej(e); },
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
    });
  }

  notify(method, params) {
    if (this.closed) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n');
  }

  async init() {
    if (this.initialized) return;
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'career-ops-scan-linkedin-mcp', version: '1.0' },
    });
    this.notify('notifications/initialized');
    this.initialized = true;
  }

  async callTool(name, toolArgs, timeoutMs = 90000) {
    await this.init();
    return this.request('tools/call', { name, arguments: toolArgs }, timeoutMs);
  }

  close() {
    if (!this.closed) {
      try { this.proc.kill(); } catch { /* noop */ }
    }
    this.closed = true;
  }
}

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
      location: 'Remote',
    };
  });
}

function isSessionError(msg) {
  return /no valid LinkedIn session|login.*progress|setup is not complete|not authenticated/i.test(msg);
}

// --- Main ------------------------------------------------------------------

async function main() {
  const seen = loadSeenUrls();
  const allJobs = [];
  const errors = [];

  const client = new McpClient('uvx', ['linkedin-scraper-mcp@latest']);

  try {
    for (const query of queries) {
      try {
        const result = await client.callTool('search_jobs', {
          keywords: query,
          location: 'Remote',
          date_posted: 'past_24_hours',
          max_pages: 1,
        });
        const contentText = result?.content?.[0]?.text;
        if (!contentText) {
          console.error(`[${SOURCE}] empty content for "${query}"`);
          continue;
        }
        let data;
        try {
          data = JSON.parse(contentText);
        } catch {
          console.error(`[${SOURCE}] non-JSON content for "${query}"`);
          continue;
        }
        const jobs = parseJobsFromMcpResponse(data);
        for (const j of jobs) {
          if (!seen.has(j.url)) allJobs.push(j);
        }
        console.error(`[${SOURCE}] query="${query}" → ${jobs.length} results (${allJobs.length} new total)`);
      } catch (err) {
        errors.push({ query, error: err.message });
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

main().catch(err => {
  console.error(`[${SOURCE}] Fatal: ${err.message}`);
  if (jsonMode) process.stdout.write('[]');
  process.exit(1);
});
