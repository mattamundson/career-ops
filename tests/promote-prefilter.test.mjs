// tests/promote-prefilter.test.mjs
// Coverage for scripts/promote-prefilter.mjs pure helpers.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parsePrefilter } from '../scripts/promote-prefilter.mjs';

test('parsePrefilter: pending template → score null', () => {
  const text = `# Prefilter: X

**status:** pending
**date:** 2026-04-14
**url:** https://example.com
**company:** Acme
**title:** Data Architect

---

**Archetype:** _pending_
**Quick Score:** _/5 — _
**Recommendation:** _EVALUATE | MAYBE | SKIP_
`;
  const meta = parsePrefilter(text);
  assert.equal(meta.status, 'pending');
  assert.equal(meta.company, 'Acme');
  assert.equal(meta.score, null);
  assert.equal(meta.recommendation, null);
});

test('parsePrefilter: completed EVALUATE at 4.5', () => {
  const text = `**status:** pending
**date:** 2026-04-14
**company:** Optum
**title:** Data Architect - Minneapolis, MN

**Archetype:** Operational Data Architect
**Quick Score:** 4.5/5 — Prime target match
**Recommendation:** EVALUATE
`;
  const meta = parsePrefilter(text);
  assert.equal(meta.score, 4.5);
  assert.equal(meta.recommendation, 'EVALUATE');
  assert.equal(meta.archetype, 'Operational Data Architect');
});

test('parsePrefilter: MAYBE at 2.5', () => {
  const text = `**company:** X
**title:** Y
**Quick Score:** 2.5/5 — meh
**Recommendation:** MAYBE
`;
  const meta = parsePrefilter(text);
  assert.equal(meta.score, 2.5);
  assert.equal(meta.recommendation, 'MAYBE');
});

test('parsePrefilter: promoted marker sticks', () => {
  const text = `**company:** X
**title:** Y
**promoted:** 2026-04-21
**Quick Score:** 4.2/5 — ok
**Recommendation:** EVALUATE
`;
  const meta = parsePrefilter(text);
  assert.equal(meta.promoted, '2026-04-21');
});
