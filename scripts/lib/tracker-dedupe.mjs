const STATUS_RANK = {
  skip: 0,
  discarded: 0,
  rejected: 1,
  evaluated: 2,
  'conditional go': 2.5,
  go: 3,
  contact: 3.1,
  'ready to submit': 3.4,
  'in progress': 3.6,
  applied: 4,
  responded: 4.5,
  interview: 5,
  offer: 6,
};

export function dedupeApplicationsMarkdown(content) {
  const lines = content.split('\n');
  const entries = [];
  const lineByNum = new Map();

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) continue;
    const app = parseAppLine(lines[i], i);
    if (!app) continue;
    entries.push(app);
    lineByNum.set(app.num, i);
  }

  const clusters = findDuplicateClusters(entries);
  const linesToRemove = new Set();
  const removed = [];
  const updated = [];

  for (const cluster of clusters) {
    const keeper = chooseKeeper(cluster);
    const bestStatus = chooseBestStatus(cluster);
    const mergedNotes = mergeNotes(cluster.map((entry) => entry.notes));
    const lineIdx = lineByNum.get(keeper.num);

    if (lineIdx !== undefined && (bestStatus !== keeper.status || mergedNotes !== keeper.notes)) {
      const next = { ...keeper, status: bestStatus, notes: mergedNotes };
      lines[lineIdx] = formatAppLine(next);
      updated.push({ num: keeper.num, status: bestStatus });
    }

    for (const entry of cluster) {
      if (entry.num === keeper.num) continue;
      const removeIdx = lineByNum.get(entry.num);
      if (removeIdx === undefined) continue;
      linesToRemove.add(removeIdx);
      removed.push({
        num: entry.num,
        keptNum: keeper.num,
        company: entry.company,
        role: entry.role,
        reason: duplicateReason(keeper, entry),
      });
    }
  }

  for (const idx of [...linesToRemove].sort((a, b) => b - a)) {
    lines.splice(idx, 1);
  }

  return {
    content: lines.join('\n'),
    entries,
    removed,
    updated,
  };
}

function findDuplicateClusters(entries) {
  const seen = new Set();
  const clusters = [];

  for (const entry of entries) {
    if (seen.has(entry.num)) continue;

    const cluster = [entry];
    seen.add(entry.num);

    for (const candidate of entries) {
      if (seen.has(candidate.num)) continue;
      if (!isDuplicate(entry, candidate)) continue;
      cluster.push(candidate);
      seen.add(candidate.num);
    }

    if (cluster.length > 1) clusters.push(cluster);
  }

  return clusters;
}

function isDuplicate(a, b) {
  const aReport = reportKey(a.report);
  const bReport = reportKey(b.report);
  if (aReport && bReport && aReport === bReport) return true;

  const aCompany = normalizeCompany(a.company);
  const bCompany = normalizeCompany(b.company);
  if (!aCompany || !bCompany) return false;

  return aCompany === bCompany && normalizeRole(a.role) === normalizeRole(b.role);
}

function duplicateReason(a, b) {
  const aReport = reportKey(a.report);
  const bReport = reportKey(b.report);
  if (aReport && bReport && aReport === bReport) return 'same report';
  return 'same company and role';
}

function chooseKeeper(cluster) {
  return [...cluster].sort((a, b) => {
    const scoreDelta = parseScore(b.score) - parseScore(a.score);
    if (scoreDelta !== 0) return scoreDelta;
    const statusDelta = statusRank(b.status) - statusRank(a.status);
    if (statusDelta !== 0) return statusDelta;
    return b.num - a.num;
  })[0];
}

function chooseBestStatus(cluster) {
  return [...cluster].sort((a, b) => statusRank(b.status) - statusRank(a.status))[0].status;
}

function mergeNotes(notes) {
  return [...new Set(notes.map((note) => note.trim()).filter(Boolean))].join(' / ');
}

function statusRank(status) {
  return STATUS_RANK[String(status || '').toLowerCase()] || 0;
}

function parseScore(score) {
  const m = String(score || '').replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? Number.parseFloat(m[1]) : 0;
}

function parseAppLine(line, lineIndex) {
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length < 9) return null;
  const num = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(num) || num === 0) return null;
  return {
    lineIndex,
    num,
    numText: parts[1],
    date: parts[2],
    company: parts[3],
    role: parts[4],
    score: parts[5],
    status: parts[6],
    pdf: parts[7],
    report: parts[8],
    notes: parts[9] || '',
  };
}

function formatAppLine(app) {
  return `| ${app.numText} | ${app.date} | ${app.company} | ${app.role} | ${app.score} | ${app.status} | ${app.pdf} | ${app.report} | ${app.notes} |`;
}

function normalizeCompany(company) {
  return String(company || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeRole(role) {
  return String(role || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function reportKey(report) {
  const raw = String(report || '').trim().toLowerCase();
  if (!raw || raw === '—' || raw === '-') return '';
  const link = raw.match(/\]\(([^)]+)\)/);
  if (link) return link[1].replace(/\\/g, '/');
  const bracket = raw.match(/\[(\d+)\]/);
  if (bracket) return bracket[1];
  return '';
}
