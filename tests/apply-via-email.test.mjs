// tests/apply-via-email.test.mjs
// Coverage for scripts/apply-via-email.mjs (arg parsing + MIME shape).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseEmailArgs } from '../scripts/apply-via-email.mjs';

test('parseEmailArgs: minimum', () => {
  const a = parseEmailArgs(['--app-id', '216', '--draft']);
  assert.equal(a.appId, '216');
  assert.equal(a.draft, true);
  assert.equal(a.send, false);
});

test('parseEmailArgs: equals form', () => {
  const a = parseEmailArgs(['--app-id=216', '--draft', '--to=careers@govdocs.com']);
  assert.equal(a.appId, '216');
  assert.equal(a.to, 'careers@govdocs.com');
});

test('parseEmailArgs: package-dir override', () => {
  const a = parseEmailArgs(['--app-id', '216', '--draft', '--package-dir', '/tmp/x']);
  assert.equal(a.packageDir, '/tmp/x');
});

test('parseEmailArgs: cc/bcc', () => {
  const a = parseEmailArgs([
    '--app-id',
    '216',
    '--draft',
    '--cc',
    'team@example.com',
    '--bcc=archive@example.com',
  ]);
  assert.equal(a.cc, 'team@example.com');
  assert.equal(a.bcc, 'archive@example.com');
});

test('parseEmailArgs: --send flag captured (script blocks later)', () => {
  const a = parseEmailArgs(['--app-id', '216', '--send']);
  assert.equal(a.send, true);
  assert.equal(a.draft, false);
});

test('parseEmailArgs: empty', () => {
  const a = parseEmailArgs([]);
  assert.equal(a.appId, null);
  assert.equal(a.draft, false);
  assert.equal(a.send, false);
});
