// tests/match-stories.test.mjs
// Coverage for scripts/match-stories.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tokens, parseStoryBank, scoreStoryAgainstQuery, matchStories, parseArgs } from '../scripts/match-stories.mjs';

const SAMPLE = `# Header

## Intro

---

### [Architecture] ERP Data Pipeline
**S:** Situation text with Python and ETL.
**A:** Built pipeline.
**Best for questions about:** data architecture, ETL

---

### [Reliability] Barcode System
**S:** Production floor.
**A:** Node.js middleware with retry logic.
**Best for questions about:** production systems, reliability

---

### [AI/ML] Trading System
**S:** Python FastAPI engine with data reliability.
**A:** Walk-forward efficiency gate.
**Best for questions about:** AI/ML architecture, data reliability
`;

test('tokens: strips stop words and short tokens', () => {
  const t = tokens('The quick brown fox jumps over a lazy dog');
  assert.ok(!t.includes('the'));
  assert.ok(!t.includes('a'));
  assert.ok(t.includes('quick'));
  assert.ok(t.includes('brown'));
});

test('parseStoryBank: extracts all stories from --- separated markdown', () => {
  const stories = parseStoryBank(SAMPLE);
  assert.equal(stories.length, 3);
  assert.equal(stories[0].tag, 'Architecture');
  assert.equal(stories[0].title, 'ERP Data Pipeline');
  assert.equal(stories[1].tag, 'Reliability');
  assert.equal(stories[2].tag, 'AI/ML');
});

test('parseStoryBank: CRLF-tolerant', () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  const stories = parseStoryBank(crlf);
  assert.equal(stories.length, 3);
});

test('parseStoryBank: captures bestFor line', () => {
  const stories = parseStoryBank(SAMPLE);
  assert.match(stories[0].bestFor, /data architecture/);
  assert.match(stories[1].bestFor, /reliability/);
});

test('scoreStoryAgainstQuery: zero overlap → score 0', () => {
  const stories = parseStoryBank(SAMPLE);
  const q = new Set(tokens('Rust Kubernetes WebAssembly'));
  const s = scoreStoryAgainstQuery(stories[0], q);
  assert.equal(s.score, 0);
});

test('scoreStoryAgainstQuery: tag/bestFor hits weighted higher', () => {
  const stories = parseStoryBank(SAMPLE);
  // "architecture" only in tag + bestFor, not body. Should score 2 per tag hit.
  const q = new Set(tokens('architecture'));
  const s = scoreStoryAgainstQuery(stories[0], q);
  assert.ok(s.score > 0);
});

test('matchStories: returns top-N ranked by score', () => {
  const matches = matchStories({
    query: 'Python data pipeline ETL reliability production',
    storyBankText: SAMPLE,
    topN: 3,
  });
  assert.ok(matches.length > 0);
  assert.ok(matches.length <= 3);
  // Verify sorted descending
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1].score >= matches[i].score);
  }
});

test('matchStories: empty query → empty result', () => {
  const matches = matchStories({ query: '', storyBankText: SAMPLE });
  assert.equal(matches.length, 0);
});

test('parseArgs: space-separated values', () => {
  const a = parseArgs(['--company', 'Acme Data', '--role', 'Senior Data Architect']);
  assert.equal(a.company, 'Acme Data');
  assert.equal(a.role, 'Senior Data Architect');
});

test('parseArgs: equals-separated values', () => {
  const a = parseArgs(['--company=Acme', '--topN=5']);
  assert.equal(a.company, 'Acme');
  assert.equal(a.topN, 5);
});

test('parseArgs: --application-id padded to 3 digits', () => {
  const a = parseArgs(['--application-id', '7']);
  assert.equal(a.applicationId, '007');
});

test('parseArgs: --json flag', () => {
  const a = parseArgs(['--company=X', '--json']);
  assert.equal(a.json, true);
});
