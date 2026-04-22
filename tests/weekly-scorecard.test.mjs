import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  weekRange,
  inYmdRange,
  buildMetrics,
  parseArgs,
} from '../scripts/weekly-scorecard.mjs';

test('weekRange: 7-day inclusive window ending on Sunday', () => {
  const { start, end } = weekRange('2026-04-22');
  assert.strictEqual(end, '2026-04-22');
  assert.strictEqual(start, '2026-04-16');
});

test('inYmdRange', () => {
  assert.strictEqual(inYmdRange('2026-04-20', '2026-04-16', '2026-04-22'), true);
  assert.strictEqual(inYmdRange('2026-04-15', '2026-04-16', '2026-04-22'), false);
  assert.strictEqual(inYmdRange('', '2026-04-16', '2026-04-22'), false);
});

test('parseArgs', () => {
  const a = parseArgs(['--json', '--week-ending=2026-01-01', '--root=/tmp/x', '--phase-a']);
  assert.strictEqual(a.json, true);
  assert.strictEqual(a.weekEnding, '2026-01-01');
  assert.strictEqual(a.root, resolve('/tmp/x'));
  assert.strictEqual(a.phaseA, true);
  assert.strictEqual(a.runVerify, false);
});

test('buildMetrics from minimal fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'co-score-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(
    join(root, 'data', 'applications.md'),
    `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 001 | 2026-04-20 | Acme | Eng | 4.0/5 | Applied | ❌ | [1](reports/1.md) | x |
| 002 | 2026-04-19 | Beta | Arch | 3.5/5 | Interview | ❌ | [2](reports/2.md) | y |
`,
    'utf8',
  );
  writeFileSync(
    join(root, 'data', 'responses.md'),
    `# Response Tracker

| app_id | company | role | submitted_at | ats | status | last_event_at | response_days | notes |
|--------|---------|------|--------------|-----|--------|---------------|---------------|-------|
| 001 | Acme | Eng | 2026-04-21 | Lever | submitted | 2026-04-21 | — | new |
| 003 | Gamma | PM | 2026-04-10 | GH | submitted | 2026-04-11 | — | old |
| 002 | Beta | Arch | 2026-01-10 | x | recruiter_reply | 2026-04-21 | 1 | hi |
`,
    'utf8',
  );

  const m = buildMetrics(root, { start: '2026-04-16', end: '2026-04-22' });
  assert.strictEqual(m.applications_submitted, 1);
  assert.strictEqual(m.recruiter_hm_conversations, 1);
  assert.strictEqual(m.interviews, 1);
});
