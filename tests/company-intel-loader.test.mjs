// tests/company-intel-loader.test.mjs
// Coverage for scripts/lib/company-intel-loader.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  toIntelSlug,
  loadCompanyIntel,
  formatIntelBlock,
} from '../scripts/lib/company-intel-loader.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function tmpIntelDir() {
  const d = resolve(ROOT, 'output', 'test-intel-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  mkdirSync(d, { recursive: true });
  return d;
}

test('toIntelSlug: matches prefilter-pipeline toSlug semantics', () => {
  assert.equal(toIntelSlug('Agility Robotics'), 'agility-robotics');
  assert.equal(toIntelSlug('KinderCare Learning Companies'), 'kindercare-learning-companies');
  assert.equal(toIntelSlug("Land O'Lakes, Inc."), 'land-olakes-inc');
  assert.equal(toIntelSlug('10Pearls LATAM'), '10pearls-latam');
  assert.equal(toIntelSlug(''), '');
  assert.equal(toIntelSlug(null), '');
});

test('loadCompanyIntel: returns found=false when slug is empty', () => {
  const intel = loadCompanyIntel('', { intelDir: '/nonexistent' });
  assert.equal(intel.found, false);
});

test('loadCompanyIntel: returns found=false when file missing', () => {
  const dir = tmpIntelDir();
  const intel = loadCompanyIntel('Acme Corp', { intelDir: dir });
  assert.equal(intel.found, false);
  assert.equal(intel.slug, 'acme-corp');
  rmSync(dir, { recursive: true, force: true });
});

test('loadCompanyIntel: populated file → found, not stub, body has content', () => {
  const dir = tmpIntelDir();
  const content = `---
company: Acme Corp
last_updated: 2026-04-15
---

## Company Overview

Acme builds anvils. Founded 1949. Roadrunner-adjacent.

## Target Role

Senior Data Engineer — remote, $140K-$180K.

### Strong Fit

- Manufacturing domain
- Modern data stack

### Gaps

- No acme-specific experience
`;
  writeFileSync(join(dir, 'acme-corp.md'), content, 'utf-8');

  const intel = loadCompanyIntel('Acme Corp', { intelDir: dir });
  assert.equal(intel.found, true);
  assert.equal(intel.isStub, false);
  assert.ok(intel.body.includes('Acme builds anvils'));
  assert.equal(intel.lastUpdated, '2026-04-15');
  assert.ok(typeof intel.ageDays === 'number');

  rmSync(dir, { recursive: true, force: true });
});

test('loadCompanyIntel: stub file (mostly TODOs) → isStub=true', () => {
  const dir = tmpIntelDir();
  const content = `---
company: Fake Co
last_updated: 2026-04-20
---

## Company Overview

| Field | Value |
|-------|-------|
| Full Name | <!-- TODO: Fill from search --> |
| Website | <!-- TODO: Fill from search --> |
| Industry | <!-- TODO: Fill from search --> |
| Founded | <!-- TODO: Fill from search --> |
| HQ Location | <!-- TODO: Fill from search --> |
| Stage | <!-- TODO: Fill from search --> |

## Glassdoor

| Field | Value |
|-------|-------|
| Overall Rating | <!-- TODO: Fill from search --> |
| Review Count | <!-- TODO: Fill from search --> |
| CEO Approval | <!-- TODO: Fill from search --> |
`;
  writeFileSync(join(dir, 'fake-co.md'), content, 'utf-8');

  const intel = loadCompanyIntel('Fake Co', { intelDir: dir });
  assert.equal(intel.found, true);
  assert.equal(intel.isStub, true, 'should be stub — TODOs dominate the body');

  rmSync(dir, { recursive: true, force: true });
});

test('loadCompanyIntel: TODO placeholder lines are stripped from body', () => {
  const dir = tmpIntelDir();
  const content = `---
company: Mixed Co
last_updated: 2026-04-15
---

## Section One

This has real content.

## Section Two

| Field | Value |
|-------|-------|
| Name  | Mixed Co |
| HQ    | <!-- TODO: Fill from search --> |
| Stage | Series A |

## Section Three

More substantive text here spanning several lines to ensure the body
has enough substance that stripping the TODO line above does not tip
it over the stub threshold.
`;
  writeFileSync(join(dir, 'mixed-co.md'), content, 'utf-8');

  const intel = loadCompanyIntel('Mixed Co', { intelDir: dir });
  assert.equal(intel.found, true);
  assert.ok(!intel.body.includes('TODO:'), 'TODO markers should be stripped');
  assert.ok(intel.body.includes('This has real content'));
  assert.ok(intel.body.includes('Series A'));

  rmSync(dir, { recursive: true, force: true });
});

test('formatIntelBlock: empty when intel not found', () => {
  const block = formatIntelBlock({ found: false, slug: 'x', path: '' });
  assert.equal(block, '');
});

test('formatIntelBlock: stub intel → one-line notice', () => {
  const block = formatIntelBlock({
    found: true, isStub: true, path: '/fake/path', body: 'stub body',
  });
  assert.match(block, /Company Intel/);
  assert.match(block, /mostly unpopulated/);
});

test('formatIntelBlock: populated intel → full body', () => {
  const block = formatIntelBlock({
    found: true, isStub: false, path: '/fake/path',
    body: '## Section\nReal content here.',
    lastUpdated: '2026-04-10',
    ageDays: 11,
  });
  assert.match(block, /Company Intel \(cached · updated 2026-04-10\)/);
  assert.match(block, /Real content here/);
  assert.ok(!block.includes('ntel is'), 'no staleness warning for 11d-old intel');
});

test('formatIntelBlock: stale intel (>90d) gets a staleness warning', () => {
  const block = formatIntelBlock({
    found: true, isStub: false, path: '/fake/path',
    body: '## Section\nContent.',
    lastUpdated: '2025-01-01',
    ageDays: 120,
  });
  assert.match(block, /intel is 120d old/);
});
