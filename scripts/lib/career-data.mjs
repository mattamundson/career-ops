import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function splitRow(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function parseMarkdownTable(filePath, expectedHeaderPrefix) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim().startsWith(expectedHeaderPrefix));
  if (headerIndex === -1) {
    throw new Error(`Could not find header ${expectedHeaderPrefix} in ${filePath}`);
  }

  const rowLines = [];
  for (let i = headerIndex + 2; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) break;
    rowLines.push(lines[i]);
  }

  return { rowLines };
}

export function parseApplicationsTracker(rootDir) {
  const filePath = resolve(rootDir, 'data', 'applications.md');
  if (!existsSync(filePath)) return [];

  const table = parseMarkdownTable(filePath, '| # |');
  return table.rowLines.map((line) => {
    const cells = splitRow(line);
    const [id, date, company, role, score, status, pdf, report, ...notes] = cells;
    const reportMatch = String(report || '').match(/\[.*?\]\((.*?)\)/);
    return {
      id: String(id || '').padStart(3, '0'),
      date: date || '',
      company: company || '',
      role: role || '',
      score: score || '',
      status: status || '',
      pdf: pdf || '',
      report: report || '',
      reportPath: reportMatch ? reportMatch[1] : null,
      notes: notes.join(' | '),
    };
  });
}

export function parseApplyQueue(rootDir) {
  const filePath = resolve(rootDir, 'data', 'apply-queue.md');
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, 'utf8').split('\n');
  const entries = [];
  let current = null;

  function flushCurrent() {
    if (current) entries.push(current);
  }

  for (const line of lines) {
    // Accept both "[NNN — Status]" and bare "[NNN]" — some queue sections omit the status label.
    const headerMatch = line.match(/^###\s+\d+\.\s+(.+?)\s+\[(\d{1,3})(?:\s+[—-]\s+([^\]]+))?\]/);
    if (headerMatch) {
      flushCurrent();
      current = {
        companyRoleLabel: headerMatch[1].trim(),
        id: headerMatch[2].padStart(3, '0'),
        queueDecision: (headerMatch[3] || '').trim(),
        applyUrl: null,
        queueScore: null,
        salary: null,
        remote: null,
        pdfPath: null,
        coverLetterPath: null,
        queueStatus: null,
      };
      continue;
    }

    if (!current) continue;

    let match = line.match(/^\-\s+\*\*Apply URL:\*\*\s+(https?:\/\/\S+)/);
    if (match) {
      current.applyUrl = match[1];
      continue;
    }

    match = line.match(
      /^\-\s+\*\*Score:\*\*\s+([0-9]+(?:\.[0-9]+)?)\s*\/\s*5/,
    );
    if (match) {
      current.queueScore = `${match[1]}/5`;
      continue;
    }

    match = line.match(/^\-\s+\*\*Salary:\*\*\s+(.+)/);
    if (match) {
      current.salary = match[1].trim();
      continue;
    }

    match = line.match(/^\-\s+\*\*Remote:\*\*\s+(.+)/);
    if (match) {
      current.remote = match[1].trim();
      continue;
    }

    match = line.match(/^\-\s+\*\*PDF:\*\*\s+(.+)/);
    if (match) {
      current.pdfPath = match[1].trim();
      continue;
    }

    match = line.match(/^\-\s+\*\*CL:\*\*\s+(.+)/);
    if (match) {
      current.coverLetterPath = match[1].trim();
      continue;
    }

    match = line.match(/^\-\s+\*\*Status:\*\*\s+(.+)/);
    if (match) {
      current.queueStatus = match[1].trim();
    }
  }

  flushCurrent();
  return entries;
}

/**
 * When apply-queue has a header like [NNN — GO], surface a tracker-like status
 * for synthetic (queue-only) records.
 */
function statusFromQueueEntry(entry) {
  const d = (entry.queueDecision || '').trim();
  if (d === 'Discarded') return 'Discarded';
  if (d === 'GO' || d === 'MAYBE') return d;
  if (d) return d;
  return 'Conditional GO';
}

/**
 * `applications.md` is canonical, but older queue rows can still reference
 * numeric IDs that no longer exist in the tracker (renumbering / split datasets).
 * Merge in minimal synthetic rows so `submit-dispatch` / `apply-review` can
 * resolve `applyUrl` for those IDs.
 */
function queueOnlyRecords(applications, queueEntries) {
  const inTracker = new Set(applications.map((a) => a.id));
  const out = [];
  for (const q of queueEntries) {
    if (inTracker.has(q.id) || !q.applyUrl) continue;
    const label = q.companyRoleLabel || '';
    const segs = label.split(/\s+—\s+/);
    const company = (segs[0] || label || 'Unknown').trim();
    const role = (segs[1] || segs[0] || 'Role TBD').trim();
    out.push({
      id: q.id,
      date: '',
      company,
      role,
      score: q.queueScore || '',
      status: statusFromQueueEntry(q),
      pdf: '',
      report: '',
      reportPath: null,
      notes: 'queue-only: id not in applications.md — fix tracker drift or retire this row',
      applyUrl: q.applyUrl,
      salary: q.salary,
      remote: q.remote,
      pdfPath: q.pdfPath,
      coverLetterPath: q.coverLetterPath,
      queueDecision: q.queueDecision || null,
      queueStatus: q.queueStatus || null,
    });
  }
  return out;
}

export function buildApplicationIndex(rootDir) {
  const applications = parseApplicationsTracker(rootDir);
  const queueEntries = parseApplyQueue(rootDir);
  const queueById = new Map(queueEntries.map((entry) => [entry.id, entry]));

  const fromTracker = applications.map((application) => {
    const queue = queueById.get(application.id) || null;
    return {
      ...application,
      applyUrl: queue?.applyUrl || null,
      salary: queue?.salary || null,
      remote: queue?.remote || null,
      pdfPath: queue?.pdfPath || null,
      coverLetterPath: queue?.coverLetterPath || null,
      queueDecision: queue?.queueDecision || null,
      queueStatus: queue?.queueStatus || null,
    };
  });
  const extra = queueOnlyRecords(applications, queueEntries);

  return {
    generatedAt: new Date().toISOString(),
    records: [...fromTracker, ...extra],
  };
}

export function getApplicationRecord(rootDir, appId) {
  if (!appId) return null;
  const paddedId = String(appId).padStart(3, '0');
  const snapshot = buildApplicationIndex(rootDir);
  return snapshot.records.find((record) => record.id === paddedId || record.id === String(appId)) || null;
}

export function writeApplicationIndex(rootDir, snapshot = null) {
  const finalSnapshot = snapshot || buildApplicationIndex(rootDir);
  const dir = resolve(rootDir, 'data', 'index');
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, 'applications.json');
  writeFileSync(filePath, `${JSON.stringify(finalSnapshot, null, 2)}\n`, 'utf8');
  return { filePath, snapshot: finalSnapshot };
}
