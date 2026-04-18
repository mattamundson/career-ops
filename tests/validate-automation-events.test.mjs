import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const SCRIPT = join(ROOT, 'scripts', 'validate-automation-events.mjs');

function runValidate(env) {
  return execFileSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('validate-automation-events passes on valid JSONL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-ev-'));
  writeFileSync(join(dir, '2026-04-01.jsonl'), '{"type":"x"}\n', 'utf8');
  const out = runValidate({ CAREER_OPS_EVENTS_DIR: dir });
  assert.match(out, /OK/);
});

test('validate-automation-events fails on invalid JSONL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-ev-'));
  writeFileSync(join(dir, '2026-04-01.jsonl'), 'NOT JSON', 'utf8');
  assert.throws(
    () => runValidate({ CAREER_OPS_EVENTS_DIR: dir }),
    (err) => err.status === 1,
  );
});

test('validate-automation-events fails when CAREER_OPS_EVENTS_DIR missing', () => {
  const ghost = join(tmpdir(), `no-such-events-${Date.now()}`);
  assert.ok(!existsSync(ghost));
  assert.throws(
    () => runValidate({ CAREER_OPS_EVENTS_DIR: ghost }),
    (err) => err.status === 1,
  );
});
