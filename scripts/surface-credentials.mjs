#!/usr/bin/env node
/**
 * surface-credentials.mjs — Dormant-credential surfacer
 *
 * Cross-references a JD (or report) against profile.yml `dormant_credentials`.
 * Prints any credentials whose trigger_keywords appear in the JD text.
 *
 * Purpose: Matt has low-frequency high-specificity experience (Land O'Lakes
 * ag-coop, FirstEnergy NERC-CIP, Pretium $25B AUM) that drives eval quality
 * when a JD matches — but these are buried in his CV and easy to forget at
 * eval time. This script raises them automatically.
 *
 * Usage:
 *   node scripts/surface-credentials.mjs --jd=jds/pivot-bio.md
 *   node scripts/surface-credentials.mjs --report-num=219
 *   node scripts/surface-credentials.mjs --report-num=219 --json
 *   node scripts/surface-credentials.mjs --report-num=219 --inject
 *     # appends a "## Dormant Credentials Surfaced" section to the report
 *
 * Output (default):
 *   3 dormant credential(s) matched for #219:
 *     • Land O'Lakes agricultural cooperative experience (triggers: agriculture, crop, ...)
 *       15-month analytics lead on a Fortune 500 agricultural...
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntry } from './lib/main-entry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const PROFILE = resolve(ROOT, 'config', 'profile.yml');

// ── Args ────────────────────────────────────────────────────────────────────

export function parseSurfaceArgs(argv) {
  const out = { jd: null, reportNum: null, json: false, inject: false };
  for (const a of argv) {
    if (a.startsWith('--jd=')) out.jd = a.slice(5);
    else if (a.startsWith('--report-num=')) out.reportNum = a.slice(13);
    else if (a === '--json') out.json = true;
    else if (a === '--inject') out.inject = true;
  }
  return out;
}

// ── YAML helpers (minimal parser for dormant_credentials block) ────────────

export function parseDormantCredentials(profileYml) {
  // Locate the `dormant_credentials:` block and parse its list-of-maps.
  // Lightweight parser — just enough for this schema.
  const body = profileYml;
  const startMatch = body.match(/^dormant_credentials:[ \t]*\n/m);
  if (!startMatch) return [];
  const startIdx = startMatch.index + startMatch[0].length;
  // Block ends at next top-level key (line starting with non-space + :) or EOF
  const after = body.slice(startIdx);
  const endMatch = after.match(/^[A-Za-z_][A-Za-z0-9_]*:/m);
  const block = endMatch ? after.slice(0, endMatch.index) : after;

  const credentials = [];
  let current = null;
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // New credential entry
    const nameMatch = line.match(/^\s*-\s+name:\s*["']?(.+?)["']?\s*$/);
    if (nameMatch) {
      if (current) credentials.push(current);
      current = { name: nameMatch[1].trim(), trigger_keywords: [], experience_blurb: '' };
      continue;
    }
    if (!current) continue;
    const blurbMatch = line.match(/^\s+experience_blurb:\s*["']?(.+?)["']?\s*$/);
    if (blurbMatch) {
      current.experience_blurb = blurbMatch[1].trim();
      continue;
    }
    if (/^\s+trigger_keywords:/.test(line)) {
      // Following lines are `      - "keyword"` until non-indent or next key
      for (let j = i + 1; j < lines.length; j++) {
        const kw = lines[j].match(/^\s+-\s+["']?([^"'\n]+?)["']?\s*$/);
        if (!kw) break;
        current.trigger_keywords.push(kw[1].trim().toLowerCase());
        i = j; // advance outer loop
      }
    }
  }
  if (current) credentials.push(current);
  return credentials;
}

export function surfaceMatches(jdText, credentials) {
  const lower = String(jdText || '').toLowerCase();
  const matches = [];
  for (const cred of credentials) {
    const triggers = cred.trigger_keywords.filter((kw) => {
      // Whole-word match for single-token triggers, substring match for multi-word
      const kwNorm = kw.toLowerCase();
      if (kwNorm.includes(' ') || kwNorm.includes('-')) {
        return lower.includes(kwNorm);
      }
      const re = new RegExp(`\\b${kwNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return re.test(lower);
    });
    if (triggers.length > 0) {
      matches.push({ ...cred, matched_triggers: triggers });
    }
  }
  return matches;
}

// ── Input resolution ────────────────────────────────────────────────────────

function findReport(reportNum) {
  const id = String(reportNum).padStart(3, '0');
  const dir = resolve(ROOT, 'reports');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => x.startsWith(`${id}-`) && x.endsWith('.md'));
  return f ? resolve(dir, f) : null;
}

function loadJdText(opts) {
  if (opts.jd) {
    const path = resolve(ROOT, opts.jd);
    return readFileSync(path, 'utf8');
  }
  if (opts.reportNum) {
    const reportPath = findReport(opts.reportNum);
    if (!reportPath) throw new Error(`Report #${opts.reportNum} not found`);
    // Report contains both summary + JD quotes; surface against the whole thing
    return readFileSync(reportPath, 'utf8');
  }
  throw new Error('Provide --jd=<path> or --report-num=<N>');
}

// ── Main ────────────────────────────────────────────────────────────────────

export function surfaceCredentials(opts) {
  if (!existsSync(PROFILE)) {
    throw new Error(`profile.yml not found at ${PROFILE}`);
  }
  const profile = readFileSync(PROFILE, 'utf8');
  const credentials = parseDormantCredentials(profile);
  if (credentials.length === 0) {
    return { matches: [], credentials_count: 0 };
  }
  const text = loadJdText(opts);
  const matches = surfaceMatches(text, credentials);
  return { matches, credentials_count: credentials.length };
}

function renderSurfaceSection(matches) {
  if (matches.length === 0) {
    return '\n## Dormant Credentials Surfaced\n\n_None triggered by this JD._\n';
  }
  const out = ['\n## Dormant Credentials Surfaced', ''];
  for (const m of matches) {
    out.push(`### ${m.name}`);
    out.push('');
    out.push(`**Triggers matched:** ${m.matched_triggers.join(', ')}`);
    out.push('');
    out.push(m.experience_blurb);
    out.push('');
  }
  return out.join('\n');
}

function main() {
  const opts = parseSurfaceArgs(process.argv.slice(2));
  if (!opts.jd && !opts.reportNum) {
    console.error('Usage: node scripts/surface-credentials.mjs --jd=<path>|--report-num=<N> [--json] [--inject]');
    process.exit(2);
  }
  try {
    const { matches, credentials_count } = surfaceCredentials(opts);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ matches, credentials_count }, null, 2) + '\n');
      process.exit(0);
    }
    if (opts.inject && opts.reportNum) {
      const reportPath = findReport(opts.reportNum);
      if (!reportPath) {
        console.error(`Report #${opts.reportNum} not found`);
        process.exit(1);
      }
      const body = readFileSync(reportPath, 'utf8');
      // Replace existing section if present, else append
      const section = renderSurfaceSection(matches);
      let updated;
      if (/^## Dormant Credentials Surfaced/m.test(body)) {
        updated = body.replace(
          /## Dormant Credentials Surfaced[\s\S]*?(?=\n## |$)/m,
          section.trim() + '\n\n'
        );
      } else {
        updated = body.trimEnd() + '\n' + section;
      }
      writeFileSync(reportPath, updated, 'utf8');
      console.log(`✓ Injected "Dormant Credentials Surfaced" into ${reportPath} (${matches.length} match(es))`);
      process.exit(0);
    }
    // Human-readable output
    if (matches.length === 0) {
      console.log(`No dormant credentials matched (checked ${credentials_count}).`);
      process.exit(0);
    }
    console.log(`${matches.length} dormant credential(s) matched (of ${credentials_count} total):\n`);
    for (const m of matches) {
      console.log(`• ${m.name}`);
      console.log(`  Triggers: ${m.matched_triggers.join(', ')}`);
      console.log(`  ${m.experience_blurb}\n`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`surface-credentials: ${err.message}`);
    process.exit(1);
  }
}

if (isMainEntry(import.meta.url)) {
  main();
}
