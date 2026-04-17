#!/usr/bin/env node
/**
 * chrome-preflight.mjs — clear stale Playwright MCP Chrome lockfiles.
 *
 * The MCP Chrome browser keeps a `lockfile` per profile directory. When the
 * browser crashes or a session dies uncleanly, the lockfile is left behind
 * as a 0-byte sentinel that blocks the next launch with a mysterious hang.
 * The file is safe to delete if it's older than ~1 minute and no browser is
 * currently running against that profile.
 *
 * Usage (library):
 *   import { clearStaleLockfiles } from './scripts/lib/chrome-preflight.mjs';
 *   const result = clearStaleLockfiles();
 *   if (result.cleared.length) console.log(`Cleared ${result.cleared.length} stale lock(s)`);
 *
 * Usage (CLI):
 *   node scripts/lib/chrome-preflight.mjs              # clear locks >1hr old
 *   node scripts/lib/chrome-preflight.mjs --dry-run    # list without deleting
 *   node scripts/lib/chrome-preflight.mjs --max-age-minutes=5
 *
 * Call from apply-mode entry points (or any script that will spawn the
 * Playwright MCP browser) to avoid the "mysterious browser never opens"
 * failure mode seen repeatedly in interactive sessions.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve the default ms-playwright base dir for the current platform.
 * Windows: %LOCALAPPDATA%/ms-playwright/
 * macOS/Linux: ~/.cache/ms-playwright/
 */
function defaultPlaywrightBaseDir() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'ms-playwright');
  }
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

/**
 * List all mcp-chrome-* profile directories under the base dir.
 * Returns [] if the base dir doesn't exist.
 */
function findChromeProfileDirs(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  try {
    return fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('mcp-chrome-'))
      .map((entry) => path.join(baseDir, entry.name));
  } catch {
    return [];
  }
}

/**
 * Clear stale lockfiles under one or more Playwright MCP Chrome profile dirs.
 *
 * @param {object} options
 * @param {string} [options.baseDir] - Override the Playwright base dir
 * @param {number} [options.maxAgeMs=3600000] - Delete locks older than this
 * @param {boolean} [options.dryRun=false] - Log without deleting
 * @param {(msg: string) => void} [options.log=console.log]
 * @returns {{ cleared: string[], skipped: Array<{path:string,ageMs:number}>, failed: Array<{path:string,reason:string}>, missing: boolean }}
 */
export function clearStaleLockfiles({
  baseDir = defaultPlaywrightBaseDir(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  dryRun = false,
  log = console.log,
} = {}) {
  const profileDirs = findChromeProfileDirs(baseDir);
  if (profileDirs.length === 0) {
    return { cleared: [], skipped: [], failed: [], missing: true };
  }

  const cleared = [];
  const skipped = [];
  const failed = [];
  const now = Date.now();

  for (const profileDir of profileDirs) {
    const lockPath = path.join(profileDir, 'lockfile');
    if (!fs.existsSync(lockPath)) continue;

    let ageMs = Infinity;
    try {
      ageMs = now - fs.statSync(lockPath).mtimeMs;
    } catch {
      // stat failed — leave it alone to avoid racing the browser
      continue;
    }

    if (ageMs < maxAgeMs) {
      skipped.push({ path: lockPath, ageMs });
      continue;
    }

    if (dryRun) {
      log(`[chrome-preflight] [dry-run] would remove ${lockPath} (age ${Math.round(ageMs / 60000)}min)`);
      cleared.push(lockPath);
      continue;
    }

    try {
      fs.unlinkSync(lockPath);
      cleared.push(lockPath);
      log(`[chrome-preflight] cleared stale lock: ${lockPath} (age ${Math.round(ageMs / 60000)}min)`);
    } catch (err) {
      // On Windows, EBUSY means another process still holds the file handle.
      // Record the failure but don't crash — this is best-effort hygiene.
      failed.push({ path: lockPath, reason: err.message });
      log(`[chrome-preflight] failed to clear ${lockPath}: ${err.message}`);
    }
  }

  return { cleared, skipped, failed, missing: false };
}

/**
 * Shared wrapper for browser-launch entrypoints.
 * Keeps warning text consistent and centralizes future preflight policy.
 *
 * @param {string} label
 * @param {object} options
 * @returns {{ cleared: string[], skipped: Array<{path:string,ageMs:number}>, failed: Array<{path:string,reason:string}>, missing: boolean }}
 */
export function runChromePreflight(label = 'browser-preflight', options = {}) {
  const result = clearStaleLockfiles(options);
  if (result.failed.length > 0) {
    console.warn(`[${label}] preflight could not clear ${result.failed.length} stale lockfile(s); launch may still fail.`);
  }
  return result;
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────
// Only run when invoked directly, not when imported.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
           import.meta.url.endsWith(path.basename(process.argv[1] || ''));
  } catch { return false; }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const maxAgeIdx = args.findIndex((a) => a.startsWith('--max-age-minutes'));
  let maxAgeMs = DEFAULT_MAX_AGE_MS;
  if (maxAgeIdx >= 0) {
    const raw = args[maxAgeIdx].includes('=')
      ? args[maxAgeIdx].split('=')[1]
      : args[maxAgeIdx + 1];
    const mins = Number.parseFloat(raw);
    if (Number.isFinite(mins) && mins >= 0) maxAgeMs = mins * 60 * 1000;
  }

  const result = clearStaleLockfiles({ dryRun, maxAgeMs });
  const total = result.cleared.length + result.skipped.length + result.failed.length;
  if (result.missing) {
    console.log('[chrome-preflight] no Playwright base dir found — nothing to do');
  } else if (total === 0) {
    console.log('[chrome-preflight] no lockfiles present');
  } else {
    const parts = [
      `${dryRun ? 'would clear' : 'cleared'} ${result.cleared.length}`,
      `kept ${result.skipped.length} fresh`,
    ];
    if (result.failed.length) parts.push(`failed ${result.failed.length}`);
    console.log(`[chrome-preflight] ${parts.join(', ')}`);
    if (result.failed.length > 0) process.exitCode = 1;
  }
}
