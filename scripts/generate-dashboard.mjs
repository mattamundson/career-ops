#!/usr/bin/env node
/**
 * generate-dashboard.mjs
 * Reads career-ops data files and produces a self-contained dashboard.html
 * Usage: node scripts/generate-dashboard.mjs [--open]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { execSync } from 'child_process';
import { computeApplicationPriority, focusSortKey } from './lib/scoring-core.mjs';
import { loadLocationConfig } from './lib/profile-location-config.mjs';
import { buildApplicationIndex, writeApplicationIndex } from './lib/career-data.mjs';
import {
  getSourceOperationalStatus,
  operationalStatusLabel,
  portalDisplayLabel,
} from './lib/source-labels.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { isBrainAvailable, getBrainStats } from './lib/brain-client.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// Load priority config once from config/profile.yml.location.work_modes.
// Flipping the array in profile.yml flips dashboard sort order on next regen
// without any code changes. Falls back to on_site > hybrid > remote defaults.
const LOCATION_CONFIG = loadLocationConfig();

// ─── Parsers ────────────────────────────────────────────────────────────────

function parseApplications() {
  const snapshot = buildApplicationIndex(ROOT);
  const rows = [];
  for (const application of snapshot.records) {
    const scoreNum = parseFloat(application.score);
    rows.push({
      num: application.id,
      date: application.date,
      company: application.company,
      role: application.role,
      scoreStr: application.score || '',
      score: isNaN(scoreNum) ? null : scoreNum,
      status: application.status,
      hasPdf: String(application.pdf || '').includes('✅'),
      reportPath: application.reportPath,
      notes: application.notes,
      applyUrl: application.applyUrl,
      queueDecision: application.queueDecision,
      queueStatus: application.queueStatus,
      remote: application.remote,
      salary: application.salary,
      priority: null,
    });
  }
  return rows;
}

function parsePipeline() {
  const file = join(ROOT, 'data', 'pipeline.md');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const items = [];
  for (const line of lines) {
    const match = line.match(/^-\s+\[([ x])\]\s+(https?:\/\/\S+)\s*\|\s*(.+)/);
    if (!match) continue;
    const [, done, url, rest] = match;
    const parts = rest.split('|').map(s => s.trim());
    items.push({ done: done === 'x', url, company: parts[0] || '', role: parts[1] || '' });
  }
  return items;
}

function parseScanHistory() {
  const file = join(ROOT, 'data', 'scan-history.tsv');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split('\t').map(h => h.trim());
  const idx = {
    url:        header.indexOf('url'),
    first_seen: header.indexOf('first_seen'),
    portal:     header.indexOf('portal'),
    title:      header.indexOf('title'),
    company:    header.indexOf('company'),
    status:     header.indexOf('status'),
  };
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    rows.push({
      url:       cols[idx.url]        || '',
      firstSeen: cols[idx.first_seen] || '',
      portal:    cols[idx.portal]     || '',
      title:     cols[idx.title]      || '',
      company:   cols[idx.company]    || '',
      status:    (cols[idx.status]    || '').trim(),
    });
  }
  return rows;
}

function parsePrefilterCards() {
  const dir = join(ROOT, 'data', 'prefilter-results');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  return files.map(file => {
    const text = readFileSync(join(dir, file), 'utf8');
    const statusMatch  = text.match(/\*\*status:\*\*\s*(\w+)/);
    const scoreMatch   = text.match(/\*\*Quick Score:\*\*\s*([\d.]+)/);
    const companyMatch = text.match(/\*\*company:\*\*\s*(.+)/);
    const titleMatch   = text.match(/\*\*title:\*\*\s*(.+)/);
    return {
      file,
      status:  statusMatch  ? statusMatch[1].trim()    : 'pending',
      score:   scoreMatch   ? parseFloat(scoreMatch[1]) : null,
      company: companyMatch ? companyMatch[1].trim()   : '',
      title:   titleMatch   ? titleMatch[1].trim()     : '',
    };
  });
}

function parseResponses() {
  const file = join(ROOT, 'data', 'responses.md');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    if (line.includes('---')) { inTable = true; continue; }
    if (line.includes('app_id') && line.includes('company')) continue; // header
    if (!inTable) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 8 || !cells[0] || cells[0] === 'app_id') continue;
    rows.push({
      app_id: cells[0],
      company: cells[1],
      role: cells[2],
      submitted_at: cells[3],
      ats: cells[4],
      status: cells[5],
      last_event_at: cells[6],
      response_days: cells[7],
      notes: cells[8] || ''
    });
  }
  return rows;
}

function parseLivenessReports() {
  const dir = join(ROOT, 'data');
  if (!existsSync(dir)) return { lastRun: null, deadCount: 0, deadUrls: [] };
  const reports = readdirSync(dir).filter(f => f.startsWith('liveness-') && f.endsWith('.md'));
  if (!reports.length) return { lastRun: null, deadCount: 0, deadUrls: [] };
  reports.sort().reverse();
  const latest = reports[0];
  const text = readFileSync(join(dir, latest), 'utf8');
  // Parse dead URL entries: lines starting with "- **Company**"
  const deadUrls = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^- \*\*(.+?)\*\* — (.+)/);
    if (m) deadUrls.push({ company: m[1], title: m[2] });
  }
  return {
    lastRun:  latest.replace('liveness-', '').replace('.md', ''),
    deadCount: deadUrls.length,
    deadUrls,
  };
}

function readReport(reportPath) {
  if (!reportPath) return null;
  const full = join(ROOT, reportPath);
  if (!existsSync(full)) return null;
  try {
    const text = readFileSync(full, 'utf8');
    const archMatch = text.match(/\*\*Archetype:\*\*\s*(.+)/);
    const urlMatch = text.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
    const salMatch = text.match(/\|\s*\*\*Salary\*\*\s*\|\s*(.+?)\s*\|/);
    const whyMatch = text.match(/\*\*Why [\d.]+\/5:\*\*\s*(.+)/);
    const remoteRow = text.match(/\|\s*\*\*Remote\*\*\s*\|\s*(.+?)\s*\|/);
    const tldrRow = text.match(/\|\s*\*\*TL;DR\*\*\s*\|\s*(.+?)\s*\|/);
    const remoteAlt = text.match(/\*\*Remote:\*\*\s*(.+)/);
    const tldrAlt = text.match(/\*\*TL;DR:\*\*\s*(.+)/);
    return {
      archetype: archMatch ? archMatch[1].trim() : null,
      url: urlMatch ? urlMatch[1].trim() : null,
      salary: salMatch ? salMatch[1].trim() : null,
      why: whyMatch ? whyMatch[1].trim() : null,
      remote: (remoteRow?.[1] || remoteAlt?.[1] || '').trim() || null,
      tldr: (tldrRow?.[1] || tldrAlt?.[1] || '').trim() || null,
    };
  } catch { return null; }
}

// ─── Data Assembly ────────────────────────────────────────────────────────────

const apps = parseApplications();
const pipeline = parsePipeline();

// Enrich apps with report metadata
for (const app of apps) {
  app.reportMeta = readReport(app.reportPath);
  if (app.reportMeta?.url) app.jobUrl = app.reportMeta.url;
  app.priority = computeApplicationPriority({
    score: app.scoreStr,
    status: app.status,
    date: app.date,
    reportPath: app.reportPath,
    remote: app.remote,
    reportRemote: app.reportMeta?.remote ?? null,
    role: app.role,
    notes: app.notes,
    tldr: app.reportMeta?.tldr ?? null,
    why: app.reportMeta?.why ?? null,
  }, LOCATION_CONFIG);
}

const pendingPipeline = pipeline.filter(p => !p.done);
const processedPipeline = pipeline.filter(p => p.done);

const scanHistory    = parseScanHistory();
const prefilterCards = parsePrefilterCards();

const prefilterPending = prefilterCards.filter(c => c.status === 'pending').length;
const prefilterScored  = prefilterCards.filter(c => c.score !== null);
const prefilterPassed  = prefilterScored.filter(c => c.score >= 3.5).length;
const prefilterMaybe   = prefilterScored.filter(c => c.score >= 2.5 && c.score < 3.5).length;
const prefilterSkip    = prefilterScored.filter(c => c.score < 2.5).length;

const liveness = parseLivenessReports();

// Response tracker (v14 — added 2026-04-10)
const responses = parseResponses();
const DAILY_TARGET = 50;
const today = new Date().toISOString().slice(0, 10);
const submittedToday = responses.filter(r => r.submitted_at === today).length;
const TERMINAL_STATUSES = new Set(['rejected', 'offer', 'withdrew', 'ghosted']);
const IN_FLIGHT = responses.filter(r => !TERMINAL_STATUSES.has(r.status) && r.status !== 'in_progress');
const FUNNEL_STAGES = [
  { key: 'submitted',        label: 'Submitted',        match: (r) => true },
  { key: 'acknowledged',     label: 'Acknowledged',     match: (r) => ['acknowledged', 'recruiter_reply', 'phone_screen', 'interview', 'offer'].includes(r.status) },
  { key: 'recruiter_reply',  label: 'Recruiter Reply',  match: (r) => ['recruiter_reply', 'phone_screen', 'interview', 'offer'].includes(r.status) },
  { key: 'interview',        label: 'Interview',        match: (r) => ['phone_screen', 'interview', 'offer'].includes(r.status) },
  { key: 'offer',            label: 'Offer',            match: (r) => r.status === 'offer' },
];
const funnelCounts = FUNNEL_STAGES.map(stage => ({
  ...stage,
  count: responses.filter(stage.match).length,
}));
const replyRate = responses.length > 0
  ? ((funnelCounts[1].count / responses.length) * 100).toFixed(1)
  : '0.0';

// Rejection insights — run analyze-rejections.mjs --json (needs --min-data=3 terminal entries)
let rejectionInsights = null;
{
  const { execFileSync } = await import('child_process');
  const { resolve: res } = await import('path');
  try {
    const out = execFileSync(process.execPath, [
      res(ROOT, 'scripts', 'analyze-rejections.mjs'), '--json', '--min-data=3',
    ], { cwd: ROOT, encoding: 'utf8' });
    rejectionInsights = JSON.parse(out.trim());
  } catch { /* not enough data or script error — panel hidden */ }
}

// Filter Health — run tune-filters.mjs --json (30-day window)
let filterHealth = null;
{
  const { execFileSync } = await import('child_process');
  const { resolve: res } = await import('path');
  try {
    const out = execFileSync(process.execPath, [
      res(ROOT, 'scripts', 'tune-filters.mjs'), '--json', '--days=30',
    ], { cwd: ROOT, encoding: 'utf8' });
    filterHealth = JSON.parse(out.trim());
  } catch { /* no scan history yet — panel hidden */ }
}

function daysSinceIsoDate(iso) {
  if (!iso || typeof iso !== 'string') return 0;
  const d = new Date(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

function loadRecentAutomationEvents(maxTotal = 150) {
  const dir = join(ROOT, 'data', 'events');
  if (!existsSync(dir)) return [];
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files.slice(-4)) {
    let text;
    try {
      text = readFileSync(join(dir, f), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* ignore malformed line */
      }
    }
  }
  return out.slice(-maxTotal);
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const automationEvents = loadRecentAutomationEvents(150);
const STALE_TOUCH_STATUSES = new Set([
  'Evaluated', 'Evaluating', 'GO', 'Conditional GO', 'Ready to Submit',
  'Contact', 'Responded', 'Interview', 'In Progress',
]);
const staleTouchApps = apps
  .filter((a) => STALE_TOUCH_STATUSES.has(a.status) && a.date && daysSinceIsoDate(a.date) >= 14)
  .sort((a, b) => daysSinceIsoDate(b.date) - daysSinceIsoDate(a.date))
  .slice(0, 10);
const automationTail = automationEvents.slice(-10).reverse();
const lastScannerEvent = [...automationEvents].reverse().find((e) => e.type === 'scanner.run.completed');

const operatorSnapshotSection = `
  <div class="section">
    <div class="section-header">
      <h2>Operator health</h2>
      <span class="count">freshness · automation · scanner</span>
    </div>
    <div style="padding:16px 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
      <div>
        <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Stale touchpoints (≥14d)</div>
        ${staleTouchApps.length === 0
    ? '<div class="muted" style="font-size:13px">No in-flight applications older than 14 days in the statuses we track here.</div>'
    : `<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5">
            ${staleTouchApps.map((a) => `<li><strong>${escHtml(a.company)}</strong> — ${escHtml(a.role)} <span class="muted">(${escHtml(a.status)}, ${daysSinceIsoDate(a.date)}d)</span></li>`).join('')}
          </ul>`}
      </div>
      <div>
        <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Recent automation events</div>
        ${automationTail.length === 0
    ? '<div class="muted" style="font-size:13px">No entries in <code>data/events/*.jsonl</code> yet.</div>'
    : `<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5">
            ${automationTail.map((e) => {
    const t = escHtml(e.type || 'event');
    const sum = escHtml(e.summary || '');
    const at = escHtml((e.recorded_at || '').slice(0, 19));
    return `<li><span class="muted">${at}</span> <strong>${t}</strong>${sum ? ` — ${sum}` : ''}</li>`;
  }).join('')}
          </ul>`}
      </div>
      <div>
        <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Last full scan</div>
        ${!lastScannerEvent
    ? '<div class="muted" style="font-size:13px">No <code>scanner.run.completed</code> event found.</div>'
    : `<div style="font-size:12px;line-height:1.6">
            <div><strong>${escHtml(lastScannerEvent.status || 'ok')}</strong> <span class="muted">${escHtml((lastScannerEvent.recorded_at || '').slice(0, 19))}</span></div>
            <div style="margin-top:6px">${escHtml(lastScannerEvent.summary || '')}</div>
            ${lastScannerEvent.details
      ? `<div class="muted" style="margin-top:6px;font-size:11px">new: ${escHtml(String(lastScannerEvent.details.new_added ?? '—'))} | jobspy: ${escHtml(String(lastScannerEvent.details.jobspy_new ?? '—'))}</div>`
      : ''}
          </div>`}
      </div>
    </div>
  </div>`;

const generatedAt = new Date().toLocaleString('en-US', {
  timeZone: 'America/Chicago',
  month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
}) + ' CT';

writeApplicationIndex(ROOT);

// ─── HTML Generation ─────────────────────────────────────────────────────────

const statusColors = {
  'Evaluated': '#cba6f7',   // mauve
  'Applied':   '#89b4fa',   // blue
  'Responded': '#89dceb',   // sky
  'Contact':   '#fab387',   // peach
  'Interview': '#a6e3a1',   // green
  'Offer':     '#f9e2af',   // yellow
  'Rejected':  '#f38ba8',   // red
  'Discarded': '#6c7086',   // overlay1
  'SKIP':      '#585b70',   // surface2
};

function scoreBar(score) {
  if (score === null) return '<span class="no-score">—</span>';
  const pct = (score / 5) * 100;
  const color = score >= 4 ? '#a6e3a1' : score >= 3 ? '#f9e2af' : '#f38ba8';
  return `<div class="score-wrap">
    <span class="score-num">${score.toFixed(1)}</span>
    <div class="score-bar"><div class="score-fill" style="width:${pct}%;background:${color}"></div></div>
  </div>`;
}

function statusBadge(status) {
  const color = statusColors[status] || '#cdd6f4';
  return `<span class="badge" style="color:${color};border-color:${color}22;background:${color}11">${status}</span>`;
}

function applicationProvenance(app) {
  const priority = app.priority || {};
  const parts = [
    `Fit ${priority.fit ?? 'n/a'}`,
    `Age ${priority.ageDays ?? 'n/a'}d`,
    `Freshness ${priority.freshnessDecay ?? 'n/a'}`,
    `Confidence ${priority.confidence ?? 'n/a'}`,
  ];
  if (priority.workArrangement) {
    parts.push(`Loc ${priority.workArrangement} ×${priority.locationMultiplier ?? 1}`);
  }

  if (app.queueDecision) parts.push(`Queue ${app.queueDecision}`);
  if (app.remote) parts.push(`Remote ${app.remote}`);
  if (app.salary) parts.push(`Comp ${app.salary}`);

  return parts.join(' | ');
}

function computeSourceBreakdown(rows) {
  const byPortal = {};
  for (const r of rows) {
    const p = (r.portal || 'unknown').trim() || 'unknown';
    if (!byPortal[p]) {
      byPortal[p] = {
        total: 0,
        added: 0,
        label: portalDisplayLabel(p),
        opStatus: getSourceOperationalStatus(p),
      };
    }
    byPortal[p].total++;
    if (r.status === 'added') byPortal[p].added++;
  }
  return Object.entries(byPortal).sort((a, b) => b[1].total - a[1].total);
}

function computePipelineBreakdown(items) {
  const byCompany = {};
  for (const item of items) {
    const co = item.company || 'Unknown';
    byCompany[co] = (byCompany[co] || 0) + 1;
  }
  return Object.entries(byCompany).sort((a, b) => b[1] - a[1]);
}

function computeBoardStatus(rows) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const byBoard = {};
  for (const r of rows) {
    const portal = r.portal || 'unknown';
    if (!byBoard[portal]) {
      byBoard[portal] = {
        total: 0,
        added: 0,
        lastSeen: '',
        displayName: portalDisplayLabel(portal),
        opStatus: getSourceOperationalStatus(portal),
      };
    }
    byBoard[portal].total++;
    if (r.status === 'added') byBoard[portal].added++;
    if (r.firstSeen > byBoard[portal].lastSeen) byBoard[portal].lastSeen = r.firstSeen;
  }
  return Object.entries(byBoard)
    .map(([portal, s]) => ({
      portal,
      name: portal,
      displayName: s.displayName,
      opStatus: s.opStatus,
      total: s.total,
      added: s.added,
      lastSeen: s.lastSeen,
      active: s.lastSeen >= sevenDaysAgo,
    }))
    .sort((a, b) => b.added - a.added || b.total - a.total);
}

function boardOperationalBadge(opStatus) {
  const styles = {
    active: 'color:#a6e3a1;border-color:#a6e3a122;background:#a6e3a111',
    blocked: 'color:#f38ba8;border-color:#f38ba822;background:#f38ba811',
    deferred: 'color:#fab387;border-color:#fab38722;background:#fab38711',
    stub: 'color:#6c7086;border-color:#6c708622;background:#6c708611',
    error: 'color:#f38ba8;border-color:#f38ba822;background:#f38ba811',
  };
  const st = styles[opStatus] || styles.stub;
  const label = operationalStatusLabel(opStatus);
  return `<span class="badge" style="${st}">${label}</span>`;
}

function appRows(list) {
  if (list.length === 0) return '<tr><td colspan="8" class="empty">No applications match this filter.</td></tr>';
  return list.map(app => {
    const urlCell = app.jobUrl
      ? `<a href="${app.jobUrl}" target="_blank" title="Open job posting">↗</a>`
      : '—';
    const reportCell = app.reportPath
      ? `<a href="${app.reportPath}" target="_blank" title="Open evaluation report">📄</a>`
      : '—';
    const pdfCell = app.hasPdf
      ? `<a href="output/cv-matt-${app.company.toLowerCase().replace(/\s+/g,'-')}-${app.date}.pdf" target="_blank" title="Open PDF">📑</a>`
      : '—';
    const arch = app.reportMeta?.archetype ? `<div class="arch">${app.reportMeta.archetype}</div>` : '';
    const salary = app.reportMeta?.salary ? `<div class="salary">${app.reportMeta.salary}</div>` : '';
    const priority = app.priority || {};
    const priorityColor = priority.band === 'High'
      ? '#a6e3a1'
      : priority.band === 'Medium'
        ? '#f9e2af'
        : '#f38ba8';
    return `<tr data-status="${app.status}" data-score="${app.score ?? -1}">
      <td class="num">#${app.num}</td>
      <td class="date">${app.date}</td>
      <td class="company"><strong>${app.company}</strong>${salary}</td>
      <td class="role">${app.role}${arch}</td>
      <td class="score">${scoreBar(app.score)}</td>
      <td class="status"><span class="badge" style="color:${priorityColor};border-color:${priorityColor}22;background:${priorityColor}11">${priority.priorityScore ?? 0} · ${priority.band || 'Low'}</span></td>
      <td class="status">${statusBadge(app.status)}</td>
      <td class="actions">${urlCell} ${reportCell} ${pdfCell}</td>
    </tr>
    ${app.notes || applicationProvenance(app) ? `<tr data-status="${app.status}" class="notes-row"><td colspan="8"><div class="notes">${app.notes || ''}${app.notes ? '<br>' : ''}<span class="muted">${applicationProvenance(app)}</span></div></td></tr>` : ''}`;
  }).join('');
}

function pipelineRows(list) {
  if (list.length === 0) return '<tr><td colspan="3" class="empty">No pending jobs.</td></tr>';
  return list.map(item => `<tr>
    <td class="company"><strong>${item.company}</strong></td>
    <td class="role">${item.role}</td>
    <td class="actions"><a href="${item.url}" target="_blank">↗ View</a></td>
  </tr>`).join('');
}

function applyQueueFocusKey(app) {
  if (app.score == null) return -1;
  return focusSortKey(app.score, {
    remote: app.remote,
    reportRemote: app.reportMeta?.remote ?? null,
    role: app.role,
    notes: app.notes,
    tldr: app.reportMeta?.tldr ?? null,
    why: app.reportMeta?.why ?? null,
  }, LOCATION_CONFIG);
}

function generateApplyQueue(appList) {
  const queue = appList
    .filter(a => a.status === 'GO' || a.status === 'Conditional GO')
    .sort((a, b) => applyQueueFocusKey(b) - applyQueueFocusKey(a));

  if (queue.length === 0) return '';

  const rows = queue.map(app => {
    const slug = app.company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const clDir = join(ROOT, 'output', 'cover-letters');
    const outDir = join(ROOT, 'output');

    let hasCL = false;
    if (existsSync(clDir)) {
      try {
        hasCL = readdirSync(clDir).some(f => f.startsWith(slug) && f.endsWith('.txt'));
      } catch { /* ignore */ }
    }

    let hasPDF = false;
    if (existsSync(outDir)) {
      try {
        hasPDF = readdirSync(outDir).some(f => f.startsWith(`cv-matt-${slug}`) && f.endsWith('.pdf'));
      } catch { /* ignore */ }
    }

    const isGO = app.status === 'GO';
    const badgeColor = isGO ? '#a6e3a1' : '#f9e2af';
    const badge = `<span class="badge" style="color:${badgeColor};border-color:${badgeColor}22;background:${badgeColor}11">${app.status}</span>`;
    const applyLink = app.jobUrl
      ? `<a href="${app.jobUrl}" target="_blank" style="color:#89b4fa;font-weight:600">Apply →</a>`
      : '<span style="color:var(--overlay0)">—</span>';
    const clCell = hasCL
      ? '<span style="color:#a6e3a1" title="Cover letter ready">✓</span>'
      : '<span style="color:var(--surface2)">—</span>';
    const pdfCell = hasPDF
      ? '<span style="color:#a6e3a1" title="PDF ready">✓</span>'
      : '<span style="color:var(--surface2)">—</span>';

    return `<tr>
      <td>${badge}</td>
      <td class="company"><strong>${app.company}</strong></td>
      <td class="role">${app.role}</td>
      <td class="score">${scoreBar(app.score)}</td>
      <td>${applyLink}</td>
      <td style="text-align:center">${pdfCell}</td>
      <td style="text-align:center">${clCell}</td>
    </tr>`;
  }).join('');

  return `
  <!-- Apply Queue -->
  <div class="section">
    <div class="section-header">
      <h2>Apply Queue</h2>
      <span class="count">${queue.length} ready</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Company</th>
            <th>Role</th>
            <th>Score</th>
            <th>Apply</th>
            <th style="text-align:center">PDF</th>
            <th style="text-align:center">Cover Letter</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>`;
}

function generateMorningBriefing(appList) {
  // Unified "what should Matt do right now?" — caps at 7 items, blends apply / follow-up / reply.
  const today = new Date().toISOString().slice(0, 10);

  // 1. Top 3 stale apps from latest stale-alert file (highest overdue first).
  const staleItems = (() => {
    let files = [];
    try {
      files = readdirSync(join(ROOT, 'data'))
        .filter((f) => /^stale-alert-\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort();
    } catch { return []; }
    if (files.length === 0) return [];
    let body;
    try { body = readFileSync(join(ROOT, 'data', files[files.length - 1]), 'utf8'); }
    catch { return []; }
    const lineRe = /^\s*\d+\.\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(\d+)d\s+\(([+-]?\d+)d\s+(?:over|left)\)\s+—\s+(.+?)\s*$/;
    const out = [];
    for (const raw of body.split('\n')) {
      const m = raw.match(lineRe);
      if (!m) continue;
      out.push({
        kind: 'follow-up',
        company: m[1].trim(),
        role: m[2].trim(),
        status: m[3].trim(),
        days: Number(m[4]),
        overdue: Number(m[5]),
        action: m[6].trim(),
      });
    }
    return out.sort((a, b) => b.overdue - a.overdue).slice(0, 3);
  })();

  // 2. Top 3 apply-now (GO / Conditional GO ranked by priorityScore × urgency).
  const applyItems = appList
    .filter((a) => (a.status === 'GO' || a.status === 'Conditional GO') && a.priority?.priorityScore > 0)
    .sort((a, b) => b.priority.priorityScore - a.priority.priorityScore)
    .slice(0, 3)
    .map((a) => ({
      kind: 'apply',
      company: a.company,
      role: a.role,
      status: a.status,
      score: a.score,
      priority: a.priority.priorityScore,
      urgency: a.priority.urgencyMultiplier ?? 1.0,
      url: a.jobUrl,
    }));

  // 3. Top 3 reply-now (Responded status, oldest first — recruiter is waiting).
  const replyItems = appList
    .filter((a) => a.status === 'Responded' || a.status === 'Contact')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(0, 3)
    .map((a) => ({
      kind: 'reply',
      company: a.company,
      role: a.role,
      status: a.status,
      date: a.date,
    }));

  // Interleave: stale (highest overdue) + apply (top 1-2) + reply (oldest) → max 7.
  const merged = [];
  const max = 7;
  let si = 0, ai = 0, ri = 0;
  // First: any stale +5d+ go first (matt is bleeding revenue).
  while (si < staleItems.length && staleItems[si].overdue >= 5 && merged.length < max) merged.push(staleItems[si++]);
  // Then: any active reply (recruiter waiting).
  while (ri < replyItems.length && merged.length < max) merged.push(replyItems[ri++]);
  // Then: top 1-2 apply-now.
  while (ai < Math.min(2, applyItems.length) && merged.length < max) merged.push(applyItems[ai++]);
  // Remaining stale (lower overdue).
  while (si < staleItems.length && merged.length < max) merged.push(staleItems[si++]);
  // Remaining apply.
  while (ai < applyItems.length && merged.length < max) merged.push(applyItems[ai++]);

  if (merged.length === 0) {
    return `
  <div class="section" style="margin-bottom:16px;border-color:#a6e3a144;background:#a6e3a108">
    <div class="section-header"><h2>☀ Morning Briefing — ${today}</h2><span class="count" style="color:#a6e3a1">all clear</span></div>
    <div style="padding:14px 20px;font-size:13px;color:var(--subtext)">
      No urgent actions today. Pipeline is healthy. Run <code>node scripts/auto-scan.mjs</code> to refresh.
    </div>
  </div>`;
  }

  const verbColor = { 'follow-up': '#f9e2af', 'apply': '#a6e3a1', 'reply': '#89b4fa' };
  const verbIcon = { 'follow-up': '⏰', 'apply': '📤', 'reply': '💬' };
  const verbLabel = { 'follow-up': 'FOLLOW UP', 'apply': 'APPLY', 'reply': 'REPLY' };

  const rows = merged.map((it, i) => {
    const c = verbColor[it.kind];
    const verb = `<span class="badge" style="color:${c};border-color:${c}33;background:${c}11;font-weight:700">${verbIcon[it.kind]} ${verbLabel[it.kind]}</span>`;
    let context = '';
    if (it.kind === 'follow-up') {
      context = `<span style="color:${it.overdue >= 5 ? '#f38ba8' : '#f9e2af'};font-weight:600">${it.days}d (+${it.overdue}d over)</span> · ${escHtml(it.action)}`;
    } else if (it.kind === 'apply') {
      const urgencyTag = it.urgency >= 1.25
        ? '<span style="color:#f38ba8;font-weight:600">Closing ≤2d</span>'
        : it.urgency >= 1.10
          ? '<span style="color:#f9e2af">Closing ≤7d</span>'
          : '';
      context = `Score ${it.score?.toFixed(1) ?? '—'} · Priority ${it.priority}${urgencyTag ? ' · ' + urgencyTag : ''}`;
    } else if (it.kind === 'reply') {
      const ageDays = it.date ? Math.floor((Date.now() - new Date(it.date).getTime()) / (24 * 60 * 60 * 1000)) : null;
      context = `${escHtml(it.status)} · ${ageDays !== null ? ageDays + 'd ago' : 'unknown date'}`;
    }
    const link = it.kind === 'apply' && it.url
      ? `<a href="${it.url}" target="_blank" style="color:#89b4fa;font-weight:600">Open →</a>`
      : it.kind === 'reply'
        ? `<code style="font-size:11px">pnpm respond</code>`
        : `<code style="font-size:11px">pnpm respond</code>`;
    return `<tr>
      <td style="text-align:center;color:var(--subtext);font-weight:700;font-size:18px;width:36px">${i + 1}</td>
      <td style="width:140px">${verb}</td>
      <td><strong>${escHtml(it.company)}</strong> · <span style="color:var(--subtext)">${escHtml(it.role)}</span></td>
      <td style="font-size:12px;color:var(--subtext)">${context}</td>
      <td style="text-align:right">${link}</td>
    </tr>`;
  }).join('');

  return `
  <div class="section" style="margin-bottom:16px;border-color:#cba6f744;background:#cba6f706">
    <div class="section-header" style="background:#cba6f714">
      <h2>☀ Morning Briefing — ${today}</h2>
      <span class="count" style="color:#cba6f7;font-weight:600">${merged.length} action${merged.length === 1 ? '' : 's'} ranked</span>
    </div>
    <div style="padding:8px 20px 4px;font-size:12px;color:var(--subtext)">
      Stale (overdue 5d+) → reply-waiting → top apply-now → remaining stale → remaining apply.
    </div>
    <div style="overflow-x:auto">
      <table>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function generateStaleAlertPanel() {
  // Latest data/stale-alert-YYYY-MM-DD.md → parse "N. Company | Role | Status | Xd (+Yd over) — Action".
  let files = [];
  try {
    files = readdirSync(join(ROOT, 'data'))
      .filter((f) => /^stale-alert-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
  } catch { return ''; }
  if (files.length === 0) return '';

  const latest = files[files.length - 1];
  const dateStr = latest.match(/stale-alert-(\d{4}-\d{2}-\d{2})\.md/)[1];
  let body;
  try { body = readFileSync(join(ROOT, 'data', latest), 'utf8'); }
  catch { return ''; }

  const lineRe = /^\s*\d+\.\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(\d+)d\s+\(([+-]?\d+)d\s+(?:over|left)\)\s+—\s+(.+?)\s*$/;
  const items = [];
  for (const raw of body.split('\n')) {
    const m = raw.match(lineRe);
    if (!m) continue;
    items.push({
      company: m[1].trim(),
      role: m[2].trim(),
      status: m[3].trim(),
      days: Number(m[4]),
      overdue: Number(m[5]),
      action: m[6].trim(),
    });
  }
  if (items.length === 0) return '';

  const ageMs = Date.now() - new Date(dateStr + 'T00:00:00Z').getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const ageBadge = ageDays === 0
    ? '<span style="color:#a6e3a1">today</span>'
    : ageDays === 1
      ? '<span style="color:#f9e2af">1d old</span>'
      : `<span style="color:#f38ba8">${ageDays}d old</span>`;

  const colorFor = (overdue) => {
    if (overdue >= 5) return '#f38ba8';
    if (overdue >= 1) return '#f9e2af';
    return '#a6e3a1';
  };

  const rows = items.map((it) => {
    const c = colorFor(it.overdue);
    const overdueStr = it.overdue >= 0 ? `+${it.overdue}d over` : `${it.overdue}d`;
    return `<tr>
      <td><strong>${escHtml(it.company)}</strong></td>
      <td>${escHtml(it.role)}</td>
      <td><span class="badge" style="color:${c};border-color:${c}33;background:${c}11">${escHtml(it.status)}</span></td>
      <td style="color:${c};font-weight:600">${it.days}d</td>
      <td style="color:${c}">${overdueStr}</td>
      <td>${escHtml(it.action)}</td>
    </tr>`;
  }).join('');

  return `
  <div class="section" style="margin-bottom:16px">
    <div class="section-header">
      <h2>⏰ Stale Applications</h2>
      <span class="count">${items.length} need action · ${dateStr} ${ageBadge}</span>
    </div>
    <div style="padding:12px 20px">
      <table>
        <thead>
          <tr><th>Company</th><th>Role</th><th>Status</th><th>Age</th><th>Overdue</th><th>Action</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function generateFreshnessBadges() {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  // Source-of-truth list: each task we expect to see fire at least daily.
  // expectedHours = how often it's supposed to run (used to color the badge).
  const tasks = [
    { id: 'dashboard',    label: '🖥 Dashboard',    types: ['dashboard.generated'],          expectedHours: 1 },
    { id: 'scanner',      label: '🔎 Scanner',      types: ['scanner.run.completed', 'auto-scan.run.completed'], expectedHours: 24 },
    { id: 'prefilter',    label: '🧮 Prefilter',    types: ['prefilter_templates_generated'], expectedHours: 24 },
    { id: 'gmail-sync',   label: '📬 Gmail-Sync',   types: ['gmail-sync.run.success', 'gmail-sync.run.completed'], expectedHours: 1 },
    { id: 'cadence',      label: '⏰ Cadence-Alert', types: ['cadence-alert.run.completed', 'cadence-alert.run.success'], expectedHours: 24 },
    { id: 'brain-ingest', label: '🧠 Brain Ingest', types: ['brain.ingest.completed', 'brain.embed.completed'], expectedHours: 24, optional: true },
  ];

  const eventTs = (e) => new Date(e.recorded_at || e.timestamp || e.ts || e.at || 0).getTime();

  // Recent task.failed events surface as a separate red strip.
  const recentFailures = automationEvents
    .filter((e) => e?.type === 'task.failed' && eventTs(e))
    .filter((e) => (now - eventTs(e)) < oneDayMs)
    .sort((a, b) => eventTs(b) - eventTs(a));

  const lastByTask = (typesArr) => {
    let latestTs = 0;
    for (const e of automationEvents) {
      if (!typesArr.includes(e?.type)) continue;
      const ts = eventTs(e);
      if (ts > latestTs) latestTs = ts;
    }
    return latestTs;
  };

  const fmtAge = (ageMs) => {
    if (!isFinite(ageMs) || ageMs < 0) return '—';
    const min = Math.floor(ageMs / 60000);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    return `${Math.floor(hr / 24)}d`;
  };

  const badges = tasks.map((t) => {
    const ts = lastByTask(t.types);
    if (!ts) {
      const color = t.optional ? '#6c7086' : '#f38ba8';
      const tip = t.optional ? 'no events (optional)' : 'no events recorded';
      return { ...t, ts: 0, color, ageStr: 'never', tip };
    }
    const ageMs = now - ts;
    const ageHrs = ageMs / (60 * 60 * 1000);
    let color = '#a6e3a1';
    let tip = 'fresh';
    if (ageHrs > t.expectedHours * 3) {
      color = '#f38ba8'; tip = `> ${(t.expectedHours * 3).toFixed(0)}h since last run`;
    } else if (ageHrs > t.expectedHours * 1.5) {
      color = '#f9e2af'; tip = `> ${(t.expectedHours * 1.5).toFixed(0)}h since last run`;
    }
    return { ...t, ts, color, ageStr: fmtAge(ageMs), tip };
  });

  const badgeHtml = badges.map((b) => `
    <div title="${escHtml(b.tip)}" style="display:flex;flex-direction:column;align-items:center;padding:8px 12px;border:1px solid ${b.color}33;border-radius:6px;background:${b.color}0a;min-width:96px">
      <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px">${b.label}</div>
      <div style="font-size:18px;font-weight:700;color:${b.color};margin-top:4px">${b.ageStr}</div>
    </div>`).join('');

  const failureStrip = recentFailures.length === 0 ? '' : `
    <div style="margin-top:12px;padding:10px 14px;border:1px solid #f38ba844;border-radius:6px;background:#f38ba811">
      <div style="font-size:11px;color:#f38ba8;text-transform:uppercase;letter-spacing:0.5px;font-weight:700">
        ⚠ ${recentFailures.length} task.failed event${recentFailures.length === 1 ? '' : 's'} in last 24h
      </div>
      <div style="margin-top:6px;font-size:12px;color:var(--text);line-height:1.6">
        ${recentFailures.slice(0, 5).map((e) => `
          <div><span class="muted">${escHtml(String(e.recorded_at || e.timestamp || '').slice(0, 19).replace('T', ' '))}</span>
          <strong>${escHtml(e.task || 'unknown')}</strong>
          ${e.error_code !== undefined ? `<span class="muted">exit ${e.error_code}</span>` : ''}
          ${e.error ? `— <span style="color:var(--subtext)">${escHtml(String(e.error).slice(0, 120))}</span>` : ''}</div>
        `).join('')}
      </div>
    </div>`;

  return `
  <div class="section" style="margin-bottom:16px">
    <div class="section-header">
      <h2>🟢 Freshness</h2>
      <span class="count">last successful run by task</span>
    </div>
    <div style="padding:14px 18px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:stretch">
        ${badgeHtml}
      </div>
      ${failureStrip}
    </div>
  </div>`;
}

function generateGmailSyncTile() {
  const syncEvents = automationEvents.filter((e) =>
    typeof e?.type === 'string' && e.type.startsWith('gmail-sync.run.'));
  if (syncEvents.length === 0) {
    return `
  <div class="section" style="margin-bottom:16px">
    <div class="section-header"><h2>📬 Gmail Sync</h2><span class="count" style="color:#f38ba8">no runs logged</span></div>
    <div style="padding:12px 20px;font-size:12px;color:var(--subtext)">
      No gmail-sync events in <code>data/events/*.jsonl</code>. Verify the Windows task is registered: see <code>scripts/register-gmail-sync-task.ps1</code>.
    </div>
  </div>`;
  }
  const latest = syncEvents
    .map((e) => ({ ...e, ts: new Date(e.timestamp || e.ts || e.at || 0).getTime() }))
    .sort((a, b) => b.ts - a.ts)[0];
  const ageMs = latest.ts ? (Date.now() - latest.ts) : Infinity;
  const ageMin = Math.floor(ageMs / 60000);
  const ageStr = ageMin < 60
    ? `${ageMin} min ago`
    : ageMin < 1440
      ? `${Math.floor(ageMin / 60)} hr ago`
      : `${Math.floor(ageMin / 1440)} d ago`;
  const isFailure = latest.type === 'gmail-sync.run.failed' || latest.status === 'failure';
  // Task runs every 30 min; green <60m, yellow <4h, red >4h or last was failure.
  let color = '#a6e3a1';
  let label = 'healthy';
  if (isFailure) {
    color = '#f38ba8'; label = 'last run failed';
  } else if (ageMs > 4 * 60 * 60 * 1000) {
    color = '#f38ba8'; label = 'stale';
  } else if (ageMs > 60 * 60 * 1000) {
    color = '#f9e2af'; label = 'slow';
  }
  const matched = latest.details?.matched ?? '—';
  const status = latest.status || 'success';
  return `
  <div class="section" style="margin-bottom:16px">
    <div class="section-header">
      <h2>📬 Gmail Sync</h2>
      <span class="count" style="color:${color};font-weight:600">${label} · ${ageStr}</span>
    </div>
    <div style="padding:12px 20px;font-size:12px;color:var(--subtext);display:flex;gap:24px;flex-wrap:wrap">
      <span>Last status: <strong style="color:${color}">${status}</strong></span>
      <span>Matched: <strong>${matched}</strong></span>
      <span>Event: <code>${latest.type}</code></span>
    </div>
  </div>`;
}

function generateBrainTile() {
  if (!isBrainAvailable()) return '';
  const s = getBrainStats();
  if (!s.available) {
    return `
  <div class="section" style="margin-bottom:16px">
    <div class="section-header"><h2>🧠 Brain</h2><span class="count" style="color:#f38ba8">unavailable</span></div>
    <div style="padding:12px 20px;font-size:12px;color:var(--subtext)">
      <code>${(s.error || 'unknown').replace(/</g, '&lt;').slice(0, 200)}</code>
    </div>
  </div>`;
  }
  const typeBadges = Object.entries(s.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span>${t}: <strong>${n}</strong></span>`)
    .join('');
  return `
  <div class="section" style="margin-bottom:16px">
    <div class="section-header">
      <h2>🧠 Brain</h2>
      <span class="count" style="color:#a6e3a1;font-weight:600">${s.pages} pages · ${s.links} links</span>
    </div>
    <div style="padding:12px 20px;font-size:12px;color:var(--subtext);display:flex;gap:24px;flex-wrap:wrap">
      ${typeBadges}
      <span>Chunks: <strong>${s.chunks}</strong></span>
      <span>Embedded: <strong>${s.embedded}</strong></span>
      <span>Timeline: <strong>${s.timeline}</strong></span>
    </div>
  </div>`;
}

function generateNextActions(appList) {
  const actionable = appList
    .filter((a) => a.status === 'GO' || a.status === 'Conditional GO')
    .filter((a) => a.priority && a.priority.priorityScore > 0)
    .sort((a, b) => b.priority.priorityScore - a.priority.priorityScore)
    .slice(0, 5);

  if (actionable.length === 0) return '';

  const rows = actionable.map((app, i) => {
    const urgency = app.priority.urgencyMultiplier ?? 1.0;
    const urgencyBadge = urgency >= 1.25
      ? '<span style="color:#f38ba8;font-weight:600">Closing ≤2d</span>'
      : urgency >= 1.10
        ? '<span style="color:#f9e2af;font-weight:600">Closing ≤7d</span>'
        : urgency < 1.0
          ? '<span style="color:#6c7086">Past close</span>'
          : '<span style="color:var(--overlay0)">—</span>';
    const applyLink = app.jobUrl
      ? `<a href="${app.jobUrl}" target="_blank" style="color:#89b4fa;font-weight:600">Apply →</a>`
      : '<span style="color:var(--overlay0)">—</span>';
    const isGO = app.status === 'GO';
    const badgeColor = isGO ? '#a6e3a1' : '#f9e2af';
    const statusBadge = `<span class="badge" style="color:${badgeColor};border-color:${badgeColor}22;background:${badgeColor}11">${app.status}</span>`;
    return `<tr>
      <td style="text-align:center;color:var(--subtext);font-weight:700;font-size:18px">${i + 1}</td>
      <td>${statusBadge}</td>
      <td class="company"><strong>${app.company}</strong></td>
      <td class="role">${app.role}</td>
      <td class="score">${scoreBar(app.score)}</td>
      <td style="font-weight:600;color:#a6e3a1;text-align:center">${app.priority.priorityScore}</td>
      <td style="text-align:center">${urgencyBadge}</td>
      <td>${applyLink}</td>
    </tr>`;
  }).join('');

  return `
  <!-- Next 5 Actions -->
  <div class="section">
    <div class="section-header">
      <h2>🎯 Next 5 Applications</h2>
      <span class="count">ranked by priority × urgency</span>
    </div>
    <div style="padding:8px 20px 0;font-size:12px;color:var(--subtext)">
      Highest-priority GO / Conditional-GO rows after fit, freshness, location, and deadline urgency.
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th style="text-align:center">#</th>
            <th>Status</th>
            <th>Company</th>
            <th>Role</th>
            <th>Score</th>
            <th style="text-align:center">Priority</th>
            <th style="text-align:center">Urgency</th>
            <th>Apply</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

// ─── v14 Response Tracker Sections ─────────────────────────────────────────

function generateDailyGoal() {
  const pct = Math.min(100, (submittedToday / DAILY_TARGET) * 100);
  const barColor = pct >= 100 ? '#a6e3a1' : pct >= 50 ? '#f9e2af' : '#89b4fa';
  const remaining = Math.max(0, DAILY_TARGET - submittedToday);
  return `
  <!-- Daily Submission Goal -->
  <div class="section">
    <div class="section-header">
      <h2>🎯 Today's Goal (${today})</h2>
      <span class="count">${submittedToday} / ${DAILY_TARGET}</span>
    </div>
    <div style="padding:16px 20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="flex:1;height:24px;background:#313244;border-radius:12px;overflow:hidden;position:relative">
          <div style="width:${pct}%;height:100%;background:${barColor};transition:width 0.3s ease"></div>
          <div style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#1e1e2e">
            ${submittedToday} submitted
          </div>
        </div>
        <span style="font-size:13px;color:#a6adc8;min-width:80px;text-align:right">${remaining} to go</span>
      </div>
      <div style="font-size:12px;color:#6c7086">
        At 50 apps/day: 250/week · 1,000/month · ~2% reply = 20 replies/week · ~10% of replies → interview = 2 interviews/week
      </div>
    </div>
  </div>`;
}

function generateResponseFunnel() {
  if (responses.length === 0) {
    return `
  <div class="section">
    <div class="section-header"><h2>📊 Response Funnel</h2><span class="count">0 submissions</span></div>
    <div style="padding:20px;color:#6c7086;font-size:13px">No submissions logged yet. Use <code>node scripts/log-response.mjs --new ...</code> to record your first submission.</div>
  </div>`;
  }
  const maxCount = funnelCounts[0].count || 1;
  return `
  <!-- Response Funnel -->
  <div class="section">
    <div class="section-header">
      <h2>📊 Response Funnel</h2>
      <span class="count">${responses.length} total</span>
      <span class="count" style="margin-left:4px;color:#a6e3a1">${replyRate}% reply rate</span>
    </div>
    <div style="padding:16px 20px">
      ${funnelCounts.map((stage, i) => {
        const pct = (stage.count / maxCount) * 100;
        const conv = i === 0 ? '—' : `${((stage.count / (funnelCounts[0].count || 1)) * 100).toFixed(0)}%`;
        const width = Math.max(10, 100 - (i * 15));
        const colors = ['#89b4fa', '#94e2d5', '#f9e2af', '#fab387', '#a6e3a1'];
        return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="min-width:140px;font-size:12px;color:#cdd6f4;text-align:right">${stage.label}</div>
          <div style="flex:1;height:20px;background:#313244;border-radius:4px;position:relative;max-width:${width}%">
            <div style="width:${pct}%;height:100%;background:${colors[i]};border-radius:4px"></div>
            <div style="position:absolute;top:0;left:8px;line-height:20px;font-size:11px;font-weight:600;color:#1e1e2e">${stage.count}</div>
          </div>
          <div style="min-width:48px;font-size:11px;color:#a6adc8">${conv}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function generateFollowupQueue() {
  const stale = responses.filter(r => {
    if (TERMINAL_STATUSES.has(r.status)) return false;
    if (r.status !== 'submitted' && r.status !== 'acknowledged') return false;
    const days = r.response_days === '—' ? 0 : parseInt(r.response_days, 10) || 0;
    const daysSinceSubmit = Math.round((new Date() - new Date(r.submitted_at)) / (1000 * 60 * 60 * 24));
    return daysSinceSubmit >= 7;
  }).sort((a, b) => {
    const aDays = Math.round((new Date() - new Date(a.submitted_at)) / (1000 * 60 * 60 * 24));
    const bDays = Math.round((new Date() - new Date(b.submitted_at)) / (1000 * 60 * 60 * 24));
    return bDays - aDays;
  });

  if (stale.length === 0) {
    return `
  <div class="section">
    <div class="section-header"><h2>⏰ Follow-up Queue</h2><span class="count">0 stale</span></div>
    <div style="padding:20px;color:#6c7086;font-size:13px">Nothing needs follow-up. All submissions are recent or have progressed.</div>
  </div>`;
  }

  const rows = stale.map(r => {
    const days = Math.round((new Date() - new Date(r.submitted_at)) / (1000 * 60 * 60 * 24));
    const color = days >= 14 ? '#f38ba8' : '#f9e2af';
    const urgency = days >= 14 ? 'URGENT (LinkedIn msg)' : 'Stale (>7d)';
    return `<tr>
      <td>#${r.app_id}</td>
      <td><strong>${r.company}</strong></td>
      <td>${r.role}</td>
      <td>${r.ats}</td>
      <td>${r.submitted_at}</td>
      <td style="color:${color};font-weight:600">${days}d</td>
      <td><span class="badge" style="color:${color};border-color:${color}22;background:${color}11">${urgency}</span></td>
    </tr>`;
  }).join('');

  return `
  <!-- Follow-up Queue -->
  <div class="section">
    <div class="section-header">
      <h2>⏰ Follow-up Queue</h2>
      <span class="count">${stale.length} stale</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>#</th><th>Company</th><th>Role</th><th>ATS</th><th>Submitted</th><th>Days</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function generateChannelPerformance() {
  if (responses.length === 0) return '';
  const byAts = new Map();
  for (const r of responses) {
    const ats = r.ats || 'Unknown';
    if (!byAts.has(ats)) byAts.set(ats, { ats, submitted: 0, acked: 0, interview: 0, offer: 0, rejected: 0 });
    const b = byAts.get(ats);
    b.submitted++;
    if (['acknowledged', 'recruiter_reply', 'phone_screen', 'interview', 'offer'].includes(r.status)) b.acked++;
    if (['phone_screen', 'interview', 'offer'].includes(r.status)) b.interview++;
    if (r.status === 'offer') b.offer++;
    if (r.status === 'rejected') b.rejected++;
  }
  const rows = [...byAts.values()].sort((a, b) => b.submitted - a.submitted).map(b => {
    const replyRate = b.submitted > 0 ? ((b.acked / b.submitted) * 100).toFixed(0) : 0;
    return `<tr>
      <td><strong>${b.ats}</strong></td>
      <td>${b.submitted}</td>
      <td style="color:#94e2d5">${b.acked}</td>
      <td style="color:#f9e2af">${b.interview}</td>
      <td style="color:#a6e3a1">${b.offer}</td>
      <td style="color:#f38ba8">${b.rejected}</td>
      <td style="font-weight:600">${replyRate}%</td>
    </tr>`;
  }).join('');
  return `
  <!-- Channel Performance -->
  <div class="section">
    <div class="section-header">
      <h2>📈 Channel Performance</h2>
      <span class="count">${byAts.size} channels</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>ATS</th><th>Submitted</th><th>Acked</th><th>Interview</th><th>Offer</th><th>Rejected</th><th>Reply %</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

const tabStatuses = ['ALL', 'Evaluated', 'Applied', 'Contact', 'Interview', 'TOP≥4', 'SKIP'];
function tabCount(status) {
  if (status === 'ALL') return apps.length;
  if (status === 'TOP≥4') return apps.filter(a => (a.score ?? 0) >= 4).length;
  return apps.filter(a => a.status === status).length;
}

// ─── v15 Response Tracker Extensions ─────────────────────────────────────────

function generateApplied30Days() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const applied30 = responses.filter(r => r.submitted_at >= thirtyDaysAgo)
    .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

  if (applied30.length === 0) {
    return `
  <div class="section">
    <div class="section-header"><h2>Applied (Last 30 Days)</h2><span class="count">0 submissions</span></div>
    <div style="padding:20px;color:#6c7086;font-size:13px">No applications in the last 30 days.</div>
  </div>`;
  }

  const rows = applied30.map(r => {
    const daysSince = Math.round((new Date() - new Date(r.submitted_at)) / (1000 * 60 * 60 * 24));
    return `<tr>
      <td>#${r.app_id}</td>
      <td><strong>${r.company}</strong></td>
      <td>${r.role}</td>
      <td>${r.submitted_at}</td>
      <td>${r.ats}</td>
      <td>${r.status}</td>
      <td>${daysSince}d</td>
    </tr>`;
  }).join('');

  return `
  <!-- Applied (Last 30 Days) -->
  <div class="section">
    <div class="section-header">
      <h2>Applied (Last 30 Days)</h2>
      <span class="count">${applied30.length} submissions</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>#</th><th>Company</th><th>Role</th><th>Submitted</th><th>ATS</th><th>Status</th><th>Days</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function generatePendingResponse() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const pending = responses.filter(r => {
    if (r.status !== 'submitted') return false;
    const daysSince = Math.round((new Date() - new Date(r.submitted_at)) / (1000 * 60 * 60 * 24));
    return daysSince > 7;
  }).sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));

  if (pending.length === 0) {
    return `
  <div class="section">
    <div class="section-header"><h2>Pending Response (&gt;7 days)</h2><span class="count">0 stale</span></div>
    <div style="padding:20px;color:#6c7086;font-size:13px">No stale applications. All recent submissions or progressed.</div>
  </div>`;
  }

  const rows = pending.map(r => {
    const daysSince = Math.round((new Date() - new Date(r.submitted_at)) / (1000 * 60 * 60 * 24));
    const cmdCopy = `node scripts/log-response.mjs --app-id ${r.app_id} --event recruiter_reply --notes ""`;
    return `<tr>
      <td>#${r.app_id}</td>
      <td><strong>${r.company}</strong></td>
      <td>${r.role}</td>
      <td>${r.submitted_at}</td>
      <td>${r.ats}</td>
      <td>${daysSince}d</td>
      <td><code style="font-size:11px;color:#a6adc8;background:#313244;padding:3px 6px;border-radius:3px;display:inline-block">${cmdCopy}</code></td>
    </tr>`;
  }).join('');

  return `
  <!-- Pending Response (>7 days) -->
  <div class="section">
    <div class="section-header">
      <h2>Pending Response (&gt;7 days)</h2>
      <span class="count">${pending.length} stale</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>#</th><th>Company</th><th>Role</th><th>Submitted</th><th>ATS</th><th>Days</th><th style="width:400px">Log Event</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function generateActiveConversations() {
  const active = responses.filter(r =>
    ['phone_screen', 'phone_screen_scheduled', 'phone_screen_done', 'on_site_scheduled', 'on_site_done', 'offer'].includes(r.status)
  ).sort((a, b) => new Date(b.last_event_at) - new Date(a.last_event_at));

  if (active.length === 0) {
    return `
  <div class="section">
    <div class="section-header"><h2>Active Conversations</h2><span class="count">0 in flight</span></div>
    <div style="padding:20px;color:#6c7086;font-size:13px">No active conversations. Build the funnel by logging responses.</div>
  </div>`;
  }

  const rows = active.map(r => {
    const daysSince = Math.round((new Date() - new Date(r.submitted_at)) / (1000 * 60 * 60 * 24));
    const stageColor = r.status === 'offer' ? '#a6e3a1'
      : r.status.includes('on_site') ? '#f9e2af'
      : r.status.includes('phone') ? '#89dceb'
      : '#6c7086';
    return `<tr>
      <td>#${r.app_id}</td>
      <td><strong>${r.company}</strong></td>
      <td>${r.role}</td>
      <td>${r.submitted_at}</td>
      <td>${r.ats}</td>
      <td><span class="badge" style="color:${stageColor};border-color:${stageColor}22;background:${stageColor}11">${r.status}</span></td>
      <td>${daysSince}d since submit</td>
    </tr>`;
  }).join('');

  return `
  <!-- Active Conversations -->
  <div class="section">
    <div class="section-header">
      <h2>Active Conversations</h2>
      <span class="count">${active.length} in flight</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>#</th><th>Company</th><th>Role</th><th>Submitted</th><th>ATS</th><th>Stage</th><th>Timeline</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function generateResponseMetrics() {
  if (responses.length === 0) return '';

  // Calculate metrics per schema requirements
  const withReply = responses.filter(r => !['submitted', 'ghosted'].includes(r.status)).length;
  const withPhone = responses.filter(r =>
    ['phone_screen', 'phone_screen_scheduled', 'phone_screen_done', 'on_site_scheduled', 'on_site_done', 'offer'].includes(r.status)
  ).length;
  const withOnSite = responses.filter(r =>
    ['on_site_scheduled', 'on_site_done', 'offer'].includes(r.status)
  ).length;
  const withOffer = responses.filter(r => r.status === 'offer').length;

  const replyPct = responses.length > 0 ? ((withReply / responses.length) * 100).toFixed(1) : '0.0';
  const phonePct = withReply > 0 ? ((withPhone / withReply) * 100).toFixed(1) : '0.0';
  const onSitePct = withPhone > 0 ? ((withOnSite / withPhone) * 100).toFixed(1) : '0.0';
  const offerPct = withOnSite > 0 ? ((withOffer / withOnSite) * 100).toFixed(1) : '0.0';

  return `
  <!-- Response Rate Metrics -->
  <div class="section">
    <div class="section-header">
      <h2>📈 Response Rate Metrics</h2>
      <span class="count">${responses.length} total</span>
    </div>
    <div style="padding:16px 20px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <div style="background:#313244;border-radius:8px;padding:12px">
          <div style="font-size:12px;color:#a6adc8;margin-bottom:4px">Applied → First Reply</div>
          <div style="font-size:24px;font-weight:600;color:#89dceb">${withReply}</div>
          <div style="font-size:11px;color:#6c7086;margin-top:2px">${replyPct}% of ${responses.length}</div>
        </div>
        <div style="background:#313244;border-radius:8px;padding:12px">
          <div style="font-size:12px;color:#a6adc8;margin-bottom:4px">First Reply → Phone</div>
          <div style="font-size:24px;font-weight:600;color:#94e2d5">${withPhone}</div>
          <div style="font-size:11px;color:#6c7086;margin-top:2px">${phonePct}% of ${withReply}</div>
        </div>
        <div style="background:#313244;border-radius:8px;padding:12px">
          <div style="font-size:12px;color:#a6adc8;margin-bottom:4px">Phone → On-Site</div>
          <div style="font-size:24px;font-weight:600;color:#f9e2af">${withOnSite}</div>
          <div style="font-size:11px;color:#6c7086;margin-top:2px">${onSitePct}% of ${withPhone}</div>
        </div>
        <div style="background:#313244;border-radius:8px;padding:12px">
          <div style="font-size:12px;color:#a6adc8;margin-bottom:4px">On-Site → Offer</div>
          <div style="font-size:24px;font-weight:600;color:#a6e3a1">${withOffer}</div>
          <div style="font-size:11px;color:#6c7086;margin-top:2px">${offerPct}% of ${withOnSite}</div>
        </div>
      </div>
    </div>
  </div>`;
}

function generateAnalytics() {
  if (apps.length < 3) return '';
  const totalApps = apps.length;
  const applied = apps.filter(a => ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(a.status)).length;
  const responded = apps.filter(a => ['Responded', 'Interview', 'Offer'].includes(a.status)).length;
  const interviewed = apps.filter(a => ['Interview', 'Offer'].includes(a.status)).length;
  const rejected = apps.filter(a => a.status === 'Rejected').length;
  const offered = apps.filter(a => a.status === 'Offer').length;
  const convRate = applied > 0 ? ((responded / applied) * 100).toFixed(1) : '0.0';
  const intRate = applied > 0 ? ((interviewed / applied) * 100).toFixed(1) : '0.0';

  const scored = apps.filter(a => a.score !== null);
  const avgScore = scored.length > 0 ? (scored.reduce((s, a) => s + a.score, 0) / scored.length).toFixed(2) : 'N/A';
  const above4 = scored.filter(a => a.score >= 4.0).length;
  const above3 = scored.filter(a => a.score >= 3.0 && a.score < 4.0).length;
  const below3 = scored.filter(a => a.score < 3.0).length;

  const sourceStats = {};
  for (const row of scanHistory) {
    const src = row.portal || 'unknown';
    if (!sourceStats[src]) sourceStats[src] = { added: 0, skipped: 0 };
    if (row.status === 'added') sourceStats[src].added++;
    else sourceStats[src].skipped++;
  }
  const topSources = Object.entries(sourceStats)
    .map(([portal, s]) => ({ portal, ...s, total: s.added + s.skipped, hitRate: s.total > 0 ? ((s.added / s.total) * 100).toFixed(1) : '0.0' }))
    .sort((a, b) => b.added - a.added)
    .slice(0, 8);

  const datedApps = apps.filter(a => a.date);
  const last7 = datedApps.filter(a => daysSinceIsoDate(a.date) <= 7).length;
  const last30 = datedApps.filter(a => daysSinceIsoDate(a.date) <= 30).length;
  const weeklyRate = last30 > 0 ? (last30 / 4.3).toFixed(1) : '0';

  // Build funnel bars
  const funnelData = [
    { label: 'Evaluated', count: totalApps, color: '#cdd6f4' },
    { label: 'Applied', count: applied, color: '#89b4fa' },
    { label: 'Responded', count: responded, color: '#94e2d5' },
    { label: 'Interview', count: interviewed, color: '#cba6f7' },
    { label: 'Offer', count: offered, color: '#a6e3a1' },
    { label: 'Rejected', count: rejected, color: '#f38ba8' },
  ];
  const funnelHtml = funnelData.map(s => {
    const pct = totalApps > 0 ? ((s.count / totalApps) * 100).toFixed(0) : 0;
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px">' +
      '<span style="min-width:70px;text-align:right;color:var(--subtext)">' + s.label + '</span>' +
      '<div style="flex:1;height:12px;background:var(--surface0);border-radius:3px">' +
      '<div style="width:' + pct + '%;height:100%;background:' + s.color + ';border-radius:3px;min-width:' + (s.count > 0 ? '2px' : '0') + '"></div>' +
      '</div>' +
      '<span style="min-width:40px;font-size:11px;color:' + s.color + '">' + s.count + ' (' + pct + '%)</span>' +
      '</div>';
  }).join('');

  // Build source bars
  const maxAdded = topSources.length > 0 ? topSources[0].added || 1 : 1;
  const sourceHtml = topSources.length > 0 ? topSources.map(s => {
    const pct = ((s.added / maxAdded) * 100).toFixed(0);
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:11px">' +
      '<span style="min-width:120px;text-align:right;color:var(--subtext);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.portal + '</span>' +
      '<div style="flex:1;height:8px;background:var(--surface0);border-radius:2px">' +
      '<div style="width:' + pct + '%;height:100%;background:#89dceb;border-radius:2px"></div>' +
      '</div>' +
      '<span style="min-width:50px;font-size:10px;color:var(--overlay0)">' + s.added + ' (' + s.hitRate + '%)</span>' +
      '</div>';
  }).join('') : '<div class="muted" style="font-size:12px">No scan history data yet.</div>';

  return `<div class="section">
    <div class="section-header">
      <h2>Application Analytics</h2>
      <span class="count">${totalApps} total | ${avgScore} avg score | ${weeklyRate}/week pace</span>
    </div>
    <div style="padding:16px 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px">
      <div>
        <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Conversion Funnel</div>
        ${funnelHtml}
        <div style="margin-top:8px;font-size:11px;color:var(--overlay0)">
          Response rate: <strong style="color:var(--teal)">${convRate}%</strong> |
          Interview rate: <strong style="color:var(--mauve)">${intRate}%</strong>
        </div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Score Distribution</div>
        <div style="display:flex;gap:12px;margin-bottom:12px">
          <div style="text-align:center;flex:1;padding:8px;background:var(--surface0);border-radius:6px">
            <div style="font-size:20px;font-weight:700;color:#a6e3a1">${above4}</div>
            <div style="font-size:10px;color:var(--subtext)">Score 4+</div>
          </div>
          <div style="text-align:center;flex:1;padding:8px;background:var(--surface0);border-radius:6px">
            <div style="font-size:20px;font-weight:700;color:#f9e2af">${above3}</div>
            <div style="font-size:10px;color:var(--subtext)">Score 3-4</div>
          </div>
          <div style="text-align:center;flex:1;padding:8px;background:var(--surface0);border-radius:6px">
            <div style="font-size:20px;font-weight:700;color:#f38ba8">${below3}</div>
            <div style="font-size:10px;color:var(--subtext)">Score &lt;3</div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--overlay0)">
          Avg: <strong style="color:var(--text)">${avgScore}/5</strong> |
          Last 7d: <strong>${last7}</strong> |
          Last 30d: <strong>${last30}</strong>
        </div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Source Performance (scan history)</div>
        ${sourceHtml}
      </div>
    </div>
  </div>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Career-Ops Dashboard</title>
<meta http-equiv="refresh" content="300">
<style>
  :root {
    --base:    #1e1e2e;
    --mantle:  #181825;
    --crust:   #11111b;
    --surface0:#313244;
    --surface1:#45475a;
    --surface2:#585b70;
    --overlay0:#6c7086;
    --overlay1:#7f849c;
    --text:    #cdd6f4;
    --subtext: #a6adc8;
    --mauve:   #cba6f7;
    --blue:    #89b4fa;
    --sapphire:#74c7ec;
    --sky:     #89dceb;
    --teal:    #94e2d5;
    --green:   #a6e3a1;
    --yellow:  #f9e2af;
    --peach:   #fab387;
    --red:     #f38ba8;
    --pink:    #f5c2e7;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--base); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Layout */
  .header { background: var(--crust); border-bottom: 1px solid var(--surface0); padding: 16px 24px; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 18px; font-weight: 700; color: var(--mauve); letter-spacing: 0.5px; }
  .header .subtitle { color: var(--subtext); font-size: 12px; }
  .header .gen-time { margin-left: auto; color: var(--overlay0); font-size: 11px; }
  .header .refresh-btn { background: var(--surface0); border: 1px solid var(--surface1); color: var(--text); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .header .refresh-btn:hover { background: var(--surface1); }

  .main { padding: 20px 24px; max-width: 1400px; margin: 0 auto; }

  /* Stats row */
  .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat-card { background: var(--mantle); border: 1px solid var(--surface0); border-radius: 8px; padding: 12px 16px; min-width: 120px; }
  .stat-card .label { font-size: 11px; color: var(--subtext); text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 24px; font-weight: 700; margin-top: 2px; }

  /* Section */
  .section { background: var(--mantle); border: 1px solid var(--surface0); border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
  .section-header { padding: 14px 20px; border-bottom: 1px solid var(--surface0); display: flex; align-items: center; gap: 10px; }
  .section-header h2 { font-size: 14px; font-weight: 600; color: var(--text); }
  .section-header .count { background: var(--surface0); color: var(--subtext); font-size: 11px; padding: 2px 7px; border-radius: 10px; }

  /* Tabs */
  .tabs { display: flex; gap: 4px; padding: 12px 20px 0; border-bottom: 1px solid var(--surface0); overflow-x: auto; }
  .tab { padding: 8px 14px; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 12px; font-weight: 500; color: var(--subtext); border: 1px solid transparent; border-bottom: none; white-space: nowrap; }
  .tab:hover { color: var(--text); background: var(--surface0); }
  .tab.active { color: var(--mauve); background: var(--surface0); border-color: var(--surface1); }
  .tab .tab-count { background: var(--surface1); border-radius: 8px; padding: 1px 6px; font-size: 10px; margin-left: 5px; }

  /* Sort bar */
  .sort-bar { display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-bottom: 1px solid var(--surface0); }
  .sort-bar span { font-size: 11px; color: var(--subtext); }
  .sort-btn { background: var(--surface0); border: 1px solid var(--surface1); color: var(--subtext); padding: 4px 10px; border-radius: 5px; cursor: pointer; font-size: 11px; }
  .sort-btn:hover, .sort-btn.active { background: var(--surface1); color: var(--text); }

  /* Table */
  table { width: 100%; border-collapse: collapse; }
  th { background: var(--crust); color: var(--subtext); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--surface0); position: sticky; top: 0; }
  td { padding: 10px 16px; border-bottom: 1px solid var(--surface0); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface0)22; }
  .notes-row td { padding-top: 0; }
  .notes-row:hover td { background: transparent; }

  .num { color: var(--overlay0); font-size: 12px; font-family: monospace; white-space: nowrap; }
  .date { color: var(--subtext); font-size: 12px; white-space: nowrap; }
  .company strong { display: block; }
  .salary { font-size: 11px; color: var(--green); margin-top: 2px; }
  .arch { font-size: 11px; color: var(--subtext); margin-top: 2px; font-style: italic; }
  .actions { white-space: nowrap; font-size: 16px; }
  .actions a { margin-right: 6px; }

  .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; border: 1px solid; white-space: nowrap; }

  .score-wrap { display: flex; align-items: center; gap: 8px; }
  .score-num { font-size: 13px; font-weight: 600; min-width: 28px; }
  .score-bar { flex: 1; height: 6px; background: var(--surface1); border-radius: 3px; min-width: 50px; }
  .score-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
  .no-score { color: var(--overlay0); }

  .notes { font-size: 12px; color: var(--subtext); background: var(--surface0)44; padding: 6px 10px; border-radius: 4px; border-left: 2px solid var(--surface1); }
  .muted { color: var(--overlay1); font-size: 11px; }

  .empty { text-align: center; padding: 32px; color: var(--overlay0); }

  /* Pipeline section */
  .pipeline-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
  .pipeline-col { padding: 0; }
  .pipeline-col:first-child { border-right: 1px solid var(--surface0); }
  .pipeline-col h3 { font-size: 12px; color: var(--subtext); text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 16px; border-bottom: 1px solid var(--surface0); }
  .pipeline-table td { padding: 7px 14px; font-size: 12px; }

  /* Responsive */
  @media (max-width: 900px) {
    .pipeline-grid { grid-template-columns: 1fr; }
    .pipeline-col:first-child { border-right: none; border-bottom: 1px solid var(--surface0); }
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>⚡ Career-Ops</h1>
    <div class="subtitle">Job Search Command Center</div>
  </div>
  <div class="gen-time">Generated ${generatedAt} <span id="countdown" style="color:var(--mauve);margin-left:4px"></span></div>
  <button class="refresh-btn" onclick="location.reload()">↻ Refresh</button>
</div>

<div class="main">

  ${generateMorningBriefing(apps)}

  <!-- Stats Row -->
  <div class="stats">
    <div class="stat-card">
      <div class="label">Total Apps</div>
      <div class="value" style="color:var(--mauve)">${apps.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Evaluated</div>
      <div class="value" style="color:var(--mauve)">${apps.filter(a => a.status === 'Evaluated').length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Applied</div>
      <div class="value" style="color:var(--blue)">${apps.filter(a => a.status === 'Applied').length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Interview</div>
      <div class="value" style="color:var(--green)">${apps.filter(a => a.status === 'Interview').length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Top ≥4</div>
      <div class="value" style="color:var(--yellow)">${apps.filter(a => (a.score ?? 0) >= 4).length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg Score</div>
      <div class="value" style="color:var(--peach)">${apps.filter(a => a.score !== null).length > 0 ? (apps.filter(a => a.score !== null).reduce((s, a) => s + a.score, 0) / apps.filter(a => a.score !== null).length).toFixed(1) : '—'}</div>
    </div>
    <div class="stat-card">
      <div class="label">Pipeline Inbox</div>
      <div class="value" style="color:var(--sky)">${pendingPipeline.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">Dead URLs</div>
      <div class="value" style="color:${liveness.deadCount > 0 ? '#f38ba8' : '#a6e3a1'}">${liveness.deadCount}</div>
      <div class="label" style="margin-top:2px">${liveness.lastRun ? 'checked ' + liveness.lastRun : 'never checked'}</div>
    </div>
  </div>

  ${operatorSnapshotSection}

  ${generateFreshnessBadges()}

  ${generateStaleAlertPanel()}

  <!-- Scan Sources -->
  <div class="section">
    <div class="section-header">
      <h2>Scan Sources</h2>
      <span class="count">${scanHistory.length.toLocaleString()} total scanned</span>
    </div>
    <div style="padding:16px 20px">
      <table>
        <thead>
          <tr><th>Source</th><th>Scanned</th><th>Added</th><th>Hit Rate</th></tr>
        </thead>
        <tbody>
          ${computeSourceBreakdown(scanHistory).map(([, s]) => {
            const rate = s.total > 0 ? ((s.added / s.total) * 100).toFixed(1) : '0.0';
            const barPct = s.total > 0 ? Math.max(2, (s.added / s.total) * 100) : 0;
            const op = boardOperationalBadge(s.opStatus);
            return `<tr>
              <td><strong>${s.label}</strong> <span class="muted" style="font-size:11px">${op}</span></td>
              <td>${s.total.toLocaleString()}</td>
              <td style="color:#a6e3a1">${s.added}</td>
              <td>
                <div class="score-wrap">
                  <span class="score-num">${rate}%</span>
                  <div class="score-bar"><div class="score-fill" style="width:${barPct}%;background:#a6e3a1"></div></div>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Prefilter Queue -->
  <div class="section">
    <div class="section-header">
      <h2>Prefilter Queue</h2>
      <span class="count">${prefilterCards.length} cards</span>
    </div>
    <div style="padding:16px 20px;display:flex;gap:16px;flex-wrap:wrap">
      <div class="stat-card">
        <div class="label">Pending Score</div>
        <div class="value" style="color:#f9e2af">${prefilterPending}</div>
      </div>
      <div class="stat-card">
        <div class="label">Evaluate (≥3.5)</div>
        <div class="value" style="color:#a6e3a1">${prefilterPassed}</div>
      </div>
      <div class="stat-card">
        <div class="label">Maybe (2.5–3.5)</div>
        <div class="value" style="color:#fab387">${prefilterMaybe}</div>
      </div>
      <div class="stat-card">
        <div class="label">Skip (&lt;2.5)</div>
        <div class="value" style="color:#6c7086">${prefilterSkip}</div>
      </div>
    </div>
  </div>

  <!-- Rejection Insights (shown only when rejectionInsights.sufficient === true) -->
  ${rejectionInsights?.sufficient ? `
  <div class="section">
    <div class="section-header">
      <h2>Rejection Insights</h2>
      <span class="count">${rejectionInsights.rejected} rejected / ${rejectionInsights.positive} positive</span>
    </div>
    <div style="padding:16px 20px">
      ${rejectionInsights.recommendations?.length ? `
        <div style="margin-bottom:12px">
          <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Recommendations</div>
          ${rejectionInsights.recommendations.map((r, i) => `
            <div style="display:flex;gap:8px;margin-bottom:6px;font-size:13px">
              <span style="color:#a6e3a1;font-weight:700;min-width:16px">${i + 1}.</span>
              <span>${r}</span>
            </div>`).join('')}
        </div>` : ''}
      ${rejectionInsights.topRejectionGaps?.length ? `
        <div style="margin-top:12px">
          <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Top Gaps in Rejections</div>
          ${rejectionInsights.topRejectionGaps.map(g => `
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;font-size:12px">
              <span style="min-width:20px;text-align:right;color:#f38ba8">${g.count}x</span>
              <span style="min-width:80px;color:var(--subtext)">${g.severity}</span>
              <span>${g.gap}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>
  </div>` : ''}

  <!-- Filter Health (shown only when scan history exists) -->
  ${filterHealth ? `
  <div class="section">
    <div class="section-header">
      <h2>Filter Health</h2>
      <span class="count">${filterHealth.added} added / ${filterHealth.skipped} skipped in ${filterHealth.window}d</span>
    </div>
    <div style="padding:16px 20px">
      ${filterHealth.topKeywords?.length ? `
        <div style="margin-bottom:16px">
          <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Top Performing Keywords</div>
          ${filterHealth.topKeywords.slice(0, 5).map(k => {
            const pct = Math.round((k.count / filterHealth.topKeywords[0].count) * 100);
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;font-size:12px">
              <span style="min-width:24px;text-align:right;color:#a6e3a1;font-weight:700">${k.count}</span>
              <span style="min-width:160px;color:var(--text)">${k.kw}</span>
              <div style="flex:1;background:#313244;border-radius:2px;height:6px">
                <div style="width:${pct}%;background:#a6e3a1;height:6px;border-radius:2px"></div>
              </div>
            </div>`;
          }).join('')}
        </div>` : ''}
      ${filterHealth.deadKeywords?.length ? `
        <div style="margin-bottom:16px">
          <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Zero-Match Keywords (${filterHealth.window}d) — consider pruning</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${filterHealth.deadKeywords.slice(0, 10).map(kw =>
              `<span style="background:#313244;color:#f38ba8;padding:2px 8px;border-radius:4px;font-size:11px">${kw}</span>`
            ).join('')}
          </div>
        </div>` : ''}
      ${filterHealth.novelPhrases?.length ? `
        <div>
          <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Discovery — Common Skipped Phrases (add to positive filter?)</div>
          ${filterHealth.novelPhrases.slice(0, 6).map(p =>
            `<div style="display:flex;gap:8px;margin-bottom:4px;font-size:12px">
              <span style="min-width:24px;text-align:right;color:#f9e2af">${p.count}x</span>
              <span style="color:var(--text)">"${p.phrase}"</span>
            </div>`
          ).join('')}
        </div>` : ''}
      ${filterHealth.sourceRollup?.length ? `
        <div style="margin-top:16px">
          <div style="font-size:11px;color:var(--subtext);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Title filter window — by source (portal)</div>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            <thead><tr style="color:var(--subtext);text-align:left">
              <th style="padding:4px 8px">Source</th>
              <th style="padding:4px 8px">Added</th>
              <th style="padding:4px 8px">Skipped title</th>
              <th style="padding:4px 8px">Other</th>
            </tr></thead>
            <tbody>
              ${filterHealth.sourceRollup.map((s) => `<tr>
                <td style="padding:4px 8px"><strong>${s.label}</strong><div class="muted" style="font-size:10px">${s.portal}</div></td>
                <td style="padding:4px 8px;color:#a6e3a1">${s.added}</td>
                <td style="padding:4px 8px;color:#f9e2af">${s.skippedTitle}</td>
                <td style="padding:4px 8px;color:var(--overlay0)">${s.other}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
    </div>
  </div>` : ''}

  ${generateGmailSyncTile()}

  ${generateBrainTile()}

  ${generateNextActions(apps)}

  ${generateDailyGoal()}

  ${generateResponseFunnel()}

  ${generateFollowupQueue()}

  ${generateChannelPerformance()}

  ${generateResponseMetrics()}

  ${generateApplied30Days()}

  ${generatePendingResponse()}

  ${generateActiveConversations()}

  ${generateApplyQueue(apps)}

  <!-- Application Analytics -->
  ${generateAnalytics()}

  <!-- Offer Comparison (apps with score >= 4.0) -->
  ${(() => {
    const topApps = apps.filter(a => a.score !== null && a.score >= 4.0);
    if (topApps.length < 2) return '';
    topApps.sort((a, b) => (b.priority?.priorityScore ?? 0) - (a.priority?.priorityScore ?? 0));
    return `<div class="section">
      <div class="section-header">
        <h2>Offer Comparison</h2>
        <span class="count">${topApps.length} top opportunities (score &ge; 4.0)</span>
      </div>
      <div style="overflow-x:auto;padding:0">
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead><tr style="color:var(--subtext);text-align:left;border-bottom:1px solid var(--surface0)">
            <th style="padding:10px 12px">Company</th>
            <th style="padding:10px 12px">Role</th>
            <th style="padding:10px 12px">Score</th>
            <th style="padding:10px 12px">Salary</th>
            <th style="padding:10px 12px">Remote</th>
            <th style="padding:10px 12px">Status</th>
            <th style="padding:10px 12px">Archetype</th>
          </tr></thead>
          <tbody>
            ${topApps.map((a, i) => {
              const bg = i === 0 ? 'rgba(166,227,161,0.08)' : 'transparent';
              const medal = i === 0 ? ' style="color:#f9e2af;font-weight:700"' : '';
              const sal = a.reportMeta?.salary || a.salary || '—';
              const remote = a.remote || '—';
              const arch = a.reportMeta?.archetype || '—';
              const sc = a.score ? a.score.toFixed(1) : '—';
              const scColor = a.score >= 4.5 ? '#a6e3a1' : a.score >= 4 ? '#f9e2af' : '#cdd6f4';
              return `<tr style="background:${bg};border-bottom:1px solid var(--surface0)">
                <td style="padding:8px 12px"><strong${medal}>${i === 0 ? '★ ' : ''}${a.company}</strong></td>
                <td style="padding:8px 12px">${a.role}</td>
                <td style="padding:8px 12px;color:${scColor};font-weight:700">${sc}/5</td>
                <td style="padding:8px 12px">${sal}</td>
                <td style="padding:8px 12px">${remote}</td>
                <td style="padding:8px 12px"><span class="badge" style="color:var(--blue);border-color:var(--blue);background:rgba(137,180,250,0.1)">${a.status}</span></td>
                <td style="padding:8px 12px;font-size:11px;color:var(--subtext)">${arch}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  })()}

  <!-- Application Timeline -->
  ${(() => {
    const timelineApps = apps.filter(a => a.date);
    if (timelineApps.length < 2) return '';
    const statusColors = {
      'GO': '#a6e3a1', 'Conditional GO': '#f9e2af', 'Ready to Submit': '#89b4fa',
      'Applied': '#74c7ec', 'In Progress': '#89dceb', 'Interview': '#cba6f7',
      'Offer': '#a6e3a1', 'Rejected': '#f38ba8', 'Discarded': '#6c7086',
      'SKIP': '#585b70', 'Contact': '#94e2d5', 'Responded': '#f5c2e7',
      'Evaluated': '#fab387',
    };
    const now = new Date();
    const dates = timelineApps.map(a => new Date(a.date));
    const earliest = new Date(Math.min(...dates));
    const totalDays = Math.max(1, Math.ceil((now - earliest) / 86400000));
    return `<div class="section">
      <div class="section-header">
        <h2>Application Timeline</h2>
        <span class="count">${timelineApps.length} applications over ${totalDays} days</span>
      </div>
      <div style="padding:16px 20px;overflow-x:auto">
        ${timelineApps.slice(0, 20).map(a => {
          const start = new Date(a.date);
          const daysSinceStart = Math.ceil((start - earliest) / 86400000);
          const leftPct = ((daysSinceStart / totalDays) * 100).toFixed(1);
          const durationDays = Math.ceil((now - start) / 86400000);
          const widthPct = Math.max(2, ((durationDays / totalDays) * 100)).toFixed(1);
          const color = statusColors[a.status] || '#cdd6f4';
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px">
            <span style="min-width:100px;text-align:right;color:var(--subtext);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.company}</span>
            <div style="flex:1;position:relative;height:14px;background:var(--surface0);border-radius:3px">
              <div style="position:absolute;left:${leftPct}%;width:${widthPct}%;height:100%;background:${color};border-radius:3px;opacity:0.8" title="${a.company} — ${a.role} (${a.status}, ${a.date})"></div>
            </div>
            <span style="min-width:60px;font-size:10px;color:${color}">${a.status}</span>
          </div>`;
        }).join('')}
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--overlay0);margin-top:8px">
          <span>${earliest.toISOString().slice(0, 10)}</span>
          <span>Today</span>
        </div>
      </div>
    </div>`;
  })()}

  <!-- Applications Table -->
  <div class="section">
    <div class="tabs" id="tabs">
      ${tabStatuses.map((s, i) => `<div class="tab${i === 0 ? ' active' : ''}" data-filter="${s}" onclick="setTab(this)">${s}<span class="tab-count">${tabCount(s)}</span></div>`).join('')}
    </div>
    <div class="sort-bar">
      <span>Sort:</span>
      <button class="sort-btn active" data-sort="num" onclick="setSort(this)">Entry #</button>
      <button class="sort-btn" data-sort="priority" onclick="setSort(this)">Priority</button>
      <button class="sort-btn" data-sort="score" onclick="setSort(this)">Score</button>
      <button class="sort-btn" data-sort="date" onclick="setSort(this)">Date</button>
      <button class="sort-btn" data-sort="company" onclick="setSort(this)">Company</button>
      <button class="sort-btn" data-sort="status" onclick="setSort(this)">Status</button>
    </div>
    <div style="overflow-x:auto">
      <table id="apps-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Date</th>
            <th>Company</th>
            <th>Role</th>
            <th>Score</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody id="apps-body">
          ${appRows(apps)}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Pipeline Inbox -->
  <div class="section">
    <div class="section-header">
      <h2>📥 Pipeline Inbox</h2>
      <span class="count">${pendingPipeline.length} pending</span>
      <span class="count" style="margin-left:4px">${processedPipeline.length} processed</span>
    </div>
    ${(() => {
      const breakdown = computePipelineBreakdown(pendingPipeline);
      if (!breakdown.length) return '';
      const maxCount = breakdown[0][1];
      return `<div style="padding:12px 20px;border-bottom:1px solid #313244">
        <div style="font-size:11px;color:#a6adc8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">By Company</div>
        ${breakdown.map(([co, count]) => {
          const pct = (count / maxCount) * 100;
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="min-width:140px;font-size:12px;text-align:right;color:#cdd6f4">${co}</span>
            <div style="flex:1;height:8px;background:#313244;border-radius:4px">
              <div style="width:${pct}%;height:100%;background:#89dceb;border-radius:4px"></div>
            </div>
            <span style="min-width:24px;font-size:12px;color:#a6adc8">${count}</span>
          </div>`;
        }).join('')}
      </div>`;
    })()}
    <div class="pipeline-grid">
      <div class="pipeline-col">
        <h3>Pending (${pendingPipeline.length})</h3>
        <div style="overflow-x:auto">
          <table class="pipeline-table">
            <tbody>
              ${pipelineRows(pendingPipeline)}
            </tbody>
          </table>
        </div>
      </div>
      <div class="pipeline-col">
        <h3>Processed (${processedPipeline.length})</h3>
        <div style="overflow-x:auto">
          <table class="pipeline-table">
            <tbody>
              ${processedPipeline.length > 0 ? pipelineRows(processedPipeline) : '<tr><td class="empty">None yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Board Status -->
  <div class="section">
    <div class="section-header">
      <h2>Board Status</h2>
      <span class="count">${computeBoardStatus(scanHistory).filter(b => b.active).length} w/ rows last 7d</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr><th>Source</th><th>Policy</th><th>Data freshness</th><th>Last Seen</th><th>Scanned</th><th>Added</th></tr>
        </thead>
        <tbody>
          ${computeBoardStatus(scanHistory).map(b => `<tr>
            <td><strong>${b.displayName}</strong><div class="muted" style="font-size:10px;margin-top:2px">${b.portal}</div></td>
            <td>${boardOperationalBadge(b.opStatus)}</td>
            <td>${b.active
              ? '<span class="badge" style="color:#a6e3a1;border-color:#a6e3a122;background:#a6e3a111">Recent data</span>'
              : '<span class="badge" style="color:#f38ba8;border-color:#f38ba822;background:#f38ba811">Stale</span>'
            }</td>
            <td class="date">${b.lastSeen}</td>
            <td>${b.total.toLocaleString()}</td>
            <td style="color:#a6e3a1">${b.added}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>

</div>

<script>
// Auto-refresh countdown timer
(function() {
  const genTime = new Date('${generatedAt}');
  const refreshInterval = 300; // seconds
  const el = document.getElementById('countdown');
  if (!el) return;
  function update() {
    const elapsed = Math.floor((Date.now() - genTime.getTime()) / 1000);
    const remaining = Math.max(0, refreshInterval - elapsed);
    if (remaining > 0) {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      el.textContent = '(refresh in ' + m + ':' + String(s).padStart(2, '0') + ')';
    } else {
      el.textContent = '(refreshing...)';
    }
  }
  update();
  setInterval(update, 1000);
})();

const DATA = ${JSON.stringify(apps)};
let currentFilter = 'ALL';
let currentSort = 'num';
let sortDir = 1;

function setTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentFilter = el.dataset.filter;
  render();
}

function setSort(el) {
  const newSort = el.dataset.sort;
  if (currentSort === newSort) sortDir *= -1;
  else { currentSort = newSort; sortDir = -1; }
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  render();
}

function render() {
  let filtered = DATA.filter(a => {
    if (currentFilter === 'ALL') return true;
    if (currentFilter === 'TOP≥4') return (a.score ?? 0) >= 4;
    return a.status === currentFilter;
  });

  filtered.sort((a, b) => {
    let va, vb;
    if (currentSort === 'priority')   { va = a.priority?.priorityScore ?? -1; vb = b.priority?.priorityScore ?? -1; }
    else if (currentSort === 'score')   { va = a.score ?? -1; vb = b.score ?? -1; }
    else if (currentSort === 'num')   { va = parseInt(a.num); vb = parseInt(b.num); }
    else if (currentSort === 'date')  { va = a.date; vb = b.date; }
    else if (currentSort === 'company') { va = a.company.toLowerCase(); vb = b.company.toLowerCase(); }
    else if (currentSort === 'status') { va = a.status.toLowerCase(); vb = b.status.toLowerCase(); }
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  });

  const tbody = document.getElementById('apps-body');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No applications match this filter.</td></tr>';
    return;
  }

  const statusColors = ${JSON.stringify(statusColors)};
  tbody.innerHTML = filtered.map(app => {
    const scoreHtml = app.score !== null
      ? \`<div class="score-wrap"><span class="score-num">\${app.score.toFixed(1)}</span><div class="score-bar"><div class="score-fill" style="width:\${(app.score/5*100)}%;background:\${app.score>=4?'#a6e3a1':app.score>=3?'#f9e2af':'#f38ba8'}"></div></div></div>\`
      : '<span class="no-score">—</span>';
    const color = statusColors[app.status] || '#cdd6f4';
    const badgeHtml = \`<span class="badge" style="color:\${color};border-color:\${color}22;background:\${color}11">\${app.status}</span>\`;
    const priorityColor = app.priority?.band === 'High'
      ? '#a6e3a1'
      : app.priority?.band === 'Medium'
        ? '#f9e2af'
        : '#f38ba8';
    const priorityHtml = \`<span class="badge" style="color:\${priorityColor};border-color:\${priorityColor}22;background:\${priorityColor}11">\${app.priority?.priorityScore ?? 0} · \${app.priority?.band ?? 'Low'}</span>\`;
    const urlLink = app.jobUrl ? \`<a href="\${app.jobUrl}" target="_blank" title="Job posting">↗</a>\` : '—';
    const rptLink = app.reportPath ? \`<a href="\${app.reportPath}" target="_blank" title="Report">📄</a>\` : '';
    const arch = app.reportMeta?.archetype ? \`<div class="arch">\${app.reportMeta.archetype}</div>\` : '';
    const salary = app.reportMeta?.salary ? \`<div class="salary">\${app.reportMeta.salary}</div>\` : '';
    const provenance = [
      \`Fit \${app.priority?.fit ?? 'n/a'}\`,
      \`Age \${app.priority?.ageDays ?? 'n/a'}d\`,
      \`Freshness \${app.priority?.freshnessDecay ?? 'n/a'}\`,
      \`Confidence \${app.priority?.confidence ?? 'n/a'}\`,
      app.priority?.workArrangement ? \`Loc \${app.priority.workArrangement} ×\${app.priority.locationMultiplier}\` : '',
      app.queueDecision ? \`Queue \${app.queueDecision}\` : '',
      app.remote ? \`Remote \${app.remote}\` : '',
      app.salary ? \`Comp \${app.salary}\` : '',
    ].filter(Boolean).join(' | ');
    const notesRow = app.notes || provenance
      ? \`<tr data-status="\${app.status}" class="notes-row"><td colspan="8"><div class="notes">\${app.notes || ''}\${app.notes ? '<br>' : ''}<span class="muted">\${provenance}</span></div></td></tr>\`
      : '';
    return \`<tr data-status="\${app.status}" data-score="\${app.score ?? -1}">
      <td class="num">#\${app.num}</td>
      <td class="date">\${app.date}</td>
      <td class="company"><strong>\${app.company}</strong>\${salary}</td>
      <td class="role">\${app.role}\${arch}</td>
      <td class="score">\${scoreHtml}</td>
      <td class="status">\${priorityHtml}</td>
      <td class="status">\${badgeHtml}</td>
      <td class="actions">\${urlLink} \${rptLink}</td>
    </tr>\${notesRow}\`;
  }).join('');
}
</script>
</body>
</html>`;

const outPath = join(ROOT, 'dashboard.html');
writeFileSync(outPath, html, 'utf8');

appendAutomationEvent(ROOT, {
  type: 'dashboard.generated',
  status: 'success',
  summary: `Dashboard HTML regenerated (${apps.length} apps, ${pendingPipeline.length} pipeline items).`,
  details: {
    stale_touchpoints: staleTouchApps.length,
    automation_events_loaded: automationEvents.length,
  },
});

console.log(`✅ Dashboard written to: ${outPath}`);
console.log(`   ${apps.length} application(s) | ${pendingPipeline.length} pipeline items`);

const shouldOpen = process.argv.includes('--open');
if (shouldOpen) {
  try {
    execSync(`start "" "${outPath}"`, { shell: true });
    console.log('   Opened in browser.');
  } catch {
    console.log('   Run: start dashboard.html');
  }
}
