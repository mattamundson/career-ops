import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyWorkArrangement,
  computeApplicationPriority,
  focusSortKey,
  scoreMessageAgainstApplication,
  scoreTitleAgainstFilter,
  selectBestApplicationMatch,
} from '../scripts/lib/scoring-core.mjs';

test('scoreTitleAgainstFilter matches strong positive phrases', () => {
  const result = scoreTitleAgainstFilter('Senior Power BI Architect', {
    positive: ['power bi architect', 'data architect'],
    negative: ['marketing analyst'],
    seniority_boost: { senior: 1.3 },
  });

  assert.equal(result.match, true);
  assert.ok(result.fitTitle >= 40);
  assert.ok(result.matchedPhrases.includes('power bi architect'));
});

test('scoreTitleAgainstFilter rejects negative matches', () => {
  const result = scoreTitleAgainstFilter('Senior Marketing Analyst', {
    positive: ['analytics engineer'],
    negative: ['marketing analyst'],
  });

  assert.equal(result.match, false);
  assert.equal(result.reason, 'negative_match');
});

test('scoreTitleAgainstFilter dampens token-only overlap without phrase hit', () => {
  const result = scoreTitleAgainstFilter('foo1 bar1 only', {
    positive: ['foo1 foo2 foo3', 'bar1 bar2'],
    negative: [],
  });
  assert.equal(result.match, true);
  assert.ok(result.fitTitle < 55, `expected dampened fitTitle, got ${result.fitTitle}`);
});

test('computeApplicationPriority favors fresh, high-score applications', () => {
  const high = computeApplicationPriority({
    score: '4.8/5',
    status: 'Evaluating',
    date: new Date().toISOString().slice(0, 10),
    reportPath: 'reports/001-test.md',
  });
  const low = computeApplicationPriority({
    score: '3.0/5',
    status: 'Applied',
    date: '2026-01-01',
  });

  assert.ok(high.priorityScore > low.priorityScore);
});

test('classifyWorkArrangement treats optional hybrid JD as onsite_hybrid', () => {
  assert.equal(
    classifyWorkArrangement({
      reportRemote: 'VERIFIED REMOTE — fully remote with optional hybrid near Salem OR',
    }),
    'onsite_hybrid',
  );
});

test('computeApplicationPriority boosts hybrid vs remote at same score', () => {
  const base = {
    score: '4.2/5',
    status: 'Evaluated',
    date: new Date().toISOString().slice(0, 10),
    reportPath: 'reports/x.md',
  };
  const remoteP = computeApplicationPriority({
    ...base,
    role: 'Engineer — Remote US',
    reportRemote: 'Fully remote',
  });
  const hybridP = computeApplicationPriority({
    ...base,
    role: 'Engineer — Minneapolis hybrid',
    reportRemote: 'Hybrid 2 days in office',
  });
  assert.ok(hybridP.priorityScore > remoteP.priorityScore);
  assert.equal(hybridP.workArrangement, 'onsite_hybrid');
  assert.equal(remoteP.workArrangement, 'remote');
});

test('focusSortKey keeps very high remote above mid hybrid', () => {
  const r = focusSortKey(5.0, { role: 'Remote', reportRemote: 'fully remote' });
  const h = focusSortKey(4.0, { role: 'Hybrid', reportRemote: 'hybrid minneapolis' });
  assert.ok(r > h);
});

test('selectBestApplicationMatch requires a clear winner', () => {
  const applications = [
    { id: '001', company: 'Anthropic', role: 'Applied AI Engineer', date: '2026-04-10' },
    { id: '002', company: 'Databricks', role: 'Solutions Architect', date: '2026-04-10' },
  ];
  const message = {
    subject: 'Anthropic interview update',
    from: 'Anthropic Recruiting <jobs@anthropic.com>',
    snippet: 'Applied AI Engineer next steps',
    bodyText: 'We would like to move you to the next stage for Applied AI Engineer.',
    internalDate: `${Date.now()}`,
  };

  const result = selectBestApplicationMatch(applications, message);
  assert.equal(result.match?.id, '001');
  assert.ok(result.confidence > 0.5);
});

test('selectBestApplicationMatch suppresses ambiguous matches', () => {
  const applications = [
    { id: '001', company: 'DataCorp', role: 'Solutions Architect', date: '2026-04-10' },
    { id: '002', company: 'DataCorp', role: 'Senior Solutions Architect', date: '2026-04-10' },
  ];
  const message = {
    subject: 'DataCorp interview update',
    from: 'DataCorp Recruiting <jobs@datacorp.com>',
    snippet: 'We would like to schedule a conversation about the Solutions Architect role.',
    bodyText: '',
    internalDate: `${Date.now()}`,
  };

  const result = selectBestApplicationMatch(applications, message);
  assert.equal(result.match, null);
  assert.ok(result.ranked.length >= 2);
});

test('scoreMessageAgainstApplication records evidence for company and role tokens', () => {
  const result = scoreMessageAgainstApplication(
    {
      company: 'Agility Robotics',
      role: 'Manager, Business Intelligence',
      date: '2026-04-10',
    },
    {
      subject: 'Agility Robotics recruiter follow-up',
      from: 'talent@agilityrobotics.com',
      snippet: 'Business Intelligence interview availability',
      bodyText: '',
      internalDate: `${Date.now()}`,
    }
  );

  assert.ok(result.score >= 30);
  assert.ok(result.evidence.some((item) => item.startsWith('company:')));
  assert.ok(result.evidence.some((item) => item.startsWith('role_token:business')));
});
