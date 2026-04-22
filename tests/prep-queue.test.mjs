// tests/prep-queue.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parsePrepQueueArgs, parseScoreValue } from '../scripts/prep-queue.mjs';

test('parsePrepQueueArgs: defaults', () => {
  const o = parsePrepQueueArgs([]);
  assert.equal(o.dryRun, false);
  assert.equal(o.skipLiveness, false);
  assert.equal(o.minScore, 3.0);
  assert.equal(o.limit, null);
  assert.equal(o.includeReady, false);
});

test('parsePrepQueueArgs: flags', () => {
  const o = parsePrepQueueArgs([
    '--dry-run',
    '--skip-liveness',
    '--min-score=3.5',
    '--limit=10',
    '--skip-pdf',
    '--no-tracker',
    '--no-ats',
    '--threshold=55',
    '--include-ready',
  ]);
  assert.equal(o.dryRun, true);
  assert.equal(o.skipLiveness, true);
  assert.equal(o.minScore, 3.5);
  assert.equal(o.limit, 10);
  assert.equal(o.skipPdf, true);
  assert.equal(o.noTracker, true);
  assert.equal(o.noAts, true);
  assert.equal(o.threshold, 55);
  assert.equal(o.includeReady, true);
});

test('parseScoreValue: X.X/5 and raw', () => {
  assert.equal(parseScoreValue('4.0/5'), 4);
  assert.equal(parseScoreValue('3.25/5'), 3.25);
  assert.equal(parseScoreValue('N/A'), null);
});
