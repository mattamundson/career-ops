// tests/exit-event-trap.test.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dir, '..');

function readTodayJsonl(rootPath) {
  const today = new Date().toISOString().slice(0, 10);
  const file = join(rootPath, 'data', 'events', `${today}.jsonl`);
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function mkScript(rootPath, body) {
  const script = join(rootPath, 'tmp-script.mjs');
  // import path needs file:// URL on Windows for ESM
  const trapUrl = JSON.stringify(
    pathToFileURL(resolve(REPO_ROOT, 'scripts', 'lib', 'exit-event-trap.mjs')).href,
  );
  writeFileSync(
    script,
    `import { installExitTrap } from ${trapUrl};\n` +
      `installExitTrap('test-task', { rootPath: ${JSON.stringify(rootPath.replace(/\\/g, '/'))} });\n` +
      body,
    'utf8',
  );
  return script;
}

function mkTmpRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'exit-trap-test-'));
  mkdirSync(join(dir, 'data', 'events'), { recursive: true });
  return dir;
}

test('exit code 0 → no task.failed event emitted', () => {
  const root = mkTmpRoot();
  try {
    const script = mkScript(root, `console.log('ok'); process.exit(0);\n`);
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    const events = readTodayJsonl(root);
    assert.equal(events.filter((e) => e.type === 'task.failed').length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exit code 1 → task.failed event emitted with code', () => {
  const root = mkTmpRoot();
  try {
    const script = mkScript(root, `console.error('boom'); process.exit(1);\n`);
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    const events = readTodayJsonl(root);
    const failed = events.find((e) => e.type === 'task.failed');
    assert.ok(failed, 'expected task.failed event');
    assert.equal(failed.task, 'test-task');
    assert.equal(failed.error_code, 1);
    assert.equal(failed.error_source, 'exit-trap');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('throw at top level → task.failed via exit-trap (non-zero exit)', () => {
  const root = mkTmpRoot();
  try {
    // Top-level throw → Node emits uncaughtException + exits non-zero.
    // Our exit-trap fires on the non-zero exit code regardless.
    const script = mkScript(root, `throw new Error('top-level-boom');\n`);
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    const events = readTodayJsonl(root);
    const failed = events.filter((e) => e.type === 'task.failed');
    assert.ok(failed.length >= 1, `expected at least one task.failed; got ${failed.length}`);
    assert.equal(failed[0].task, 'test-task');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
