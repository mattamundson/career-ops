import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function safeName(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stamp() {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/\..+/, 'Z');
}

function appendUnique(existing, addition) {
  if (!addition) return existing;
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}; ${addition}`;
}

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
  for (let i = headerIndex + 2; i < lines.length; i++) {
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

function annotateApplication(rootDir, appId, note) {
  if (!appId) return;
  const file = resolve(rootDir, 'data', 'applications.md');
  if (!existsSync(file)) return;

  const table = parseMarkdownTable(file, '| # |');
  const rows = table.rowLines.map((line) => {
    const cells = splitRow(line);
    const [id, date, company, role, score, status, pdf, report, ...notes] = cells;
    return { id, date, company, role, score, status, pdf, report, notes: notes.join(' | ') };
  });

  const row = rows.find((entry) => entry.id === String(appId).padStart(3, '0') || entry.id === String(appId));
  if (!row) return;

  row.notes = appendUnique(row.notes, note);
  const content = [
    table.prefix,
    table.header,
    table.separator,
    ...rows.map(formatApplicationRow),
    table.trailing,
  ].join('\n');
  writeFileSync(file, content, 'utf8');
}

export function createApplyRunContext(rootDir, meta = {}) {
  const idPart = meta.appId ? String(meta.appId).padStart(3, '0') : 'unknown';
  const atsPart = safeName(meta.ats || 'ats');
  const runId = `${idPart}-${atsPart}-${stamp()}`;
  const dir = resolve(rootDir, 'data', 'apply-runs');
  mkdirSync(dir, { recursive: true });
  return {
    rootDir,
    runId,
    dir,
    meta,
    startedAt: new Date().toISOString(),
    steps: [],
    artifacts: [],
  };
}

export function recordApplyStep(ctx, name, detail = '') {
  ctx.steps.push({
    at: new Date().toISOString(),
    name,
    detail,
  });
}

export function attachApplyArtifact(ctx, path) {
  if (path) ctx.artifacts.push(path);
}

export function finalizeApplyRun(ctx, status, extra = {}) {
  const finishedAt = new Date().toISOString();
  const summary = {
    runId: ctx.runId,
    status,
    startedAt: ctx.startedAt,
    finishedAt,
    durationMs: Math.max(0, new Date(finishedAt) - new Date(ctx.startedAt)),
    meta: ctx.meta,
    steps: ctx.steps,
    artifacts: [...ctx.artifacts, ...(extra.artifacts || [])],
    error: extra.error || null,
    result: extra.result || {},
  };
  const path = resolve(ctx.dir, `${ctx.runId}.json`);
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const noteBase = {
    blocked: `Apply run blocked ${ctx.runId}`,
    partial: `Apply run partial ${ctx.runId}`,
    success: `Apply run success ${ctx.runId}`,
    failure: `Apply run failure ${ctx.runId}`,
  }[status] || `Apply run ${status} ${ctx.runId}`;
  annotateApplication(ctx.rootDir, ctx.meta.appId, noteBase);

  return path;
}
