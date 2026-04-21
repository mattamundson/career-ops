import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickPeopleSearchTool,
  renderWarmIntrosSection,
  upsertWarmIntrosSection,
  normalizeIntros,
} from '../scripts/linkedin-warm-intros.mjs';

test('pickPeopleSearchTool: returns null for empty tool list', () => {
  assert.equal(pickPeopleSearchTool(null), null);
  assert.equal(pickPeopleSearchTool({ tools: [] }), null);
});

test('pickPeopleSearchTool: prioritizes specific network-search tools', () => {
  const tools = {
    tools: [
      { name: 'search_jobs' },
      { name: 'get_person_profile' },
      { name: 'search_people_in_network' },
      { name: 'find_people' },
    ],
  };
  assert.equal(pickPeopleSearchTool(tools), 'search_people_in_network');
});

test('pickPeopleSearchTool: falls back to generic people search', () => {
  const tools = {
    tools: [
      { name: 'search_jobs' },
      { name: 'search_people' },
      { name: 'get_conversation' },
    ],
  };
  assert.equal(pickPeopleSearchTool(tools), 'search_people');
});

test('pickPeopleSearchTool: no match returns null', () => {
  const tools = { tools: [{ name: 'search_jobs' }, { name: 'send_message' }] };
  assert.equal(pickPeopleSearchTool(tools), null);
});

test('renderWarmIntrosSection: empty intros renders "no matches" with manual fallback', () => {
  const out = renderWarmIntrosSection([], { company: 'Acme' });
  assert.match(out, /## Warm intros/);
  assert.match(out, /No 1st\/2nd-degree.*Acme/);
  assert.match(out, /LinkedIn → Search/);
});

test('renderWarmIntrosSection: MCP-unavailable note has manual fallback', () => {
  const out = renderWarmIntrosSection(null, {
    company: 'Acme',
    note: 'LinkedIn MCP unavailable: auth expired',
  });
  assert.match(out, /## Warm intros/);
  assert.match(out, /LinkedIn MCP unavailable: auth expired/);
  assert.match(out, /Manual fallback.*\/contact/);
});

test('renderWarmIntrosSection: populated intros render table', () => {
  const intros = [
    { name: 'Jane Doe', title: 'Director, Data', degree: '2nd', url: 'https://linkedin.com/in/jane' },
    { name: 'John Smith', title: 'VP Eng', degree: '1st', url: 'https://linkedin.com/in/john' },
  ];
  const out = renderWarmIntrosSection(intros, { company: 'Acme', source: 'linkedin-mcp via search_people' });
  assert.match(out, /Source: linkedin-mcp via search_people/);
  assert.match(out, /Matches: 2/);
  assert.match(out, /\| Jane Doe \| Director, Data \| 2nd \|/);
  assert.match(out, /\/contact.*referral or hiring-manager/);
});

test('upsertWarmIntrosSection: inserts new section before trailing Inspired-by fence', () => {
  const report = `# Report\n\nBody text.\n\n---\nInspired by upstream.\n`;
  const section = '## Warm intros\n\nFake section\n';
  const out = upsertWarmIntrosSection(report, section);
  assert.match(out, /Body text\.\s+## Warm intros/);
  assert.match(out, /---\nInspired by upstream\./);
  assert.ok(out.indexOf('## Warm intros') < out.indexOf('Inspired by'),
    'warm intros section must precede the trailing fence');
});

test('upsertWarmIntrosSection: replaces existing section, stays idempotent', () => {
  const report = `# Report\n\n## Warm intros\n\nOld content\n\n## Next\n\nOther\n`;
  const section = '## Warm intros\n\nNew content\n\n';
  const out = upsertWarmIntrosSection(report, section);
  assert.match(out, /New content/);
  assert.doesNotMatch(out, /Old content/);
  assert.match(out, /## Next\n\nOther/, 'trailing sections preserved');
});

test('upsertWarmIntrosSection: appends to end when no fence exists', () => {
  const report = `# Report\n\nBody text.`;
  const section = '## Warm intros\n\nFake section\n';
  const out = upsertWarmIntrosSection(report, section);
  assert.match(out, /Body text\.\s+## Warm intros/);
});

test('normalizeIntros: handles bare array', () => {
  const raw = [
    { name: 'A', title: 'X', degree: '1st', url: 'u1' },
    { name: 'B', title: 'Y', degree: '2nd', url: 'u2' },
  ];
  const out = normalizeIntros(raw, { max: 5 });
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'A');
});

test('normalizeIntros: handles MCP-style { content: [{ text: JSON }] }', () => {
  const raw = {
    content: [{ type: 'text', text: JSON.stringify([
      { full_name: 'Alice', headline: 'CEO', connection_degree: '1st', profile_url: 'u1' },
    ]) }],
  };
  const out = normalizeIntros(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Alice');
  assert.equal(out[0].title, 'CEO');
  assert.equal(out[0].degree, '1st');
  assert.equal(out[0].url, 'u1');
});

test('normalizeIntros: handles { people: [...] } shape', () => {
  const raw = { people: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
  const out = normalizeIntros(raw, { max: 2 });
  assert.equal(out.length, 2);
});

test('normalizeIntros: handles { results: [...] } shape', () => {
  const raw = { results: [{ name: 'X' }] };
  const out = normalizeIntros(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'X');
});

test('normalizeIntros: null/non-array → empty list', () => {
  assert.deepEqual(normalizeIntros(null), []);
  assert.deepEqual(normalizeIntros({ other: 'shape' }), []);
});

test('normalizeIntros: respects max cap', () => {
  const raw = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}` }));
  const out = normalizeIntros(raw, { max: 3 });
  assert.equal(out.length, 3);
});
