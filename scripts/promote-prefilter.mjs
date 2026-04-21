#!/usr/bin/env node
/**
 * promote-prefilter.mjs — Promote completed high-score prefilter results
 * into the application tracker as TSV additions.
 *
 * Reads data/prefilter-results/*.md — any file whose body has:
 *   **Quick Score:** X.Y/5 — ...
 *   **Recommendation:** EVALUATE
 * and whose Score >= --min (default 4.0) gets one TSV line written to
 * batch/tracker-additions/ for merge-tracker.mjs to pick up.
 *
 * Idempotent: once promoted, the prefilter file gets `promoted: YYYY-MM-DD`
 * added to its frontmatter so it won't be re-promoted on subsequent runs.
 * Also skips any company+role already present in applications.md.
 *
 * Usage:
 *   node scripts/promote-prefilter.mjs              # full run, writes TSVs
 *   node scripts/promote-prefilter.mjs --dry-run    # list what would be promoted
 *   node scripts/promote-prefilter.mjs --min=3.5    # lower threshold
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseApplicationsTracker } from './lib/career-data.mjs';
import { isMainEntry } from './lib/main-entry.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const PREFILTER_DIR = join(ROOT, 'data', 'prefilter-results');
const TSV_DIR = join(ROOT, 'batch', 'tracker-additions');

export function parsePrefilter(text) {
  // Parse key: value pairs at the top (before first `---` divider).
  const meta = {};
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\*\*([a-zA-Z_ ]+):\*\*\s*(.+)$/);
    if (m) {
      const key = m[1].toLowerCase().replace(/\s+/g, '_');
      meta[key] = m[2].trim();
    }
  }
  // Quick Score format: "4.2/5 — some note" or "_/5 — _"
  const scoreMatch = (meta.quick_score || '').match(/^([0-9]+(?:\.[0-9]+)?)\s*\/\s*5/);
  const score = scoreMatch ? Number(scoreMatch[1]) : null;
  const recommendation = (meta.recommendation || '').toUpperCase().match(/^(EVALUATE|MAYBE|SKIP)\b/)?.[1] || null;
  return {
    status: (meta.status || '').toLowerCase(),
    date: meta.date || null,
    url: meta.url || null,
    company: meta.company || null,
    title: meta.title || null,
    archetype: meta.archetype || null,
    score,
    recommendation,
    promoted: meta.promoted || null,
  };
}

function nextAppId(apps) {
  const ids = apps.map((a) => parseInt(a.id, 10)).filter((n) => !isNaN(n));
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return String(max + 1).padStart(3, '0');
}

function slugify(s) {
  return String(s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) args[a.slice(2, eq)] = a.slice(eq + 1);
    else args[a.slice(2)] = true;
  }
  return {
    min: Number(args.min ?? 4.0),
    dryRun: Boolean(args['dry-run']),
    json: Boolean(args.json),
  };
}

// Compare title tokens loosely — applications.md often truncates long roles
// ("AI/ML Engineer - Python / Agentic AI - Remote N..."), so strict string
// equality causes false negatives. We normalize to alphanumeric tokens and
// declare a match when the shorter-side shares >= 70% of its tokens (min 3)
// with the longer side, provided company matches exactly.
function roleTokenSet(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function alreadyTracked(apps, company, role) {
  const normC = String(company || '').toLowerCase().trim();
  const wantedTokens = roleTokenSet(role);
  for (const a of apps) {
    if (a.company.toLowerCase().trim() !== normC) continue;
    const haveTokens = roleTokenSet(a.role);
    const small = wantedTokens.size <= haveTokens.size ? wantedTokens : haveTokens;
    const big = small === wantedTokens ? haveTokens : wantedTokens;
    if (small.size < 3) {
      // Too few tokens for a fuzzy match — fall back to exact equality.
      if ([...small].every((t) => big.has(t))) return true;
      continue;
    }
    let hits = 0;
    for (const t of small) if (big.has(t)) hits++;
    if (hits / small.size >= 0.7) return true;
  }
  return false;
}

export function main() {
  const opts = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);

  if (!existsSync(PREFILTER_DIR)) {
    console.log(`[promote-prefilter] no prefilter directory at ${PREFILTER_DIR}`);
    return 0;
  }

  const files = readdirSync(PREFILTER_DIR).filter((n) => n.endsWith('.md'));
  const apps = parseApplicationsTracker(ROOT);

  const candidates = [];
  for (const name of files) {
    const path = join(PREFILTER_DIR, name);
    const text = readFileSync(path, 'utf-8');
    const meta = parsePrefilter(text);
    if (meta.promoted) continue;
    if (meta.score == null) continue;
    if (meta.score < opts.min) continue;
    if (meta.recommendation !== 'EVALUATE') continue;
    if (!meta.company || !meta.title) continue;
    if (alreadyTracked(apps, meta.company, meta.title)) continue;
    candidates.push({ path, name, text, meta });
  }

  if (candidates.length === 0) {
    console.log(`[promote-prefilter] no candidates (min=${opts.min}, scanned=${files.length})`);
    appendAutomationEvent(ROOT, {
      type: 'automation.promote_prefilter.completed',
      status: 'success',
      summary: `No candidates (threshold=${opts.min}, scanned=${files.length})`,
      details: { scanned: files.length, candidates: 0, promoted: 0 },
    });
    return 0;
  }

  console.log(`[promote-prefilter] ${candidates.length} candidate(s) at score>=${opts.min}`);

  if (opts.dryRun) {
    for (const c of candidates) {
      console.log(`  [dry-run] would promote ${c.meta.company} / ${c.meta.title} (score=${c.meta.score})`);
    }
    return 0;
  }

  mkdirSync(TSV_DIR, { recursive: true });

  let nextId = nextAppId(apps);
  const promoted = [];
  for (const c of candidates) {
    const id = nextId;
    nextId = String(parseInt(nextId, 10) + 1).padStart(3, '0');
    const slug = slugify(c.meta.company);
    const note = `Auto-promoted from prefilter (score=${c.meta.score}, rec=EVALUATE)${c.meta.archetype && c.meta.archetype !== '_pending_' ? ` — archetype=${c.meta.archetype}` : ''}`;
    const tsvPath = join(TSV_DIR, `${id}-${slug}.tsv`);
    const row = [
      id,
      today,
      c.meta.company,
      c.meta.title,
      'GO',
      `${c.meta.score.toFixed(1)}/5`,
      '❌',
      `[${id}](reports/${id}-${slug}-${today}.md)`,
      note,
    ].join('\t') + '\n';
    writeFileSync(tsvPath, row, 'utf-8');

    // Mark prefilter file as promoted (append to the top-level metadata block).
    const promotedLine = `**promoted:** ${today}`;
    const patched = c.text.includes('**promoted:**')
      ? c.text.replace(/\*\*promoted:\*\*.*$/m, promotedLine)
      : c.text.replace(/(\*\*title:\*\*[^\n]+\n)/m, `$1${promotedLine}\n`);
    writeFileSync(c.path, patched, 'utf-8');

    promoted.push({ id, company: c.meta.company, role: c.meta.title, score: c.meta.score, tsv: tsvPath });
    console.log(`  [${id}] promoted ${c.meta.company} / ${c.meta.title} (score=${c.meta.score}) → ${tsvPath}`);
  }

  console.log(`[promote-prefilter] wrote ${promoted.length} TSV addition(s). Run 'node merge-tracker.mjs' to merge.`);

  appendAutomationEvent(ROOT, {
    type: 'automation.promote_prefilter.completed',
    status: 'success',
    summary: `Promoted ${promoted.length} prefilter result(s) to tracker`,
    details: {
      scanned: files.length,
      candidates: candidates.length,
      promoted: promoted.length,
      threshold: opts.min,
      applications: promoted.map((p) => ({ id: p.id, company: p.company, role: p.role, score: p.score })),
    },
  });

  return 0;
}

if (isMainEntry(import.meta.url)) {
  try { main(); }
  catch (err) { console.error('[promote-prefilter] Fatal:', err.message); process.exit(1); }
}
