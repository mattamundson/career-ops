// tests/cover-letter-lint.test.mjs
// Coverage for scripts/lib/cover-letter-lint.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { lintCoverLetter } from '../scripts/lib/cover-letter-lint.mjs';

const CLEAN_LETTER = `The Senior BI Architect role at Acme aligns with my work owning end-to-end Power BI architecture for high-stakes environments over the last ten years. I led the BI rollout for Pretium's $25B portfolio analytics, and built the full BI stack at Greenfield Metal Sales from ERP integration through to executive dashboards used by the COO every morning.

In my prior roles, I implemented Power BI across five companies in regulated and consumer-facing industries. At UltiMed I drove a 35% increase in dashboard adoption through performance tuning and semantic model design. At GMS I designed the entire BI strategy and integrated three ERP sources into a unified Power BI semantic layer that the finance team now treats as the single source of truth.

My Snowflake exposure is shallower than my Azure SQL background, where I have ten years of production work. To close that gap I am working through the SnowPro Core practice exams and have built a small staging pipeline against Snowflake's free tier so the syntax and feature set are familiar before day one. I would be happy to walk through both the existing work and the Snowflake plan in a 20-minute call this week.`;

test('clean letter scores 1.00 with no issues', () => {
  const result = lintCoverLetter(CLEAN_LETTER);
  assert.equal(result.errors.length, 0, `unexpected errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.warnings.length, 0, `unexpected warnings: ${JSON.stringify(result.warnings)}`);
  assert.equal(result.score, 1.0);
});

test('em-dash triggers warning (non-strict)', () => {
  const text = CLEAN_LETTER.replace('shallower than', 'shallower — than');
  const result = lintCoverLetter(text);
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((w) => /em-dash/.test(w)), 'expected em-dash warning');
});

test('em-dash triggers error in strict mode', () => {
  const text = CLEAN_LETTER.replace('shallower than', 'shallower — than');
  const result = lintCoverLetter(text, { strict: true });
  assert.ok(result.errors.some((e) => /em-dash/.test(e)), 'expected em-dash error in strict');
});

test('buzzword triggers error', () => {
  const text = CLEAN_LETTER + '\n\nI am a passionate, results-driven leader.';
  const result = lintCoverLetter(text);
  assert.ok(result.errors.some((e) => /passionate/i.test(e)), 'expected passionate error');
  assert.ok(result.errors.some((e) => /results-driven/i.test(e)), 'expected results-driven error');
});

test('"Paradigm" caught (the recurring escape word)', () => {
  const text = 'A new paradigm in data architecture awaits.\n\n' + CLEAN_LETTER;
  const result = lintCoverLetter(text);
  assert.ok(result.errors.some((e) => /paradigm/i.test(e)), 'expected paradigm error');
});

test('generic opener triggers error', () => {
  const text = 'I am writing to apply for the Senior BI Architect role.\n\n' + CLEAN_LETTER;
  const result = lintCoverLetter(text);
  assert.ok(result.errors.some((e) => /generic opener/i.test(e)), 'expected generic-opener error');
});

test('two-paragraph letter warns about paragraph count', () => {
  const text = `Para one with $25B at Pretium and ten years of BI work in production.

Para two acknowledging the Snowflake gap and a 20-minute call CTA.`;
  const result = lintCoverLetter(text);
  assert.ok(result.warnings.some((w) => /paragraph/i.test(w)), 'expected paragraph warning');
});

test('letter without numbers warns about proof points', () => {
  const text = `The role aligns with my background in BI architecture for stakeholder-facing analytics.

In prior roles I implemented Power BI across enterprise environments and led full-stack BI strategy.

My experience with the cloud warehouse in question is limited but I am closing that gap. Happy to discuss in a brief call.`;
  const result = lintCoverLetter(text);
  assert.ok(result.warnings.some((w) => /numbers|proof points/i.test(w)), 'expected proof-points warning');
});

test('short letter warns about word count', () => {
  const text = 'Para one says hello very briefly.\n\nPara two says short.\n\nPara three closes.';
  const result = lintCoverLetter(text);
  assert.ok(result.warnings.some((w) => /words/i.test(w)), 'expected word-count warning');
});

test('empty input returns error', () => {
  const result = lintCoverLetter('');
  assert.ok(result.errors.includes('empty cover letter'));
  assert.equal(result.score, 0);
});

test('score decreases proportionally with errors and warnings', () => {
  const oneBuzz = lintCoverLetter(CLEAN_LETTER + '\n\nA passionate sentence.');
  const twoBuzz = lintCoverLetter(CLEAN_LETTER + '\n\nA passionate, synergy-driven sentence.');
  assert.ok(oneBuzz.score > twoBuzz.score, `expected ${oneBuzz.score} > ${twoBuzz.score}`);
});
