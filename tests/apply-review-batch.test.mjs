// tests/apply-review-batch.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseBatchArgs } from '../scripts/apply-review-batch.mjs';

test('parseBatchArgs: prepare + ids', () => {
  const o = parseBatchArgs(['--prepare', '--ids=016,042', '--delay-ms=0']);
  assert.equal(o.mode, 'prepare');
  assert.deepEqual(o.ids.sort(), ['016', '042']);
  assert.equal(o.delayMs, 0);
  assert.equal(o.dryRun, false);
});

test('parseBatchArgs: confirm needs explicit flag in runner', () => {
  const o = parseBatchArgs(['--confirm', '219', '--accept-submit-risk', '--dry-run']);
  assert.equal(o.mode, 'confirm');
  assert.equal(o.acceptSubmit, true);
  assert.equal(o.dryRun, true);
  assert.ok(o.ids.includes('219'));
});

test('parseBatchArgs: bare numeric ids', () => {
  const o = parseBatchArgs(['--prepare', '3', '10']);
  assert.equal(o.mode, 'prepare');
  assert.ok(o.ids.includes('003'));
  assert.ok(o.ids.includes('010'));
});
