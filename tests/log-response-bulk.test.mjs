import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';

const ROOT = resolve(process.cwd());
const SCRIPT = resolve(ROOT, 'scripts', 'log-response.mjs');

function makeFixture() {
  const dir = mkdtempSync(join(os.tmpdir(), 'log-response-bulk-'));
  const responsesPath = join(dir, 'data', 'responses.md');
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });

  const header = [
    '# Test Responses',
    '',
    '| app_id | company | role | submitted_at | ats | status | last_event_at | response_days | notes |',
    '|--------|---------|------|--------------|-----|--------|---------------|---------------|-------|',
    '| 001 | Acme | Data Architect | 2026-04-01 | Greenhouse | submitted | 2026-04-01 | — | initial |',
    '| 002 | Widget Co | BI Lead | 2026-04-02 | Lever | submitted | 2026-04-02 | — | initial |',
    '',
  ].join('\n');

  writeFileSync(responsesPath, header, 'utf8');
  return { dir, responsesPath };
}

function runScript(args, cwd, responsesPath) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CAREER_OPS_RESPONSES_FILE: responsesPath,
      BRAIN_LOG_RESPONSE_SKIP: '1',
    },
  });
}

test('log-response: --bulk YAML applies multiple events in one run', () => {
  const { dir, responsesPath } = makeFixture();
  try {
    const bulkPath = join(dir, 'batch.yml');
    writeFileSync(bulkPath, [
      'events:',
      '  - { app_id: "001", event: acknowledged, date: "2026-04-05", notes: "ATS auto-ack" }',
      '  - { app_id: "002", event: phone_screen_scheduled, date: "2026-04-06" }',
      '',
    ].join('\n'), 'utf8');

    const result = runScript(['--bulk', bulkPath], dir, responsesPath);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /bulk] #001 → acknowledged/);
    assert.match(result.stdout, /bulk] #002 → phone_screen_scheduled/);
    assert.match(result.stdout, /processed 2\/2 events/);

    const after = readFileSync(responsesPath, 'utf8');
    assert.match(after, /\| 001 \|.*\| acknowledged \|.*2026-04-05.*ATS auto-ack/);
    assert.match(after, /\| 002 \|.*\| phone_screen_scheduled \|.*2026-04-06/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('log-response: --bulk JSON array parses identically', () => {
  const { dir, responsesPath } = makeFixture();
  try {
    const bulkPath = join(dir, 'batch.json');
    writeFileSync(bulkPath, JSON.stringify([
      { app_id: '001', event: 'rejected', date: '2026-04-10', reason: 'not a fit' },
      { app_id: '002', event: 'on_site_done', date: '2026-04-11' },
    ]), 'utf8');

    const result = runScript(['--bulk', bulkPath], dir, responsesPath);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /processed 2\/2 events/);

    const after = readFileSync(responsesPath, 'utf8');
    assert.match(after, /\| 001 \|.*\| rejected \|.*not a fit/);
    assert.match(after, /\| 002 \|.*\| on_site_done \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('log-response: --bulk warns on unknown app_id without aborting batch', () => {
  const { dir, responsesPath } = makeFixture();
  try {
    const bulkPath = join(dir, 'batch.json');
    writeFileSync(bulkPath, JSON.stringify([
      { app_id: '999', event: 'acknowledged', date: '2026-04-10' },
      { app_id: '001', event: 'acknowledged', date: '2026-04-10' },
    ]), 'utf8');

    const result = runScript(['--bulk', bulkPath], dir, responsesPath);
    assert.equal(result.status, 0);
    assert.match(result.stderr + result.stdout, /unknown app_id 999/);
    assert.match(result.stdout, /processed 1\/2 events/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('log-response: new phone_screen and on_site event variants are accepted', () => {
  const { dir, responsesPath } = makeFixture();
  try {
    for (const evt of ['phone_screen_scheduled', 'phone_screen_done', 'on_site_scheduled', 'on_site_done']) {
      const result = runScript(['--app-id', '001', '--event', evt, '--date', '2026-04-15'], dir, responsesPath);
      assert.equal(result.status, 0, `event ${evt} should accept; stderr: ${result.stderr}`);
      assert.match(result.stdout, new RegExp(`Updated #001.*${evt}`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
