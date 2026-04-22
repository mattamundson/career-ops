// tests/parse-apply-url.test.mjs
// Coverage for scripts/lib/parse-apply-url.mjs — deterministic ATS URL parsing.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseApplyUrl } from '../scripts/lib/parse-apply-url.mjs';

test('parseApplyUrl: Greenhouse embed (company page with gh_jid)', () => {
  const r = parseApplyUrl('https://www.pivotbio.com/job-description?gh_jid=8419914002');
  assert.equal(r.portal, 'greenhouse');
  assert.equal(r.jobId, '8419914002');
  assert.equal(r.companySlug, 'pivotbio');
});

test('parseApplyUrl: Greenhouse direct board', () => {
  const r = parseApplyUrl('https://boards.greenhouse.io/acme/jobs/1234567');
  assert.equal(r.portal, 'greenhouse');
  assert.equal(r.jobId, '1234567');
  assert.equal(r.board, 'acme');
});

test('parseApplyUrl: Lever UUID', () => {
  const r = parseApplyUrl('https://jobs.lever.co/acme/abcd1234-5678-90ab-cdef-123456789abc');
  assert.equal(r.portal, 'lever');
  assert.equal(r.jobId, 'abcd1234-5678-90ab-cdef-123456789abc');
  assert.equal(r.board, 'acme');
});

test('parseApplyUrl: Ashby UUID', () => {
  const r = parseApplyUrl('https://jobs.ashbyhq.com/rescale/2f43e26a-a331-4648-8523-d83c258bd8a2');
  assert.equal(r.portal, 'ashby');
  assert.equal(r.jobId, '2f43e26a-a331-4648-8523-d83c258bd8a2');
  assert.equal(r.board, 'rescale');
});

test('parseApplyUrl: Workday', () => {
  const r = parseApplyUrl('https://acme.myworkdayjobs.com/en-US/Acme_Careers/job/ABC-123');
  assert.equal(r.portal, 'workday');
  assert.equal(r.jobId, 'ABC-123');
  assert.equal(r.board, 'acme');
});

test('parseApplyUrl: iCIMS', () => {
  const r = parseApplyUrl('https://careers-acme.icims.com/jobs/12345/senior-role/job');
  assert.equal(r.portal, 'icims');
  assert.equal(r.jobId, '12345');
});

test('parseApplyUrl: LinkedIn proxy', () => {
  const r = parseApplyUrl('https://www.linkedin.com/jobs/view/123456789');
  assert.equal(r.portal, 'linkedin-proxy');
  assert.equal(r.jobId, null);
});

test('parseApplyUrl: BuiltIn proxy', () => {
  const r = parseApplyUrl('https://builtin.com/job/lead-data-architect/8475662');
  assert.equal(r.portal, 'builtin-proxy');
});

test('parseApplyUrl: mailto email', () => {
  const r = parseApplyUrl('mailto:careers@govdocs.com');
  assert.equal(r.portal, 'email');
});

test('parseApplyUrl: bare email embedded in apply-prose', () => {
  const r = parseApplyUrl('careers@govdocs.com (email resume + salary requirements + cover letter)');
  assert.equal(r.portal, 'email');
  assert.equal(r.email, 'careers@govdocs.com');
});

test('parseApplyUrl: page with contact email does NOT misclassify as email', () => {
  const r = parseApplyUrl('https://acme.com/careers?contact=hr@acme.com');
  assert.equal(r.portal, 'universal', 'presence of @ plus http:// must not trigger email portal');
});

test('parseApplyUrl: unknown company domain', () => {
  const r = parseApplyUrl('https://acme.com/careers/123');
  assert.equal(r.portal, 'universal');
});

test('parseApplyUrl: empty/null', () => {
  assert.equal(parseApplyUrl('').portal, null);
  assert.equal(parseApplyUrl(null).portal, null);
  assert.equal(parseApplyUrl(undefined).portal, null);
});
