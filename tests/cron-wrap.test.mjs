// tests/cron-wrap.test.mjs
// Coverage for scripts/lib/cron-wrap.mjs
//
// We can't easily test the real exit-on-finish path, so we use
// exitOnFinish: false to keep the process alive and inspect events
// written to a temp dir.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runCronTask, recentTaskEvents } from '../scripts/lib/cron-wrap.mjs';

function mkRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-cron-wrap-'));
  mkdirSync(join(dir, 'data', 'events'), { recursive: true });
  return dir;
}

function readEvents(rootPath) {
  const eventsDir = resolve(rootPath, 'data', 'events');
  const files = readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl'));
  const events = [];
  for (const f of files) {
    const lines = readFileSync(join(eventsDir, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) events.push(JSON.parse(line));
  }
  return events;
}

test('runCronTask emits start + complete on success', async () => {
  const root = mkRoot();
  try {
    const result = await runCronTask(
      'unit-test-success',
      async () => ({ scanned: 5, found: 2 }),
      { rootPath: root, exitOnFinish: false }
    );
    assert.deepEqual(result, { scanned: 5, found: 2 });

    const events = readEvents(root);
    const start = events.find((e) => e.type === 'task.start');
    const done = events.find((e) => e.type === 'task.complete');
    assert.ok(start, 'expected task.start event');
    assert.ok(done, 'expected task.complete event');
    assert.equal(start.task, 'unit-test-success');
    assert.equal(done.task, 'unit-test-success');
    assert.deepEqual(done.summary, { scanned: 5, found: 2 });
    assert.ok(done.elapsed_ms >= 0);
    assert.ok(!events.some((e) => e.type === 'task.failed'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runCronTask emits start + failed on caught error', async () => {
  const root = mkRoot();
  try {
    await assert.rejects(
      runCronTask(
        'unit-test-failure',
        async () => {
          const err = new Error('simulated boom');
          err.code = 'BOOM';
          throw err;
        },
        { rootPath: root, exitOnFinish: false }
      )
    );

    const events = readEvents(root);
    const start = events.find((e) => e.type === 'task.start');
    const failed = events.find((e) => e.type === 'task.failed');
    assert.ok(start, 'expected task.start event');
    assert.ok(failed, 'expected task.failed event');
    assert.equal(failed.task, 'unit-test-failure');
    assert.equal(failed.error, 'simulated boom');
    assert.equal(failed.error_code, 'BOOM');
    assert.equal(failed.error_source, 'caught');
    assert.ok(failed.stack.includes('simulated boom'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runCronTask preserves retry annotations from retry.mjs', async () => {
  const root = mkRoot();
  try {
    await assert.rejects(
      runCronTask(
        'unit-test-with-retry',
        async () => {
          const err = new Error('exhausted');
          err.retryAttempts = 4;
          err.retryLabel = 'openai-embed';
          err.status = 429;
          throw err;
        },
        { rootPath: root, exitOnFinish: false }
      )
    );
    const failed = readEvents(root).find((e) => e.type === 'task.failed');
    assert.equal(failed.retry_attempts, 4);
    assert.equal(failed.retry_label, 'openai-embed');
    assert.equal(failed.error_code, 429);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recentTaskEvents reads + filters last N hours', async () => {
  const root = mkRoot();
  try {
    // Generate one success + one failure
    await runCronTask(
      'demo-pass',
      async () => ({ ok: true }),
      { rootPath: root, exitOnFinish: false }
    );
    await assert.rejects(
      runCronTask(
        'demo-fail',
        async () => {
          throw new Error('nope');
        },
        { rootPath: root, exitOnFinish: false }
      )
    );

    const recent = recentTaskEvents(root, 24);
    assert.ok(recent.started.length >= 2);
    assert.ok(recent.completed.length >= 1);
    assert.ok(recent.failed.length >= 1);
    assert.equal(recent.failed[0].task, 'demo-fail');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('summary serialization caps oversize objects', async () => {
  const root = mkRoot();
  try {
    const huge = { items: Array.from({ length: 500 }, (_, i) => `item-${i}-with-padding-padding`) };
    await runCronTask(
      'demo-huge-summary',
      async () => huge,
      { rootPath: root, exitOnFinish: false }
    );
    const done = readEvents(root).find((e) => e.type === 'task.complete');
    assert.ok(done.summary._truncated, 'expected oversized summary to be truncated');
    assert.ok(done.summary.preview.length <= 800);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
