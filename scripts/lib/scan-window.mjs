/**
 * Shared date windows for scanner + post-scan report CLIs.
 *
 * | Variable | Used by | When read | Effect if unset |
 * |----------|---------|-----------|-----------------|
 * | (none) + `--since=N` on CLI | `auto-scan.mjs`, `scan-report.mjs` | always wins when present | N-day window (clamped 1–90) |
 * | `CAREER_OPS_SCAN_SINCE_DAYS` | `auto-scan.mjs` (via `resolveAutoScanSinceDays`) | after `.env` load | Default **7** days when `--since` omitted |
 * | `CAREER_OPS_SCAN_REPORT_SINCE_DAYS` | `scan-report.mjs` (via `resolveScanReportSinceDays`) | after `.env` load | **All-time** (no `first_seen` filter) when `--since` omitted |
 */

/** @param {number} n */
export function clampScanWindowDays(n) {
  const t = Math.trunc(Number(n));
  if (!Number.isFinite(t)) return 7;
  return Math.min(90, Math.max(1, t));
}

/**
 * @param {object} opts
 * @param {string[]} opts.argv process.argv slice (e.g. process.argv.slice(2))
 * @param {string} [opts.envVar='CAREER_OPS_SCAN_SINCE_DAYS']
 * @param {number} [opts.defaultDays=7]
 * @returns {{ days: number, source: 'cli' | 'env' | 'default' }}
 */
export function resolveAutoScanSinceDays(opts) {
  const argv = opts.argv || [];
  const envVar = opts.envVar ?? 'CAREER_OPS_SCAN_SINCE_DAYS';
  const defaultDays = clampScanWindowDays(opts.defaultDays ?? 7);

  const flag = argv.find((a) => a.startsWith('--since='));
  if (flag) {
    const val = flag.split('=')[1];
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) {
      throw new Error(`Invalid --since value: ${val}`);
    }
    return { days: clampScanWindowDays(n), source: 'cli' };
  }
  const raw = process.env[envVar];
  if (raw !== undefined && String(raw).trim() !== '') {
    const n = parseInt(String(raw).trim(), 10);
    if (!Number.isNaN(n)) {
      return { days: clampScanWindowDays(n), source: 'env' };
    }
  }
  return { days: defaultDays, source: 'default' };
}

/**
 * Post-scan report window: `--since=N` if passed; else optional `CAREER_OPS_SCAN_REPORT_SINCE_DAYS`
 * from .env; else **all-time** (`days: null`).
 *
 * @param {object} opts
 * @param {string[]} opts.argv
 * @returns {{ days: number | null, source: 'cli' | 'env' | 'all' }}
 */
export function resolveScanReportSinceDays(opts) {
  const argv = opts.argv || [];
  const flag = argv.find((a) => a.startsWith('--since='));
  if (flag) {
    const val = flag.split('=')[1];
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) {
      throw new Error(`Invalid --since value: ${val}`);
    }
    return { days: clampScanWindowDays(n), source: 'cli' };
  }
  const raw = process.env.CAREER_OPS_SCAN_REPORT_SINCE_DAYS;
  if (raw !== undefined && String(raw).trim() !== '') {
    const n = parseInt(String(raw).trim(), 10);
    if (!Number.isNaN(n)) {
      return { days: clampScanWindowDays(n), source: 'env' };
    }
  }
  return { days: null, source: 'all' };
}
