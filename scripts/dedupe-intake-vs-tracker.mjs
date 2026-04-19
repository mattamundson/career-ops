#!/usr/bin/env node
/**
 * dedupe-intake-vs-tracker.mjs — Compare pipeline + raw intake + prefilter URLs to tracker scope.
 *
 * Does NOT delete files. Writes data/dedupe-intake-report.md with:
 * - Duplicate job identity keys within pipeline+raw (same keys as pipeline:dedupe / prune)
 * - Pipeline URLs whose keys match an evaluated tracker report (**URL:** in reports/*.md)
 * - Prefilter files whose **url:** frontmatter shares a key with the tracker (cross-board hint)
 * - Prefilter filenames vs company tokens (heuristic, unchanged)
 *
 * Usage: node scripts/dedupe-intake-vs-tracker.mjs
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

import { jobKeysFromUrl } from './lib/job-url-keys.mjs';
import { loadTrackedKeyMap } from './lib/tracker-report-keys.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = resolve(ROOT, 'data', 'applications.md');
const PIPE = resolve(ROOT, 'data', 'pipeline.md');
const RAW = resolve(ROOT, 'data', 'pipeline-raw-intake.md');
const PREFILTER = resolve(ROOT, 'data', 'prefilter-results');
const OUT = resolve(ROOT, 'data', 'dedupe-intake-report.md');

const PREFILTER_URL_SCAN_CAP = 600;

function extractUrls(md) {
  const urls = [];
  const re = /https?:\/\/[^\s|)]+/g;
  for (const line of md.split(/\r?\n/)) {
    const seenLine = new Set();
    let m;
    while ((m = re.exec(line)) !== null) {
      const u = m[0];
      if (seenLine.has(u)) continue;
      seenLine.add(u);
      urls.push(u);
    }
  }
  return urls;
}

function companiesFromApplications(text) {
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 4 || parts[1] === '#' || parts[1] === '---') continue;
    const company = (parts[3] || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (company) set.add(company);
  }
  return set;
}

/** @returns {Map<string, Set<string>>} key -> distinct urls */
function urlsByIdentityKey(urlList) {
  const byKey = new Map();
  for (const u of urlList) {
    for (const k of jobKeysFromUrl(u)) {
      if (!byKey.has(k)) byKey.set(k, new Set());
      byKey.get(k).add(u);
    }
  }
  return byKey;
}

function formatDupGroups(byKey, keyFilter) {
  const lines = [];
  const entries = [...byKey.entries()].filter(
    ([k, set]) => keyFilter(k) && set.size > 1,
  );
  if (entries.length === 0) {
    lines.push('_None found._');
    return { lines, count: 0 };
  }
  for (const [k, set] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
    const uniq = [...set];
    lines.push(`- **${k}** (${uniq.length} distinct URLs)`);
    for (const u of uniq) lines.push(`  - ${u}`);
  }
  return { lines, count: entries.length };
}

function main() {
  const appsText = existsSync(APPS) ? readFileSync(APPS, 'utf8') : '';
  const companies = companiesFromApplications(appsText);

  let pipeText = '';
  if (existsSync(PIPE)) pipeText += readFileSync(PIPE, 'utf8');
  if (existsSync(RAW)) pipeText += '\n' + readFileSync(RAW, 'utf8');

  const urls = extractUrls(pipeText);
  const byKey = urlsByIdentityKey(urls);

  const dupJid = formatDupGroups(byKey, (k) => k.startsWith('jid:'));
  const dupIndeed = formatDupGroups(byKey, (k) => k.startsWith('indeed:'));
  const dupLi = formatDupGroups(byKey, (k) => k.startsWith('li:'));
  const dupLever = formatDupGroups(byKey, (k) => k.startsWith('lever:'));
  const dupUrl = formatDupGroups(byKey, (k) => k.startsWith('url:'));

  const { keyTo: trackerKeys, missingReport, noUrlInReport, entryCount } = loadTrackedKeyMap(ROOT, APPS);

  const pipelineTrackerHits = [];
  const seenHit = new Set();
  for (const u of new Set(urls)) {
    for (const k of jobKeysFromUrl(u)) {
      if (trackerKeys.has(k)) {
        const meta = trackerKeys.get(k);
        const sig = `${u}::${k}`;
        if (seenHit.has(sig)) continue;
        seenHit.add(sig);
        pipelineTrackerHits.push({
          url: u,
          key: k,
          apps: meta.appNums.join(', '),
          company: meta.firstCompany,
        });
      }
    }
  }
  pipelineTrackerHits.sort((a, b) => a.key.localeCompare(b.key));

  let prefilterKeyHits = [];
  if (existsSync(PREFILTER)) {
    const files = readdirSync(PREFILTER)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .slice(0, PREFILTER_URL_SCAN_CAP);
    const seenFile = new Set();
    for (const f of files) {
      const body = readFileSync(join(PREFILTER, f), 'utf8').slice(0, 4000);
      const um = body.match(/^\*\*url:\*\*\s*(.+)$/im);
      if (!um) continue;
      const preUrl = um[1].trim();
      for (const k of jobKeysFromUrl(preUrl)) {
        if (trackerKeys.has(k)) {
          const meta = trackerKeys.get(k);
          const rowKey = `${f}|${k}`;
          if (seenFile.has(rowKey)) continue;
          seenFile.add(rowKey);
          prefilterKeyHits.push({
            file: f,
            key: k,
            apps: meta.appNums.join(', '),
            url: preUrl.slice(0, 120),
          });
          break;
        }
      }
    }
  }

  let prefilterHits = [];
  if (existsSync(PREFILTER)) {
    const files = readdirSync(PREFILTER).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const slug = f.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      for (const c of companies) {
        if (c.length < 4) continue;
        if (slug.includes(c) || c.includes(slug.slice(0, 12))) {
          prefilterHits.push({ file: f, matchedCompanyNorm: c });
          break;
        }
      }
    }
  }

  const lines = [];
  lines.push('# Dedupe intake report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('## Tracker key map (from reports)');
  lines.push('');
  lines.push(
    `_Entries in applications.md: **${entryCount}**. Reports missing on disk: **${missingReport}**. Reports without \`**URL:**\`: **${noUrlInReport}**. Distinct keys: **${trackerKeys.size}**._`,
  );
  lines.push('');

  lines.push('## Duplicate `jid:` (Greenhouse-style) in pipeline + raw intake');
  lines.push('');
  lines.push(...dupJid.lines);
  lines.push('');
  lines.push('## Duplicate `indeed:` keys in pipeline + raw intake');
  lines.push('');
  lines.push(...dupIndeed.lines);
  lines.push('');
  lines.push('## Duplicate `li:` (LinkedIn view id) in pipeline + raw intake');
  lines.push('');
  lines.push(...dupLi.lines);
  lines.push('');
  lines.push('## Duplicate `lever:` keys in pipeline + raw intake');
  lines.push('');
  lines.push(...dupLever.lines);
  lines.push('');
  lines.push('## Duplicate normalized `url:` keys (same URL, different decoration rare)');
  lines.push('');
  lines.push(...dupUrl.lines);
  lines.push('');

  lines.push('## Pipeline / raw URLs matching tracker report keys');
  lines.push('');
  lines.push(
    '_These rows are candidates for `pnpm run pipeline:prune-tracked -- --apply` (already evaluated)._',
  );
  lines.push('');
  if (pipelineTrackerHits.length === 0) lines.push('_None found._');
  else {
    for (const h of pipelineTrackerHits.slice(0, 250)) {
      lines.push(
        `- \`${h.key}\` → apps **#${h.apps}** (${h.company}) — ${h.url}`,
      );
    }
    if (pipelineTrackerHits.length > 250) {
      lines.push(`\n_… ${pipelineTrackerHits.length - 250} more_`);
    }
  }
  lines.push('');

  lines.push('## Prefilter **url:** matching tracker keys (first N files)');
  lines.push('');
  lines.push(
    `_Scanned first **${PREFILTER_URL_SCAN_CAP}** \`.md\` files (alphabetical). Same job may use a different board than the report \`**URL:**\`; this only flags when keys overlap._`,
  );
  lines.push('');
  if (prefilterKeyHits.length === 0) lines.push('_No overlaps in scanned slice._');
  else {
    for (const h of prefilterKeyHits.slice(0, 200)) {
      lines.push(
        `- \`${h.file}\` — key \`${h.key}\` → tracker **#${h.apps}** — \`${h.url}\``,
      );
    }
    if (prefilterKeyHits.length > 200) lines.push(`\n_… ${prefilterKeyHits.length - 200} more_`);
  }
  lines.push('');

  lines.push('## Prefilter files overlapping tracker company tokens (heuristic)');
  lines.push('');
  lines.push('_Heuristic only — review before deleting or skipping._');
  lines.push('');
  if (prefilterHits.length === 0) lines.push('_No obvious overlaps._');
  else {
    for (const h of prefilterHits.slice(0, 200)) {
      lines.push(`- \`${h.file}\` (token ~ \`${h.matchedCompanyNorm}\`)`);
    }
    if (prefilterHits.length > 200) lines.push(`\n_… ${prefilterHits.length - 200} more_`);
  }
  lines.push('');

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUT}`);
  console.log(`Duplicate jid groups: ${dupJid.count}`);
  console.log(`Duplicate indeed groups: ${dupIndeed.count}`);
  console.log(`Duplicate li groups: ${dupLi.count}`);
  console.log(`Duplicate lever groups: ${dupLever.count}`);
  console.log(`Duplicate url groups: ${dupUrl.count}`);
  console.log(`Pipeline URLs matching tracker keys: ${pipelineTrackerHits.length}`);
  console.log(`Prefilter URL key overlaps (scanned): ${prefilterKeyHits.length}`);
  console.log(`Prefilter company-token heuristic hits: ${prefilterHits.length}`);
}

main();
