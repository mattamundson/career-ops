#!/usr/bin/env node
/**
 * generate-cover-letter.mjs
 *
 * Drafts a 3-paragraph cover letter for a given application by:
 *   1. Reading reports/{###}-{slug}-{date}.md (CV-match, gaps, archetype)
 *   2. Extracting structured signals (top strengths, top gaps, role summary)
 *   3. Calling OpenAI chat completion to write a tight, honest letter
 *   4. Writing to output/cover-letters/{slug}-{role-slug}.txt
 *
 * The output is a DRAFT. Per CLAUDE.md, Matt always reviews before sending.
 *
 * Usage:
 *   node scripts/generate-cover-letter.mjs --app-id 015
 *   node scripts/generate-cover-letter.mjs --app-id 015 --print  (don't write file, just stdout)
 *   node scripts/generate-cover-letter.mjs --app-id 015 --force  (overwrite existing)
 *
 * Env: OPENAI_API_KEY required.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './load-env.mjs';
import { buildApplicationIndex } from './lib/career-data.mjs';
import { retry } from './lib/retry.mjs';
import { lintCoverLetter, formatLintReport } from './lib/cover-letter-lint.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function valOf(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  return args[i + 1] ?? true;
}
function flag(name) { return args.includes(`--${name}`); }

const APP_ID = valOf('app-id');
const PRINT_ONLY = flag('print');
const FORCE = flag('force');

if (!APP_ID) {
  console.error('Usage: node scripts/generate-cover-letter.mjs --app-id <N> [--print] [--force]');
  process.exit(1);
}

const apiKey = (process.env.OPENAI_API_KEY || '').trim();
if (!apiKey) {
  console.error('OPENAI_API_KEY missing from .env');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normId(id) { return String(id).padStart(3, '0'); }
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findApp() {
  const id = normId(APP_ID);
  const snap = buildApplicationIndex(ROOT);
  return snap.records.find((a) => normId(a.id) === id) || null;
}

function findReport(appId, slug) {
  const id = normId(appId);
  const reportsDir = resolve(ROOT, 'reports');
  if (!existsSync(reportsDir)) return null;
  const files = readdirSync(reportsDir).filter((f) => f.startsWith(`${id}-`) && f.endsWith('.md'));
  if (files.length === 0) return null;
  // If multiple, pick most recent by filename (date is in name)
  return resolve(reportsDir, files.sort().reverse()[0]);
}

function extractReportSignals(reportText) {
  // Pull structured fields by matching the consistent template format.
  const signals = {
    archetype: null,
    score: null,
    tldr: null,
    strongMatches: [],
    gaps: [],
  };

  const archetypeMatch = reportText.match(/\*\*Archetype:\*\*\s*(.+?)(?:\n|$)/);
  if (archetypeMatch) signals.archetype = archetypeMatch[1].trim();

  const scoreMatch = reportText.match(/\*\*Score:\*\*\s*([\d.]+)/);
  if (scoreMatch) signals.score = parseFloat(scoreMatch[1]);

  const tldrMatch = reportText.match(/\*\*TL;DR\*\*\s*\|\s*(.+?)(?:\n|\|)/);
  if (tldrMatch) signals.tldr = tldrMatch[1].trim();

  // Pull rows from "Requirement-to-CV Mapping" table where match column is ✅ Strong
  const tableLines = reportText.split('\n');
  for (const line of tableLines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const req = cells[1];
    const matchCell = cells[2];
    const evidence = cells[3];
    if (matchCell.includes('✅ Strong')) {
      signals.strongMatches.push({ req, evidence });
    }
    if (matchCell.includes('❌ Gap') || matchCell.includes('⚠️ Gap')) {
      signals.gaps.push({ req, evidence, severity: matchCell.includes('❌') ? 'hard' : 'soft' });
    }
  }

  return signals;
}

async function callOpenAI(messages) {
  return retry(async () => {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 500,
        temperature: 0.4,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      const err = new Error(`OpenAI ${r.status}: ${text.slice(0, 300)}`);
      err.status = r.status;
      throw err;
    }
    const j = await r.json();
    return j.choices?.[0]?.message?.content?.trim() || '';
  }, {
    label: 'openai-cover-letter',
    maxAttempts: 3,
    shouldRetry: (e) => {
      const s = e?.status;
      if (s === 400 || s === 401 || s === 403 || s === 404) return false;
      return true;
    },
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

const app = findApp();
if (!app) {
  console.error(`No application found for id ${APP_ID}`);
  process.exit(1);
}

const slug = slugify(app.company);
const reportPath = findReport(app.id, slug);
if (!reportPath) {
  console.error(`No report found for app #${app.id} in reports/`);
  process.exit(1);
}

const reportText = readFileSync(reportPath, 'utf8');
const signals = extractReportSignals(reportText);

const top3 = signals.strongMatches.slice(0, 3);
const top1Gap = signals.gaps[0] || null;

console.log(`[cover-letter] app: #${app.id} ${app.company} · ${app.role}`);
console.log(`[cover-letter] report: ${reportPath}`);
console.log(`[cover-letter] strong matches: ${signals.strongMatches.length}, gaps: ${signals.gaps.length}`);

const systemPrompt = `You write tight, honest cover letters for senior data/BI/AI architect roles. Voice: Matt Morrison Amundson — Operational Data Architect, Minneapolis, ten-plus years in BI/data work across Pretium ($25B portfolio analytics), Land O'Lakes (truck purchase ETL), UltiMed (Power BI org rollout), FirstEnergy (utility compliance reporting), and Greenfield Metal Sales (full BI stack from ERP integration). Senior IC with strategy + hands-on chops. Email is mattmamundson@gmail.com, phone 612-877-1189, LinkedIn linkedin.com/in/mmamundson.

Cover letter rules:
- EXACTLY 3 paragraphs, each 3-5 sentences. Total ~250-350 words.
- Para 1: Hook on the SPECIFIC role + company match. Reference one concrete thing about the company or role. Lead with title fit, not generic enthusiasm.
- Para 2: Two specific evidence bullets pulled from the strongest CV matches. Use real metrics ($X portfolio, X% improvement). NO bullet points — write as flowing sentences.
- Para 3: Honest acknowledgment of the strongest gap, framed as a clear plan to close it. NEVER lie or overclaim. Close with a tight call-to-action ("happy to walk through X in a 20-min call").
- NO em dashes — use periods or "and." NO buzzwords (passionate, synergy, results-driven). NO "I am writing to apply for..."
- Plain text, no markdown. No greeting/signature lines (those get added separately).`;

const userPrompt = `Write a 3-paragraph cover letter for this role.

ROLE: ${app.role}
COMPANY: ${app.company}
ARCHETYPE: ${signals.archetype || 'unspecified'}
SCORE: ${signals.score?.toFixed(1) ?? '?'}/5

TL;DR FROM EVALUATION:
${signals.tldr || '(none captured)'}

STRONGEST CV MATCHES (use 2 of these in para 2):
${top3.map((m, i) => `${i + 1}. ${m.req}\n   Evidence: ${m.evidence}`).join('\n\n')}

${top1Gap ? `BIGGEST GAP (acknowledge in para 3):
- ${top1Gap.req} (${top1Gap.severity})
- Note: ${top1Gap.evidence}` : 'NO MAJOR GAPS — close with strong CTA in para 3 instead.'}

Write the cover letter now. Plain text. 3 paragraphs only.`;

console.log('[cover-letter] Calling OpenAI...');
const draft = await callOpenAI([
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userPrompt },
]);

if (!draft) {
  console.error('[cover-letter] OpenAI returned empty content');
  process.exit(1);
}

// Quality lint — abort on hard errors, surface warnings.
const lint = lintCoverLetter(draft, { strict: false });
console.log('\n' + formatLintReport(lint));
if (lint.errors.length > 0) {
  console.error('\n[cover-letter] ❌ Letter failed quality lint. Re-run (the model is non-deterministic) or refine the system prompt.');
  console.error('[cover-letter] To override and write anyway, add --skip-lint.');
  if (!flag('skip-lint')) {
    process.exit(2);
  }
  console.warn('[cover-letter] --skip-lint: writing despite errors.');
}

const fullLetter = [
  `Dear ${app.company} Hiring Team,`,
  '',
  draft,
  '',
  'Best,',
  'Matthew M. Amundson',
  'mattmamundson@gmail.com · 612.877.1189 · linkedin.com/in/mmamundson',
].join('\n');

if (PRINT_ONLY) {
  console.log('\n' + '─'.repeat(60));
  console.log(fullLetter);
  console.log('─'.repeat(60));
  process.exit(0);
}

const outDir = resolve(ROOT, 'output', 'cover-letters');
mkdirSync(outDir, { recursive: true });
const roleSlug = slugify(app.role).slice(0, 50);
const outPath = resolve(outDir, `${slug}-${roleSlug}.txt`);

if (existsSync(outPath) && !FORCE) {
  console.error(`[cover-letter] File exists: ${outPath}`);
  console.error('[cover-letter] Re-run with --force to overwrite, or --print to preview only.');
  process.exit(1);
}

writeFileSync(outPath, fullLetter, 'utf8');
console.log(`[cover-letter] ✅ Written: ${outPath}`);
console.log(`[cover-letter] ${fullLetter.split('\n').length} lines, ${fullLetter.length} chars`);
