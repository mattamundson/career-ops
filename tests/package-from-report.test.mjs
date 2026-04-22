// tests/package-from-report.test.mjs
// Coverage for scripts/package-from-report.mjs (pure-function contract).
// CLI integration is exercised separately via the smoke test against a
// real report on disk.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parsePackageArgs } from '../scripts/package-from-report.mjs';

test('parsePackageArgs: equals form', () => {
  const a = parsePackageArgs(['--report-num=219']);
  assert.equal(a.reportNum, '219');
  assert.equal(a.dryRun, false);
  assert.equal(a.skipPdf, false);
  assert.equal(a.noTracker, false);
  assert.equal(a.noAts, false);
  assert.equal(a.threshold, 60);
});

test('parsePackageArgs: space-separated form', () => {
  const a = parsePackageArgs(['--report-num', '219']);
  assert.equal(a.reportNum, '219');
});

test('parsePackageArgs: positional number', () => {
  const a = parsePackageArgs(['219']);
  assert.equal(a.reportNum, '219');
});

test('parsePackageArgs: all flags', () => {
  const a = parsePackageArgs([
    '--report-num=219',
    '--dry-run',
    '--skip-pdf',
    '--no-tracker',
    '--no-ats',
    '--threshold=75',
  ]);
  assert.equal(a.reportNum, '219');
  assert.equal(a.dryRun, true);
  assert.equal(a.skipPdf, true);
  assert.equal(a.noTracker, true);
  assert.equal(a.noAts, true);
  assert.equal(a.threshold, 75);
});

test('parsePackageArgs: threshold default if invalid', () => {
  const a = parsePackageArgs(['--report-num=219', '--threshold=junk']);
  assert.equal(a.threshold, 60);
});

test('parsePackageArgs: empty', () => {
  const a = parsePackageArgs([]);
  assert.equal(a.reportNum, null);
});
