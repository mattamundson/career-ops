/**
 * dates.mjs — small date-math helpers used across career-ops scripts.
 */

/**
 * Days elapsed since a YYYY-MM-DD (or ISO) date string. Uses UTC date
 * arithmetic rounded to whole days. Returns 0 for missing/unparseable input.
 */
export function daysSinceIsoDate(iso) {
  if (!iso || typeof iso !== 'string') return 0;
  const d = new Date(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

/**
 * Format a Date as YYYY-MM-DD (UTC).
 */
export function toIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Days between two YYYY-MM-DD strings. Returns null if either is unparseable.
 */
export function daysBetween(laterIso, earlierIso) {
  if (!laterIso || !earlierIso) return null;
  const a = new Date(String(laterIso).slice(0, 10));
  const b = new Date(String(earlierIso).slice(0, 10));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}
