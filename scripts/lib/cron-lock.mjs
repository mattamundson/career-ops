/**
 * Single-instance lock files for scheduled tasks (avoids overlapping runs).
 * Lock path: data/.locks/<safe-task>.lock (JSON: pid, at)
 *
 * A lock is "stale" and may be taken if: mtime age > STALE_MS, the pid
 * in the file is not alive, or the JSON is unreadable.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const STALE_MS = 3 * 3600 * 1000; // 3h — long scans may run this long; tune if needed

function safeName(taskName) {
  const s = String(taskName)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'task';
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {{ acquired: true, lockPath: string } | { acquired: false, lockPath: string }}
 */
export function tryAcquireCronLock(rootPath, taskName) {
  const safe = safeName(taskName);
  const dir = join(rootPath, 'data', '.locks');
  const lockFile = join(dir, `${safe}.lock`);
  mkdirSync(dir, { recursive: true });

  const payload = () =>
    `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`;

  function tryCreate(afterSteal) {
    try {
      writeFileSync(lockFile, payload(), { flag: 'wx' });
      return { acquired: true, lockPath: lockFile };
    } catch (e) {
      if (e?.code !== 'EEXIST' || afterSteal) {
        if (e?.code === 'EEXIST') return { acquired: false, lockPath: lockFile };
        throw e;
      }
      if (!existsSync(lockFile)) {
        return tryCreate(false);
      }
      const st = statSync(lockFile);
      const tooOld = Date.now() - st.mtimeMs > STALE_MS;
      let steal = tooOld;
      if (!steal) {
        try {
          const j = JSON.parse(readFileSync(lockFile, 'utf8'));
          if (!isPidAlive(j.pid)) steal = true;
        } catch {
          steal = true;
        }
      }
      if (steal) {
        try {
          unlinkSync(lockFile);
        } catch {
          /* ignore */
        }
        return tryCreate(true);
      }
      return { acquired: false, lockPath: lockFile };
    }
  }

  return tryCreate(false);
}

export function releaseCronLock(lockPath) {
  if (!lockPath) return;
  try {
    unlinkSync(lockPath);
  } catch {
    /* already gone or permission */
  }
}
