#!/usr/bin/env node
/**
 * generate-review-ui.mjs — self-contained review.html (apply review cockpit)
 *
 * Usage: node scripts/generate-review-ui.mjs [--open]
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import { buildApplicationIndex } from './lib/career-data.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const shouldOpen = process.argv.includes('--open');

const REVIEW = new Set(['GO', 'Conditional GO', 'Ready to Submit']);

const snap = buildApplicationIndex(ROOT);
const rows = snap.records
  .filter((r) => REVIEW.has(String(r.status || '').trim()))
  .map((r) => {
    const m = String(r.score || '').match(/(\d+\.?\d*)/);
    const scoreNum = m ? parseFloat(m[1]) : null;
    return { ...r, scoreNum: Number.isFinite(scoreNum) ? scoreNum : -1 };
  })
  .sort((a, b) => b.scoreNum - a.scoreNum);

const dataJson = JSON.stringify(
  rows.map((r) => ({
    id: r.id,
    company: r.company,
    role: r.role,
    status: r.status,
    score: r.score,
    applyUrl: r.applyUrl,
    reportPath: r.reportPath,
  })),
);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Apply review — career-ops</title>
  <style>
    :root { --bg:#0f1419; --panel:#1a2332; --text:#e7ecf3; --muted:#8b9cb3; --accent:#3d8fd1; --line:#2a3a4d; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; min-height: 100vh; }
    header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--line); background: var(--panel); }
    header h1 { margin: 0; font-size: 1.15rem; font-weight: 600; }
    header p { margin: 0.35rem 0 0; font-size: 0.85rem; color: var(--muted); }
    .layout { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 0; min-height: calc(100vh - 80px); }
    @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } }
    .list { border-right: 1px solid var(--line); overflow: auto; max-height: calc(100vh - 80px); }
    .row { padding: 0.65rem 1rem; border-bottom: 1px solid var(--line); cursor: pointer; }
    .row:hover, .row.on { background: #243044; }
    .row .id { color: var(--accent); font-weight: 600; }
    .row .co { font-size: 0.9rem; }
    .row .meta { font-size: 0.75rem; color: var(--muted); margin-top: 0.2rem; }
    .detail { padding: 1.25rem; overflow: auto; max-height: calc(100vh - 80px); }
    .detail h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
    .detail .kv { margin: 0.5rem 0; font-size: 0.9rem; }
    .detail .k { color: var(--muted); display: inline-block; min-width: 7rem; }
    a { color: var(--accent); }
    .btns { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
    button { background: #2d4a68; color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 0.4rem 0.75rem; font-size: 0.85rem; cursor: pointer; }
    button:hover { background: #365a82; }
    pre.cmd { background: #121a24; padding: 0.75rem; border-radius: 6px; overflow: auto; font-size: 0.8rem; border: 1px solid var(--line); white-space: pre-wrap; }
    code { font-size: 0.85em; }
  </style>
</head>
<body>
  <header>
    <h1>Apply review</h1>
    <p>GO / Conditional GO / Ready to Submit — <strong>${rows.length}</strong> row(s). Regenerate: <code>pnpm run review:ui</code></p>
  </header>
  <div class="layout">
    <div class="list" id="list"></div>
    <div class="detail" id="detail"><p style="color:var(--muted)">Select a row.</p></div>
  </div>
  <script>
    const DATA = ${dataJson};
    const list = document.getElementById('list');
    const detail = document.getElementById('detail');

    function escapeHtml(s) {
      if (s == null) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function escapeAttr(s) {
      return String(s).replace(/"/g, '&quot;');
    }

    function select(i) {
      document.querySelectorAll('.row').forEach((r, j) => r.classList.toggle('on', j === i));
      const r = DATA[i];
      if (!r) return;
      const rep = r.reportPath ? r.reportPath : '';
      const cmd = {
        prepare: 'pnpm run apply-review -- --prepare ' + r.id,
        confirm: 'pnpm run apply-review -- --confirm ' + r.id,
        dispatch: 'node scripts/submit-dispatch.mjs --app-id ' + r.id + ' --pdf <path-to-pdf> --dry-run',
      };
      let h = '<h2>#' + escapeHtml(r.id) + ' — ' + escapeHtml(r.company) + ' — ' + escapeHtml(r.role) + '</h2>';
      h += '<div class="kv"><span class="k">Status</span> ' + escapeHtml(r.status) + '</div>';
      h += '<div class="kv"><span class="k">Score</span> ' + escapeHtml(r.score) + '</div>';
      h += '<div class="kv"><span class="k">Apply URL</span> ';
      h += r.applyUrl ? '<a href="' + escapeAttr(r.applyUrl) + '">' + escapeHtml(r.applyUrl) + '</a>' : '—';
      h += '</div><div class="kv"><span class="k">Report</span> ';
      h += rep ? '<code>' + escapeHtml(rep) + '</code>' : '—';
      h += '</div><div class="btns">';
      h += '<button type="button" data-cmd="prepare">Copy prepare</button>';
      h += '<button type="button" data-cmd="confirm">Copy confirm</button>';
      h += '<button type="button" data-cmd="dispatch">Copy dispatch dry-run</button></div>';
      h += '<p style="color:var(--muted);font-size:0.8rem;margin-top:0.75rem">You review every apply; confirm only when ready.</p>';
      h += '<pre class="cmd" id="cmdbox"></pre>';
      detail.innerHTML = h;
      const box = document.getElementById('cmdbox');
      box.textContent = cmd.prepare;
      detail.querySelectorAll('button[data-cmd]').forEach((b) => {
        b.addEventListener('click', () => {
          const k = b.getAttribute('data-cmd');
          box.textContent = cmd[k];
          navigator.clipboard.writeText(cmd[k]);
        });
      });
    }

    if (!DATA.length) {
      list.innerHTML = '<div class="row">No applications in target statuses.</div>';
    } else {
      DATA.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'row' + (i === 0 ? ' on' : '');
        el.innerHTML = '<span class="id">#' + escapeHtml(r.id) + '</span> <span class="co">' + escapeHtml(r.company) + '</span>' +
          '<div class="meta">' + escapeHtml(r.score) + ' · ' + escapeHtml(r.status) + '</div>';
        el.addEventListener('click', () => select(i));
        list.appendChild(el);
      });
      select(0);
    }
  </script>
</body>
</html>
`;

const out = join(ROOT, 'review.html');
writeFileSync(out, html, 'utf8');
console.log(`[review-ui] Wrote ${out}`);

if (shouldOpen) {
  const p = resolve(ROOT, 'review.html');
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', p], { detached: true, stdio: 'ignore' }).unref();
  } else {
    try {
      execSync(`open "${p}"`, { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
}
