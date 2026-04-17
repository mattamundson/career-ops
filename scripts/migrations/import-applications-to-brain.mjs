#!/usr/bin/env node
// One-shot migration: applications.md + responses.md → brain-staging-applications/*.md
// Each application becomes a markdown file with frontmatter (type: application) and a
// Timeline section built from responses.md events. Run `gbrain import` on the output dir.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPS_MD = join(ROOT, 'data', 'applications.md');
const RESPONSES_MD = join(ROOT, 'data', 'responses.md');
const OUT_DIR = join(ROOT, 'data', 'brain-staging-applications');

mkdirSync(OUT_DIR, { recursive: true });

function parsePipeTable(src) {
  const lines = src.split(/\r?\n/).filter(l => l.trim().startsWith('|') && !/^\|\s*[-]/.test(l));
  const rows = lines.map(l => l.split('|').slice(1, -1).map(c => c.trim()));
  if (rows.length === 0) return { header: [], data: [] };
  const [header, ...data] = rows;
  return { header, data };
}

function yamlEscape(s) {
  if (s == null) return '""';
  const str = String(s);
  if (/[":#\[\]\{\}&*!|>%@`]/.test(str) || /^\s|\s$/.test(str)) {
    return JSON.stringify(str);
  }
  return str;
}

const appsSrc = readFileSync(APPS_MD, 'utf8');
const apps = parsePipeTable(appsSrc);
const appRows = apps.data.filter(r => r.length >= 9 && /^\d+$/.test(r[0]));

const responsesSrc = readFileSync(RESPONSES_MD, 'utf8');
const responses = parsePipeTable(responsesSrc);
const responseRows = responses.data.filter(r => r.length >= 9 && /^\d+$/.test(r[0]));

const responsesByAppId = new Map();
for (const r of responseRows) {
  const [app_id, , , submitted_at, ats, status, last_event_at, , notes] = r;
  if (!responsesByAppId.has(app_id)) responsesByAppId.set(app_id, []);
  responsesByAppId.get(app_id).push({ submitted_at, ats, status, last_event_at, notes });
}

let written = 0;
for (const row of appRows) {
  const [num, date, company, role, score, status, pdf, reportCell, notes] = row;
  const slug = `app-${num}`;
  const reportMatch = reportCell.match(/\]\(reports\/([^\)]+)\)/);
  const reportSlug = reportMatch ? reportMatch[1].replace(/\.md$/, '') : '';
  const scoreNum = parseFloat(score);

  const fm = [
    '---',
    `type: application`,
    `slug: ${slug}`,
    `app_num: ${num}`,
    `company: ${yamlEscape(company)}`,
    `role: ${yamlEscape(role)}`,
    `score: ${Number.isFinite(scoreNum) ? scoreNum : 'null'}`,
    `status: ${yamlEscape(status)}`,
    `applied_date: ${date}`,
    `report_slug: ${yamlEscape(reportSlug)}`,
    `pdf_generated: ${pdf === '✅'}`,
    '---',
    '',
  ].join('\n');

  const body = [];
  body.push(`# ${company} — ${role}`);
  body.push('');
  body.push(`**Score:** ${score} | **Status:** ${status} | **Applied:** ${date}`);
  if (reportSlug) body.push(`**Report:** reports/${reportSlug}.md`);
  body.push('');
  body.push('## Notes');
  body.push('');
  body.push(notes || '_(no notes)_');
  body.push('');

  const evts = responsesByAppId.get(num) || [];
  if (evts.length > 0) {
    body.push('## Timeline');
    body.push('');
    for (const e of evts) {
      body.push(`- **${e.submitted_at}** — ${e.status} via ${e.ats}${e.notes ? ` — ${e.notes}` : ''}`);
    }
    body.push('');
  }

  writeFileSync(join(OUT_DIR, `${slug}.md`), fm + body.join('\n'), 'utf8');
  written++;
}

console.log(`Wrote ${written} application pages to ${OUT_DIR}`);
console.log(`Next: cd vendor/gbrain && bun run src/cli.ts import ${OUT_DIR} --no-embed`);
