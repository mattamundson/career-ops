import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateOutcomes,
  computeOutcomeSignal,
  outcomeSignalFor,
  slugifyCompany,
  DEFAULT_MIN_SAMPLES,
  DEFAULT_CAP,
} from '../scripts/lib/outcome-signal.mjs';

test('slugifyCompany: handles punctuation, spaces, edge cases', () => {
  assert.equal(slugifyCompany('Acme Corp'), 'acme-corp');
  assert.equal(slugifyCompany("St. Jude's"), 'st-judes');
  assert.equal(slugifyCompany('  Trim Me  '), 'trim-me');
  assert.equal(slugifyCompany(null), '');
  assert.equal(slugifyCompany(undefined), '');
});

test('computeOutcomeSignal: empty inputs → empty maps', () => {
  const sig = computeOutcomeSignal([], []);
  assert.equal(sig.company.size, 0);
  assert.equal(sig.portal.size, 0);
});

test('computeOutcomeSignal: below minSamples → multiplier forced to 1.0', () => {
  const responses = [
    { app_id: '001', company: 'Acme', ats: 'Greenhouse', status: 'rejected' },
    { app_id: '002', company: 'Acme', ats: 'Greenhouse', status: 'rejected' },
  ];
  const sig = computeOutcomeSignal(responses, []);
  const acme = sig.company.get('acme');
  assert.equal(acme.samples, 2, 'two samples seen');
  assert.equal(acme.multiplier, 1.0, 'below 3-sample gate → neutral');
  assert.ok(acme.confidence < 1.0, 'confidence under 1 when under-sampled');
});

test('computeOutcomeSignal: rejection-heavy company gets downweighted', () => {
  const responses = [
    { app_id: '001', company: 'GhostCo', ats: 'Workday', status: 'rejected' },
    { app_id: '002', company: 'GhostCo', ats: 'Workday', status: 'rejected' },
    { app_id: '003', company: 'GhostCo', ats: 'Workday', status: 'ghosted' },
    { app_id: '004', company: 'GhostCo', ats: 'Workday', status: 'ghosted' },
  ];
  const sig = computeOutcomeSignal(responses, []);
  const entry = sig.company.get('ghostco');
  assert.ok(entry.multiplier < 1.0, `expected <1.0, got ${entry.multiplier}`);
  assert.ok(entry.multiplier >= 1.0 - DEFAULT_CAP, 'capped at floor');
});

test('computeOutcomeSignal: interview/offer company gets upweighted', () => {
  const responses = [
    { app_id: '010', company: 'WinCo', ats: 'Lever', status: 'offer' },
    { app_id: '011', company: 'WinCo', ats: 'Lever', status: 'interview' },
    { app_id: '012', company: 'WinCo', ats: 'Lever', status: 'recruiter_reply' },
  ];
  const sig = computeOutcomeSignal(responses, []);
  const entry = sig.company.get('winco');
  assert.ok(entry.multiplier > 1.0, `expected >1.0, got ${entry.multiplier}`);
  assert.ok(entry.multiplier <= 1.0 + DEFAULT_CAP, 'capped at ceiling');
});

test('computeOutcomeSignal: portal signal aggregates across companies', () => {
  const responses = [
    { app_id: '001', company: 'A', ats: 'Greenhouse', status: 'rejected' },
    { app_id: '002', company: 'B', ats: 'Greenhouse', status: 'rejected' },
    { app_id: '003', company: 'C', ats: 'Greenhouse', status: 'ghosted' },
  ];
  const sig = computeOutcomeSignal(responses, []);
  const portal = sig.portal.get('greenhouse');
  assert.equal(portal.samples, 3);
  assert.ok(portal.multiplier < 1.0, 'portal with all-negative outcomes downweights');
});

test('computeOutcomeSignal: weak-positive acknowledged counts at 0.5 weight', () => {
  // 4 acks + 0 neg. Weighted pos = 2/4 = 0.5. Raw = 1 + 0.15*(0.5) = 1.075
  const responses = [
    { app_id: '1', company: 'AckCo', ats: 'X', status: 'acknowledged' },
    { app_id: '2', company: 'AckCo', ats: 'X', status: 'acknowledged' },
    { app_id: '3', company: 'AckCo', ats: 'X', status: 'acknowledged' },
    { app_id: '4', company: 'AckCo', ats: 'X', status: 'acknowledged' },
  ];
  const sig = computeOutcomeSignal(responses, []);
  const entry = sig.company.get('ackco');
  assert.ok(entry.multiplier > 1.0 && entry.multiplier < 1.10,
    `ack-only should lift modestly (got ${entry.multiplier})`);
});

test('computeOutcomeSignal: applications.md Interview/Offer rollup counts as positive', () => {
  const applications = [
    { id: '020', company: 'Mixed Co', status: 'Interview' },
    { id: '021', company: 'Mixed Co', status: 'Offer' },
    { id: '022', company: 'Mixed Co', status: 'Responded' },
  ];
  const sig = computeOutcomeSignal([], applications);
  const entry = sig.company.get('mixed-co');
  assert.equal(entry.samples, 3);
  assert.ok(entry.multiplier > 1.0, 'three positive app rollups → upweight');
});

test('outcomeSignalFor: combines company + portal, clamps at cap', () => {
  // Manually construct a signal map where both company and portal are at ceiling.
  // Without clamping, 1.15 * 1.15 = 1.3225 — must be clamped to 1.15.
  const signalMap = {
    company: new Map([['ceilingco', { multiplier: 1.15, confidence: 1 }]]),
    portal: new Map([['workday', { multiplier: 1.15, confidence: 1 }]]),
  };
  const res = outcomeSignalFor(signalMap, { company: 'CeilingCo', portal: 'Workday' });
  assert.equal(res.multiplier, 1.15, 'combined clamped at +15%');
  assert.equal(res.companyMultiplier, 1.15);
  assert.equal(res.portalMultiplier, 1.15);
});

test('outcomeSignalFor: missing signal → neutral', () => {
  const signalMap = { company: new Map(), portal: new Map() };
  const res = outcomeSignalFor(signalMap, { company: 'Unknown', portal: 'Unknown' });
  assert.equal(res.multiplier, 1.0);
  assert.equal(res.companyMultiplier, 1.0);
  assert.equal(res.portalMultiplier, 1.0);
});

test('outcomeSignalFor: null signal map → safe default', () => {
  const res = outcomeSignalFor(null, { company: 'Any', portal: 'Any' });
  assert.equal(res.multiplier, 1.0);
});

test('aggregateOutcomes: ignores in-flight statuses', () => {
  const responses = [
    { company: 'Z', ats: 'X', status: 'submitted' },
    { company: 'Z', ats: 'X', status: 'in_progress' },
    { company: 'Z', ats: 'X', status: 'withdrew' },
  ];
  const buckets = aggregateOutcomes(responses, []);
  assert.equal(buckets.size, 0, 'neither company nor portal bucket created');
});

test('DEFAULT_MIN_SAMPLES and DEFAULT_CAP are sane', () => {
  assert.equal(DEFAULT_MIN_SAMPLES, 3);
  assert.equal(DEFAULT_CAP, 0.15);
});
