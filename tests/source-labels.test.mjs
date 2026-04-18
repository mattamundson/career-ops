import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSourceOperationalStatus,
  parsePortal,
  portalDisplayLabel,
  rollupSourcesByPortal,
} from '../scripts/lib/source-labels.mjs';

test('parsePortal: direct We Work Remotely', () => {
  const p = parsePortal('direct/weworkremotely');
  assert.equal(p.sourceType, 'direct');
  assert.equal(p.sourceKey, 'weworkremotely');
  assert.equal(p.displayLabel, 'We Work Remotely');
  assert.equal(getSourceOperationalStatus('direct/weworkremotely'), 'active');
});

test('parsePortal: SimplyHired blocked', () => {
  assert.equal(portalDisplayLabel('direct/simplyhired'), 'SimplyHired');
  assert.equal(getSourceOperationalStatus('direct/simplyhired'), 'blocked');
});

test('parsePortal: direct Indeed + LinkedIn MCP scans active', () => {
  assert.equal(portalDisplayLabel('direct/indeed'), 'Indeed (direct scan)');
  assert.equal(getSourceOperationalStatus('direct/indeed'), 'active');
  assert.equal(portalDisplayLabel('direct/linkedin-mcp'), 'LinkedIn (MCP scan)');
  assert.equal(getSourceOperationalStatus('direct/linkedin-mcp'), 'active');
});

test('parsePortal: JobSpy Indeed', () => {
  const p = parsePortal('jobspy/indeed');
  assert.equal(p.displayLabel, 'Indeed');
  assert.equal(getSourceOperationalStatus('jobspy/indeed'), 'active');
});

test('parsePortal: Greenhouse keeps employer in label', () => {
  const p = parsePortal('greenhouse/Sigma Computing');
  assert.match(p.displayLabel, /Sigma Computing/i);
  assert.match(p.displayLabel, /Greenhouse/i);
});

test('rollupSourcesByPortal aggregates', () => {
  const rows = [
    { portal: 'jobspy/linkedin', status: 'added', first_seen: '2026-04-10' },
    { portal: 'jobspy/linkedin', status: 'skipped_title', first_seen: '2026-04-09' },
    { portal: 'direct/weworkremotely', status: 'added', first_seen: '2026-04-11' },
  ];
  const roll = rollupSourcesByPortal(rows);
  const li = roll.find((r) => r.portal === 'jobspy/linkedin');
  assert.ok(li);
  assert.equal(li.total, 2);
  assert.equal(li.added, 1);
  assert.equal(li.displayLabel, 'LinkedIn Jobs');
});
