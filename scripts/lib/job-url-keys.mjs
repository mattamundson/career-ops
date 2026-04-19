/**
 * Canonical job identity keys extracted from a single URL string.
 * Used by pipeline dedupe, tracker prune, and intake reports.
 */

import { indeedKeyFromUrl } from './indeed-jk.mjs';

/** @param {string} urlStr */
export function jobKeysFromUrl(urlStr) {
  const keys = new Set();
  if (!urlStr || typeof urlStr !== 'string') return keys;
  const trimmed = urlStr.trim().split(/\s+/)[0];

  for (const m of trimmed.matchAll(/gh_jid=(\d+)/gi)) {
    keys.add(`jid:${m[1]}`);
  }

  const li = trimmed.match(/linkedin\.com\/jobs\/view\/(\d+)/i);
  if (li) keys.add(`li:${li[1]}`);

  for (const re of [
    /(?:job-boards\.)?greenhouse\.io\/[^/]+\/jobs\/(\d+)/i,
    /boards\.greenhouse\.io\/[^/]+\/jobs\/(\d+)/i,
  ]) {
    const gm = trimmed.match(re);
    if (gm) keys.add(`jid:${gm[1]}`);
  }

  const lever = trimmed.match(/jobs\.lever\.co\/[^/]+\/([a-f0-9-]{36})/i);
  if (lever) keys.add(`lever:${lever[1].toLowerCase()}`);

  const builtin = trimmed.match(/builtin\.com\/job\/[^/]+\/(\d+)/i);
  if (builtin) keys.add(`builtin:${builtin[1]}`);

  const indeedK = indeedKeyFromUrl(trimmed);
  if (indeedK) keys.add(indeedK);

  try {
    const u = new URL(trimmed);
    u.hash = '';
    keys.add(`url:${u.href.toLowerCase()}`);
  } catch {
    keys.add(`url:${trimmed.toLowerCase()}`);
  }

  return keys;
}

/**
 * Single stable key for inbox dedupe (first match by priority).
 * @param {string} url
 * @returns {string | null}
 */
export function primaryLineKey(url) {
  const keys = jobKeysFromUrl(url);
  const order = ['jid:', 'indeed:', 'lever:', 'li:', 'builtin:', 'url:'];
  for (const prefix of order) {
    for (const k of keys) {
      if (k.startsWith(prefix)) return k;
    }
  }
  for (const k of keys) return k;
  return null;
}
