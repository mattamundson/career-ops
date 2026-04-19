/**
 * Stable Indeed listing key from `jk=` (hex). Same job keeps the same jk across
 * URL variants (extra query params, mobile host). Only considers *.indeed.com hosts.
 *
 * @param {string} urlStr
 * @returns {string | null} e.g. `indeed:ffa724aa3602f6ed`
 */
export function indeedKeyFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  const s = urlStr.trim().split(/\s+/)[0];
  if (!/indeed\.com/i.test(s)) return null;

  let jk = null;
  try {
    const u = new URL(s);
    const h = u.hostname.toLowerCase();
    if (h !== 'indeed.com' && !h.endsWith('.indeed.com')) return null;
    jk = u.searchParams.get('jk');
  } catch {
    const m = s.match(/[?&]jk=([a-f0-9]{6,32})(?:&|#|$|\s)/i);
    return m ? `indeed:${m[1].toLowerCase()}` : null;
  }

  if (!jk) {
    const m = s.match(/[?&]jk=([a-f0-9]{6,32})(?:&|#|$)/i);
    if (m) jk = m[1];
  }
  if (!jk || !/^[a-f0-9]{6,32}$/i.test(jk)) return null;
  return `indeed:${jk.toLowerCase()}`;
}
