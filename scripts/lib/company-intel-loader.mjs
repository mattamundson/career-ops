/**
 * company-intel-loader.mjs — load + summarize data/company-intel/{slug}.md
 *
 * 645+ intel files exist but were only being *linked* from prefilter
 * templates, not embedded. That meant Claude never saw the intel when
 * scoring a role — Matt re-researched from scratch on every eval.
 *
 * This loader:
 *   - Resolves company name → slug (matching scripts/prefilter-pipeline.mjs
 *     toSlug conventions).
 *   - Reads the dossier, strips TODO-placeholder lines, and returns the
 *     substantive body along with staleness metadata.
 *   - Classifies the dossier as "populated" vs "stub" so callers can
 *     decide whether to embed or just flag.
 *
 * Consumers embed the result into prompt context for Claude.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INTEL_DIR = resolve(__dir, '..', '..', 'data', 'company-intel');

// TODO placeholders produced by the company-intel.mjs template generator.
// Matches both "<!-- TODO: ..." inline-HTML and trailing "_pending_" markers.
const TODO_PATTERN = /<!--\s*TODO:.*?-->/i;

export function toIntelSlug(companyName) {
  return String(companyName || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

function stripTodoLines(body) {
  const kept = [];
  for (const rawLine of body.split('\n')) {
    if (TODO_PATTERN.test(rawLine)) continue;
    const line = rawLine;

    // Table row with empty value cell after TODO removal (e.g., "| Foo |  |").
    // These are noise, not content — they should not inflate the substantive
    // byte count in stub detection.
    const tableRow = line.match(/^\s*\|(.*)\|\s*$/);
    if (tableRow) {
      const cells = tableRow[1].split('|').map((c) => c.trim());
      // Skip divider rows like |---|---|
      if (cells.every((c) => /^:?-+:?$/.test(c) || c === '')) continue;
      // Skip rows where every non-empty cell is itself empty/whitespace after
      // TODO removal (one real cell + one empty value cell).
      const nonEmpty = cells.filter((c) => c.length > 0);
      if (nonEmpty.length === 1) continue; // only label cell left — no data
    }

    kept.push(line);
  }
  // Collapse 3+ blank lines to 2.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10));
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

/**
 * Load a company intel dossier.
 *
 * @param {string} companyName - e.g., "Agility Robotics"
 * @param {object} opts
 * @param {string} [opts.intelDir] - override for the default dir
 * @param {number} [opts.stubThreshold=0.55] - substantive/raw body ratio
 *   below which the file is classified as a stub. Tuned empirically:
 *   real populated dossiers ratio ≈1.0; stubs with search-query scaffolding
 *   and empty tables typically ratio 0.4-0.55.
 * @returns {{
 *   found: boolean,
 *   slug: string,
 *   path: string,
 *   body?: string,               // TODO-stripped body (sections only)
 *   isStub?: boolean,            // true if mostly TODOs
 *   lastUpdated?: string,        // from frontmatter
 *   ageDays?: number | null,
 *   rawByteCount?: number,
 *   substantiveByteCount?: number,
 * }}
 */
export function loadCompanyIntel(companyName, opts = {}) {
  const intelDir = opts.intelDir || DEFAULT_INTEL_DIR;
  const stubThreshold = opts.stubThreshold ?? 0.55;

  const slug = toIntelSlug(companyName);
  if (!slug) return { found: false, slug: '', path: '' };

  const path = join(intelDir, `${slug}.md`);
  if (!existsSync(path)) return { found: false, slug, path };

  let raw;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return { found: false, slug, path };
  }

  const fm = parseFrontmatter(raw);
  const bodyStart = raw.indexOf('---\n', 4);
  const rawBody = bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw;
  const body = stripTodoLines(rawBody);

  const rawByteCount = rawBody.length;
  const substantiveByteCount = body.length;
  const ratio = rawByteCount > 0 ? substantiveByteCount / rawByteCount : 0;
  const isStub = ratio < stubThreshold;

  return {
    found: true,
    slug,
    path,
    body,
    isStub,
    lastUpdated: fm.last_updated || null,
    ageDays: daysSince(fm.last_updated),
    rawByteCount,
    substantiveByteCount,
  };
}

/**
 * Format the intel into a prompt-ready markdown block. Returns empty string
 * when there's nothing useful to inject.
 */
export function formatIntelBlock(intel, opts = {}) {
  const stubFallback = opts.stubFallback ?? false;
  if (!intel || !intel.found) return '';
  if (intel.isStub && !stubFallback) {
    // Include a one-liner so callers know the dossier exists but is empty.
    return `## Company Intel (cached)\n\n_Dossier file exists at \`${intel.path}\` but is mostly unpopulated — treat company as unresearched._\n`;
  }

  const stalenessNote = intel.ageDays != null && intel.ageDays > 90
    ? `\n_Note: intel is ${intel.ageDays}d old — verify material facts before quoting._\n`
    : '';

  return [
    `## Company Intel (cached${intel.lastUpdated ? ` · updated ${intel.lastUpdated}` : ''})`,
    '',
    '_The following is institutional knowledge about this company from prior research. Use it to inform scoring and frame the fit story, but do not quote it verbatim in the output._',
    stalenessNote,
    '',
    intel.body,
    '',
    `_Source: ${intel.path}_`,
    '',
  ].join('\n');
}
