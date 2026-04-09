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

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// ─── Parsers ────────────────────────────────────────────────────────────────

function parseApplications() {
  const file = join(ROOT, 'data', 'applications.md');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('# |') || line.includes('Score |')) continue;
    const cols = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cols.length < 8) continue;
    const [num, date, company, role, score, status, pdf, reportRaw, ...notesParts] = cols;
    if (!num || num === '#') continue;
    const notes = notesParts.join('|').trim();
    // Extract report link
    const reportMatch = reportRaw.match(/\[.*?\]\((.*?)\)/);
    const reportPath = reportMatch ? reportMatch[1] : null;
    // Parse score
    const scoreNum = parseFloat(score);
    rows.push({ num, date, company, role, score: isNaN(scoreNum) ? null : scoreNum, status, hasPdf: pdf.includes('✅'), reportPath, notes });
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
    return {
      archetype: archMatch ? archMatch[1].trim() : null,
      url: urlMatch ? urlMatch[1].trim() : null,
      salary: salMatch ? salMatch[1].trim() : null,
      why: whyMatch ? whyMatch[1].trim() : null,
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

const generatedAt = new Date().toLocaleString('en-US', {
  timeZone: 'America/Chicago',
  month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
}) + ' CT';

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

function computeSourceBreakdown(rows) {
  const byType = {};
  for (const r of rows) {
    const type = r.portal.split('/')[0] || 'unknown';
    if (!byType[type]) byType[type] = { total: 0, added: 0 };
    byType[type].total++;
    if (r.status === 'added') byType[type].added++;
  }
  return Object.entries(byType).sort((a, b) => b[1].total - a[1].total);
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
    if (!byBoard[r.portal]) byBoard[r.portal] = { total: 0, added: 0, lastSeen: '' };
    byBoard[r.portal].total++;
    if (r.status === 'added') byBoard[r.portal].added++;
    if (r.firstSeen > byBoard[r.portal].lastSeen) byBoard[r.portal].lastSeen = r.firstSeen;
  }
  return Object.entries(byBoard)
    .map(([name, s]) => ({ name, ...s, active: s.lastSeen >= sevenDaysAgo }))
    .sort((a, b) => b.added - a.added || b.total - a.total);
}

function appRows(list) {
  if (list.length === 0) return '<tr><td colspan="7" class="empty">No applications match this filter.</td></tr>';
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
    return `<tr data-status="${app.status}" data-score="${app.score ?? -1}">
      <td class="num">#${app.num}</td>
      <td class="date">${app.date}</td>
      <td class="company"><strong>${app.company}</strong>${salary}</td>
      <td class="role">${app.role}${arch}</td>
      <td class="score">${scoreBar(app.score)}</td>
      <td class="status">${statusBadge(app.status)}</td>
      <td class="actions">${urlCell} ${reportCell} ${pdfCell}</td>
    </tr>
    ${app.notes ? `<tr data-status="${app.status}" class="notes-row"><td colspan="7"><div class="notes">${app.notes}</div></td></tr>` : ''}`;
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

const tabStatuses = ['ALL', 'Evaluated', 'Applied', 'Contact', 'Interview', 'TOP≥4', 'SKIP'];
function tabCount(status) {
  if (status === 'ALL') return apps.length;
  if (status === 'TOP≥4') return apps.filter(a => (a.score ?? 0) >= 4).length;
  return apps.filter(a => a.status === status).length;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Career-Ops Dashboard</title>
<meta http-equiv="refresh" content="3600">
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
  <div class="gen-time">Generated ${generatedAt}</div>
  <button class="refresh-btn" onclick="location.reload()">↻ Refresh</button>
</div>

<div class="main">

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
          ${computeSourceBreakdown(scanHistory).map(([type, s]) => {
            const rate = s.total > 0 ? ((s.added / s.total) * 100).toFixed(1) : '0.0';
            const barPct = s.total > 0 ? Math.max(2, (s.added / s.total) * 100) : 0;
            return `<tr>
              <td><strong>${type}</strong></td>
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

  <!-- Applications Table -->
  <div class="section">
    <div class="tabs" id="tabs">
      ${tabStatuses.map((s, i) => `<div class="tab${i === 0 ? ' active' : ''}" data-filter="${s}" onclick="setTab(this)">${s}<span class="tab-count">${tabCount(s)}</span></div>`).join('')}
    </div>
    <div class="sort-bar">
      <span>Sort:</span>
      <button class="sort-btn active" data-sort="num" onclick="setSort(this)">Entry #</button>
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
      <span class="count">${computeBoardStatus(scanHistory).filter(b => b.active).length} active</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr><th>Board / Portal</th><th>Status</th><th>Last Seen</th><th>Scanned</th><th>Added</th></tr>
        </thead>
        <tbody>
          ${computeBoardStatus(scanHistory).map(b => `<tr>
            <td><strong>${b.name}</strong></td>
            <td>${b.active
              ? '<span class="badge" style="color:#a6e3a1;border-color:#a6e3a122;background:#a6e3a111">Active</span>'
              : '<span class="badge" style="color:#f38ba8;border-color:#f38ba822;background:#f38ba811">Inactive</span>'
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
    if (currentSort === 'score')   { va = a.score ?? -1; vb = b.score ?? -1; }
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
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No applications match this filter.</td></tr>';
    return;
  }

  const statusColors = ${JSON.stringify(statusColors)};
  tbody.innerHTML = filtered.map(app => {
    const scoreHtml = app.score !== null
      ? \`<div class="score-wrap"><span class="score-num">\${app.score.toFixed(1)}</span><div class="score-bar"><div class="score-fill" style="width:\${(app.score/5*100)}%;background:\${app.score>=4?'#a6e3a1':app.score>=3?'#f9e2af':'#f38ba8'}"></div></div></div>\`
      : '<span class="no-score">—</span>';
    const color = statusColors[app.status] || '#cdd6f4';
    const badgeHtml = \`<span class="badge" style="color:\${color};border-color:\${color}22;background:\${color}11">\${app.status}</span>\`;
    const urlLink = app.jobUrl ? \`<a href="\${app.jobUrl}" target="_blank" title="Job posting">↗</a>\` : '—';
    const rptLink = app.reportPath ? \`<a href="\${app.reportPath}" target="_blank" title="Report">📄</a>\` : '';
    const arch = app.reportMeta?.archetype ? \`<div class="arch">\${app.reportMeta.archetype}</div>\` : '';
    const salary = app.reportMeta?.salary ? \`<div class="salary">\${app.reportMeta.salary}</div>\` : '';
    const notesRow = app.notes ? \`<tr data-status="\${app.status}" class="notes-row"><td colspan="7"><div class="notes">\${app.notes}</div></td></tr>\` : '';
    return \`<tr data-status="\${app.status}" data-score="\${app.score ?? -1}">
      <td class="num">#\${app.num}</td>
      <td class="date">\${app.date}</td>
      <td class="company"><strong>\${app.company}</strong>\${salary}</td>
      <td class="role">\${app.role}\${arch}</td>
      <td class="score">\${scoreHtml}</td>
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
