// tests/preflight-registry.test.mjs
// Coverage for scripts/lib/preflight-registry.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { registerPreflight, runPreflight, listPreflights } from '../scripts/lib/preflight-registry.mjs';

// NOTE: the registry is a module-level singleton. Tests use unique source
// names to avoid cross-test pollution. DO NOT reuse a source name across tests.

test('registerPreflight: rejects non-function preflight', () => {
  assert.throws(() => registerPreflight('pftest_bad_arg', 'not a fn'), /must be a function/);
  assert.throws(() => registerPreflight('pftest_bad_null', null), /must be a function/);
});

test('runPreflight: unknown source returns {ran: false}', async () => {
  const result = await runPreflight('pftest_unregistered');
  assert.deepEqual(result, { ran: false, source: 'pftest_unregistered' });
});

test('runPreflight: invokes registered sync fn and returns {ran: true, result}', async () => {
  registerPreflight('pftest_sync_ok', () => ({ cleaned: 3 }));
  const result = await runPreflight('pftest_sync_ok');
  assert.equal(result.ran, true);
  assert.equal(result.source, 'pftest_sync_ok');
  assert.deepEqual(result.result, { cleaned: 3 });
});

test('runPreflight: invokes registered async fn and awaits result', async () => {
  registerPreflight('pftest_async_ok', async () => {
    await new Promise((r) => setTimeout(r, 5));
    return 'hello';
  });
  const result = await runPreflight('pftest_async_ok');
  assert.equal(result.ran, true);
  assert.equal(result.result, 'hello');
});

test('runPreflight: catches throw and returns {error} (never rethrows)', async () => {
  registerPreflight('pftest_throw', () => {
    throw new Error('boom');
  });
  const result = await runPreflight('pftest_throw');
  assert.equal(result.ran, true);
  assert.equal(result.source, 'pftest_throw');
  assert.equal(result.error, 'boom');
  assert.equal(result.result, undefined);
});

test('runPreflight: catches async rejection and returns {error}', async () => {
  registerPreflight('pftest_reject', async () => {
    throw new Error('async boom');
  });
  const result = await runPreflight('pftest_reject');
  assert.equal(result.error, 'async boom');
});

test('runPreflight: non-Error throw values are coerced to string', async () => {
  registerPreflight('pftest_string_throw', () => {
    throw 'bare string';
  });
  const result = await runPreflight('pftest_string_throw');
  assert.equal(result.error, 'bare string');
});

test('registerPreflight: second call with same source overrides first', async () => {
  registerPreflight('pftest_override', () => 'first');
  registerPreflight('pftest_override', () => 'second');
  const result = await runPreflight('pftest_override');
  assert.equal(result.result, 'second');
});

test('listPreflights: includes every registered source', () => {
  registerPreflight('pftest_list_a', () => null);
  registerPreflight('pftest_list_b', () => null);
  const sources = listPreflights();
  assert.ok(sources.includes('pftest_list_a'));
  assert.ok(sources.includes('pftest_list_b'));
});
