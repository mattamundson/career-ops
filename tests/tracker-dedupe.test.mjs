import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { dedupeApplicationsMarkdown } from '../scripts/lib/tracker-dedupe.mjs';

const header = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];

function tracker(rows) {
  return [...header, ...rows, ''].join('\n');
}

test('dedupeApplicationsMarkdown keeps distinct roles at the same company', () => {
  const input = tracker([
    '| 001 | 2026-01-01 | Databricks | Lead Solutions Architect | 4.0/5 | GO | — | [001](reports/001-databricks.md) | |',
    '| 002 | 2026-01-02 | Databricks | Resident Solutions Architect | 4.0/5 | GO | — | [002](reports/002-databricks.md) | |',
  ]);

  const result = dedupeApplicationsMarkdown(input);

  assert.equal(result.removed.length, 0);
  assert.match(result.content, /Lead Solutions Architect/);
  assert.match(result.content, /Resident Solutions Architect/);
});

test('dedupeApplicationsMarkdown removes exact company and role duplicates', () => {
  const input = tracker([
    '| 001 | 2026-01-01 | Acme Inc. | Senior Data Architect | 4.0/5 | Evaluated | — | [001](reports/001-acme.md) | Old note |',
    '| 002 | 2026-01-02 | Acme, Inc | senior data architect | 4.5/5 | GO | ✅ | [002](reports/002-acme.md) | New note |',
  ]);

  const result = dedupeApplicationsMarkdown(input);

  assert.deepEqual(result.removed.map((r) => r.num), [1]);
  assert.match(result.content, /\| 002 \| 2026-01-02 \| Acme, Inc \| senior data architect \| 4.5\/5 \| GO \|/);
  assert.doesNotMatch(result.content, /\| 001 \|/);
});

test('dedupeApplicationsMarkdown removes duplicate report links even when titles drift', () => {
  const input = tracker([
    '| 001 | 2026-01-01 | Unknown | Job Application for Senior Solutions Architect | 4.0/5 | Evaluated | — | [123](reports/123-role.md) | |',
    '| 002 | 2026-01-02 | Better Co | Senior Solutions Architect | 4.2/5 | Applied | ✅ | [123](reports/123-role.md) | Submitted |',
  ]);

  const result = dedupeApplicationsMarkdown(input);

  assert.deepEqual(result.removed.map((r) => r.num), [1]);
  assert.match(result.content, /\| 002 \| 2026-01-02 \| Better Co \| Senior Solutions Architect \| 4.2\/5 \| Applied \|/);
});
