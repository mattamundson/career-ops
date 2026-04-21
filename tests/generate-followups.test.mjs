// tests/generate-followups.test.mjs
// Coverage for scripts/generate-followups.mjs pure functions (no Claude calls).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, parseResponses, slugify, recentDrafts } from '../scripts/generate-followups.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('parseArgs: defaults', () => {
  const opts = parseArgs(['node', 'script']);
  assert.equal(opts.staleDays, 7);
  assert.equal(opts.dryRun, false);
  assert.equal(opts.applicationId, null);
  assert.equal(opts.force, false);
  assert.equal(opts.idempotencyDays, 7);
});

test('parseArgs: --dry-run flag', () => {
  const opts = parseArgs(['node', 'script', '--dry-run']);
  assert.equal(opts.dryRun, true);
});

test('parseArgs: --stale-days=N form', () => {
  const opts = parseArgs(['node', 'script', '--stale-days=14']);
  assert.equal(opts.staleDays, 14);
});

test('parseArgs: --stale-days N form', () => {
  const opts = parseArgs(['node', 'script', '--stale-days', '21']);
  assert.equal(opts.staleDays, 21);
});

test('parseArgs: --application-id pads to 3 digits', () => {
  const opts = parseArgs(['node', 'script', '--application-id=24']);
  assert.equal(opts.applicationId, '024');
});

test('slugify: normalizes company names', () => {
  assert.equal(slugify('KinderCare Learning Companies'), 'kindercare-learning-companies');
  assert.equal(slugify("Land O'Lakes, Inc."), 'land-o-lakes-inc');
  assert.equal(slugify('   A B C   '), 'a-b-c');
  assert.equal(slugify(null), 'unknown');
  assert.equal(slugify(''), 'unknown');
});

test('parseResponses: extracts per-app latest event from markdown table', () => {
  const tmpRoot = resolve(ROOT, 'output', 'test-responses-' + Date.now());
  mkdirSync(join(tmpRoot, 'data'), { recursive: true });
  writeFileSync(
    join(tmpRoot, 'data', 'responses.md'),
    `# Test\n| app_id | company | role | submitted_at | ats | status | last_event_at | response_days | notes |\n|--|--|--|--|--|--|--|--|--|\n| 001 | Foo | R | 2026-04-01 | L | submitted | 2026-04-01 | — | first |\n| 001 | Foo | R | 2026-04-01 | L | acknowledged | 2026-04-10 | 9 | later |\n| 002 | Bar | S | 2026-04-05 | G | submitted | 2026-04-05 | — | single |\n`,
    'utf-8'
  );

  const map = parseResponses(tmpRoot);
  assert.equal(map.size, 2);
  assert.equal(map.get('001').lastEventAt, '2026-04-10', 'should keep the later event for the same app');
  assert.equal(map.get('001').status, 'acknowledged');
  assert.equal(map.get('002').lastEventAt, '2026-04-05');

  rmSync(tmpRoot, { recursive: true, force: true });
});

test('parseResponses: returns empty map when responses.md missing', () => {
  const tmpRoot = resolve(ROOT, 'output', 'test-missing-' + Date.now());
  mkdirSync(tmpRoot, { recursive: true });
  const map = parseResponses(tmpRoot);
  assert.equal(map.size, 0);
  rmSync(tmpRoot, { recursive: true, force: true });
});

test('recentDrafts: groups by app_id and keeps latest', () => {
  const tmpDir = resolve(ROOT, 'output', 'test-drafts-' + Date.now());
  mkdirSync(tmpDir, { recursive: true });

  // Today (fresh), yesterday, and old draft.
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);
  const oldDate = '2025-01-01';

  writeFileSync(join(tmpDir, `followup-${yesterday}-001-foo.md`), '---\n---\n', 'utf-8');
  writeFileSync(join(tmpDir, `followup-${today}-001-foo.md`),    '---\n---\n', 'utf-8');
  writeFileSync(join(tmpDir, `followup-${oldDate}-002-bar.md`),  '---\n---\n', 'utf-8');
  writeFileSync(join(tmpDir, 'random-unrelated.md'),              'body',      'utf-8');

  const fresh = recentDrafts(tmpDir, 7);
  assert.equal(fresh.size, 1, 'old draft (2025) should not appear within 7-day window');
  assert.equal(fresh.get('001').dateStr, today, 'should keep today over yesterday');

  const wide = recentDrafts(tmpDir, 1000);
  assert.equal(wide.size, 2, 'wider window should include the old draft');

  rmSync(tmpDir, { recursive: true, force: true });
});
