// tests/surface-credentials.test.mjs
// Coverage for scripts/surface-credentials.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseSurfaceArgs,
  parseDormantCredentials,
  surfaceMatches,
} from '../scripts/surface-credentials.mjs';

test('parseSurfaceArgs: --jd', () => {
  const a = parseSurfaceArgs(['--jd=jds/acme.md']);
  assert.equal(a.jd, 'jds/acme.md');
  assert.equal(a.reportNum, null);
});

test('parseSurfaceArgs: --report-num + --json', () => {
  const a = parseSurfaceArgs(['--report-num=219', '--json']);
  assert.equal(a.reportNum, '219');
  assert.equal(a.json, true);
  assert.equal(a.inject, false);
});

test('parseSurfaceArgs: --inject', () => {
  const a = parseSurfaceArgs(['--report-num=219', '--inject']);
  assert.equal(a.inject, true);
});

test('parseDormantCredentials: extracts from YAML block', () => {
  const yml = `
other_key:
  foo: bar

dormant_credentials:
  - name: "Land O'Lakes ag-coop"
    trigger_keywords:
      - "agriculture"
      - "crop"
      - "co-op"
    experience_blurb: "Fortune 500 ag-coop lead."

  - name: "FirstEnergy NERC"
    trigger_keywords:
      - "utility"
      - "NERC"
    experience_blurb: "NERC-CIP compliance."

trailing_key:
  other: thing
`;
  const creds = parseDormantCredentials(yml);
  assert.equal(creds.length, 2);
  assert.equal(creds[0].name, "Land O'Lakes ag-coop");
  assert.deepEqual(creds[0].trigger_keywords, ['agriculture', 'crop', 'co-op']);
  assert.equal(creds[0].experience_blurb, 'Fortune 500 ag-coop lead.');
  assert.equal(creds[1].name, 'FirstEnergy NERC');
});

test('parseDormantCredentials: empty when section missing', () => {
  const yml = 'candidate:\n  name: Matt\n';
  const creds = parseDormantCredentials(yml);
  assert.equal(creds.length, 0);
});

test('surfaceMatches: exact-word match wins', () => {
  const creds = [
    {
      name: 'Ag',
      trigger_keywords: ['agriculture', 'crop'],
      experience_blurb: 'Ag blurb.',
    },
  ];
  const jd = 'We are an agriculture biotech company focused on crop nutrition.';
  const matches = surfaceMatches(jd, creds);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].matched_triggers.sort(), ['agriculture', 'crop']);
});

test('surfaceMatches: single-word whole-word boundary', () => {
  const creds = [
    { name: 'Power', trigger_keywords: ['power'], experience_blurb: 'x' },
  ];
  // "empower" should NOT match "power" (whole-word bound)
  const matches = surfaceMatches('We empower teams with data.', creds);
  assert.equal(matches.length, 0);
});

test('surfaceMatches: multi-word substring match', () => {
  const creds = [
    { name: 'AgTech', trigger_keywords: ['precision ag', 'co-op'], experience_blurb: 'x' },
  ];
  const jd = 'Focused on precision ag and farmer co-op workflows.';
  const matches = surfaceMatches(jd, creds);
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].matched_triggers.sort(), ['co-op', 'precision ag']);
});

test('surfaceMatches: no false positives on unrelated JD', () => {
  const creds = [
    { name: 'Finance', trigger_keywords: ['hedge fund', 'portfolio'], experience_blurb: 'x' },
  ];
  const matches = surfaceMatches('Senior data engineer for ad-tech.', creds);
  assert.equal(matches.length, 0);
});
