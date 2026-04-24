/**
 * Update data/applications.md: set Status to Applied and refresh Date for one app #.
 * Used by apply-review --confirm after a live submit succeeds.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseMarkdownTable(filePath, headerPrefix) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim().startsWith(headerPrefix));
  if (headerIndex === -1) {
    throw new Error(`Could not find ${headerPrefix} in ${filePath}`);
  }
  const prefix = lines.slice(0, headerIndex).join('\n');
  const header = lines[headerIndex];
  const separator = lines[headerIndex + 1];
  const rowLines = [];
  let trailingStart = lines.length;
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('|')) {
      rowLines.push(lines[i]);
      continue;
    }
    trailingStart = i;
    break;
  }
  const trailing = lines.slice(trailingStart).join('\n');
  return { prefix, header, separator, rowLines, trailing };
}

function splitRow(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function formatApplicationRow(row) {
  return `| ${row.id} | ${row.date} | ${row.company} | ${row.role} | ${row.score} | ${row.status} | ${row.pdf} | ${row.report} | ${row.notes} |`;
}

function appendUniqueNote(existing, addition) {
  if (!addition) return existing || '';
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}; ${addition}`;
}

/**
 * @param {string} rootDir - repo root
 * @param {string|number} appId - e.g. 12 or "012"
 * @param {{ date?: string, noteLine?: string }} [opts]
 * @returns {{ ok: true, path: string } | { ok: false, reason: 'missing_file' | 'row_not_found' | 'parse_error', detail?: string }}
 */
export function markApplicationApplied(rootDir, appId, opts = {}) {
  const filePath = resolve(rootDir, 'data', 'applications.md');
  if (!existsSync(filePath)) {
    return { ok: false, reason: 'missing_file' };
  }
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const noteLine = opts.noteLine
    || `Submitted ${date} (logged by apply-review --confirm).`;
  const padded = String(appId).padStart(3, '0');
  let table;
  try {
    table = parseMarkdownTable(filePath, '| # |');
  } catch (e) {
    return { ok: false, reason: 'parse_error', detail: e.message };
  }
  const rows = table.rowLines.map((line) => {
    const cells = splitRow(line);
    const [id, d, company, role, score, status, pdf, report, ...notes] = cells;
    return {
      id,
      date: d,
      company,
      role,
      score,
      status,
      pdf,
      report,
      notes: notes.join(' | '),
    };
  });
  const row = rows.find(
    (r) => String(r.id).padStart(3, '0') === padded || String(r.id) === String(appId),
  );
  if (!row) {
    return { ok: false, reason: 'row_not_found' };
  }
  row.status = 'Applied';
  row.date = date;
  row.notes = appendUniqueNote(row.notes, noteLine);
  const content = [
    table.prefix,
    table.header,
    table.separator,
    ...rows.map(formatApplicationRow),
    table.trailing,
  ].join('\n');
  writeFileSync(filePath, content, 'utf8');
  return { ok: true, path: filePath };
}
