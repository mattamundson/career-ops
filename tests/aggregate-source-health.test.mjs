// tests/aggregate-source-health.test.mjs
// Coverage for scripts/aggregate-source-health.mjs pure functions.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifySource, aggregate } from '../scripts/aggregate-source-health.mjs';

test('classifySource: extracts source from scanner.<source>.completed', () => {
  assert.equal(classifySource('scanner.greenhouse.completed'), 'greenhouse');
  assert.equal(classifySource('scanner.linkedin_mcp.completed'), 'linkedin_mcp');
  assert.equal(classifySource('scanner.run.completed'), 'run');
});

test('classifySource: extracts source from scanner.<source>.failed', () => {
  assert.equal(classifySource('scanner.ashby.failed'), 'ashby');
  assert.equal(classifySource('scanner.run.failed'), 'run');
});

test('classifySource: extracts source from scanner.<source>.partial', () => {
  assert.equal(classifySource('scanner.workday.partial'), 'workday');
});

test('classifySource: returns null for non-matching types', () => {
  assert.equal(classifySource('dashboard.generated'), null);
  assert.equal(classifySource('scanner'), null);
  assert.equal(classifySource(''), null);
  assert.equal(classifySource(null), null);
  assert.equal(classifySource(undefined), null);
  assert.equal(classifySource('scanner.source.unknown_suffix'), null);
});

function ev({ type, status, yieldCount, tsIso }) {
  const ts = Date.parse(tsIso);
  return {
    type,
    status,
    recorded_at: tsIso,
    _ts: ts,
    details: yieldCount != null ? { newCount: yieldCount } : {},
  };
}

test('aggregate: counts runs/successes/partials/failures and computes rates', () => {
  const events = [
    ev({ type: 'scanner.greenhouse.completed', status: 'success',  yieldCount: 3, tsIso: '2026-04-15T12:00:00.000Z' }),
    ev({ type: 'scanner.greenhouse.completed', status: 'success',  yieldCount: 5, tsIso: '2026-04-16T12:00:00.000Z' }),
    ev({ type: 'scanner.greenhouse.partial',   status: 'partial',  yieldCount: 1, tsIso: '2026-04-17T12:00:00.000Z' }),
    ev({ type: 'scanner.greenhouse.failed',    status: 'failed',                   tsIso: '2026-04-18T12:00:00.000Z' }),
  ];
  const report = aggregate(events, 14);
  const gh = report.sources.greenhouse;
  assert.equal(gh.runs, 4);
  assert.equal(gh.successes, 2);
  assert.equal(gh.partials, 1);
  assert.equal(gh.failures, 1);
  assert.equal(gh.success_rate, 0.5);
  assert.equal(gh.partial_rate, 0.25);
  assert.equal(gh.failure_rate, 0.25);
  assert.equal(gh.total_yield, 9);
  assert.equal(gh.yield_samples, 3);
  assert.equal(gh.avg_yield, 3);
});

test('aggregate: most recent event determines recent_status', () => {
  const events = [
    ev({ type: 'scanner.lever.completed', status: 'success', tsIso: '2026-04-15T12:00:00.000Z' }),
    ev({ type: 'scanner.lever.failed',    status: 'failed',  tsIso: '2026-04-20T12:00:00.000Z' }),
    ev({ type: 'scanner.lever.partial',   status: 'partial', tsIso: '2026-04-17T12:00:00.000Z' }),
  ];
  const report = aggregate(events, 14);
  assert.equal(report.sources.lever.recent_status, 'error');
  assert.deepEqual(report.sources.lever.sparkline, ['s', 'p', 'e']);
});

test('aggregate: sparkline keeps last 14 marks in chronological order', () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    ev({
      type: 'scanner.indeed.completed',
      status: 'success',
      yieldCount: i,
      tsIso: `2026-04-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`,
    })
  );
  const report = aggregate(events, 30);
  assert.equal(report.sources.indeed.sparkline.length, 14);
  assert.ok(report.sources.indeed.sparkline.every((m) => m === 's'));
});

test('aggregate: ignores events that do not match scanner.<source>.<suffix>', () => {
  const events = [
    ev({ type: 'scanner.greenhouse.completed', status: 'success', tsIso: '2026-04-15T12:00:00.000Z' }),
    ev({ type: 'dashboard.generated',          status: 'success', tsIso: '2026-04-16T12:00:00.000Z' }),
    ev({ type: 'apply.completed',              status: 'success', tsIso: '2026-04-17T12:00:00.000Z' }),
  ];
  const report = aggregate(events, 14);
  assert.deepEqual(Object.keys(report.sources), ['greenhouse']);
  assert.equal(report.total_events, 3, 'total_events reflects all input, not just matched');
});

test('aggregate: returns null rates when runs=0 (empty input)', () => {
  const report = aggregate([], 14);
  assert.deepEqual(report.sources, {});
  assert.equal(report.total_events, 0);
  assert.equal(report.window_days, 14);
});

test('aggregate: handles missing yield (newCount absent) — counts run, no yield sample', () => {
  const events = [
    ev({ type: 'scanner.firecrawl.completed', status: 'success', tsIso: '2026-04-15T12:00:00.000Z' }),
  ];
  const report = aggregate(events, 14);
  const fc = report.sources.firecrawl;
  assert.equal(fc.runs, 1);
  assert.equal(fc.yield_samples, 0);
  assert.equal(fc.avg_yield, null);
});

test('aggregate: tracks last_success / last_failure / last_partial independently', () => {
  const events = [
    ev({ type: 'scanner.workday.completed', status: 'success', tsIso: '2026-04-10T12:00:00.000Z' }),
    ev({ type: 'scanner.workday.partial',   status: 'partial', tsIso: '2026-04-12T12:00:00.000Z' }),
    ev({ type: 'scanner.workday.failed',    status: 'failed',  tsIso: '2026-04-14T12:00:00.000Z' }),
    ev({ type: 'scanner.workday.completed', status: 'success', tsIso: '2026-04-15T12:00:00.000Z' }),
  ];
  const report = aggregate(events, 14);
  const wd = report.sources.workday;
  assert.equal(wd.last_success, '2026-04-15T12:00:00.000Z');
  assert.equal(wd.last_partial, '2026-04-12T12:00:00.000Z');
  assert.equal(wd.last_failure, '2026-04-14T12:00:00.000Z');
  assert.equal(wd.last_run, '2026-04-15T12:00:00.000Z');
});

test('aggregate: accepts alternative yield keys (new_added, pipeline_additions)', () => {
  const events = [
    { type: 'scanner.a.completed', status: 'success', recorded_at: '2026-04-15T12:00:00Z', _ts: Date.parse('2026-04-15T12:00:00Z'), details: { new_added: 4 } },
    { type: 'scanner.a.completed', status: 'success', recorded_at: '2026-04-16T12:00:00Z', _ts: Date.parse('2026-04-16T12:00:00Z'), details: { pipeline_additions: 2 } },
  ];
  const report = aggregate(events, 14);
  assert.equal(report.sources.a.total_yield, 6);
  assert.equal(report.sources.a.yield_samples, 2);
  assert.equal(report.sources.a.avg_yield, 3);
});
