#!/usr/bin/env node
/**
 * regen-cover-letters.mjs
 *
 * Bulk-regenerate cover letters that fail the quality lint, but ONLY for
 * apps currently in GO / Conditional GO / Ready to Submit (no point
 * regenning Rescale or V4C if they are Discarded). Up to 2 retries per
 * letter (the OpenAI model is non-deterministic and may slip a buzzword
 * on attempt 1).
 *
 * Usage:
 *   node scripts/regen-cover-letters.mjs              # dry-run (shows what would regen)
 *   node scripts/regen-cover-letters.mjs --apply      # actually regen + write
 *   node scripts/regen-cover-letters.mjs --max 5      # cap regen attempts
 *   node scripts/regen-cover-letters.mjs --strict     # treat warnings as needing regen
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { buildApplicationIndex } from './lib/career-data.mjs';
import { lintCoverLetter } from './lib/cover-letter-lint.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STRICT = args.includes('--strict');
const maxArg = args.find((a) => a.startsWith('--max'));
const MAX = maxArg ? parseInt(args[args.indexOf(maxArg) + 1] || maxArg.split('=')[1] || '99', 10) : 99;

const ACTIVE_STATUSES = new Set(['GO', 'Conditional GO', 'Ready to Submit']);

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function letterPathFor(app) {
  // generate-cover-letter writes to {company-slug}-{role-slug}.txt with role-slug capped at 50.
  // Multiple variants may exist for one app (different role slugs over time);
  // we want the most-recently-modified, since that's what generate-cover-letter
  // would write next.
  const cl = resolve(ROOT, 'output', 'cover-letters');
  if (!existsSync(cl)) return null;
  const companySlug = slugify(app.company);
  const compactCompany = companySlug.replace(/-/g, '');
  const candidates = readdirSync(cl)
    .filter((f) => f.endsWith('.txt') && (f.toLowerCase().includes(companySlug) || f.toLowerCase().includes(compactCompany)))
    .map((f) => ({ f, mtime: statSync(resolve(cl, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) return null;
  return resolve(cl, candidates[0].f);
}

function bodyOnly(text) {
  return text.split('\n').filter((l, i) => {
    if (i === 0 && /^dear /i.test(l.trim())) return false;
    if (/^best,?\s*$/i.test(l.trim())) return false;
    if (/matthew m\. amundson/i.test(l) || /mattmamundson@gmail/i.test(l)) return false;
    return true;
  }).join('\n').trim();
}

const snapshot = buildApplicationIndex(ROOT);
const queue = snapshot.records.filter((a) => ACTIVE_STATUSES.has(a.status));

const targets = [];
for (const app of queue) {
  const path = letterPathFor(app);
  if (!path) continue; // no existing letter
  const text = readFileSync(path, 'utf8');
  const lint = lintCoverLetter(bodyOnly(text), { strict: STRICT });
  const needsRegen = lint.errors.length > 0 || (STRICT && lint.warnings.length > 0);
  if (needsRegen) {
    targets.push({ app_id: app.id, company: app.company, role: app.role, path, score: lint.score, issues: [...lint.errors, ...lint.warnings] });
  }
}

console.log(`[regen] ${targets.length} letter${targets.length === 1 ? '' : 's'} need regen ${STRICT ? '(strict)' : ''}`);
for (const t of targets.slice(0, MAX)) {
  console.log(`  #${t.app_id} ${t.company} (score ${t.score.toFixed(2)}) — ${t.issues.length} issue(s)`);
}

if (!APPLY) {
  console.log(`\n[regen] Dry-run. Re-run with --apply to actually regenerate.`);
  process.exit(0);
}

const generator = resolve(__dir, 'generate-cover-letter.mjs');
let regenerated = 0;
let stillFailing = 0;
for (const t of targets.slice(0, MAX)) {
  console.log(`\n[regen] Regenerating #${t.app_id} ${t.company}...`);
  let success = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      execSync(`node "${generator}" --app-id ${t.app_id} --force`, {
        cwd: ROOT,
        stdio: 'inherit',
        timeout: 60_000,
      });
      success = true;
      break;
    } catch (e) {
      console.warn(`  Attempt ${attempt} failed (likely lint-blocked); retrying...`);
    }
  }
  if (success) { regenerated++; }
  else { stillFailing++; console.warn(`  ❌ #${t.app_id} ${t.company} still failing after 2 attempts`); }
}

console.log(`\n[regen] Done. ${regenerated} regenerated · ${stillFailing} still failing`);
