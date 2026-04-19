import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampScanWindowDays,
  resolveAutoScanSinceDays,
  resolveScanReportSinceDays,
} from '../scripts/lib/scan-window.mjs';

test('clampScanWindowDays clamps range', () => {
  assert.equal(clampScanWindowDays(0), 1);
  assert.equal(clampScanWindowDays(1), 1);
  assert.equal(clampScanWindowDays(7), 7);
  assert.equal(clampScanWindowDays(90), 90);
  assert.equal(clampScanWindowDays(200), 90);
});

test('resolveAutoScanSinceDays: cli wins', () => {
  const r = resolveAutoScanSinceDays({
    argv: ['--since=10', '--dry-run'],
    envVar: 'CAREER_OPS_SCAN_SINCE_DAYS',
    defaultDays: 7,
  });
  assert.equal(r.days, 10);
  assert.equal(r.source, 'cli');
});

test('resolveAutoScanSinceDays: env when no flag', () => {
  process.env.CAREER_OPS_SCAN_SINCE_DAYS = '14';
  try {
    const r = resolveAutoScanSinceDays({ argv: [], envVar: 'CAREER_OPS_SCAN_SINCE_DAYS', defaultDays: 7 });
    assert.equal(r.days, 14);
    assert.equal(r.source, 'env');
  } finally {
    delete process.env.CAREER_OPS_SCAN_SINCE_DAYS;
  }
});

test('resolveAutoScanSinceDays: default', () => {
  delete process.env.CAREER_OPS_SCAN_SINCE_DAYS;
  const r = resolveAutoScanSinceDays({ argv: [], envVar: 'CAREER_OPS_SCAN_SINCE_DAYS', defaultDays: 7 });
  assert.equal(r.days, 7);
  assert.equal(r.source, 'default');
});

test('resolveScanReportSinceDays: cli', () => {
  const r = resolveScanReportSinceDays({ argv: ['--since=5'] });
  assert.equal(r.days, 5);
  assert.equal(r.source, 'cli');
});

test('resolveScanReportSinceDays: env when no flag', () => {
  process.env.CAREER_OPS_SCAN_REPORT_SINCE_DAYS = '21';
  try {
    const r = resolveScanReportSinceDays({ argv: [] });
    assert.equal(r.days, 21);
    assert.equal(r.source, 'env');
  } finally {
    delete process.env.CAREER_OPS_SCAN_REPORT_SINCE_DAYS;
  }
});

test('resolveScanReportSinceDays: all-time when unset', () => {
  delete process.env.CAREER_OPS_SCAN_REPORT_SINCE_DAYS;
  const r = resolveScanReportSinceDays({ argv: [] });
  assert.equal(r.days, null);
  assert.equal(r.source, 'all');
});
