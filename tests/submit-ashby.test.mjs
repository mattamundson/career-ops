// tests/submit-ashby.test.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isAshbyUrl } from '../scripts/submit-ashby.mjs';

test('isAshbyUrl: ashbyhq.com true', () => {
  assert.equal(isAshbyUrl('https://jobs.ashbyhq.com/acme/abc'), true);
  assert.equal(isAshbyUrl('https://app.ashbyhq.com/jobs/x'), true);
});

test('isAshbyUrl: non-ashby false', () => {
  assert.equal(isAshbyUrl('https://jobs.lever.co/x/y'), false);
  assert.equal(isAshbyUrl(''), false);
  assert.equal(isAshbyUrl(null), false);
});
