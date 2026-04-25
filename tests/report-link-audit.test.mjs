import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { auditReportLinks, renderReportLinkAudit } from '../scripts/lib/report-link-audit.mjs';

test('auditReportLinks separates present and missing tracker report links', () => {
  const root = mkdtempSync(join(tmpdir(), 'report-audit-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports', '001-acme.md'), '# Acme\n');
  writeFileSync(
    join(root, 'data', 'applications.md'),
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 001 | 2026-01-01 | Acme | Engineer | 4.0/5 | GO | — | [001](reports/001-acme.md) | |',
      '| 002 | 2026-01-02 | Beta | Architect | 4.0/5 | Evaluated | — | [002](reports/002-beta.md) | |',
      '| 003 | 2026-01-03 | Gamma | Manager | 3.0/5 | SKIP | — | — | |',
      '',
    ].join('\n'),
  );

  const result = auditReportLinks(root);

  assert.equal(result.totalLinked, 2);
  assert.equal(result.present.length, 1);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].num, 2);
  assert.equal(result.missing[0].path, 'reports/002-beta.md');
});

test('renderReportLinkAudit includes actionable missing report rows', () => {
  const rendered = renderReportLinkAudit({
    generatedAt: '2026-04-25T00:00:00.000Z',
    trackerPath: 'data/applications.md',
    totalEntries: 2,
    totalLinked: 1,
    present: [],
    missing: [
      {
        num: 42,
        company: 'Acme',
        role: 'Principal Architect',
        status: 'GO',
        path: 'reports/042-acme.md',
      },
    ],
  });

  assert.match(rendered, /Missing report links: 1/);
  assert.match(rendered, /\| 42 \| GO \| Acme \| Principal Architect \| `reports\/042-acme.md` \|/);
});
