import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAutoScoreResponse } from '../scripts/prefilter-pipeline.mjs';

test('parseAutoScoreResponse: well-formed EVALUATE response', () => {
  const text = `{"score": 4.0, "archetype": "Operational Data Architect", "matches": ["ERP exp", "Power BI", "Fabric"], "gaps": ["No Snowflake", "No dbt", "No Airflow"], "recommendation": "EVALUATE"}`;
  const r = parseAutoScoreResponse(text);
  assert.equal(r.ok, true);
  assert.equal(r.score, 4.0);
  assert.equal(r.recommendation, 'EVALUATE');
  assert.equal(r.archetype, 'Operational Data Architect');
  assert.deepEqual(r.matches, ['ERP exp', 'Power BI', 'Fabric']);
  assert.equal(r.gaps.length, 3);
});

test('parseAutoScoreResponse: JSON inside prose still extracts', () => {
  const text = `Here is the scoring:\n\n{"score": 3.5, "archetype": "BI & Analytics Lead", "matches": ["a","b","c"], "gaps": ["x","y","z"], "recommendation": "EVALUATE"}\n\nThat's my take.`;
  const r = parseAutoScoreResponse(text);
  assert.equal(r.ok, true);
  assert.equal(r.score, 3.5);
});

test('parseAutoScoreResponse: UNCLEAR stays ok (runner handles)', () => {
  const text = `{"score": 2.8, "archetype": "unknown", "matches": ["?","?","?"], "gaps": ["?","?","?"], "recommendation": "UNCLEAR"}`;
  const r = parseAutoScoreResponse(text);
  assert.equal(r.ok, true);
  assert.equal(r.recommendation, 'UNCLEAR');
});

test('parseAutoScoreResponse: SKIP preserved', () => {
  const text = `{"score": 1.5, "archetype": "BI & Analytics Lead", "matches": ["a","b","c"], "gaps": ["x","y","z"], "recommendation": "SKIP"}`;
  const r = parseAutoScoreResponse(text);
  assert.equal(r.ok, true);
  assert.equal(r.recommendation, 'SKIP');
});

test('parseAutoScoreResponse: empty input fails cleanly', () => {
  const r = parseAutoScoreResponse('');
  assert.equal(r.ok, false);
  assert.match(r.reason, /empty/);
});

test('parseAutoScoreResponse: no JSON fails cleanly', () => {
  const r = parseAutoScoreResponse('sorry I cannot score this');
  assert.equal(r.ok, false);
  assert.match(r.reason, /no JSON/);
});

test('parseAutoScoreResponse: malformed JSON fails cleanly', () => {
  const r = parseAutoScoreResponse('{score: 4, not valid json');
  assert.equal(r.ok, false);
});

test('parseAutoScoreResponse: score out of range rejected', () => {
  const r = parseAutoScoreResponse(`{"score": 7, "archetype": "x", "matches": ["a","b","c"], "gaps": ["x","y","z"], "recommendation": "EVALUATE"}`);
  assert.equal(r.ok, false);
  assert.match(r.reason, /bad score/);
});

test('parseAutoScoreResponse: bad recommendation rejected', () => {
  const r = parseAutoScoreResponse(`{"score": 3.0, "archetype": "x", "matches": ["a","b","c"], "gaps": ["x","y","z"], "recommendation": "HIRE"}`);
  assert.equal(r.ok, false);
  assert.match(r.reason, /bad recommendation/);
});

test('parseAutoScoreResponse: truncates matches/gaps to 3', () => {
  const r = parseAutoScoreResponse(`{"score": 4.0, "archetype": "x", "matches": ["a","b","c","d","e"], "gaps": ["1","2","3","4"], "recommendation": "EVALUATE"}`);
  assert.equal(r.ok, true);
  assert.equal(r.matches.length, 3);
  assert.equal(r.gaps.length, 3);
});
