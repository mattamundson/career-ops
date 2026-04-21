#!/usr/bin/env node
/**
 * match-stories.mjs — Match interview-prep/story-bank.md stories to an
 * application's company+role via semantic keyword overlap.
 *
 * Activated when an application flips to Interview. Produces a short
 * "top 3 stories" list with a one-line "why this fits" per story so
 * Matt doesn't have to re-read the entire story bank before every call.
 *
 * Usage:
 *   node scripts/match-stories.mjs --company "Acme" --role "Senior Data Engineer"
 *   node scripts/match-stories.mjs --application-id 042
 *   node scripts/match-stories.mjs --application-id 042 --json
 *
 * Pure text-overlap scoring — no LLM required. When jd text is available via
 * --jd=<path>, uses it for richer matching. Otherwise role+company only.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseApplicationsTracker } from './lib/career-data.mjs';
import { isMainEntry } from './lib/main-entry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const STORY_BANK = join(ROOT, 'interview-prep', 'story-bank.md');

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'with',
  'as', 'by', 'is', 'was', 'be', 'are', 'were', 'you', 'your', 'our', 'we',
  'that', 'this', 'it', 'from', 'not', 'but', 'if', 'so', 'about', 'into',
  'over', 'any', 'all', 'new', 'other', 'their', 'its', 'what', 'how', 'why',
  'who', 'when', 'where', 'which', 'them', 'they', 'than', 'then', 'also',
  'will', 'can', 'could', 'would', 'should', 'do', 'does', 'did', 'had',
  'has', 'have', 'been', 'being', 'up', 'down', 'out', 'more', 'most', 'such',
  'just', 'only', 'very', 'per', 'including', 'via', 'across', 'through',
  'between', 'within', 'one', 'two', 'three', 'role', 'work', 'team', 'job',
  'company', 'experience', 'position', 'required', 'preferred', 'skills',
  'year', 'years', 'best', 'about',
]);

export function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'\-+#./]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * Parse story-bank.md into discrete stories. Each story section begins with
 * `### [Tag] Title` and ends at the next `---` separator.
 */
export function parseStoryBank(text) {
  // Use a multiline anchor so we handle CRLF + LF equally; trim internal
  // whitespace before tag detection.
  const sections = String(text || '').split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);
  const stories = [];
  for (const block of sections) {
    const header = block.match(/^###\s+\[(?<tag>[^\]]+)\]\s+(?<title>.+)$/m);
    if (!header) continue;
    const title = header.groups.title.trim();
    const tag = header.groups.tag.trim();

    // Pull "Best for questions about:" line into its own field.
    const bestFor = (block.match(/^\*\*Best for questions about:\*\*\s*(.+)$/m) || [, ''])[1].trim();

    stories.push({ title, tag, bestFor, raw: block });
  }
  return stories;
}

export function scoreStoryAgainstQuery(story, queryTokenSet) {
  const textTokens = tokens(story.raw);
  const matched = new Set();
  for (const t of textTokens) {
    if (queryTokenSet.has(t)) matched.add(t);
  }
  // Tag + bestFor weighted higher than body text because they're curated
  // summaries of intent.
  const tagTokens = tokens(`${story.tag} ${story.bestFor}`);
  let tagHits = 0;
  for (const t of tagTokens) if (queryTokenSet.has(t)) tagHits++;

  return {
    score: matched.size + tagHits * 2,
    matched: [...matched].sort(),
    tagHits,
  };
}

export function matchStories({ query, storyBankText, topN = 3 }) {
  const stories = parseStoryBank(storyBankText);
  const queryTokenSet = new Set(tokens(query));
  if (queryTokenSet.size === 0) return [];
  const ranked = stories.map((s) => ({ ...s, ...scoreStoryAgainstQuery(s, queryTokenSet) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  return ranked;
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) {
      args[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return {
    company: typeof args.company === 'string' ? args.company : null,
    role: typeof args.role === 'string' ? args.role : null,
    applicationId: args['application-id'] && typeof args['application-id'] === 'string'
      ? String(args['application-id']).padStart(3, '0')
      : null,
    jd: typeof args.jd === 'string' ? args.jd : null,
    topN: Number(args.topN ?? 3),
    json: args.json === true || args.json === 'true',
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let company = opts.company;
  let role = opts.role;
  let extra = '';

  if (opts.applicationId) {
    const apps = parseApplicationsTracker(ROOT);
    const app = apps.find((a) => a.id === opts.applicationId);
    if (!app) {
      console.error(`[match-stories] No application with id=${opts.applicationId}`);
      process.exit(2);
    }
    company = company || app.company;
    role = role || app.role;
    extra += ` ${app.notes || ''}`;
  }

  if (opts.jd) {
    try { extra += '\n' + readFileSync(resolve(ROOT, opts.jd), 'utf-8'); }
    catch { console.error(`[match-stories] Cannot read JD: ${opts.jd}`); }
  }

  if (!company && !role && !extra) {
    console.error('[match-stories] Need --company/--role or --application-id or --jd');
    process.exit(2);
  }

  const query = [company, role, extra].filter(Boolean).join(' ');

  if (!existsSync(STORY_BANK)) {
    console.error(`[match-stories] Story bank missing at ${STORY_BANK}`);
    process.exit(2);
  }
  const storyBankText = readFileSync(STORY_BANK, 'utf-8');
  const matches = matchStories({ query, storyBankText, topN: opts.topN });

  if (opts.json) {
    console.log(JSON.stringify({
      company, role, applicationId: opts.applicationId,
      matches: matches.map((m) => ({
        title: m.title, tag: m.tag, score: m.score,
        matched_keywords: m.matched,
        best_for: m.bestFor,
      })),
    }, null, 2));
    return;
  }

  console.log('');
  console.log('─'.repeat(60));
  console.log(`Story matches for ${company || '(no company)'} / ${role || '(no role)'}`);
  console.log('─'.repeat(60));
  if (matches.length === 0) {
    console.log('\nNo story matched the query tokens. Broaden the search with --jd=<path>.');
    return;
  }
  matches.forEach((m, i) => {
    console.log(`\n${i + 1}. [${m.tag}] ${m.title}  (score=${m.score})`);
    console.log(`   Matched keywords: ${m.matched.slice(0, 8).join(', ') || '—'}`);
    if (m.bestFor) console.log(`   Best for: ${m.bestFor.slice(0, 180)}${m.bestFor.length > 180 ? '…' : ''}`);
  });
  console.log('');
}

if (isMainEntry(import.meta.url)) {
  main();
}
