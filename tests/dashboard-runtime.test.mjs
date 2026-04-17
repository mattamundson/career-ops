import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirectoryEntryCache, runOptionalJsonCommand } from '../scripts/lib/dashboard-runtime.mjs';

test('createDirectoryEntryCache reuses directory listings for repeated reads', () => {
  let calls = 0;
  const cache = createDirectoryEntryCache({
    existsSyncFn: () => true,
    readdirSyncFn: () => {
      calls += 1;
      return ['a.txt', 'b.txt'];
    },
  });

  const first = cache('C:/tmp/output');
  const second = cache('C:/tmp/output');

  assert.deepEqual(first, ['a.txt', 'b.txt']);
  assert.deepEqual(second, ['a.txt', 'b.txt']);
  assert.equal(calls, 1);
});

test('runOptionalJsonCommand returns parsed data on success', async () => {
  const result = await runOptionalJsonCommand({
    label: 'demo-script',
    execFileImpl: async () => ({ stdout: '{"ok":true}\n' }),
  });

  assert.deepEqual(result, { data: { ok: true }, warning: null });
});

test('runOptionalJsonCommand surfaces warnings instead of swallowing failures', async () => {
  const result = await runOptionalJsonCommand({
    label: 'demo-script',
    execFileImpl: async () => {
      throw new Error('boom');
    },
  });

  assert.equal(result.data, null);
  assert.match(result.warning, /demo-script unavailable: boom/);
});
