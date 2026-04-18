/**
 * Canonical portal → human labels and operational status for scan-history / reports / dashboard.
 * Portal is the source-of-truth string (e.g. jobspy/linkedin, direct/weworkremotely, greenhouse/Acme).
 */

const ATS_TYPES = new Set([
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'workday',
  'icims',
  'workable',
]);

/** @typedef {'active' | 'blocked' | 'deferred' | 'stub' | 'error'} OperationalStatus */

/**
 * @param {string} portal
 * @returns {{ raw: string, sourceType: string, sourceKey: string, displayLabel: string }}
 */
export function parsePortal(portal) {
  const raw = String(portal ?? '').trim();
  if (!raw) {
    return { raw: '', sourceType: 'unknown', sourceKey: '', displayLabel: 'Unknown' };
  }
  const slash = raw.indexOf('/');
  const sourceType = (slash === -1 ? raw : raw.slice(0, slash)).toLowerCase() || 'unknown';
  const sourceKey = slash === -1 ? '' : raw.slice(slash + 1).trim();
  let displayLabel;

  if (sourceType === 'direct') {
    const k = sourceKey.toLowerCase();
    if (k === 'weworkremotely') displayLabel = 'We Work Remotely';
    else if (k === 'simplyhired') displayLabel = 'SimplyHired';
    else if (k === 'linkedin-mcp') displayLabel = 'LinkedIn (MCP scan)';
    else if (k === 'indeed') displayLabel = 'Indeed (direct scan)';
    else if (k === 'wellfound') displayLabel = 'Wellfound';
    else if (k === 'dice') displayLabel = 'Dice';
    else if (k === 'flexjobs') displayLabel = 'FlexJobs';
    else if (k === 'remoteok') displayLabel = 'RemoteOK';
    else if (k === 'remotive') displayLabel = 'Remotive';
    else if (k === 'keyvalues') displayLabel = 'KeyValues';
    else displayLabel = sourceKey ? toTitleWords(sourceKey) : 'Direct';
  } else if (sourceType === 'jobspy') {
    const sk = sourceKey.toLowerCase().replace(/_com$/i, '');
    if (sk === 'indeed') displayLabel = 'Indeed';
    else if (sk === 'linkedin') displayLabel = 'LinkedIn Jobs';
    else if (sk === 'glassdoor') displayLabel = 'Glassdoor';
    else if (sk === 'zip_recruiter' || sk === 'ziprecruiter') displayLabel = 'ZipRecruiter';
    else if (sk === 'google') displayLabel = 'Google Jobs';
    else displayLabel = sourceKey ? `${toTitleWords(sourceKey)} (JobSpy)` : 'JobSpy';
  } else if (sourceType === 'builtin') {
    displayLabel = sourceKey ? `Built In — ${sourceKey}` : 'Built In';
  } else if (sourceType === 'firecrawl') {
    displayLabel = sourceKey ? `Firecrawl — ${sourceKey}` : 'Firecrawl';
  } else if (ATS_TYPES.has(sourceType)) {
    displayLabel = sourceKey
      ? `${sourceKey} (${capitalize(sourceType)})`
      : capitalize(sourceType);
  } else {
    displayLabel = raw;
  }

  return { raw, sourceType, sourceKey, displayLabel };
}

/**
 * User-facing label for a scan row (never use portal alone when a clearer label exists).
 * @param {string} portal
 */
export function portalDisplayLabel(portal) {
  return parsePortal(portal).displayLabel;
}

/**
 * Policy for automation / operator UI — independent of whether rows exist in history.
 * @param {string} portal
 * @returns {OperationalStatus}
 */
export function getSourceOperationalStatus(portal) {
  const { sourceType, sourceKey } = parsePortal(portal);
  const k = sourceKey.toLowerCase();

  if (sourceType === 'direct') {
    if (k === 'weworkremotely') return 'active';
    if (k === 'indeed' || k === 'linkedin-mcp') return 'active';
    if (k === 'simplyhired') return 'blocked';
    if (k === 'wellfound' || k === 'flexjobs') return 'deferred';
    if (k === 'dice') return 'stub';
    if (k === 'remoteok' || k === 'remotive' || k === 'keyvalues') return 'stub';
    return 'stub';
  }

  if (sourceType === 'jobspy') return 'active';
  if (ATS_TYPES.has(sourceType)) return 'active';
  if (sourceType === 'builtin' || sourceType === 'firecrawl') return 'active';
  return 'stub';
}

/** True when portal identifies a multi-employer board, not a single-company ATS slug. */
export function isAggregateBoardPortal(portal) {
  const { sourceType } = parsePortal(portal);
  if (sourceType === 'jobspy' || sourceType === 'builtin' || sourceType === 'firecrawl') return true;
  if (sourceType === 'direct') return true;
  return false;
}

export function operationalStatusLabel(status) {
  switch (status) {
    case 'active': return 'Active';
    case 'blocked': return 'Blocked';
    case 'deferred': return 'Deferred / manual';
    case 'stub': return 'Stub / not production';
    case 'error': return 'Error';
    default: return status;
  }
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function toTitleWords(s) {
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Roll up scan-history rows by full portal string for reporting.
 * @param {Array<{ portal?: string, status?: string, first_seen?: string }>} rows
 */
export function rollupSourcesByPortal(rows) {
  const by = new Map();
  for (const r of rows) {
    const portal = (r.portal || 'unknown').trim() || 'unknown';
    if (!by.has(portal)) {
      const meta = parsePortal(portal);
      by.set(portal, {
        portal,
        displayLabel: meta.displayLabel,
        opStatus: getSourceOperationalStatus(portal),
        total: 0,
        added: 0,
        lastSeen: '',
      });
    }
    const e = by.get(portal);
    e.total++;
    if (r.status === 'added') e.added++;
    const fs = r.first_seen || '';
    if (fs > e.lastSeen) e.lastSeen = fs;
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.displayLabel.localeCompare(b.displayLabel));
}
