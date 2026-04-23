import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildApplicationIndex } from '../scripts/lib/career-data.mjs';

test('buildApplicationIndex: queue-only id gets applyUrl when missing from applications.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-data-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'applications.md'),
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 001 | 2026-01-01 | Acme | Engineer | 4.0/5 | GO | — | — | |',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'data', 'apply-queue.md'),
    [
      '# Q',
      '',
      '### 1. Orphan Co — Test Role [777 — GO]',
      '- **Score:** 4.0/5',
      '- **Apply URL:** https://example.com/jobs/999',
      '',
    ].join('\n'),
  );

  const { records } = buildApplicationIndex(root);
  const orphan = records.find((r) => r.id === '777');
  assert.ok(orphan, 'synthetic record for id 777');
  assert.equal(orphan.applyUrl, 'https://example.com/jobs/999');
  assert.equal(orphan.status, 'GO');
  assert.equal(orphan.score, '4.0/5');
});

test('buildApplicationIndex: tracker row wins; no duplicate for same id', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-data-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'applications.md'),
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 001 | 2026-01-01 | Tracked | Engineer | 4.0/5 | GO | — | — | |',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'data', 'apply-queue.md'),
    [
      '# Q',
      '',
      '### 1. Queue Co — X [001 — GO]',
      '- **Apply URL:** https://from-queue.example/apply',
      '',
    ].join('\n'),
  );

  const { records } = buildApplicationIndex(root);
  const for001 = records.filter((r) => r.id === '001');
  assert.equal(for001.length, 1);
  assert.equal(for001[0].company, 'Tracked');
  assert.equal(for001[0].applyUrl, 'https://from-queue.example/apply');
});
