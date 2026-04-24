import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  releaseCronLock,
  tryAcquireCronLock,
} from '../scripts/lib/cron-lock.mjs';

test('tryAcquireCronLock: second instance fails until release', () => {
  const root = mkdtempSync(join(tmpdir(), 'cops-lock-'));
  mkdirSync(join(root, 'data', 'events'), { recursive: true });
  try {
    const a = tryAcquireCronLock(root, 'my-task');
    assert.equal(a.acquired, true);
    const b = tryAcquireCronLock(root, 'my-task');
    assert.equal(b.acquired, false);
    assert.ok(a.lockPath);
    assert.equal(b.lockPath, a.lockPath);
    releaseCronLock(a.lockPath);
    const c = tryAcquireCronLock(root, 'my-task');
    assert.equal(c.acquired, true);
    releaseCronLock(c.lockPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tryAcquireCronLock: different task names do not block', () => {
  const root = mkdtempSync(join(tmpdir(), 'cops-lock-'));
  mkdirSync(join(root, 'data', 'events'), { recursive: true });
  try {
    const a = tryAcquireCronLock(root, 'task-a');
    const b = tryAcquireCronLock(root, 'task-b');
    assert.equal(a.acquired, true);
    assert.equal(b.acquired, true);
    releaseCronLock(a.lockPath);
    releaseCronLock(b.lockPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lock file contains pid json', () => {
  const root = mkdtempSync(join(tmpdir(), 'cops-lock-'));
  mkdirSync(join(root, 'data', 'events'), { recursive: true });
  try {
    const a = tryAcquireCronLock(root, 'x');
    assert(a.acquired);
    const raw = readFileSync(a.lockPath, 'utf8');
    const j = JSON.parse(raw);
    assert.equal(j.pid, process.pid);
    assert.ok(j.at);
    releaseCronLock(a.lockPath);
    assert.equal(existsSync(a.lockPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
