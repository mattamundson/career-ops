import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCutoffDay,
  listEventFilenamesToPrune,
  parseEventJsonlYmd,
} from '../scripts/lib/event-log-prune.mjs';

test('parseEventJsonlYmd accepts only dated jsonl names', () => {
  assert.equal(parseEventJsonlYmd('2026-04-10.jsonl'), '2026-04-10');
  assert.equal(parseEventJsonlYmd('2026-aa-01.jsonl'), null);
  assert.equal(parseEventJsonlYmd('backup-2026-04-10.jsonl'), null);
  assert.equal(parseEventJsonlYmd('readme.md'), null);
});

test('computeCutoffDay is local midnight minus retainDays', () => {
  const fixed = new Date('2026-04-13T15:30:00');
  assert.equal(computeCutoffDay(1, fixed), '2026-04-12');
  assert.equal(computeCutoffDay(2, fixed), '2026-04-11');
});

test('listEventFilenamesToPrune uses strict string ordering on YYYY-MM-DD', () => {
  const cutoff = '2026-04-12';
  const names = [
    '2026-04-13.jsonl',
    '2026-04-11.jsonl',
    '2026-04-12.jsonl',
    'noise.jsonl',
    '2026-01-01.jsonl',
  ];
  assert.deepEqual(listEventFilenamesToPrune(names, cutoff), [
    '2026-01-01.jsonl',
    '2026-04-11.jsonl',
  ]);
});
