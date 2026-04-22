#!/usr/bin/env node
/**
 * weekly-scorecard.mjs — Pre-fill the weekly scorecard from docs/career-search-roadmap-2026.md
 *
 * Uses data/applications.md + data/responses.md + (optional) data/outreach/*.md mtimes.
 *
 * Usage:
 *   node scripts/weekly-scorecard.mjs
 *   node scripts/weekly-scorecard.mjs --week-ending=2026-04-22
 *   node scripts/weekly-scorecard.mjs --json
 *   node scripts/weekly-scorecard.mjs --phase-a
 *   node scripts/weekly-scorecard.mjs --run-verify   # runs pnpm run verify:ci (slow)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseApplicationsTracker } from './lib/career-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..');

/** @type {Set<string>} Human-touch events (aligned with daily-digest recruiter-adjacent signals) */
const CONVERSATION_EVENTS = new Set([
  'acknowledged',
  'recruiter_reply',
  'phone_screen_scheduled',
  'phone_screen_done',
  'on_site_scheduled',
  'interview',
  'offer',
  'rejected',
]);

export function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  let weekEnding = null;
  let json = false;
  let phaseA = false;
  let runVerify = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '--phase-a') phaseA = true;
    else if (a === '--run-verify') runVerify = true;
    else if (a.startsWith('--root=')) root = resolve(a.slice('--root='.length));
    else if (a.startsWith('--week-ending=')) weekEnding = a.slice('--week-ending='.length).trim();
  }
  return { root, weekEnding, json, phaseA, runVerify };
}

/** @returns {{ start: string, end: string, endDate: Date }} */
export function weekRange(weekEndingYmd) {
  const [y, m, d] = weekEndingYmd.split('-').map(Number);
  const endDate = new Date(y, m - 1, d);
  endDate.setHours(12, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;
  const end = weekEndingYmd;
  return { start, end, endDate };
}

function todayYmd() {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function inYmdRange(ymd, start, end) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  return ymd >= start && ymd <= end;
}

function parseResponsesLog(root) {
  const path = join(root, 'data', 'responses.md');
  if (!existsSync(path)) return [];
  const body = readFileSync(path, 'utf8');
  const out = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|') || line.startsWith('|--')) continue;
    if (line.startsWith('| app_id')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 9 || !/^\d+$/.test(cells[0])) continue;
    out.push({
      app_id: cells[0],
      company: cells[1],
      role: cells[2],
      submitted_at: cells[3],
      ats: cells[4],
      event: cells[5],
      last_event_at: cells[6],
      response_days: cells[7],
      notes: cells[8],
    });
  }
  return out;
}

function parseYamlCadence(text) {
  const result = {};
  const lines = text.split('\n');
  let currentSection = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*$/);
    if (topMatch) {
      currentSection = topMatch[1];
      result[currentSection] = {};
      continue;
    }
    const nestedMatch = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)$/);
    if (nestedMatch && currentSection) {
      const key = nestedMatch[1];
      const rawVal = nestedMatch[2].trim().replace(/^["']|["']$/g, '');
      const num = Number(rawVal);
      result[currentSection][key] = Number.isNaN(num) ? rawVal : num;
    }
  }
  return result;
}

const DEFAULT_THRESHOLDS = {
  evaluated_days: 14,
  go_days: 10,
  conditional_go_days: 14,
  ready_to_submit_days: 5,
  in_progress_days: 4,
  applied_days: 7,
  responded_days: 5,
  contact_days: 5,
  interview_days: 10,
};

function loadThresholds(root) {
  try {
    const yml = readFileSync(join(root, 'config', 'profile.yml'), 'utf8');
    const parsed = parseYamlCadence(yml);
    if (parsed.cadence && Object.keys(parsed.cadence).length > 0) {
      return { ...DEFAULT_THRESHOLDS, ...parsed.cadence };
    }
  } catch { /* ok */ }
  return { ...DEFAULT_THRESHOLDS };
}

function getThreshold(status, thresholds) {
  const s = status.toLowerCase().trim();
  const map = {
    go: thresholds.go_days ?? thresholds.evaluated_days,
    'conditional go': thresholds.conditional_go_days ?? thresholds.evaluated_days,
    'ready to submit': thresholds.ready_to_submit_days ?? 5,
    'in progress': thresholds.in_progress_days ?? 4,
    evaluated: thresholds.evaluated_days,
    applied: thresholds.applied_days,
    responded: thresholds.responded_days,
    contact: thresholds.contact_days,
    interview: thresholds.interview_days,
  };
  return map[s] ?? null;
}

function daysSince(dateStr, todayMidnight) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return Math.floor((todayMidnight - d) / (1000 * 60 * 60 * 24));
}

function countStaleRows(apps, thresholds) {
  const TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);
  let n = 0;
  for (const row of apps) {
    const { date, status } = row;
    const days = daysSince(date, TODAY);
    if (days === null) continue;
    const th = getThreshold(status, thresholds);
    if (th === null) continue;
    if (days >= th) n += 1;
  }
  return n;
}

function countOutreachFiles(root, start, end) {
  const dir = join(root, 'data', 'outreach');
  if (!existsSync(dir)) return { count: 0, note: 'no data/outreach/ directory' };
  let count = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === '.gitkeep') continue;
    const p = join(dir, name);
    try {
      const st = statSync(p);
      const m = st.mtime;
      const y = m.getFullYear();
      const mo = String(m.getMonth() + 1).padStart(2, '0');
      const d = String(m.getDate()).padStart(2, '0');
      const ymd = `${y}-${mo}-${d}`;
      if (inYmdRange(ymd, start, end)) count += 1;
    } catch { /* skip */ }
  }
  return {
    count,
    note: 'file mtime in week (roadmap 3.5+ score is manual)',
  };
}

function runVerifyCi(root) {
  const r = spawnSync('pnpm', ['run', 'verify:ci'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { ok: r.status === 0, status: r.status ?? -1, stderr: r.stderr || '', stdout: (r.stdout || '').slice(-2000) };
}

export function buildMetrics(root, { start, end }) {
  const apps = parseApplicationsTracker(root);
  const responses = parseResponsesLog(root);
  const thresholds = loadThresholds(root);

  const submitted = responses.filter(
    (r) => inYmdRange(r.submitted_at, start, end),
  );
  const submittedCount = submitted.length;

  const convoApps = new Set();
  for (const r of responses) {
    if (!CONVERSATION_EVENTS.has(r.event)) continue;
    if (!inYmdRange(r.last_event_at, start, end)) continue;
    convoApps.add(r.app_id);
  }
  const conversationCount = convoApps.size;

  const interviewFromResponses = responses.filter(
    (r) => r.event === 'interview' && inYmdRange(r.last_event_at, start, end),
  ).length;

  const interviewFromTracker = apps.filter(
    (a) => a.status === 'Interview' && inYmdRange(a.date, start, end),
  ).length;

  const interviewsTotal = Math.max(interviewFromResponses, interviewFromTracker);

  const outreach = countOutreachFiles(root, start, end);

  const staleNow = countStaleRows(apps, thresholds);

  const goN = apps.filter((a) => a.status === 'GO').length;
  const condN = apps.filter((a) => a.status === 'Conditional GO').length;
  const readyN = apps.filter((a) => a.status === 'Ready to Submit').length;

  return {
    week: { start, end },
    applications_submitted: submittedCount,
    recruiter_hm_conversations: conversationCount,
    interviews: interviewsTotal,
    interview_detail: { from_responses: interviewFromResponses, from_tracker: interviewFromTracker },
    outreach_files_touched: outreach.count,
    outreach_note: outreach.note,
    stale_rows_now: staleNow,
    queue: { go: goN, conditional_go: condN, ready_to_submit: readyN },
  };
}

function printText(root, m, { phaseA }) {
  const { start, end } = m.week;
  console.log('');
  console.log('Weekly scorecard (from tracker + responses)');
  console.log('────────────────────────────────────────────');
  console.log(`Week: ${start}  →  ${end}  (7 days, inclusive)`);
  console.log('');
  console.log(`Applications submitted:              ${m.applications_submitted}`);
  console.log(`Recruiter / HM touch (distinct apps): ${m.recruiter_hm_conversations}`);
  console.log(`Interviews (max of tracker vs events):  ${m.interviews}`);
  if (m.interview_detail.from_responses !== m.interview_detail.from_tracker) {
    console.log(`  (responses "interview" events: ${m.interview_detail.from_responses}, tracker date+Interview: ${m.interview_detail.from_tracker})`);
  }
  console.log(`Outreach files touched (heuristic):  ${m.outreach_files_touched}  — ${m.outreach_note}`);
  console.log(`Stale rows (over cadence, now):      ${m.stale_rows_now}`);
  console.log('');
  console.log('Queue snapshot:  GO: %d  |  Conditional GO: %d  |  Ready to Submit: %d',
    m.queue.go, m.queue.conditional_go, m.queue.ready_to_submit);
  console.log('');
  console.log('Copy/paste block (fill manual lines as needed):');
  console.log('---');
  console.log(`Week ending: ${end}`);
  console.log('');
  console.log(`Applications submitted (quality, you reviewed): ${m.applications_submitted}  (from responses.md submitted_at in range)`);
  console.log('Recruiter / HM conversations held: ' + m.recruiter_hm_conversations + '  (distinct apps, human-touch events in range on last_event_at)');
  console.log('Interviews (any stage): ' + m.interviews);
  console.log('Outreach sent (3.5+ only): ___  (script only counted outreach/ file mtimes; verify scores manually)');
  console.log('Rows moved out of "stale" (follow-up, discard, defer): ___');
  if (m.verify) {
    console.log(`System: verify:ci: ${m.verify.ok ? 'Pass' : 'Fail'} (exit ${m.verify.status})`);
  } else {
    console.log('System: verify:all or verify:ci last run: ___   Pass/Fail: ___  (re-run: pnpm run scorecard:week -- --run-verify)');
  }
  console.log('Biggest blocker (one line): ___');
  console.log('---');

  if (phaseA) {
    console.log('');
    console.log('Phase A — batch workflow (from docs/career-search-roadmap-2026.md)');
    console.log('  [ ] pnpm run prep-queue -- --dry-run');
    console.log('  [ ] pnpm run prep-queue -- --min-score=3 --limit=3');
    console.log('  [ ] pnpm run apply-review:batch -- --prepare --dry-run --ids=016,042');
    console.log('  [ ] pnpm run health   (or verify:all when you have time)');
    console.log('  [ ] After evening scan: tail data/events for scanner (no setSourceAttempted / TDZ)');
  }
  console.log('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const endArg = args.weekEnding || todayYmd();
  const { start, end: endS } = weekRange(endArg);
  const m = buildMetrics(args.root, { start, end: endS });

  if (args.runVerify) {
    m.verify = runVerifyCi(args.root);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(m, null, 2) + '\n');
    return;
  }

  printText(args.root, m, { phaseA: args.phaseA });
  if (m.verify) {
    const v = m.verify;
    console.log('─ verify:ci ' + (v.ok ? 'OK' : 'FAILED') + ' ─');
    if (!v.ok && v.stderr) process.stderr.write(v.stderr.slice(0, 2000) + (v.stderr.length > 2000 ? '\n…' : ''));
  }
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main();
}
