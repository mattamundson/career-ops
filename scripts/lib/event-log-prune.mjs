/**
 * Pure helpers for pruning dated automation event files (YYYY-MM-DD.jsonl).
 */

export function localYmd(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * First calendar day that should be **kept** (files strictly before this are pruned).
 * @param {number} retainDays
 * @param {Date} [now]
 */
export function computeCutoffDay(retainDays, now = new Date()) {
  const t = new Date(now.getTime());
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - retainDays);
  return localYmd(t);
}

/** @param {string} name */
export function parseEventJsonlYmd(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
  return m ? m[1] : null;
}

/**
 * @param {string[]} names — basenames only
 * @param {string} cutoffDay — YYYY-MM-DD; delete files strictly older than this calendar day
 */
export function listEventFilenamesToPrune(names, cutoffDay) {
  const out = [];
  for (const name of names) {
    const ymd = parseEventJsonlYmd(name);
    if (!ymd) continue;
    if (ymd < cutoffDay) out.push(name);
  }
  return out.sort();
}
