#!/usr/bin/env node
/**
 * ATS Pre-Flight Gate
 *
 * Purpose: prevent shipping a CV/PDF that scores poorly against the JD.
 * Called by modes/pdf.md (step 6b) BEFORE invoking generate-pdf/cv-docx-to-pdf.
 *
 * Behavior:
 *   - Compute ATS keyword match via scoreAtsMatch(jdText, cvText).
 *   - If pct >= threshold (default 60) → exit 0, emit automation.ats_gate.passed.
 *   - If pct <  threshold             → exit 1, emit automation.ats_gate.blocked,
 *                                        print top-3 missing keywords to stderr.
 *   - --force overrides the block (still emits .passed with force=true).
 *
 * Usage:
 *   node scripts/ats-gate.mjs --jd=jds/acme.txt [--cv=cv.md] [--threshold=60] [--force]
 *   node scripts/ats-gate.mjs --jd=jds/acme.txt --json  (machine-readable output)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isMainEntry } from './lib/main-entry.mjs';
import { scoreAtsMatch, addSuggestion } from './ats-score.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DEFAULT_THRESHOLD = 60;

export function parseGateArgs(argv) {
  const args = Object.fromEntries(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
  );
  return {
    jd: args.jd,
    cv: args.cv ?? 'cv.md',
    threshold: Number(args.threshold ?? DEFAULT_THRESHOLD),
    force: Boolean(args.force),
    json: Boolean(args.json),
    company: args.company ?? null,
    role: args.role ?? null,
  };
}

/**
 * Run the gate against provided texts. Pure — no I/O, no events.
 * Returns { passed, pct, matched, missing, keywords, threshold, forced }.
 */
export function evaluateGate(jdText, cvText, { threshold = DEFAULT_THRESHOLD, force = false } = {}) {
  const { pct, matched, missing, keywords } = scoreAtsMatch(jdText, cvText);
  const meetsBar = pct >= threshold;
  const passed = meetsBar || force;
  return {
    passed,
    meetsBar,
    forced: force && !meetsBar,
    pct,
    matched,
    missing,
    keywords,
    threshold,
  };
}

function main() {
  const opts = parseGateArgs(process.argv.slice(2));
  if (!opts.jd) {
    console.error('Error: --jd=<path> is required');
    process.exit(2);
  }

  const jdPath = resolve(ROOT, opts.jd);
  const cvPath = resolve(ROOT, opts.cv);

  let jdText, cvText;
  try { jdText = readFileSync(jdPath, 'utf8'); }
  catch { console.error(`Error: Cannot read JD file: ${jdPath}`); process.exit(2); }
  try { cvText = readFileSync(cvPath, 'utf8'); }
  catch { console.error(`Error: Cannot read CV file: ${cvPath}`); process.exit(2); }

  const result = evaluateGate(jdText, cvText, { threshold: opts.threshold, force: opts.force });
  const top3Missing = result.missing.slice(0, 3);

  const eventDetails = {
    jd_path: opts.jd,
    cv_path: opts.cv,
    threshold: result.threshold,
    pct: result.pct,
    matched_count: result.matched.length,
    missing_count: result.missing.length,
    top_missing: top3Missing,
    forced: result.forced,
    company: opts.company,
    role: opts.role,
  };

  try {
    appendAutomationEvent(ROOT, {
      type: result.meetsBar ? 'automation.ats_gate.passed' : (result.forced ? 'automation.ats_gate.forced' : 'automation.ats_gate.blocked'),
      status: result.meetsBar || result.forced ? 'ok' : 'blocked',
      summary: `ATS gate ${result.meetsBar ? 'passed' : (result.forced ? 'forced' : 'blocked')} at ${result.pct}% (threshold ${result.threshold}%)`,
      details: eventDetails,
    });
  } catch (e) {
    console.error(`[ats-gate] WARN: failed to append event: ${e.message}`);
  }

  if (opts.json) {
    console.log(JSON.stringify({ ...result, top_missing: top3Missing }, null, 2));
  } else {
    const line = '─'.repeat(60);
    const tag = result.meetsBar ? 'PASSED' : (result.forced ? 'FORCED' : 'BLOCKED');
    console.log('');
    console.log(line);
    console.log(`ATS Gate: ${tag} — ${result.pct}% vs threshold ${result.threshold}%`);
    console.log(line);
    if (!result.meetsBar) {
      console.log('\nTop 3 missing keywords:');
      top3Missing.forEach((term, i) => {
        console.log(`  ${i + 1}. ${term} — ${addSuggestion(term)}`);
      });
      if (!result.forced) {
        console.log('\nHALT: PDF generation blocked. Options:');
        console.log('  1. Revise CV to cover missing keywords, re-run gate.');
        console.log('  2. Re-run with --force to override (logged).');
      } else {
        console.log('\nOVERRIDE: --force present — PDF generation may proceed.');
      }
    }
    console.log('');
  }

  process.exit(result.passed ? 0 : 1);
}

if (isMainEntry(import.meta.url)) {
  main();
}
