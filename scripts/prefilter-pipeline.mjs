#!/usr/bin/env node
/**
 * prefilter-pipeline.mjs — Two-Tier Scoring: generate prefilter templates from pipeline.md
 *
 * Usage:
 *   node scripts/prefilter-pipeline.mjs              — generate templates for all pending pipeline entries
 *   node scripts/prefilter-pipeline.mjs --list        — list all prefilter results and their statuses
 *   node scripts/prefilter-pipeline.mjs --semantic    — include semantic score from match-jd.mjs output if present
 *   node scripts/prefilter-pipeline.mjs --ai-score    — compute AI semantic score via OpenAI embeddings (requires OPENAI_API_KEY)
 *   node scripts/prefilter-pipeline.mjs --auto-score  — LLM-fill Quick Score + matches/gaps/recommendation per modes/prefilter-auto-score.md (requires ANTHROPIC_API_KEY, falls back to OPENAI_API_KEY)
 *   node scripts/prefilter-pipeline.mjs --auto-score --max=10  — cap LLM calls (default 50)
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
import { loadCompanyIntel, formatIntelBlock } from './lib/company-intel-loader.mjs';
import { isMainEntry } from './lib/main-entry.mjs';

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
const AUTO_SCORE = argv.includes('--auto-score');
const SKIP_SEMANTIC = argv.includes('--skip-semantic');
const DRY_RUN    = argv.includes('--dry-run');
const MAX_AUTO_SCORE = (() => {
  const flag = argv.find((a) => a.startsWith('--max='));
  if (!flag) return 50;
  const n = parseInt(flag.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
})();
const AUTO_SCORE_RATE_MS = 200;

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
  // Load the intel dossier and embed substantive content into the template.
  // Prior behavior just linked to the file; Claude never saw the intel at
  // scoring time (scripts/lib/company-intel-loader.mjs extracted body here).
  const intel = loadCompanyIntel(company, { intelDir: INTEL_DIR });
  const intelBlock = formatIntelBlock(intel);
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

${intelBlock ? '\n---\n\n' + intelBlock : ''}
---

## Notes

<!-- Optional: manual notes, context, referrals, etc. -->
`;
}

// ---------------------------------------------------------------------------
// Pure parser for LLM auto-score output. Exported for unit testing without
// touching the network. Returns { ok: true, ...parsed } or { ok: false, reason }.
// ---------------------------------------------------------------------------
export function parseAutoScoreResponse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, reason: 'empty response' };
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { ok: false, reason: 'no JSON in response' };

  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch (err) { return { ok: false, reason: `JSON parse: ${err.message}` }; }

  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    return { ok: false, reason: `bad score: ${parsed.score}` };
  }
  const rec = String(parsed.recommendation || '').toUpperCase();
  if (!['EVALUATE', 'MAYBE', 'SKIP', 'UNCLEAR'].includes(rec)) {
    return { ok: false, reason: `bad recommendation: ${rec}` };
  }
  if (!Array.isArray(parsed.matches) || !Array.isArray(parsed.gaps)) {
    return { ok: false, reason: 'matches/gaps not arrays' };
  }
  return {
    ok: true,
    score,
    archetype: String(parsed.archetype || 'unknown').trim(),
    matches: parsed.matches.slice(0, 3).map((s) => String(s).trim()),
    gaps: parsed.gaps.slice(0, 3).map((s) => String(s).trim()),
    recommendation: rec,
  };
}

// ---------------------------------------------------------------------------
// Auto-score — LLM fills Quick Score + matches/gaps/recommendation per
// modes/prefilter-auto-score.md. Returns null if the call fails or the LLM
// responds with "UNCLEAR" — card stays at status: pending for manual review.
// ---------------------------------------------------------------------------
async function autoScoreEntry(entry) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!anthropicKey && !openaiKey) return { ok: false, reason: 'no API key' };

  const cvPath = resolve(ROOT, 'cv.md');
  if (!existsSync(cvPath)) return { ok: false, reason: 'cv.md missing' };
  const cvText = readFileSync(cvPath, 'utf8');
  const intel = loadCompanyIntel(entry.company, { intelDir: INTEL_DIR });
  const intelBlock = formatIntelBlock(intel);

  const prompt = `You are Matt Amundson's AI pre-filter. Score a job listing on a 1-5 scale using ONLY the listing TITLE + company + his CV. You are NOT fetching the URL. You are triaging quickly. Your default bias is to SKIP -- a quality miss is worse than a missed opportunity here, because false-positive EVALUATEs pollute Matt's review queue.

Matt's archetypes (the ONLY 6 acceptable fits):
1. Operational Data Architect -- ERP, data pipeline, semantic layer, data modeling
2. AI Automation / Workflow Engineer -- n8n, LLM workflow, agents, automation, zero-handoff
3. BI & Analytics Lead -- Power BI, DAX, SQL, dashboards, reporting
4. Business Systems / ERP Specialist -- ERP, CRM, integrations, barcode, ops-to-tech
5. Applied AI / Solutions Architect -- system design, LLM, enterprise AI, solutions architecture
6. Operations Technology Leader -- COO, VP Ops, change management, cross-functional, transformation

SCORING DISCIPLINE (read carefully, failure to follow these = wrong output):

Step 1 — Parse the TITLE (not the company, not the intel). Does the title map to one of the 6 archetypes above?
  - If title is security/identity (PAM, IAM, SIEM, SOC), SKIP regardless of company.
  - If title is electrical/mechanical/chemical engineering, SKIP regardless of company.
  - If title is finance/accounting specialist (Controller, Principal Financial Reporting, FP&A IC), SKIP -- Matt is NOT a finance specialist.
  - If title is pure ML research / ML Research Engineer / Research Scientist / Data Scientist IC, SKIP.
    IMPORTANT EXCEPTION: "Data Engineer" wins over the ML keyword. "Machine Learning Data Engineer",
    "AI/ML Data Engineer", "AI Platform Engineer", or "MLOps Engineer" are DATA ENGINEERING roles (pipelines,
    infra, orchestration) -- these are archetype matches, NOT exclusions. Score as Operational Data Architect or Applied AI / Solutions Architect.
  - If title is engineering management of teams outside the 6 archetypes (e.g. Engineering Manager of pure ML research, App Frameworks), SKIP.
    EXCEPTION: "Director/Manager of Data", "Head of Analytics", "VP Engineering - Data Platform" ARE archetype matches.
  - If title is a narrow product eng role (Platform Engineer for non-data product, Backend Engineer, Full Stack), SKIP unless archetype signal is crystal clear.
  - If title is clearly aligned (Data Architect, BI Manager, ERP Analyst, Solutions Architect, Automation Engineer,
    Data Engineering Manager, Director of Data/BI/Analytics, AI Automation Architect, GenAI Solutions Architect,
    Principal Data Engineer, Staff Data Engineer), CONTINUE to step 2.
  - If ambiguous (e.g. "Senior Consultant", "Principal Engineer" with no specialization), return UNCLEAR.

Step 2 — Seniority check. Matt targets senior/lead/manager/director/principal/staff. Junior / Associate / Entry → SKIP.

Step 3 — If both steps above pass, score 2.5-4.5 based on how tightly the title matches the archetype:
  - Exact archetype title match (e.g. "Data Architect", "AI Automation Architect"): 4.0-4.5 baseline
  - Strong archetype adjacency (e.g. "Senior BI Developer", "Analytics Engineering Lead", "Principal Data Engineer"): 3.5-4.0
  - Weak adjacency (e.g. mid-level "Data Engineer" without senior/principal/lead): 2.5-3.0

Step 4 — Apply work-mode bias by scanning the TITLE AND URL for location hints:
  - Explicit Minneapolis/MSP/MN signals in title (e.g. "from MN", "Minneapolis", "Minnesota"): +0.5 if on-site, +0.25 if hybrid.
  - If title says "Remote - US" or "Fully Remote": no boost.
  - If title is silent on location: no boost, default is remote-inferred.
  - Cap at 5.0.

Step 5 — Recommendation consistency check (REQUIRED before outputting):
  - If final score >= 3.5 → recommendation MUST be "EVALUATE"
  - If final score 2.5-3.49 → recommendation MUST be "MAYBE"
  - If final score < 2.5 → recommendation MUST be "SKIP"
  If your intended recommendation does not match your score, ADJUST THE SCORE rather than the recommendation.
  (e.g. if you're certain it's MAYBE, the score must be 2.5-3.4 -- not 3.5+.)

Step 6 — Never let company intel override the TITLE. If intel describes a DIFFERENT role at the same company, IGNORE it. Score THIS title, not a sibling role.

CV (canonical):
${cvText.slice(0, 8000)}

Listing:
- Company: ${entry.company}
- Title: ${entry.title}
- URL: ${entry.url}
${intelBlock ? '\nCompany intel (FYI only — may describe a different role; do not let it pull the score):\n' + intelBlock.slice(0, 1500) : ''}

Output ONLY a JSON object (no markdown, no prose):
{"score": 3.5, "archetype": "Operational Data Architect", "matches": ["..","..",".."], "gaps": ["..","..",".."], "recommendation": "EVALUATE"}

Rules:
- score in [1.0, 5.0], half-points allowed
- archetype is one of the 6 listed (or "none" if you're returning SKIP)
- matches/gaps each exactly 3 short phrases (max 80 chars each)
- recommendation is one of: EVALUATE (score>=3.5), MAYBE (2.5-3.4), SKIP (<2.5), UNCLEAR (signal genuinely ambiguous)
- When SKIP-ping an off-archetype title, set archetype to "none", score to 1.5-2.0, and make gap #1 name the specific mismatch (e.g. "Title is PAM platform eng, not data/BI/automation")`;

  try {
    let text;
    if (anthropicKey) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic ${response.status}: ${(await response.text()).slice(0, 200)}`);
      const data = await response.json();
      text = data.content?.[0]?.text || '';
    } else {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
      const data = await response.json();
      text = data.choices?.[0]?.message?.content || '';
    }

    return parseAutoScoreResponse(text);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Overwrite a prefilter template with the LLM-scored content. Leaves status
 * as `pending` if rec === UNCLEAR so Matt sees it in the manual-review queue.
 */
function applyAutoScore(filePath, entry, scored) {
  if (!scored.ok) return false;
  const status = scored.recommendation === 'UNCLEAR' ? 'pending' : scored.recommendation.toLowerCase();
  const autoScoredFlag = scored.recommendation === 'UNCLEAR' ? 'attempted' : 'true';
  const today = new Date().toISOString().slice(0, 10);

  const matchesBlock = scored.matches.map((m) => `- ${m}`).join('\n');
  const gapsBlock = scored.gaps.map((g) => `- ${g}`).join('\n');

  const intel = loadCompanyIntel(entry.company, { intelDir: INTEL_DIR });
  const intelBlock = formatIntelBlock(intel);
  const intelSlug = toSlug(entry.company);
  const intelPath = resolve(INTEL_DIR, `${intelSlug}.md`);
  const intelLink = existsSync(intelPath)
    ? `[../company-intel/${intelSlug}.md](../company-intel/${intelSlug}.md)`
    : `_not yet generated — run: node scripts/company-intel.mjs --company="${entry.company}"_`;

  const content = `# Prefilter: ${entry.company} — ${entry.title}

**status:** ${status}
**auto_scored:** ${autoScoredFlag}
**date:** ${today}
**url:** ${entry.url}
**company:** ${entry.company}
**title:** ${entry.title}

---

## Prefilter Result

**Archetype:** ${scored.archetype}
**Quick Score:** ${scored.score}/5 — auto-scored at scan time${scored.recommendation === 'UNCLEAR' ? ' (signal too thin; leaving pending for manual review)' : ''}
**Top 3 Matches:**
${matchesBlock}
**Top 3 Gaps:**
${gapsBlock}
**Recommendation:** ${scored.recommendation}

---

## Company Intel

${intelLink}

${intelBlock ? '\n---\n\n' + intelBlock : ''}
---

## Notes

<!-- auto-scored at scan time via modes/prefilter-auto-score.md -->
`;

  writeFileSync(filePath, content, 'utf8');
  return true;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  let autoScoreOk = 0;
  let autoScoreUnclear = 0;
  let autoScoreFailed = 0;
  let autoScoreAttempts = 0;

  if (AUTO_SCORE) {
    const hasKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    if (!hasKey) {
      console.warn('  [auto-score] no ANTHROPIC_API_KEY or OPENAI_API_KEY — flag ignored');
    } else {
      const keyType = process.env.ANTHROPIC_API_KEY ? 'Anthropic (haiku)' : 'OpenAI (gpt-4o-mini)';
      console.log(`  Auto-score: enabled via ${keyType}, max ${MAX_AUTO_SCORE} cards, ${AUTO_SCORE_RATE_MS}ms between calls`);
    }
  }

  for (const entry of entries) {
    const filename = buildFilename(entry.company, entry.title);
    const outPath  = resolve(PREFILTER_DIR, filename);
    const alreadyExists = existsSync(outPath);

    // For existing cards: skip unless AUTO_SCORE is on AND status is pending.
    // This lets --auto-score process a backlog of already-generated pending
    // cards without double-writing templates or clobbering scored results.
    if (alreadyExists) {
      if (!AUTO_SCORE) {
        skipped++;
        continue;
      }
      try {
        const existingText = readFileSync(outPath, 'utf8');
        const statusMatch = existingText.match(/\*\*status:\*\*\s*(\w+)/);
        const existingStatus = statusMatch ? statusMatch[1].trim().toLowerCase() : 'pending';
        if (existingStatus !== 'pending') {
          skipped++;
          continue;
        }
      } catch {
        skipped++;
        continue;
      }
    }

    let semanticScore = SEMANTIC && !alreadyExists ? loadSemanticScore(entry.company, entry.title) : null;
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

    // Write template only for newly-created cards. Existing pending cards
    // fall through to auto-score without touching the existing template.
    if (!alreadyExists) {
      const template = buildTemplate(entry, semanticScore);
      if (!DRY_RUN) {
        writeFileSync(outPath, template, 'utf8');
      }
    }

    const semLabel = semanticScore ? ` [sem: ${semanticScore}]` : '';

    // Optional LLM auto-score pass — overwrites the just-written template
    // with the scored version. Rate-limited, capped, best-effort.
    let autoLabel = '';
    if (AUTO_SCORE && !DRY_RUN && autoScoreAttempts < MAX_AUTO_SCORE) {
      const hasKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
      if (hasKey) {
        autoScoreAttempts++;
        const scored = await autoScoreEntry(entry);
        if (scored.ok) {
          applyAutoScore(outPath, entry, scored);
          if (scored.recommendation === 'UNCLEAR') {
            autoScoreUnclear++;
            autoLabel = ` [auto: UNCLEAR]`;
          } else {
            autoScoreOk++;
            autoLabel = ` [auto: ${scored.score}/5 ${scored.recommendation}]`;
          }
        } else {
          autoScoreFailed++;
          autoLabel = ` [auto: failed — ${scored.reason}]`;
        }
        // Rate limit between API calls
        if (autoScoreAttempts < MAX_AUTO_SCORE) await sleep(AUTO_SCORE_RATE_MS);
      }
    }

    const prefix = alreadyExists ? '↻' : '+';
    console.log(`  ${prefix} ${entry.company} | ${entry.title}${semLabel}${autoLabel}`);
    console.log(`    → data/prefilter-results/${filename}`);
    if (!alreadyExists) created++;
  }

  console.log('');
  console.log('━'.repeat(50));
  console.log(`Created:  ${created}`);
  console.log(`Skipped:  ${skipped} (already exist)`);
  if (SEMANTIC) console.log(`With semantic score: ${withSem}`);
  if (AUTO_SCORE) {
    console.log(`Auto-scored: ${autoScoreOk} scored | ${autoScoreUnclear} unclear (pending) | ${autoScoreFailed} failed`);
  }
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
if (isMainEntry(import.meta.url)) {
  if (LIST_MODE) {
    listPrefilterResults();
  } else {
    generateTemplates().catch(err => {
      console.error('[FATAL]', err);
      process.exit(1);
    });
  }
}
