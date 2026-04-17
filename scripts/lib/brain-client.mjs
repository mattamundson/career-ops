// Thin client for reading gbrain state from the local vendored runtime.
// Safe to call in dashboard generation — falls back gracefully when brain
// runtime is unavailable or when BRAIN_DISABLE=1 is set.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(THIS_DIR, '..', '..');
const GBRAIN_DIR = join(ROOT, 'vendor', 'gbrain');
const GBRAIN_CLI = join(GBRAIN_DIR, 'src', 'cli.ts');

export function isBrainAvailable() {
  if (process.env.BRAIN_DISABLE === '1') return false;
  return existsSync(GBRAIN_CLI);
}

function runGbrain(args, { timeoutMs = 5000 } = {}) {
  const res = spawnSync('bun', ['run', 'src/cli.ts', ...args], {
    cwd: GBRAIN_DIR,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (res.error || res.status !== 0) {
    return { ok: false, error: res.error?.message || res.stderr || `exit ${res.status}` };
  }
  return { ok: true, stdout: res.stdout };
}

export function addTimelineEntry(slug, date, summary, detail) {
  if (!isBrainAvailable()) return { ok: false, skipped: true };
  // Pin bare YYYY-MM-DD to local noon so gbrain's UTC parse doesn't shift the day.
  const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00` : date;
  const args = ['timeline-add', slug, normalizedDate, summary];
  if (detail) args.push('--detail', detail);
  const res = runGbrain(args, { timeoutMs: 10000 });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

export function getBrainStats() {
  if (!isBrainAvailable()) return { available: false };
  const res = runGbrain(['stats']);
  if (!res.ok) return { available: false, error: res.error };

  const stats = { available: true, pages: 0, chunks: 0, embedded: 0, links: 0, tags: 0, timeline: 0, byType: {} };
  const lines = res.stdout.split(/\r?\n/);
  let inByType = false;
  for (const line of lines) {
    const m = line.match(/^\s*(Pages|Chunks|Embedded|Links|Tags|Timeline):\s+(\d+)/);
    if (m) {
      const key = m[1].toLowerCase();
      stats[key] = parseInt(m[2], 10);
      continue;
    }
    if (line.startsWith('By type:')) { inByType = true; continue; }
    if (inByType) {
      const tm = line.match(/^\s+(\w+):\s+(\d+)/);
      if (tm) stats.byType[tm[1]] = parseInt(tm[2], 10);
    }
  }
  return stats;
}
