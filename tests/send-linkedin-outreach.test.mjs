// tests/send-linkedin-outreach.test.mjs
// Coverage for pure helpers in scripts/send-linkedin-outreach.mjs
// Does not invoke the MCP or network.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, validateOpts, checkCooldown, composeMessage, slugify } from '../scripts/send-linkedin-outreach.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function tmpDir() {
  const d = resolve(ROOT, 'output', 'test-outreach-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  mkdirSync(d, { recursive: true });
  return d;
}

test('parseArgs: required flags', () => {
  const a = parseArgs(['--company', 'Acme', '--role', 'Engineer', '--recipient', 'https://li/x', '--scenario', 'recruiter']);
  assert.equal(a.company, 'Acme');
  assert.equal(a.role, 'Engineer');
  assert.equal(a.recipient, 'https://li/x');
  assert.equal(a.scenario, 'recruiter');
  assert.equal(a.confirm, false);
});

test('parseArgs: --confirm + --no-interactive', () => {
  const a = parseArgs(['--company', 'A', '--confirm', '--no-interactive']);
  assert.equal(a.confirm, true);
  assert.equal(a.noInteractive, true);
});

test('validateOpts: missing company', () => {
  const errs = validateOpts({ role: 'x', recipient: 'y', scenario: 'recruiter' });
  assert.ok(errs.some((e) => e.includes('--company')));
});

test('validateOpts: invalid scenario', () => {
  const errs = validateOpts({ company: 'A', role: 'B', recipient: 'C', scenario: 'bogus' });
  assert.ok(errs.some((e) => e.includes('--scenario must be one of')));
});

test('validateOpts: all valid → no errors', () => {
  const errs = validateOpts({ company: 'A', role: 'B', recipient: 'C', scenario: 'hiring-manager' });
  assert.deepEqual(errs, []);
});

test('composeMessage: under 300 chars', () => {
  const m = composeMessage({
    company: 'Acme',
    role: 'Data Architect',
    scenario: 'hiring-manager',
    archetype: 'Operational Data Architect',
  });
  assert.ok(m.length <= 300, `length=${m.length}`);
  assert.match(m, /Acme/);
  assert.match(m, /Data Architect/);
});

test('composeMessage: verbose archetype still within 300 chars', () => {
  const m = composeMessage({
    company: 'VeryLongCompanyNameCorporation International Holdings',
    role: 'Senior Staff Principal Data Architecture Engineer Manager',
    scenario: 'hiring-manager',
    archetype: 'Operational Data Architect',
  });
  assert.ok(m.length <= 300, `length=${m.length}`);
});

test('composeMessage: different scenarios produce different proposals', () => {
  const r = composeMessage({ company: 'X', role: 'Y', scenario: 'recruiter' });
  const h = composeMessage({ company: 'X', role: 'Y', scenario: 'hiring-manager' });
  const ref = composeMessage({ company: 'X', role: 'Y', scenario: 'referral' });
  assert.notEqual(r, h);
  assert.notEqual(h, ref);
});

test('checkCooldown: no prior outreach → not blocked', () => {
  const dir = tmpDir();
  const result = checkCooldown(dir, 'Acme', 24);
  assert.equal(result.blocked, false);
  rmSync(dir, { recursive: true, force: true });
});

test('checkCooldown: recent sent outreach → blocked', () => {
  const dir = tmpDir();
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  writeFileSync(
    join(dir, `linkedin-${today}-001-acme.md`),
    `---\ncompany: "Acme"\nsent_at: "${nowIso}"\nstatus: "sent"\n---\n\nbody\n`,
    'utf-8'
  );
  const result = checkCooldown(dir, 'Acme', 24);
  assert.equal(result.blocked, true);
  rmSync(dir, { recursive: true, force: true });
});

test('checkCooldown: draft-only (no sent_at) does not block', () => {
  const dir = tmpDir();
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(dir, `linkedin-${today}-001-acme.md`),
    `---\ncompany: "Acme"\nstatus: "draft"\n---\n\nbody\n`,
    'utf-8'
  );
  const result = checkCooldown(dir, 'Acme', 24);
  assert.equal(result.blocked, false);
  rmSync(dir, { recursive: true, force: true });
});

test('slugify: LinkedIn-friendly', () => {
  assert.equal(slugify('Acme Robotics, Inc.'), 'acme-robotics-inc');
  assert.equal(slugify('10Pearls LATAM'), '10pearls-latam');
});
