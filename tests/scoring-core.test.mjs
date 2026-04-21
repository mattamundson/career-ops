import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyWorkArrangement,
  computeApplicationPriority,
  focusSortKey,
  scoreMessageAgainstApplication,
  scoreTitleAgainstFilter,
  selectBestApplicationMatch,
  urgencyMultiplier,
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

test('classifyWorkArrangement treats non-MSP fully-remote-with-hybrid as remote', () => {
  // Salem OR is non-MSP, so "optional hybrid near Salem" doesn't help a MN-based candidate.
  // Strong-remote keyword wins, classified as remote.
  assert.equal(
    classifyWorkArrangement({
      reportRemote: 'VERIFIED REMOTE — fully remote with optional hybrid near Salem OR',
    }),
    'remote',
  );
});

test('classifyWorkArrangement buckets MSP on-site vs MSP hybrid vs remote', () => {
  assert.equal(
    classifyWorkArrangement({ reportRemote: 'Minneapolis MN — on-site' }),
    'onsite_msp',
  );
  assert.equal(
    classifyWorkArrangement({ reportRemote: 'Minneapolis MN — hybrid 3 days/week' }),
    'hybrid_msp',
  );
  assert.equal(
    classifyWorkArrangement({ reportRemote: 'Fully remote US' }),
    'remote',
  );
  // Non-MSP on-site is unusable for Matt → unknown (no boost, mild penalty)
  assert.equal(
    classifyWorkArrangement({ role: 'Engineer — Austin TX on-site' }),
    'unknown',
  );
});

test('computeApplicationPriority ranks on-site MSP > hybrid MSP > remote at same score', () => {
  const base = {
    score: '4.2/5',
    status: 'Evaluated',
    date: new Date().toISOString().slice(0, 10),
    reportPath: 'reports/x.md',
  };
  const onsiteMsp = computeApplicationPriority({
    ...base,
    role: 'Engineer — Minneapolis on-site',
    reportRemote: 'Minneapolis MN — in-office',
  });
  const hybridMsp = computeApplicationPriority({
    ...base,
    role: 'Engineer — Minneapolis hybrid',
    reportRemote: 'Hybrid 2 days in office (Minneapolis)',
  });
  const remoteP = computeApplicationPriority({
    ...base,
    role: 'Engineer — Remote US',
    reportRemote: 'Fully remote',
  });
  assert.ok(onsiteMsp.priorityScore > hybridMsp.priorityScore,
    `onsite_msp (${onsiteMsp.priorityScore}) should beat hybrid_msp (${hybridMsp.priorityScore})`);
  assert.ok(hybridMsp.priorityScore > remoteP.priorityScore,
    `hybrid_msp (${hybridMsp.priorityScore}) should beat remote (${remoteP.priorityScore})`);
  assert.equal(onsiteMsp.workArrangement, 'onsite_msp');
  assert.equal(hybridMsp.workArrangement, 'hybrid_msp');
  assert.equal(remoteP.workArrangement, 'remote');
});

test('focusSortKey keeps very high remote above mid hybrid_msp', () => {
  // A 5.0 remote (5.0 * 0.85 = 4.25) still beats a 3.5 hybrid_msp (3.5 * 1.10 = 3.85).
  const r = focusSortKey(5.0, { role: 'Remote', reportRemote: 'fully remote' });
  const h = focusSortKey(3.5, { role: 'Hybrid', reportRemote: 'hybrid minneapolis' });
  assert.ok(r > h);
});

test('deriveLocationPriority: default order maps on_site→1.20, hybrid→1.10, remote→0.85', async () => {
  const { deriveLocationPriority } = await import('../scripts/lib/scoring-core.mjs');
  const p = deriveLocationPriority(['on_site', 'hybrid', 'remote']);
  assert.equal(p.onsiteMspMultiplier, 1.20);
  assert.equal(p.hybridMspMultiplier, 1.10);
  assert.equal(p.remoteMultiplier, 0.85);
  assert.equal(p.unknownMultiplier, 0.95);
});

test('deriveLocationPriority: flipping work_modes flips priority', async () => {
  const { deriveLocationPriority } = await import('../scripts/lib/scoring-core.mjs');
  const flipped = deriveLocationPriority(['remote', 'hybrid', 'on_site']);
  assert.equal(flipped.remoteMultiplier, 1.20);   // was 0.85
  assert.equal(flipped.onsiteMspMultiplier, 0.85); // was 1.20
  assert.equal(flipped.hybridMspMultiplier, 1.10); // unchanged in middle
});

test('focusSortKey honors config override — flipped work_modes reverses order', async () => {
  const { focusSortKey, deriveLocationPriority } = await import('../scripts/lib/scoring-core.mjs');
  const config = deriveLocationPriority(['remote', 'hybrid', 'on_site']);
  // Same score, different arrangements. Default → onsite wins; flipped → remote wins.
  const onsite = focusSortKey(4.0, { role: 'On-site', reportRemote: 'on-site minneapolis' }, config);
  const remote = focusSortKey(4.0, { role: 'Remote', reportRemote: 'fully remote' }, config);
  assert.ok(remote > onsite, `expected remote(${remote}) > onsite(${onsite}) with flipped config`);
});

test('computeApplicationPriority honors config override — flipped work_modes reverses priority', async () => {
  const { computeApplicationPriority, deriveLocationPriority } = await import('../scripts/lib/scoring-core.mjs');
  const flipped = deriveLocationPriority(['remote', 'hybrid', 'on_site']);
  const base = {
    score: '4.2/5',
    status: 'Evaluated',
    date: new Date().toISOString().slice(0, 10),
    reportPath: 'reports/x.md',
  };
  const onsiteMspFlipped = computeApplicationPriority({
    ...base,
    role: 'Engineer — Minneapolis on-site',
    reportRemote: 'Minneapolis MN — in-office',
  }, flipped);
  const remoteFlipped = computeApplicationPriority({
    ...base,
    role: 'Engineer — Remote US',
    reportRemote: 'Fully remote',
  }, flipped);
  // With flipped config, remote should now beat onsite_msp.
  assert.ok(remoteFlipped.priorityScore > onsiteMspFlipped.priorityScore,
    `expected remote(${remoteFlipped.priorityScore}) > onsite_msp(${onsiteMspFlipped.priorityScore}) with flipped config`);
});

test('loadLocationConfig loads on_site priority from profile.yml and produces live config', async () => {
  const { loadLocationConfig } = await import('../scripts/lib/profile-location-config.mjs');
  const config = loadLocationConfig();
  // profile.yml currently has work_modes: [on_site, hybrid, remote]
  assert.ok(Array.isArray(config.workModes) && config.workModes.length === 3,
    `expected 3-element workModes array, got ${JSON.stringify(config.workModes)}`);
  // onsite should be top priority (1.20) unless profile.yml has been flipped
  if (config.workModes[0] === 'on_site') {
    assert.equal(config.onsiteMspMultiplier, 1.20);
    assert.equal(config.remoteMultiplier, 0.85);
  }
  assert.equal(config.unknownMultiplier, 0.95);
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

test('urgencyMultiplier: neutral when closeDate is absent or malformed', () => {
  assert.equal(urgencyMultiplier(undefined), 1.0);
  assert.equal(urgencyMultiplier(null), 1.0);
  assert.equal(urgencyMultiplier(''), 1.0);
  assert.equal(urgencyMultiplier('not-a-date'), 1.0);
});

test('urgencyMultiplier: bands map to 1.25 / 1.10 / 1.0 / 0.5', () => {
  const now = new Date('2026-04-17T12:00:00Z');
  const dayOffset = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  assert.equal(urgencyMultiplier(dayOffset(1), now), 1.25, '1 day out → high urgency');
  assert.equal(urgencyMultiplier(dayOffset(2), now), 1.25, '2 days out → high urgency');
  assert.equal(urgencyMultiplier(dayOffset(3), now), 1.1, '3 days out → moderate urgency');
  assert.equal(urgencyMultiplier(dayOffset(7), now), 1.1, '7 days out → moderate urgency');
  assert.equal(urgencyMultiplier(dayOffset(14), now), 1.0, '14 days out → neutral');
  assert.equal(urgencyMultiplier(dayOffset(-1), now), 0.5, 'past close → heavy deprioritize');
});

test('computeApplicationPriority applies outcomeSignal multiplier when passed', () => {
  const base = {
    score: '4.0/5',
    status: 'Evaluating',
    date: new Date().toISOString().slice(0, 10),
    reportPath: 'reports/999-test.md',
    remote: 'remote',
  };
  const neutral = computeApplicationPriority(base);
  const upweighted = computeApplicationPriority({ ...base, outcomeSignal: 1.15 });
  const downweighted = computeApplicationPriority({ ...base, outcomeSignal: 0.85 });
  assert.equal(neutral.outcomeSignalMultiplier, 1.0);
  assert.equal(upweighted.outcomeSignalMultiplier, 1.15);
  assert.equal(downweighted.outcomeSignalMultiplier, 0.85);
  assert.ok(upweighted.priorityScore > neutral.priorityScore,
    `upweighted should outrank neutral (${upweighted.priorityScore} vs ${neutral.priorityScore})`);
  assert.ok(downweighted.priorityScore < neutral.priorityScore,
    `downweighted should rank below neutral (${downweighted.priorityScore} vs ${neutral.priorityScore})`);
});

test('computeApplicationPriority applies urgency multiplier when closeDate present', () => {
  const base = {
    score: '4.0/5',
    status: 'Evaluating',
    date: new Date().toISOString().slice(0, 10),
    reportPath: 'reports/001-test.md',
    remote: 'remote',
  };
  const neutral = computeApplicationPriority(base);
  const urgentCloseIn2Days = computeApplicationPriority({
    ...base,
    closeDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const closed = computeApplicationPriority({
    ...base,
    closeDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  });

  assert.equal(neutral.urgencyMultiplier, 1.0);
  assert.equal(urgentCloseIn2Days.urgencyMultiplier, 1.25);
  assert.equal(closed.urgencyMultiplier, 0.5);
  assert.ok(urgentCloseIn2Days.priorityScore > neutral.priorityScore,
    `urgent should outrank neutral (${urgentCloseIn2Days.priorityScore} vs ${neutral.priorityScore})`);
  assert.ok(closed.priorityScore < neutral.priorityScore,
    `closed should rank below neutral (${closed.priorityScore} vs ${neutral.priorityScore})`);
});
