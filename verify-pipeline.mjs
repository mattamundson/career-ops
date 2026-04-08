#!/usr/bin/env node
/**
 * verify-pipeline.mjs — Health check for career-ops pipeline integrity
 *
 * Checks:
 * 1. All statuses are canonical (per states.yml)
 * 2. No duplicate company+role entries
 * 3. All report links point to existing files
 * 4. Scores match format X.XX/5 or N/A or DUP
 * 5. All rows have proper pipe-delimited format
 * 6. No pending TSVs in tracker-additions/ (only in merged/ or archived/)
 * 7. states.yml canonical IDs for cross-system consistency
 *
 * Run: node career-ops/verify-pipeline.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const CAREER_OPS = fileURLToPath(new URL('.', import.meta.url));
// Support both layouts: data/applications.md (boilerplate) and applications.md (original)
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const ADDITIONS_DIR = join(CAREER_OPS, 'batch/tracker-additions');
const REPORTS_DIR = join(CAREER_OPS, 'reports');
const STATES_FILE = existsSync(join(CAREER_OPS, 'templates/states.yml'))
  ? join(CAREER_OPS, 'templates/states.yml')
  : join(CAREER_OPS, 'states.yml');

const CANONICAL_STATUSES = [
  'evaluated', 'applied', 'responded', 'contact',
  'interview', 'offer', 'rejected', 'discarded', 'skip',
];

const ALIASES = {
  'evaluada': 'evaluated', 'condicional': 'evaluated', 'hold': 'evaluated', 'evaluar': 'evaluated', 'verificar': 'evaluated', 'monitor': 'evaluated',
  'aplicado': 'applied', 'enviada': 'applied', 'aplicada': 'applied', 'sent': 'applied',
  'respondido': 'responded',
  'entrevista': 'interview',
  'oferta': 'offer',
  'rechazado': 'rejected', 'rechazada': 'rejected',
  'descartado': 'discarded', 'descartada': 'discarded', 'cerrada': 'discarded', 'cancelada': 'discarded',
  'no aplicar': 'skip', 'no_aplicar': 'skip',
};

let errors = 0;
let warnings = 0;

function error(msg) { console.log(`❌ ${msg}`); errors++; }
function warn(msg) { console.log(`⚠️  ${msg}`); warnings++; }
function ok(msg) { console.log(`✅ ${msg}`); }

// --- Read applications.md ---
if (!existsSync(APPS_FILE)) {
  console.log('\n📊 No applications.md found. This is normal for a fresh setup.');
  console.log('   The file will be created when you evaluate your first offer.\n');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

const entries = [];
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length < 9) continue;
  const num = parseInt(parts[1]);
  if (isNaN(num)) continue;
  entries.push({
    num, date: parts[2], company: parts[3], role: parts[4],
    score: parts[5], status: parts[6], pdf: parts[7], report: parts[8],
    notes: parts[9] || '',
  });
}

console.log(`\n📊 Checking ${entries.length} entries in applications.md\n`);

// --- Check 1: Canonical statuses ---
let badStatuses = 0;
for (const e of entries) {
  const clean = e.status.replace(/\*\*/g, '').trim().toLowerCase();
  // Strip trailing dates
  const statusOnly = clean.replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();

  if (!CANONICAL_STATUSES.includes(statusOnly) && !ALIASES[statusOnly]) {
    error(`#${e.num}: Non-canonical status "${e.status}"`);
    badStatuses++;
  }

  // Check for markdown bold in status
  if (e.status.includes('**')) {
    error(`#${e.num}: Status contains markdown bold: "${e.status}"`);
    badStatuses++;
  }

  // Check for dates in status
  if (/\d{4}-\d{2}-\d{2}/.test(e.status)) {
    error(`#${e.num}: Status contains date: "${e.status}" — dates go in date column`);
    badStatuses++;
  }
}
if (badStatuses === 0) ok('All statuses are canonical');

// --- Check 2: Duplicates ---
const companyRoleMap = new Map();
let dupes = 0;
for (const e of entries) {
  const key = e.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '::' +
    e.role.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (!companyRoleMap.has(key)) companyRoleMap.set(key, []);
  companyRoleMap.get(key).push(e);
}
for (const [key, group] of companyRoleMap) {
  if (group.length > 1) {
    warn(`Possible duplicates: ${group.map(e => `#${e.num}`).join(', ')} (${group[0].company} — ${group[0].role})`);
    dupes++;
  }
}
if (dupes === 0) ok('No exact duplicates found');

// --- Check 3: Report links ---
let brokenReports = 0;
for (const e of entries) {
  const match = e.report.match(/\]\(([^)]+)\)/);
  if (!match) continue;
  const reportPath = join(CAREER_OPS, match[1]);
  if (!existsSync(reportPath)) {
    error(`#${e.num}: Report not found: ${match[1]}`);
    brokenReports++;
  }
}
if (brokenReports === 0) ok('All report links valid');

// --- Check 4: Score format ---
let badScores = 0;
for (const e of entries) {
  const s = e.score.replace(/\*\*/g, '').trim();
  if (!/^\d+\.?\d*\/5$/.test(s) && s !== 'N/A' && s !== 'DUP') {
    error(`#${e.num}: Invalid score format: "${e.score}"`);
    badScores++;
  }
}
if (badScores === 0) ok('All scores valid');

// --- Check 5: Row format ---
let badRows = 0;
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  if (line.includes('---') || line.includes('Empresa')) continue;
  const parts = line.split('|');
  if (parts.length < 9) {
    error(`Row with <9 columns: ${line.substring(0, 80)}...`);
    badRows++;
  }
}
if (badRows === 0) ok('All rows properly formatted');

// --- Check 6: Pending TSVs ---
let pendingTsvs = 0;
if (existsSync(ADDITIONS_DIR)) {
  const files = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
  pendingTsvs = files.length;
  if (pendingTsvs > 0) {
    warn(`${pendingTsvs} pending TSVs in tracker-additions/ (not merged)`);
  }
}
if (pendingTsvs === 0) ok('No pending TSVs');

// --- Check 7: Bold in scores ---
let boldScores = 0;
for (const e of entries) {
  if (e.score.includes('**')) {
    warn(`#${e.num}: Score has markdown bold: "${e.score}"`);
    boldScores++;
  }
}
if (boldScores === 0) ok('No bold in scores');

// --- Summary ---
console.log('\n' + '='.repeat(50));
console.log(`📊 Pipeline Health: ${errors} errors, ${warnings} warnings`);
if (errors === 0 && warnings === 0) {
  console.log('🟢 Pipeline is clean!');
} else if (errors === 0) {
  console.log('🟡 Pipeline OK with warnings');
} else {
  console.log('🔴 Pipeline has errors — fix before proceeding');
}

// --- Check 8: Stale cadence (--stale-check flag) ---
if (process.argv.includes('--stale-check')) {
  const CADENCE_DEFAULTS = {
    evaluated_days: 14,
    applied_days:   7,
    responded_days: 5,
    contact_days:   5,
    interview_days: 10,
  };

  function loadCadenceThresholds() {
    try {
      const profilePath = join(CAREER_OPS, 'config/profile.yml');
      if (!existsSync(profilePath)) return { ...CADENCE_DEFAULTS };
      const yml = readFileSync(profilePath, 'utf8');
      const cadence = {};
      let inCadence = false;
      for (const raw of yml.split('\n')) {
        const line = raw.trimEnd();
        if (!line || line.startsWith('#')) continue;
        if (/^cadence:\s*$/.test(line)) { inCadence = true; continue; }
        if (inCadence && /^  ([a-zA-Z_]+):\s*(\d+)/.test(line)) {
          const m = line.match(/^  ([a-zA-Z_]+):\s*(\d+)/);
          cadence[m[1]] = Number(m[2]);
        } else if (inCadence && !/^ /.test(line)) {
          inCadence = false;
        }
      }
      return Object.keys(cadence).length > 0
        ? { ...CADENCE_DEFAULTS, ...cadence }
        : { ...CADENCE_DEFAULTS };
    } catch { return { ...CADENCE_DEFAULTS }; }
  }

  function cadenceThreshold(status, thresholds) {
    const s = (status || '').toLowerCase().trim();
    const map = {
      evaluated: thresholds.evaluated_days,
      applied:   thresholds.applied_days,
      responded: thresholds.responded_days,
      contact:   thresholds.contact_days,
      interview: thresholds.interview_days,
    };
    return map[s] ?? null;
  }

  function cadenceAction(status) {
    const s = (status || '').toLowerCase().trim();
    const actions = {
      evaluated: 'Submit application or archive',
      applied:   'Send follow-up email',
      responded: 'Schedule next step or reply',
      contact:   'Follow up with contact',
      interview: 'Send thank-you / request decision',
    };
    return actions[s] ?? 'Review and act';
  }

  const TODAY_MS = Date.now();
  const thresholds = loadCadenceThresholds();
  let staleCount = 0;

  for (const e of entries) {
    const d = new Date(e.date);
    if (isNaN(d)) continue;
    const days = Math.floor((TODAY_MS - d.getTime()) / (1000 * 60 * 60 * 24));
    const statusClean = (e.status || '').replace(/\*\*/g, '').trim().toLowerCase()
      .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
    const threshold = cadenceThreshold(statusClean, thresholds);
    if (threshold === null) continue;
    if (days >= threshold) {
      const overdue = days - threshold;
      warn(`Stale #${e.num}: ${e.company} — ${e.role} | ${statusClean} | ${days}d (+${overdue}d over) | ${cadenceAction(statusClean)}`);
      staleCount++;
    }
  }
  if (staleCount === 0) ok('Cadence check: all follow-ups within cadence');
}

process.exit(errors > 0 ? 1 : 0);
