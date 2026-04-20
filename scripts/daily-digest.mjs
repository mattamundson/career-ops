#!/usr/bin/env node
/**
 * daily-digest.mjs
 *
 * Sends a 7:55 AM CT email digest of the current career-ops state.
 * Designed to be glanceable on a phone before opening the dashboard.
 *
 * Sections:
 *   1. Top actions today (stale follow-ups, reply-waiting, top apply-now)
 *   2. Recent recruiter touches (last 14d, from data/responses.md)
 *   3. Yesterday's events (new evaluations, applications submitted, statuses changed)
 *   4. Pipeline / system health (counts + freshness)
 *
 * Auth: reuses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN.
 *
 * Usage:
 *   node scripts/daily-digest.mjs              # send
 *   node scripts/daily-digest.mjs --dry-run    # log to stdout
 *   node scripts/daily-digest.mjs --to=foo@bar # override recipient
 *
 * Recipient priority: --to flag > DAILY_DIGEST_TO env > 'mattmamundson@gmail.com'.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './load-env.mjs';
import { buildApplicationIndex } from './lib/career-data.mjs';
import { sendGmail } from './lib/gmail-send.mjs';
import { notify } from './lib/notify.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const toArg = args.find((a) => a.startsWith('--to='));
const TO = toArg ? toArg.slice('--to='.length) : (process.env.DAILY_DIGEST_TO || 'mattmamundson@gmail.com');

if (DRY_RUN) process.env.CAREER_OPS_DRY_RUN = '1';

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayString() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseResponsesLog() {
  const path = join(ROOT, 'data', 'responses.md');
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

function readStaleAlertItems() {
  let files = [];
  try {
    files = readdirSync(join(ROOT, 'data'))
      .filter((f) => /^stale-alert-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
  } catch { return []; }
  if (files.length === 0) return [];
  const body = readFileSync(join(ROOT, 'data', files[files.length - 1]), 'utf8');
  const re = /^\s*\d+\.\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(\d+)d\s+\(([+-]?\d+)d\s+(?:over|left)\)\s+—\s+(.+?)\s*$/;
  const out = [];
  for (const raw of body.split('\n')) {
    const m = raw.match(re);
    if (!m) continue;
    out.push({
      company: m[1].trim(), role: m[2].trim(), status: m[3].trim(),
      days: Number(m[4]), overdue: Number(m[5]), action: m[6].trim(),
    });
  }
  return out.sort((a, b) => b.overdue - a.overdue);
}

function loadApps() {
  const snapshot = buildApplicationIndex(ROOT);
  return snapshot.records.map((a) => ({
    id: a.id, date: a.date, company: a.company, role: a.role,
    score: parseFloat(a.score) || null, status: a.status,
    applyUrl: a.applyUrl, notes: a.notes,
  }));
}

function buildTopActions(apps) {
  const stale = readStaleAlertItems();
  const recruiterEvents = new Set(['acknowledged', 'recruiter_reply', 'phone_screen_scheduled', 'phone_screen_done', 'on_site_scheduled', 'interview', 'offer', 'rejected']);
  const replies = parseResponsesLog()
    .filter((r) => recruiterEvents.has(r.event))
    .filter((r) => {
      const ts = new Date((r.last_event_at || '') + 'T00:00:00Z').getTime();
      return Number.isFinite(ts) && (Date.now() - ts) <= 14 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => (b.last_event_at || '').localeCompare(a.last_event_at || ''))
    .slice(0, 3)
    .map((r) => ({ kind: 'reply', company: r.company, role: r.role, event: r.event, date: r.last_event_at, notes: r.notes }));

  const applyNow = apps
    .filter((a) => a.status === 'GO' || a.status === 'Conditional GO')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3)
    .map((a) => ({ kind: 'apply', company: a.company, role: a.role, score: a.score, url: a.applyUrl }));

  const merged = [];
  const max = 7;
  let si = 0, ri = 0, ai = 0;
  while (si < stale.length && stale[si].overdue >= 5 && merged.length < max) merged.push({ kind: 'follow-up', ...stale[si++] });
  while (ri < replies.length && merged.length < max) merged.push(replies[ri++]);
  while (ai < Math.min(2, applyNow.length) && merged.length < max) merged.push(applyNow[ai++]);
  while (si < stale.length && merged.length < max) merged.push({ kind: 'follow-up', ...stale[si++] });
  while (ai < applyNow.length && merged.length < max) merged.push(applyNow[ai++]);
  return merged;
}

function buildYesterdayActivity() {
  // Pulls from data/events/*.jsonl for yesterday's date.
  const yest = yesterdayString();
  const eventsDir = join(ROOT, 'data', 'events');
  if (!existsSync(eventsDir)) return [];
  let files = [];
  try { files = readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  // Heuristic: match files whose name contains yesterday's date OR scan all and filter by recorded_at.
  const out = [];
  for (const f of files) {
    let body = '';
    try { body = readFileSync(join(eventsDir, f), 'utf8'); } catch { continue; }
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt;
      try { evt = JSON.parse(trimmed); } catch { continue; }
      const ts = evt.recorded_at || evt.timestamp || evt.ts || evt.at;
      if (!ts || typeof ts !== 'string') continue;
      if (!ts.startsWith(yest)) continue;
      out.push(evt);
    }
  }
  // Tally interesting buckets.
  const tally = {
    scans: out.filter((e) => e.type === 'scanner.run.completed' || e.type === 'auto-scan.run.completed').length,
    evaluations: out.filter((e) => e.type === 'evaluation.report.written').length,
    applications: out.filter((e) => e.type === 'application.submitted' || e.type === 'apply.run.completed').length,
    failures: out.filter((e) => e.type === 'task.failed').length,
    gmailMatches: out.reduce((sum, e) => sum + (e.type === 'gmail-sync.run.success' ? (e.matched || 0) : 0), 0),
  };
  return tally;
}

function renderEmail(apps) {
  const today = todayString();
  const actions = buildTopActions(apps);
  const yesterday = buildYesterdayActivity();

  const goCount = apps.filter((a) => a.status === 'GO' || a.status === 'Conditional GO').length;
  const inFlightCount = apps.filter((a) => ['Applied', 'Responded', 'Contact', 'Interview'].includes(a.status)).length;
  const responses = parseResponsesLog();
  const recentRecruiterCount = responses.filter((r) => {
    const ts = new Date((r.last_event_at || '') + 'T00:00:00Z').getTime();
    return Number.isFinite(ts) && (Date.now() - ts) <= 14 * 24 * 60 * 60 * 1000
      && new Set(['acknowledged', 'recruiter_reply', 'phone_screen_scheduled', 'phone_screen_done', 'interview', 'offer', 'rejected']).has(r.event);
  }).length;

  const verbColor = { 'follow-up': '#d4a000', 'apply': '#22863a', 'reply': '#0366d6' };
  const verbLabel = { 'follow-up': '⏰ FOLLOW UP', 'apply': '📤 APPLY', 'reply': '💬 REPLY' };

  const actionRows = actions.length === 0
    ? `<tr><td colspan="3" style="padding:14px;color:#666;font-style:italic">No urgent actions today. Pipeline is healthy.</td></tr>`
    : actions.map((it, i) => {
      const c = verbColor[it.kind] || '#333';
      let context = '';
      if (it.kind === 'follow-up') context = `<strong style="color:${it.overdue >= 5 ? '#cb2431' : '#d4a000'}">${it.days}d (+${it.overdue}d over)</strong> · ${escHtml(it.action)}`;
      else if (it.kind === 'apply') context = `Score ${it.score?.toFixed(1) ?? '—'}${it.url ? ` · <a href="${escHtml(it.url)}" style="color:#0366d6">Open</a>` : ''}`;
      else if (it.kind === 'reply') context = `${escHtml(it.event)}${it.date ? ` · ${escHtml(it.date)}` : ''}`;
      return `<tr style="border-bottom:1px solid #eee">
        <td style="padding:8px;font-weight:600;color:#666;width:30px">${i + 1}</td>
        <td style="padding:8px">
          <div style="color:${c};font-weight:600;font-size:11px;letter-spacing:0.5px">${verbLabel[it.kind] || it.kind.toUpperCase()}</div>
          <div style="font-weight:600">${escHtml(it.company)}</div>
          <div style="color:#666;font-size:13px">${escHtml(it.role)}</div>
        </td>
        <td style="padding:8px;font-size:13px;color:#444">${context}</td>
      </tr>`;
    }).join('');

  const yesterdaySection = (yesterday && (yesterday.scans + yesterday.evaluations + yesterday.applications + yesterday.failures + yesterday.gmailMatches) > 0)
    ? `
    <h2 style="font-size:16px;margin-top:24px;margin-bottom:8px;color:#333">Yesterday — ${escHtml(yesterdayString())}</h2>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr><td style="padding:4px 0;color:#666">Scans completed</td><td style="text-align:right;font-weight:600">${yesterday.scans}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Evaluations written</td><td style="text-align:right;font-weight:600">${yesterday.evaluations}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Applications submitted</td><td style="text-align:right;font-weight:600">${yesterday.applications}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Gmail recruiter matches</td><td style="text-align:right;font-weight:600">${yesterday.gmailMatches}</td></tr>
      ${yesterday.failures > 0 ? `<tr><td style="padding:4px 0;color:#cb2431">⚠ Task failures</td><td style="text-align:right;font-weight:600;color:#cb2431">${yesterday.failures}</td></tr>` : ''}
    </table>` : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Career-Ops Daily — ${today}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;max-width:640px;margin:0 auto;padding:16px;background:#fff">

  <div style="border-bottom:2px solid #6f42c1;padding-bottom:12px;margin-bottom:16px">
    <h1 style="margin:0;font-size:22px;color:#6f42c1">⚡ Career-Ops Daily</h1>
    <div style="color:#666;font-size:13px;margin-top:4px">${escHtml(today)} — ${actions.length} action${actions.length === 1 ? '' : 's'} ranked</div>
  </div>

  <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:16px">
    <thead><tr style="background:#f6f8fa">
      <th style="padding:8px;text-align:left;font-size:11px;color:#666;letter-spacing:0.5px;width:30px">#</th>
      <th style="padding:8px;text-align:left;font-size:11px;color:#666;letter-spacing:0.5px">ACTION</th>
      <th style="padding:8px;text-align:left;font-size:11px;color:#666;letter-spacing:0.5px">CONTEXT</th>
    </tr></thead>
    <tbody>${actionRows}</tbody>
  </table>

  <h2 style="font-size:16px;margin-top:24px;margin-bottom:8px;color:#333">Pipeline snapshot</h2>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <tr><td style="padding:4px 0;color:#666">Total applications</td><td style="text-align:right;font-weight:600">${apps.length}</td></tr>
    <tr><td style="padding:4px 0;color:#666">GO / Conditional GO (queued)</td><td style="text-align:right;font-weight:600;color:#22863a">${goCount}</td></tr>
    <tr><td style="padding:4px 0;color:#666">In flight (Applied → Interview)</td><td style="text-align:right;font-weight:600;color:#0366d6">${inFlightCount}</td></tr>
    <tr><td style="padding:4px 0;color:#666">Recruiter touches (14d)</td><td style="text-align:right;font-weight:600;color:#6f42c1">${recentRecruiterCount}</td></tr>
  </table>

  ${yesterdaySection}

  <div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;font-size:11px;color:#999">
    Generated by <code>scripts/daily-digest.mjs</code> · Open the dashboard for full detail · See <code>docs/RESPONSE-PLAYBOOK.md</code> for what to do on each event
  </div>

</body>
</html>`;
  return { html, subject: `Career-Ops Daily — ${today} · ${actions.length} action${actions.length === 1 ? '' : 's'}` };
}

async function main() {
  const apps = loadApps();
  const { html, subject } = renderEmail(apps);

  if (DRY_RUN) {
    console.log(`[daily-digest:dry] to=${TO} subject="${subject}"`);
    console.log(`[daily-digest:dry] html length=${html.length} bytes`);
    console.log('[daily-digest:dry] sample (first 400 chars):');
    console.log(html.slice(0, 400));
    return;
  }

  try {
    const r = await sendGmail({ to: TO, subject, html });
    console.log(`[daily-digest] sent to=${TO} messageId=${r.messageId}`);
    await appendAutomationEvent(ROOT, {
      type: 'daily-digest.run.success',
      job: 'daily-digest',
      to: TO,
      messageId: r.messageId,
      subject,
    });
  } catch (e) {
    console.error(`[daily-digest] FAILED: ${e.message}`);
    await appendAutomationEvent(ROOT, {
      type: 'task.failed',
      job: 'daily-digest',
      error: e.message,
    });
    await notify({
      kind: 'cron-failure',
      title: '⚠ daily-digest failed',
      body: `Daily digest could not be sent.\n\nError: ${e.message}`,
      action: 'Inspect data/notifications/ and rerun: pnpm run digest',
      urgency: 'high',
    });
    process.exitCode = 1;
  }
}

await main();
