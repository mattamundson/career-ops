#!/usr/bin/env node
/**
 * prefilter-pipeline.mjs — Two-Tier Scoring: generate prefilter templates from pipeline.md
 *
 * Usage:
 *   node scripts/prefilter-pipeline.mjs              — generate templates for all pending pipeline entries
 *   node scripts/prefilter-pipeline.mjs --list        — list all prefilter results and their statuses
 *   node scripts/prefilter-pipeline.mjs --semantic    — include semantic score from match-jd.mjs output if present
 *   node scripts/prefilter-pipeline.mjs --ai-score    — compute AI semantic score via OpenAI embeddings (requires OPENAI_API_KEY)
 *   node scripts/prefilter-pipeline.mjs --dry-run     — show what would be created without writing files
 *
 * No external dependencies — ESM only.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { computeSemanticScore } from './lib/semantic-match.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const PIPELINE         = resolve(ROOT, 'data', 'pipeline.md');
const PREFILTER_DIR    = resolve(ROOT, 'data', 'prefilter-results');
const MATCH_JD_DIR     = resolve(ROOT, 'data', 'match-jd');  // optional semantic scores
const INTEL_DIR        = resolve(ROOT, 'data', 'company-intel');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const LIST_MODE  = argv.includes('--list');
const SEMANTIC   = argv.includes('--semantic');
const AI_SCORE   = argv.includes('--ai-score');
const SKIP_SEMANTIC = argv.includes('--skip-semantic');
const DRY_RUN    = argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/** Convert a raw string to a URL-safe slug: lowercase, hyphens, no special chars */
function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // strip non-alphanumeric (except spaces/hyphens)
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '');         // trim leading/trailing hyphens
}

/** Build the output filename for a prefilter result */
function buildFilename(company, title) {
  const companySlug = toSlug(company);
  const titleSlug   = toSlug(title);
  return `${companySlug}-${titleSlug}.md`;
}

// ---------------------------------------------------------------------------
// Parse pipeline.md — extract all `- [ ] URL | Company | Title [| Location]` entries.
// Location is the optional 4th column (added 2026-04-16). Legacy 3-column rows parse fine.
// Returns: Array<{ url, company, title, location, raw }>
// ---------------------------------------------------------------------------
function parsePipelineEntries() {
  if (!existsSync(PIPELINE)) {
    console.error(`[ERROR] pipeline.md not found at: ${PIPELINE}`);
    process.exit(1);
  }

  const text  = readFileSync(PIPELINE, 'utf8');
  const lines = text.split('\n');
  const entries = [];

  for (const line of lines) {
    // Match: - [ ] URL | Company | Title [| Location]
    // The checkbox can also be - [x] for already-processed items — skip those.
    // Title captures non-greedy; Location is an optional 4th pipe-separated field.
    const m = line.match(/^-\s+\[\s\]\s+(https?:\/\/[^\s|]+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*(?:\|\s*(.+?)\s*)?$/);
    if (!m) continue;

    const [, url, company, title, location = ''] = m;
    if (!url || !company || !title) continue;

    entries.push({
      url:      url.trim(),
      company:  company.trim(),
      title:    title.trim(),
      location: location.trim(),
      raw:      line.trim(),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Look up semantic score from match-jd.mjs output (optional)
// Looks for: data/match-jd/{company-slug}-{title-slug}.md or similar
// Returns: string | null
// ---------------------------------------------------------------------------
function loadSemanticScore(company, title) {
  if (!existsSync(MATCH_JD_DIR)) return null;

  const slug     = toSlug(`${company}-${title}`);
  const compSlug = toSlug(company);
  const titleSlug = toSlug(title);

  // Try multiple filename patterns
  const candidates = [
    `${compSlug}-${titleSlug}.md`,
    `${slug}.md`,
    `${compSlug}-${titleSlug}.json`,
  ];

  for (const candidate of candidates) {
    const fullPath = resolve(MATCH_JD_DIR, candidate);
    if (!existsSync(fullPath)) continue;

    try {
      const content = readFileSync(fullPath, 'utf8');
      // Look for a line like: Semantic Score: 0.87 or score: 0.87
      const scoreMatch = content.match(/(?:semantic[_\s-]?score|score)\s*[:=]\s*([0-9.]+)/i);
      if (scoreMatch) return scoreMatch[1];
    } catch {
      // ignore read errors
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Build a prefilter template for a single entry
// ---------------------------------------------------------------------------
function buildTemplate(entry, semanticScore) {
  const { url, company, title } = entry;
  const today = new Date().toISOString().slice(0, 10);

  const semanticSection = semanticScore
    ? `\n**Semantic Score:** ${semanticScore} (from match-jd output)\n`
    : '';

  // Auto-generate company intel template (creates data/company-intel/{slug}.md if absent)
  const intelSlug = toSlug(company);
  const intelPath = resolve(INTEL_DIR, `${intelSlug}.md`);
  if (!DRY_RUN && !existsSync(intelPath)) {
    try {
      execFileSync(process.execPath, [resolve(__dir, 'company-intel.mjs'), `--company=${company}`], {
        cwd: ROOT, stdio: 'ignore',
      });
    } catch { /* non-fatal */ }
  }
  const intelLink = existsSync(intelPath)
    ? `[../company-intel/${intelSlug}.md](../company-intel/${intelSlug}.md)`
    : `_not yet generated — run: node scripts/company-intel.mjs --company="${company}"_`;

  return `# Prefilter: ${company} — ${title}

**status:** pending
**date:** ${today}
**url:** ${url}
**company:** ${company}
**title:** ${title}
${semanticSection}
---

## Instructions

Run the \`prefilter\` mode against this JD to fill in the scored output below.
Command: paste URL or JD text into career-ops with \`/prefilter\` prefix.

Thresholds:
- >= 3.5 → EVALUATE (proceed to full A-F)
- 2.5 – 3.4 → MAYBE (manual review)
- < 2.5 → SKIP

---

## Prefilter Result

<!-- Fill in after running /prefilter mode -->

**Archetype:** _pending_
**Quick Score:** _/5 — _
**Top 3 Matches:**
- _pending_
- _pending_
- _pending_
**Top 3 Gaps:**
- _pending_
- _pending_
- _pending_
**Recommendation:** _EVALUATE | MAYBE | SKIP_

---

## Company Intel

${intelLink}

---

## Notes

<!-- Optional: manual notes, context, referrals, etc. -->
`;
}

// ---------------------------------------------------------------------------
// List mode — display all prefilter results with their statuses
// ---------------------------------------------------------------------------
function listPrefilterResults() {
  if (!existsSync(PREFILTER_DIR)) {
    console.log('No prefilter-results directory found.');
    console.log(`Expected: ${PREFILTER_DIR}`);
    return;
  }

  const files = readdirSync(PREFILTER_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  if (files.length === 0) {
    console.log('No prefilter results found.');
    console.log(`Run without --list to generate templates from pipeline.md`);
    return;
  }

  // Parse status and metadata from each file
  const results = files.map(filename => {
    const fullPath = resolve(PREFILTER_DIR, filename);
    let status = 'pending';
    let score  = null;
    let recommendation = null;
    let company = null;
    let title   = null;
    let date    = null;

    try {
      const content = readFileSync(fullPath, 'utf8');

      const statusMatch  = content.match(/\*\*status:\*\*\s*(.+)/i);
      const scoreMatch   = content.match(/\*\*Quick Score:\*\*\s*([0-9.]+)\/5/i);
      const recMatch     = content.match(/\*\*Recommendation:\*\*\s*(EVALUATE|MAYBE|SKIP)/i);
      const companyMatch = content.match(/\*\*company:\*\*\s*(.+)/i);
      const titleMatch   = content.match(/\*\*title:\*\*\s*(.+)/i);
      const dateMatch    = content.match(/\*\*date:\*\*\s*(.+)/i);

      if (statusMatch)  status         = statusMatch[1].trim();
      if (scoreMatch)   score          = scoreMatch[1].trim();
      if (recMatch)     recommendation = recMatch[1].trim();
      if (companyMatch) company        = companyMatch[1].trim();
      if (titleMatch)   title          = titleMatch[1].trim();
      if (dateMatch)    date           = dateMatch[1].trim();
    } catch {
      // ignore parse errors — show filename only
    }

    return { filename, status, score, recommendation, company, title, date };
  });

  // Group by status — explicit status field takes precedence over recommendation field
  const pending  = results.filter(r => r.status === 'pending');
  const evaluate = results.filter(r => {
    if (r.status && r.status !== 'pending') return r.status === 'evaluate';
    return r.recommendation === 'EVALUATE';
  });
  const maybe = results.filter(r => {
    if (r.status && r.status !== 'pending') return r.status === 'maybe';
    return r.recommendation === 'MAYBE';
  });
  const skip = results.filter(r => {
    if (r.status && r.status !== 'pending') return r.status === 'skip';
    return r.recommendation === 'SKIP';
  });

  const WIDTH = 60;
  const divider = '━'.repeat(WIDTH);

  console.log('');
  console.log(`Prefilter Results — ${new Date().toISOString().slice(0, 10)}`);
  console.log(divider);
  console.log(`  Total:    ${results.length}`);
  console.log(`  Pending:  ${pending.length}`);
  console.log(`  Evaluate: ${evaluate.length}`);
  console.log(`  Maybe:    ${maybe.length}`);
  console.log(`  Skip:     ${skip.length}`);
  console.log('');

  function printGroup(label, items) {
    if (items.length === 0) return;
    console.log(`${label} (${items.length})`);
    console.log('-'.repeat(WIDTH));
    for (const r of items) {
      const label = r.company && r.title
        ? `${r.company} | ${r.title}`
        : r.filename.replace('.md', '');
      const scoreStr = r.score ? ` [${r.score}/5]` : '';
      console.log(`  ${label}${scoreStr}`);
      if (r.date) console.log(`    date: ${r.date}`);
      console.log(`    file: data/prefilter-results/${r.filename}`);
    }
    console.log('');
  }

  printGroup('EVALUATE', evaluate);
  printGroup('MAYBE',    maybe);
  printGroup('PENDING',  pending);
  printGroup('SKIP',     skip);
}

// ---------------------------------------------------------------------------
// Generate mode — create template files for all pending pipeline entries
// ---------------------------------------------------------------------------
async function generateTemplates() {
  const entries = parsePipelineEntries();

  console.log('');
  console.log(`Prefilter Pipeline — ${new Date().toISOString().slice(0, 10)}`);
  console.log('━'.repeat(50));
  console.log(`  Pipeline entries (pending): ${entries.length}`);
  console.log(`  Output dir: ${PREFILTER_DIR}`);
  if (SEMANTIC)  console.log('  Semantic scores: enabled (match-jd)');
  if (AI_SCORE)  console.log('  AI scoring: enabled (OpenAI embeddings)');
  if (DRY_RUN)   console.log('  Mode: DRY RUN (no files written)');
  console.log('');

  if (entries.length === 0) {
    console.log('No pending entries found in pipeline.md.');
    console.log('Add entries with format: - [ ] URL | Company | Title');
    return;
  }

  let created  = 0;
  let skipped  = 0;
  let withSem  = 0;

  for (const entry of entries) {
    const filename = buildFilename(entry.company, entry.title);
    const outPath  = resolve(PREFILTER_DIR, filename);

    // Skip if already exists — do not overwrite scored results
    if (existsSync(outPath)) {
      skipped++;
      continue;
    }

    let semanticScore = SEMANTIC ? loadSemanticScore(entry.company, entry.title) : null;
    if (semanticScore) withSem++;

    // AI-powered semantic scoring via OpenAI embeddings (requires OPENAI_API_KEY in .env)
    if (AI_SCORE && !SKIP_SEMANTIC && !semanticScore) {
      try {
        const cvPath = resolve(ROOT, 'cv.md');
        if (existsSync(cvPath)) {
          const cvText = readFileSync(cvPath, 'utf8');
          // Use title + company as JD proxy (full JD requires fetching the URL)
          const jdProxy = `Job Title: ${entry.title}\nCompany: ${entry.company}\nURL: ${entry.url}`;
          const result = await computeSemanticScore(jdProxy, cvText);
          if (result.overallScore > 0) {
            semanticScore = result.overallScore.toFixed(3);
            withSem++;
            console.log(`    [AI] Semantic score: ${semanticScore} | Matches: ${result.topMatches.join(', ') || 'none'}`);
          }
        }
      } catch (err) {
        console.warn(`    [AI] Semantic scoring failed: ${err.message}`);
      }
    }

    const template = buildTemplate(entry, semanticScore);

    if (!DRY_RUN) {
      writeFileSync(outPath, template, 'utf8');
    }

    const semLabel = semanticScore ? ` [sem: ${semanticScore}]` : '';
    console.log(`  + ${entry.company} | ${entry.title}${semLabel}`);
    console.log(`    → data/prefilter-results/${filename}`);
    created++;
  }

  console.log('');
  console.log('━'.repeat(50));
  console.log(`Created:  ${created}`);
  console.log(`Skipped:  ${skipped} (already exist)`);
  if (SEMANTIC) console.log(`With semantic score: ${withSem}`);
  console.log('');

  if (!DRY_RUN) {
    appendAutomationEvent(ROOT, {
      type: 'prefilter_templates_generated',
      created,
      skipped,
      with_semantic_score: withSem,
      pipeline_entries: entries.length,
    });
  }

  if (created > 0 && !DRY_RUN) {
    console.log(`→ Run /prefilter on each entry, then node scripts/prefilter-pipeline.mjs --list`);
    console.log(`  to see EVALUATE / MAYBE / SKIP breakdown.`);
  } else if (DRY_RUN) {
    console.log('[DRY RUN] No files written.');
  } else if (created === 0) {
    console.log('→ All pipeline entries already have prefilter templates.');
    console.log('  Run --list to see current statuses.');
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (LIST_MODE) {
  listPrefilterResults();
} else {
  generateTemplates().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}
