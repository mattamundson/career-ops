import test from 'node:test';
import assert from 'node:assert/strict';

import { indeedKeyFromUrl } from '../scripts/lib/indeed-jk.mjs';
import { jobKeysFromUrl, primaryLineKey } from '../scripts/lib/job-url-keys.mjs';

test('jobKeysFromUrl extracts gh_jid and normalized url', () => {
  const u = 'https://boards.greenhouse.io/figma/jobs/5840332004?gh_jid=5840332004';
  const keys = jobKeysFromUrl(u);
  assert.ok(keys.has('jid:5840332004'));
  assert.ok([...keys].some((k) => k.startsWith('url:')));
});

test('jobKeysFromUrl extracts LinkedIn view id', () => {
  const keys = jobKeysFromUrl('https://www.linkedin.com/jobs/view/4385530845');
  assert.ok(keys.has('li:4385530845'));
});

test('jobKeysFromUrl extracts Lever UUID', () => {
  const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const keys = jobKeysFromUrl(`https://jobs.lever.co/acme/${id}`);
  assert.ok(keys.has(`lever:${id}`));
});

test('indeedKeyFromUrl is stable across query variants', () => {
  const jk = 'ffa724aa3602f6ed';
  const a = indeedKeyFromUrl(`https://www.indeed.com/viewjob?jk=${jk}`);
  const b = indeedKeyFromUrl(
    `https://www.indeed.com/viewjob?from=serp&vjk=${jk}&jk=${jk}`,
  );
  const c = indeedKeyFromUrl(`https://m.indeed.com/viewjob?jk=${jk}`);
  assert.equal(a, `indeed:${jk}`);
  assert.equal(b, `indeed:${jk}`);
  assert.equal(c, `indeed:${jk}`);
});

test('jobKeysFromUrl includes Indeed jk key', () => {
  const keys = jobKeysFromUrl('https://www.indeed.com/viewjob?jk=ffa724aa3602f6ed');
  assert.ok(keys.has('indeed:ffa724aa3602f6ed'));
  assert.ok([...keys].some((k) => k.startsWith('url:')));
});

test('primaryLineKey prefers jid over url', () => {
  const k = primaryLineKey(
    'https://boards.greenhouse.io/figma/jobs/5840332004?gh_jid=5840332004',
  );
  assert.equal(k, 'jid:5840332004');
});
