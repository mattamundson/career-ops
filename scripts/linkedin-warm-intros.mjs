#!/usr/bin/env node
/**
 * linkedin-warm-intros.mjs — surface 1st/2nd-degree LinkedIn contacts at the
 * target company for strong-fit evaluations.
 *
 * Task 7 of the 2026-04-17 top-10 ROI plan: warm intros convert 5-10× colder
 * apps. For every evaluation scoring >= 3.5, we try to query the LinkedIn MCP
 * for Matt's network at that company and append a "## Warm intros" section to
 * the evaluation report.
 *
 * Design constraints:
 * - Graceful degradation: if MCP isn't authed or the expected tool isn't
 *   exposed, write a clear "unavailable" section rather than failing the run.
 * - No rate hammering: one query per invocation, respects the LinkedIn MCP
 *   policy in docs/POLICY-mcp-dependencies.md.
 * - Skips entirely if score < 3.5 -- don't waste MCP quota on weak fits.
 *
 * Usage:
 *   node scripts/linkedin-warm-intros.mjs --report=reports/013-acme-2026-04-21.md --company="Acme" --score=4.0
 *   node scripts/linkedin-warm-intros.mjs --company="Acme" --dry-run    # prints planned query, no MCP call
 *
 * Flags:
 *   --report=<path>   (optional) Report to append to. Without this, prints to stdout.
 *   --company=<name>  (required) Target company name.
 *   --score=<n>       (optional) Eval score. Skips when < 3.5 (silent success).
 *   --max=<n>         Max intros to surface (default 5).
 *   --dry-run         Print the planned query + tool selection; do not call MCP.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { McpClient, parseJsonTextContent } from './lib/mcp-client.mjs';
import { isMainEntry } from './lib/main-entry.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const MIN_SCORE_FOR_LOOKUP = 3.5;
const DEFAULT_MAX_INTROS = 5;
const WARM_INTRO_SECTION_HEADER = '## Warm intros';

function parseArgs(argv) {
  const out = { report: null, company: null, score: null, max: DEFAULT_MAX_INTROS, dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--report=')) out.report = arg.slice('--report='.length);
    else if (arg.startsWith('--company=')) out.company = arg.slice('--company='.length);
    else if (arg.startsWith('--score=')) out.score = parseFloat(arg.slice('--score='.length));
    else if (arg.startsWith('--max=')) out.max = parseInt(arg.slice('--max='.length), 10) || DEFAULT_MAX_INTROS;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for tests
// ---------------------------------------------------------------------------

/**
 * Pick the best matching tool from an MCP tools/list result for the
 * "find people at company" use case. Returns the tool name or null.
 * Tools are server-specific: stickerdaniel's linkedin-mcp-server exposes
 * get_person_profile + search variants; other servers use different names.
 * We match on tool name patterns rather than hard-coding.
 */
export function pickPeopleSearchTool(toolsList) {
  if (!toolsList || !Array.isArray(toolsList.tools)) return null;
  const names = toolsList.tools.map((t) => t.name || '');
  // Priority order: specific network search > generic people search > profile lookup
  const patterns = [
    /search.*people.*network/i,
    /search.*connections/i,
    /network.*search/i,
    /search.*people/i,
    /find.*people/i,
    /people.*at.*company/i,
  ];
  for (const pattern of patterns) {
    const match = names.find((n) => pattern.test(n));
    if (match) return match;
  }
  return null;
}

/**
 * Build tool-specific call arguments. Different LinkedIn MCP servers expose
 * search tools with varying argument shapes. We match on tool name + schema
 * (when available) and fall back to a safe default.
 *
 * Known servers:
 * - linkedin-scraper-mcp (stickerdaniel): search_people takes { keywords, location? }
 *   with no company or limit params — we client-side truncate after the call.
 * - Other servers may expose { company, limit } directly.
 */
export function buildSearchArgs(toolName, toolSchema, { company, max }) {
  const props = toolSchema?.properties || {};
  const args = {};
  if ('keywords' in props) {
    args.keywords = company;
  } else if ('company' in props) {
    args.company = company;
  } else if ('query' in props) {
    args.query = company;
  } else {
    args.keywords = company;
  }
  if ('limit' in props && Number.isFinite(max)) args.limit = max;
  if ('max_results' in props && Number.isFinite(max)) args.max_results = max;
  return args;
}

/**
 * Render the warm-intros markdown block. Exported for testability.
 */
export function renderWarmIntrosSection(intros, { company, source = 'linkedin-mcp', note = null }) {
  const lines = [WARM_INTRO_SECTION_HEADER, ''];
  if (note) {
    lines.push(`_${note}_`, '');
    lines.push(`Manual fallback: use \`/contact\` mode with company="${company}" to draft outreach.`, '');
    return lines.join('\n');
  }
  if (!intros || intros.length === 0) {
    lines.push(`_No 1st/2nd-degree LinkedIn contacts found at **${company}** via ${source}._`);
    lines.push('');
    lines.push(`If this feels wrong, try manually: LinkedIn → Search "${company}" → People → filter by "Connections: 1st, 2nd".`);
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`Source: ${source} | Company: **${company}** | Matches: ${intros.length}`);
  lines.push('');
  lines.push('| Name | Title | Network | Profile |');
  lines.push('|------|-------|---------|---------|');
  for (const p of intros) {
    const name = p.name || '(no name)';
    const title = p.title || p.headline || '';
    const network = p.degree || p.network || '';
    const url = p.url || p.profile_url || '';
    const urlCell = url ? `[link](${url})` : '';
    lines.push(`| ${name} | ${title} | ${network} | ${urlCell} |`);
  }
  lines.push('');
  lines.push(`_Suggested next step: pick one and run \`/contact\` mode (scenario=referral or hiring-manager)._`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Insert or replace the "## Warm intros" section in a report's markdown.
 * Replaces an existing section if present to keep runs idempotent.
 */
export function upsertWarmIntrosSection(reportText, section) {
  // Match an existing "## Warm intros" section up to the next "## " heading or EOF.
  // JS regex has no \z — use a negative lookahead for any remaining char to terminate at EOF.
  const headerRe = /^## Warm intros\b[\s\S]*?(?=^## |(?![\s\S]))/m;
  if (headerRe.test(reportText)) {
    return reportText.replace(headerRe, section.endsWith('\n') ? section : section + '\n');
  }
  // Insert before a trailing fence if the report ends with "---\n*Inspired by..." or "---\nInspired by..."
  const trailingMatch = reportText.match(/\n---\s*\n\*?Inspired by[\s\S]*$/);
  if (trailingMatch) {
    const trailing = trailingMatch[0];
    const head = reportText.slice(0, reportText.length - trailing.length);
    return head.trimEnd() + '\n\n' + section + trailing;
  }
  return reportText.trimEnd() + '\n\n' + section;
}

/**
 * Normalize a tool-call result into a clean intros array.
 * MCP servers return varied shapes; we accept either `{ content: [{ text: JSON }] }`
 * or a bare array / object. Truncates to max.
 */
export function normalizeIntros(raw, { max = DEFAULT_MAX_INTROS } = {}) {
  if (!raw) return [];
  let items = raw;
  if (raw.content) {
    const parsed = parseJsonTextContent(raw);
    items = parsed;
  }
  if (Array.isArray(items?.people)) items = items.people;
  else if (Array.isArray(items?.results)) items = items.results;
  if (!Array.isArray(items)) return [];
  return items.slice(0, max).map((p) => ({
    name: p.name || p.full_name || p.display_name || null,
    title: p.title || p.headline || p.current_title || null,
    degree: p.degree || p.network_distance || p.connection_degree || null,
    url: p.url || p.profile_url || p.link || null,
  }));
}

// ---------------------------------------------------------------------------
// MCP orchestration
// ---------------------------------------------------------------------------

async function fetchWarmIntros({ company, max }) {
  const client = new McpClient('uvx', ['linkedin-scraper-mcp@4.9.3'], { stderrPrefix: 'mcp:linkedin' });
  try {
    const tools = await client.listTools();
    const toolName = pickPeopleSearchTool(tools);
    if (!toolName) {
      return {
        ok: false,
        reason: 'no people-search tool exposed by linkedin-scraper-mcp',
        toolsAvailable: (tools?.tools || []).map((t) => t.name).slice(0, 10),
      };
    }
    const toolSchema = (tools?.tools || []).find((t) => t.name === toolName)?.inputSchema;
    const callArgs = buildSearchArgs(toolName, toolSchema, { company, max });
    const result = await client.callTool(toolName, callArgs, 60000);
    const intros = normalizeIntros(result, { max });
    return { ok: true, intros, toolName };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.company) {
    console.error('Error: --company=<name> is required');
    process.exit(1);
  }
  if (opts.score !== null && Number.isFinite(opts.score) && opts.score < MIN_SCORE_FOR_LOOKUP) {
    console.log(`[warm-intros] score ${opts.score} below threshold ${MIN_SCORE_FOR_LOOKUP}, skipping.`);
    return;
  }

  if (opts.dryRun) {
    console.log(`[warm-intros] DRY-RUN — would query linkedin-scraper-mcp for people at "${opts.company}" (max=${opts.max})`);
    return;
  }

  const result = await fetchWarmIntros({ company: opts.company, max: opts.max });
  let section;
  if (!result.ok) {
    section = renderWarmIntrosSection(null, {
      company: opts.company,
      note: `LinkedIn MCP unavailable: ${result.reason}`,
    });
    console.warn(`[warm-intros] MCP query failed: ${result.reason}`);
    appendAutomationEvent(ROOT, {
      type: 'warm_intros_query_failed',
      company: opts.company,
      reason: result.reason,
    });
  } else {
    section = renderWarmIntrosSection(result.intros, {
      company: opts.company,
      source: `linkedin-mcp via ${result.toolName}`,
    });
    appendAutomationEvent(ROOT, {
      type: 'warm_intros_query_success',
      company: opts.company,
      matches: result.intros.length,
      tool: result.toolName,
    });
  }

  if (opts.report) {
    const reportPath = resolve(ROOT, opts.report);
    if (!existsSync(reportPath)) {
      console.error(`Error: report not found at ${reportPath}`);
      process.exit(1);
    }
    const current = readFileSync(reportPath, 'utf8');
    const next = upsertWarmIntrosSection(current, section);
    writeFileSync(reportPath, next, 'utf8');
    console.log(`[warm-intros] updated ${opts.report}`);
  } else {
    console.log(section);
  }
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}
