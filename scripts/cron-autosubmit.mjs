#!/usr/bin/env node
/**
 * cron-autosubmit.mjs — 24/7 autonomous application submission engine
 *
 * Reads apply-queue.md, filters "Ready to Submit" entries with score ≥ 4.0
 * on safe ATS platforms (Greenhouse, Ashby, Lever), and submits up to the
 * daily cap. Designed to run unattended on a 2-hour schedule.
 *
 * Safety gates (ALL must pass before any submission):
 *   - queueStatus contains "Ready to Submit"
 *   - Score ≥ 4.0 from evaluation report
 *   - ATS is greenhouse | ashby | lever only (LinkedIn/iCIMS/Workday hard-skipped)
 *   - PDF and CL package files exist on disk
 *   - No unresolved blockers
 *   - Daily cap not reached (default: 10, AUTOSUBMIT_DAILY_CAP env var)
 *   - Circuit breaker: < 3 failures in last 60 min
 *
 * Usage:
 *   node scripts/cron-autosubmit.mjs              — respects AUTOSUBMIT_DRY_RUN env
 *   node scripts/cron-autosubmit.mjs --dry-run    — show plan, no submissions
 *   node scripts/cron-autosubmit.mjs --max 5      — override per-run limit
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runCronTask } from './lib/cron-wrap.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { notify } from './lib/notify.mjs';
import { parseApplyQueue, detectAts } from './auto-apply-batch.mjs';
import { loadProjectEnv } from './load-env.mjs';
import { isMainEntry } from './lib/main-entry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || process.env.AUTOSUBMIT_DRY_RUN === '1';
const maxIdx = args.indexOf('--max');
const PER_RUN_MAX = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : Infinity;
const DAILY_CAP = parseInt(process.env.AUTOSUBMIT_DAILY_CAP || '10', 10);
const MIN_SCORE = parseFloat(process.env.AUTOSUBMIT_MIN_SCORE || '4.0');

// ATS platforms safe for unattended submission
const SAFE_ATS = new Set(['greenhouse', 'ashby', 'lever']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getReportScore(appId) {
  const reportsDir = resolve(ROOT, 'reports');
  if (!existsSync(reportsDir)) return null;

  const paddedId = appId.padStart(3, '0');
  const report = readdirSync(reportsDir).find(f => {
    const m = f.match(/^(\d+)-/);
    return m && m[1].padStart(3, '0') === paddedId;
  });
  if (!report) return null;

  const m = readFileSync(resolve(reportsDir, report), 'utf8')
    .match(/\*\*Score:\*\*\s*([\d.]+)\s*\/\s*5/);
  return m ? parseFloat(m[1]) : null;
}

function countTodayEvents(type) {
  const eventsFile = resolve(ROOT, 'data', 'events', `${new Date().toISOString().slice(0, 10)}.jsonl`);
  if (!existsSync(eventsFile)) return 0;
  return readFileSync(eventsFile, 'utf8')
    .split('\n').filter(Boolean)
    .filter(line => { try { return JSON.parse(line).type === type; } catch { return false; } })
    .length;
}

function countRecentFailures(withinMs = 60 * 60_000) {
  const cutoff = Date.now() - withinMs;
  const eventsFile = resolve(ROOT, 'data', 'events', `${new Date().toISOString().slice(0, 10)}.jsonl`);
  if (!existsSync(eventsFile)) return 0;
  return readFileSync(eventsFile, 'utf8')
    .split('\n').filter(Boolean)
    .filter(line => {
      try {
        const ev = JSON.parse(line);
        if (ev.type !== 'auto_submit_failed') return false;
        return Date.parse(ev.recorded_at || 0) >= cutoff;
      } catch { return false; }
    }).length;
}

function markBlocked(appId, reason) {
  const queueFile = resolve(ROOT, 'data', 'apply-queue.md');
  if (!existsSync(queueFile)) return;
  const text = readFileSync(queueFile, 'utf8');
  const updated = text.replace(
    new RegExp(`(###\\s+\\d+\\.\\s+.+?\\[${appId}[^\\]]*\\])`),
    `$1 <!-- BLOCKED: ${reason} — needs human review -->`,
  );
  if (updated !== text) writeFileSync(queueFile, updated, 'utf8');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Main submission loop
// ---------------------------------------------------------------------------
async function autosubmit({ rootPath }) {
  const summary = { candidates: 0, submitted: 0, failed: 0, skipped: 0, circuit_open: false };

  // Circuit breaker
  const recentFails = countRecentFailures();
  if (recentFails >= 3) {
    console.error(`[autosubmit] CIRCUIT OPEN: ${recentFails} failures in last 60 min — aborting`);
    appendAutomationEvent(rootPath, { type: 'auto_submit_circuit_open', recent_failures: recentFails });
    await notify({
      kind: 'autosubmit-circuit',
      title: 'Career-Ops: Auto-submit circuit OPEN',
      body: `${recentFails} submission failures in the last 60 minutes. Paused until failures clear.`,
      action: 'Check data/events/ for errors, then run: pnpm run autosubmit:dry',
      urgency: 'high',
    });
    summary.circuit_open = true;
    return summary;
  }

  // Build candidate list
  const entries = parseApplyQueue();
  const eligible = entries
    .filter(e => {
      if (!e.applyUrl || e.status === 'submitted') return false;
      if (!(e.queueStatus || '').toLowerCase().includes('ready')) return false;
      if (e.blockers.length > 0) return false;
      if (!SAFE_ATS.has(detectAts(e.applyUrl))) return false;
      const hasPdf = e.pdfPath && existsSync(resolve(rootPath, e.pdfPath));
      const hasCl = e.clPath && existsSync(resolve(rootPath, e.clPath));
      return hasPdf && hasCl;
    })
    .map(e => ({ ...e, score: getReportScore(e.appId), ats: detectAts(e.applyUrl) }))
    .filter(e => e.score !== null && e.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score); // highest score first

  summary.candidates = eligible.length;

  if (DRY_RUN) {
    console.log(`[autosubmit:dry] ${eligible.length} candidates eligible (score ≥ ${MIN_SCORE}, safe ATS):`);
    for (const e of eligible) {
      console.log(`  [${e.appId}] ${e.company} — ${e.role} | score:${e.score} | ${e.ats}`);
    }
    const todayCount = countTodayEvents('auto_submit_success');
    console.log(`  Daily cap: ${DAILY_CAP} | Today's successes: ${todayCount} | Remaining: ${Math.max(0, DAILY_CAP - todayCount)}`);
    return summary;
  }

  // Daily cap
  const todayCount = countTodayEvents('auto_submit_success');
  if (todayCount >= DAILY_CAP) {
    console.log(`[autosubmit] Daily cap reached: ${todayCount}/${DAILY_CAP}`);
    summary.skipped = eligible.length;
    return summary;
  }

  const toSubmit = eligible.slice(0, Math.min(DAILY_CAP - todayCount, PER_RUN_MAX));
  console.log(`[autosubmit] Submitting ${toSubmit.length} (cap: ${DAILY_CAP}, today: ${todayCount})`);

  let consecutiveFails = 0;

  for (let i = 0; i < toSubmit.length; i++) {
    const e = toSubmit[i];
    console.log(`[autosubmit] [${i + 1}/${toSubmit.length}] ${e.company} — ${e.role} (${e.ats}, score:${e.score})`);

    // Re-check circuit before each submission
    if (countRecentFailures() >= 3) {
      console.error('[autosubmit] Circuit tripped mid-run — stopping');
      break;
    }

    const result = spawnSync(
      process.execPath,
      ['scripts/auto-apply-batch.mjs', '--live', '--app-ids', e.appId, '--max', '1'],
      { cwd: ROOT, encoding: 'utf8', stdio: 'inherit', timeout: 120_000 },
    );

    const success = result.status === 0 && !result.error;

    if (success) {
      consecutiveFails = 0;
      summary.submitted++;
      appendAutomationEvent(ROOT, {
        type: 'auto_submit_success',
        appId: e.appId, company: e.company, role: e.role, ats: e.ats, score: e.score,
      });
      await notify({
        kind: 'autosubmit',
        title: `Applied: ${e.company}`,
        body: `${e.role} via ${e.ats} (score: ${e.score}/5)`,
        urgency: 'normal',
      });
    } else {
      consecutiveFails++;
      summary.failed++;
      const errMsg = result.error?.message || `exit ${result.status}`;
      appendAutomationEvent(ROOT, {
        type: 'auto_submit_failed',
        appId: e.appId, company: e.company, role: e.role, ats: e.ats, error: errMsg,
      });
      await notify({
        kind: 'autosubmit-fail',
        title: `Submit FAILED: ${e.company}`,
        body: `${e.role} — ${errMsg}`,
        action: `Review: node scripts/apply-review.mjs --prepare ${e.appId}`,
        urgency: 'high',
      });
      if (consecutiveFails >= 2) markBlocked(e.appId, `auto-submit failed ${consecutiveFails}x`);
    }

    if (i < toSubmit.length - 1) await sleep(30_000);
  }

  console.log(`[autosubmit] Done: ${summary.submitted} submitted, ${summary.failed} failed`);
  return summary;
}

if (isMainEntry(import.meta.url)) {
  runCronTask('cron-autosubmit', autosubmit, { singleInstance: true });
}
