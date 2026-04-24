import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { markApplicationApplied } from '../scripts/lib/tracker-mark-applied.mjs';

test('markApplicationApplied sets Applied and date', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-map-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  const md = join(root, 'data', 'applications.md');
  writeFileSync(
    md,
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 007 | 2026-01-01 | Acme | Engineer | 4.0/5 | Ready to Submit | — | — | |',
      '',
    ].join('\n'),
    'utf8',
  );
  const r = markApplicationApplied(root, '7', { date: '2026-04-23', noteLine: 'Test note.' });
  assert.equal(r.ok, true);
  const out = readFileSync(md, 'utf8');
  assert.match(out, /\| 007 \| 2026-04-23 \|/);
  assert.match(out, /\| Applied \|/);
  assert.match(out, /Test note/);
});

test('markApplicationApplied returns row_not_found for missing id', () => {
  const root = mkdtempSync(join(tmpdir(), 'tracker-map-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  const md = join(root, 'data', 'applications.md');
  writeFileSync(
    md,
    [
      '# T',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 001 | 2026-01-01 | X | Y | 4/5 | GO | — | — | |',
    ].join('\n'),
    'utf8',
  );
  const r = markApplicationApplied(root, '999');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'row_not_found');
});
