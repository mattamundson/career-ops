import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function auditReportLinks(root) {
  const trackerPath = existsSync(join(root, 'data', 'applications.md'))
    ? join(root, 'data', 'applications.md')
    : join(root, 'applications.md');

  if (!existsSync(trackerPath)) {
    return {
      generatedAt: new Date().toISOString(),
      trackerPath: relativePath(root, trackerPath),
      totalEntries: 0,
      totalLinked: 0,
      present: [],
      missing: [],
    };
  }

  const entries = parseTracker(readFileSync(trackerPath, 'utf8'));
  const linked = entries.filter((entry) => entry.path);
  const present = [];
  const missing = [];

  for (const entry of linked) {
    const target = join(root, entry.path);
    if (existsSync(target)) present.push(entry);
    else missing.push(entry);
  }

  return {
    generatedAt: new Date().toISOString(),
    trackerPath: relativePath(root, trackerPath),
    totalEntries: entries.length,
    totalLinked: linked.length,
    present,
    missing,
  };
}

export function renderReportLinkAudit(result) {
  const lines = [
    '# Report Link Audit',
    '',
    `Generated: ${result.generatedAt}`,
    `Tracker: \`${result.trackerPath}\``,
    '',
    `- Tracker rows: ${result.totalEntries}`,
    `- Rows with report links: ${result.totalLinked}`,
    `- Existing report links: ${result.present.length}`,
    `- Missing report links: ${result.missing.length}`,
    '',
  ];

  if (result.missing.length === 0) {
    lines.push('No missing report links found.', '');
    return lines.join('\n');
  }

  lines.push('| # | Status | Company | Role | Missing report |');
  lines.push('|---|---|---|---|---|');
  for (const entry of result.missing) {
    lines.push(
      `| ${entry.num} | ${escapeCell(entry.status)} | ${escapeCell(entry.company)} | ${escapeCell(entry.role)} | \`${entry.path}\` |`,
    );
  }
  lines.push('');
  lines.push('Recommended actions:');
  lines.push('- If reports exist outside this checkout, restore them under `reports/`.');
  lines.push('- If reports are intentionally local-only, keep using report-tolerant verification.');
  lines.push('- If a row should no longer reference a report, update its Report cell deliberately rather than bulk-clearing links.');
  lines.push('');

  return lines.join('\n');
}

function parseTracker(content) {
  const entries = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 9) continue;
    const num = Number.parseInt(parts[1], 10);
    if (!Number.isFinite(num)) continue;
    const link = parts[8].match(/\]\(([^)]+)\)/);
    entries.push({
      num,
      date: parts[2],
      company: parts[3],
      role: parts[4],
      score: parts[5],
      status: parts[6],
      report: parts[8],
      path: link?.[1] || '',
    });
  }
  return entries;
}

function relativePath(root, path) {
  return path.startsWith(root)
    ? path.slice(root.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
    : path.replace(/\\/g, '/');
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|');
}
