// tests/submit-lever.test.mjs
// Coverage for scripts/submit-lever.mjs pure helpers.
// No network — buildLeverApplicationPayload is invoked without a live POST.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseLeverUrl, buildLeverApplicationPayload } from '../scripts/submit-lever.mjs';

test('parseLeverUrl: canonical jobs.lever.co URL', () => {
  const r = parseLeverUrl('https://jobs.lever.co/acmeco/abc12345-def6-7890-1234-567890abcdef');
  assert.deepEqual(r, { clientName: 'acmeco', postingId: 'abc12345-def6-7890-1234-567890abcdef' });
});

test('parseLeverUrl: /apply suffix', () => {
  const r = parseLeverUrl('https://jobs.lever.co/acmeco/abc12345-def6-7890-1234-567890abcdef/apply');
  assert.equal(r.clientName, 'acmeco');
});

test('parseLeverUrl: API host variant', () => {
  const r = parseLeverUrl('https://api.lever.co/v0/postings/acmeco/abc12345-def6-7890-1234-567890abcdef');
  assert.equal(r.clientName, 'acmeco');
  assert.equal(r.postingId, 'abc12345-def6-7890-1234-567890abcdef');
});

test('parseLeverUrl: non-Lever URL returns null', () => {
  assert.equal(parseLeverUrl('https://greenhouse.io/acme/123'), null);
  assert.equal(parseLeverUrl(''), null);
  assert.equal(parseLeverUrl(null), null);
});

test('buildLeverApplicationPayload: includes name + email + urls', () => {
  const profile = {
    full_name: 'Matt Amundson',
    email: 'matt@example.com',
    phone: '555-1234',
    linkedin_url: 'https://linkedin.com/in/mattamundson',
    portfolio_url: 'https://mattamundson.com',
    location: { city: 'Minneapolis', state: 'MN' },
  };
  const fd = buildLeverApplicationPayload({ profile });
  assert.equal(fd.get('name'), 'Matt Amundson');
  assert.equal(fd.get('email'), 'matt@example.com');
  assert.equal(fd.get('phone'), '555-1234');
  assert.equal(fd.get('urls[LinkedIn]'), 'https://linkedin.com/in/mattamundson');
  assert.equal(fd.get('urls[Portfolio]'), 'https://mattamundson.com');
  assert.equal(fd.get('location'), 'Minneapolis, MN');
});

test('buildLeverApplicationPayload: missing profile fields are skipped', () => {
  const fd = buildLeverApplicationPayload({ profile: { full_name: 'X', email: 'x@x.com' } });
  assert.equal(fd.get('name'), 'X');
  assert.equal(fd.get('phone'), null);
  assert.equal(fd.get('urls[LinkedIn]'), null);
});

test('buildLeverApplicationPayload: null profile handled gracefully', () => {
  const fd = buildLeverApplicationPayload({ profile: null });
  assert.equal(fd.get('name'), null);
});
