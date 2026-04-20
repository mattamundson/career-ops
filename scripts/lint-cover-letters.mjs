#!/usr/bin/env node
/**
 * lint-cover-letters.mjs
 *
 * Run the cover-letter quality lint over existing letters in
 * output/cover-letters/. Surface buzzwords, em-dashes, generic openers,
 * wrong paragraph count, and missing proof points.
 *
 * Usage:
 *   node scripts/lint-cover-letters.mjs                   # all letters
 *   node scripts/lint-cover-letters.mjs <path-to-letter>  # one file
 *   node scripts/lint-cover-letters.mjs --strict          # em-dash → error
 *   node scripts/lint-cover-letters.mjs --min-score 0.9   # only show letters below threshold
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintCoverLetter, formatLintReport } from './lib/cover-letter-lint.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
const STRICT = args.includes('--strict');

// Parse --min-score N (eat both tokens) and treat remaining bare arg as path.
let MIN_SCORE = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--strict') continue;
  if (a === '--min-score' || a.startsWith('--min-score=')) {
    const val = a.includes('=') ? a.split('=')[1] : args[++i];
    const n = parseFloat(val);
    if (Number.isFinite(n)) MIN_SCORE = n;
    continue;
  }
  if (!a.startsWith('--')) positional.push(a);
}
const PATH_ARG = positional[0] || null;

function collectLetters() {
  if (PATH_ARG) {
    const p = resolve(PATH_ARG);
    if (!existsSync(p)) {
      console.error(`[lint] file not found: ${p}`);
      process.exit(1);
    }
    return [p];
  }
  const dir = resolve(ROOT, 'output', 'cover-letters');
  if (!existsSync(dir)) {
    console.error(`[lint] no output/cover-letters dir at ${dir}`);
    process.exit(1);
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => resolve(dir, f))
    .sort();
}

const files = collectLetters();
console.log(`[lint] Scanning ${files.length} cover letter${files.length === 1 ? '' : 's'}${STRICT ? ' (strict mode)' : ''}...\n`);

let failed = 0;
const surfaced = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  // Skip greeting/signature blocks — lint only the body.
  // Convention: first paragraph is "Dear Hiring Team,", last two lines are sig + contact.
  const bodyLines = text.split('\n');
  const body = bodyLines
    .filter((l, i) => {
      if (i === 0 && /^dear /i.test(l.trim())) return false;
      if (/^best,?\s*$/i.test(l.trim())) return false;
      if (/matthew m\. amundson/i.test(l) || /mattmamundson@gmail/i.test(l)) return false;
      return true;
    })
    .join('\n')
    .trim();

  const result = lintCoverLetter(body, { strict: STRICT });
  const isIssue = result.errors.length > 0 || result.warnings.length > 0;
  const belowMinScore = MIN_SCORE !== null && result.score < MIN_SCORE;
  if (MIN_SCORE !== null && !belowMinScore) continue; // suppress passing letters
  if (result.errors.length > 0) failed++;
  surfaced.push({ file: f.replace(ROOT + '\\', '').replace(ROOT + '/', ''), result });
}

for (const { file, result } of surfaced) {
  console.log(`${file}`);
  console.log(formatLintReport(result).split('\n').map((l) => `  ${l}`).join('\n'));
  console.log('');
}

console.log(`[lint] ${surfaced.length} letter${surfaced.length === 1 ? '' : 's'} surfaced · ${failed} with error(s)`);
process.exit(failed > 0 && MIN_SCORE === null ? 1 : 0);
