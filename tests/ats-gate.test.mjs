// tests/ats-gate.test.mjs
// Coverage for scripts/ats-gate.mjs (pure-function contract)
// CLI integration is exercised separately via the gate script in practice.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseGateArgs, evaluateGate } from '../scripts/ats-gate.mjs';
import { scoreAtsMatch, buildStructuralExcludeSet } from '../scripts/ats-score.mjs';
import { parsePreflightArgs } from '../scripts/ats-preflight.mjs';

test('parseGateArgs: defaults', () => {
  const a = parseGateArgs(['--jd=jds/x.txt']);
  assert.equal(a.jd, 'jds/x.txt');
  assert.equal(a.cv, 'cv.md');
  assert.equal(a.threshold, 60);
  assert.equal(a.force, false);
  assert.equal(a.json, false);
});

test('parseGateArgs: override threshold + force', () => {
  const a = parseGateArgs(['--jd=jds/x.txt', '--threshold=75', '--force']);
  assert.equal(a.threshold, 75);
  assert.equal(a.force, true);
});

test('parseGateArgs: company + role pass-through', () => {
  const a = parseGateArgs(['--jd=a', '--company=Acme Corp', '--role=Data Architect']);
  assert.equal(a.company, 'Acme Corp');
  assert.equal(a.role, 'Data Architect');
});

test('parseGateArgs: score-file captured', () => {
  const a = parseGateArgs(['--score-file=output/ats-score-acme.json', '--threshold=55']);
  assert.equal(a.scoreFile, 'output/ats-score-acme.json');
  assert.equal(a.threshold, 55);
});

test('parseGateArgs: score-file absent → null', () => {
  const a = parseGateArgs(['--jd=jds/x.txt']);
  assert.equal(a.scoreFile, null);
});

test('parsePreflightArgs: core flags + gate passthrough', () => {
  const p = parsePreflightArgs([
    '--jd=jds/x.txt',
    '--write-json=output/ats-score-x.json',
    '--cv=cv.md',
    '--threshold=70',
    '--json',
  ]);
  assert.equal(p.jd, 'jds/x.txt');
  assert.equal(p.writeJson, 'output/ats-score-x.json');
  assert.equal(p.cv, 'cv.md');
  assert.deepEqual(p.gateRest, ['--threshold=70', '--json']);
});

test('parsePreflightArgs: --exclude-structural routes to scoreExtra only', () => {
  const p = parsePreflightArgs([
    '--jd=jds/x.txt',
    '--write-json=output/score.json',
    '--exclude-structural',
    '--threshold=70',
  ]);
  assert.ok(p.scoreExtra.includes('--exclude-structural'));
  assert.ok(!p.gateRest.includes('--exclude-structural'));
  assert.ok(p.gateRest.includes('--threshold=70'));
});

test('parsePreflightArgs: --company + --location route to BOTH score and gate', () => {
  const p = parsePreflightArgs([
    '--jd=jds/x.txt',
    '--write-json=output/score.json',
    '--company=Pivot Bio',
    '--location=Minneapolis, MN',
  ]);
  assert.ok(p.scoreExtra.includes('--company=Pivot Bio'));
  assert.ok(p.scoreExtra.includes('--location=Minneapolis, MN'));
  assert.ok(p.gateRest.includes('--company=Pivot Bio'));
  assert.ok(p.gateRest.includes('--location=Minneapolis, MN'));
});

test('buildStructuralExcludeSet: strips company + location tokens', () => {
  const set = buildStructuralExcludeSet({
    company: 'Pivot Bio',
    location: 'St. Louis, MO',
  });
  assert.ok(set.has('pivot'));
  assert.ok(set.has('bio'));
  assert.ok(set.has('louis'));
  // Built-in blocklist tokens
  assert.ok(set.has('minneapolis'));
  assert.ok(set.has('inc'));
});

test('scoreAtsMatch: exclude set removes company + city from keywords', () => {
  const jd = `
## About Pivot Bio
Pivot Bio is based in St. Louis. We seek a data architect with
Snowflake, Python, and SQL experience at Pivot Bio. Pivot Bio uses
modern data platforms.

## Requirements
- Python, SQL, Snowflake, dbt
- Data architecture patterns
`;
  const cv = 'Snowflake Python SQL dbt data architecture';
  const without = scoreAtsMatch(jd, cv);
  const exclude = buildStructuralExcludeSet({ company: 'Pivot Bio', location: 'St. Louis, MO' });
  const withExclude = scoreAtsMatch(jd, cv, { exclude });
  // "pivot" and "bio" should appear in unmodified keywords but not in excluded
  const keywordsRaw = without.keywords.join(' ');
  const keywordsFiltered = withExclude.keywords.join(' ');
  assert.ok(keywordsRaw.includes('pivot') || keywordsRaw.includes('bio'),
    `expected raw keywords to include company tokens, got: ${keywordsRaw}`);
  assert.ok(!/\bpivot\b/.test(keywordsFiltered),
    `expected filtered keywords to NOT include 'pivot', got: ${keywordsFiltered}`);
  assert.ok(!/\bbio\b/.test(keywordsFiltered),
    `expected filtered keywords to NOT include 'bio', got: ${keywordsFiltered}`);
});

test('scoreAtsMatch: strong overlap → high pct', () => {
  const jd = `
## Requirements

- Deep experience with Snowflake, dbt, and Airflow.
- Python expertise for data pipeline development.
- Familiarity with Power BI semantic modeling and DAX.
`;
  const cv = `
Matt built production data pipelines in Python, Snowflake, dbt, and Airflow.
Delivered Power BI semantic models with DAX across Pretium and GMS engagements.
`;
  const result = scoreAtsMatch(jd, cv);
  assert.ok(result.pct >= 35, `expected >=35%, got ${result.pct}%`);
  assert.ok(result.matched.length > 0);
  assert.ok(Array.isArray(result.missing));
  assert.ok(Array.isArray(result.keywords));
});

test('scoreAtsMatch: zero overlap → low pct', () => {
  const jd = `## Requirements\n- Rust, Kubernetes, WebAssembly, eBPF, systems programming`;
  const cv = `Matt builds ERP-to-BI pipelines in Node.js.`;
  const result = scoreAtsMatch(jd, cv);
  assert.ok(result.pct < 40, `expected <40%, got ${result.pct}%`);
});

test('evaluateGate: passes when pct >= threshold', () => {
  const jd = `Python Snowflake dbt Airflow data pipelines Power BI DAX semantic`;
  const cv = `Python Snowflake dbt Airflow data pipelines Power BI DAX semantic modeling`;
  const g = evaluateGate(jd, cv, { threshold: 30 });
  assert.equal(g.passed, true);
  assert.equal(g.meetsBar, true);
  assert.equal(g.forced, false);
  assert.ok(g.pct >= 30);
});

test('evaluateGate: blocks when pct < threshold', () => {
  const jd = `Rust Kubernetes WebAssembly eBPF systems programming Go concurrency`;
  const cv = `Node.js ERP BI pipelines. Nothing else relevant.`;
  const g = evaluateGate(jd, cv, { threshold: 60 });
  assert.equal(g.passed, false);
  assert.equal(g.meetsBar, false);
  assert.equal(g.forced, false);
});

test('evaluateGate: --force flips passed=true but meetsBar stays false', () => {
  const jd = `Rust Kubernetes WebAssembly eBPF systems programming Go concurrency`;
  const cv = `Node.js ERP BI pipelines.`;
  const g = evaluateGate(jd, cv, { threshold: 60, force: true });
  assert.equal(g.passed, true);
  assert.equal(g.meetsBar, false);
  assert.equal(g.forced, true);
});

test('evaluateGate: top missing keywords surface in missing[]', () => {
  const jd = `
## Requirements
- Kafka event streaming
- Kubernetes cluster operations
- GraphQL federation
`;
  const cv = `Matt writes SQL and Python for data warehousing.`;
  const g = evaluateGate(jd, cv, { threshold: 60 });
  assert.ok(g.missing.length >= 3);
  const firstThree = g.missing.slice(0, 3).join(' ').toLowerCase();
  // At least one of the keyword clusters should show up
  assert.match(firstThree, /(kafka|kubernetes|graphql|streaming|federation)/);
});

test('score-file fast path: ats-score --write-json → ats-gate --score-file round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ats-score-'));
  try {
    const jdPath = join(dir, 'jd.txt');
    const cvPath = join(dir, 'cv.md');
    const scorePath = join(dir, 'score.json');
    writeFileSync(jdPath, '## Requirements\n- Snowflake, dbt, Airflow, Python, Power BI, DAX experience required.');
    writeFileSync(cvPath, 'Matt — Snowflake, dbt, Airflow, Python, Power BI, DAX practitioner for 10 years.');

    const produce = spawnSync(process.execPath, [
      'scripts/ats-score.mjs',
      `--jd=${jdPath}`,
      `--cv=${cvPath}`,
      `--write-json=${scorePath}`,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(produce.status, 0, `ats-score failed: ${produce.stderr}`);

    const cached = JSON.parse(readFileSync(scorePath, 'utf8'));
    assert.equal(typeof cached.pct, 'number');
    assert.ok(Array.isArray(cached.matched));
    assert.ok(Array.isArray(cached.missing));
    assert.ok(Array.isArray(cached.keywords));
    assert.ok(cached.pct >= 60, `expected strong overlap, got ${cached.pct}%`);

    const consume = spawnSync(process.execPath, [
      'scripts/ats-gate.mjs',
      `--score-file=${scorePath}`,
      '--threshold=60',
      '--json',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(consume.status, 0, `ats-gate failed: ${consume.stderr}`);
    const out = JSON.parse(consume.stdout);
    assert.equal(out.passed, true);
    assert.equal(out.pct, cached.pct);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid --score-file falls back to live JD/CV (stderr + success)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ats-gate-fallback-'));
  try {
    const badPath = join(dir, 'bad.json');
    writeFileSync(badPath, '{ not json');
    const jdPath = join(dir, 'jd.txt');
    const cvPath = join(dir, 'cv.md');
    writeFileSync(
      jdPath,
      '## Requirements\n- Snowflake, dbt, Airflow, Python, Power BI, DAX experience required.'
    );
    writeFileSync(
      cvPath,
      'Matt — Snowflake, dbt, Airflow, Python, Power BI, DAX practitioner for 10 years.'
    );
    const r = spawnSync(
      process.execPath,
      [
        'scripts/ats-gate.mjs',
        `--score-file=${badPath}`,
        `--jd=${jdPath}`,
        `--cv=${cvPath}`,
        '--threshold=60',
        '--json',
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    assert.match(r.stderr, /falling back/i, r.stderr);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.passed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readNewAutomationEvents(/** @type {string} */ logPath, /** @type {number} */ startSize) {
  if (!existsSync(logPath)) return [];
  // Read as Buffer and slice by byte offset — startSize comes from statSync
  // (bytes), which diverges from String.length once the log accumulates any
  // multi-byte UTF-8 chars (em dashes in prior events). Using string .slice
  // with a byte offset silently drops new lines when they land past the
  // char-index cap.
  const buf = readFileSync(logPath);
  const tail = startSize >= buf.length ? '' : buf.slice(startSize).toString('utf8');
  return tail
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e && typeof e === 'object');
}

test('automation event: --score-file sets details.source= cached', () => {
  const date = new Date().toISOString().slice(0, 10);
  const logPath = join(process.cwd(), 'data', 'events', `${date}.jsonl`);
  const startSize = (() => {
    try {
      return statSync(logPath).size;
    } catch {
      return 0;
    }
  })();

  const dir = mkdtempSync(join(tmpdir(), 'ats-evt-cached-'));
  try {
    const jdPath = join(dir, 'jd.txt');
    const cvPath = join(dir, 'cv.md');
    const scorePath = join(dir, 'score.json');
    writeFileSync(
      jdPath,
      '## Requirements\n- Snowflake, dbt, Airflow, Python, Power BI, DAX experience required.'
    );
    writeFileSync(
      cvPath,
      'Matt — Snowflake, dbt, Airflow, Python, Power BI, DAX practitioner for 10 years.'
    );
    const produce = spawnSync(
      process.execPath,
      [
        'scripts/ats-score.mjs',
        `--jd=${jdPath}`,
        `--cv=${cvPath}`,
        `--write-json=${scorePath}`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    assert.equal(produce.status, 0, produce.stderr);
    const gate = spawnSync(
      process.execPath,
      [
        'scripts/ats-gate.mjs',
        `--score-file=${scorePath}`,
        '--threshold=60',
        '--json',
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    assert.equal(gate.status, 0, gate.stderr);
    const appended = readNewAutomationEvents(logPath, startSize);
    const ats = appended.filter((e) => e.type && String(e.type).includes('automation.ats_gate'));
    assert.ok(ats.length >= 1, 'expected an automation.ats_gate event');
    const last = ats[ats.length - 1];
    assert.equal(last.details?.source, 'cached');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('automation event: computed path sets details.source= computed', () => {
  const date = new Date().toISOString().slice(0, 10);
  const logPath = join(process.cwd(), 'data', 'events', `${date}.jsonl`);
  const startSize = (() => {
    try {
      return statSync(logPath).size;
    } catch {
      return 0;
    }
  })();

  const dir = mkdtempSync(join(tmpdir(), 'ats-evt-computed-'));
  try {
    const jdPath = join(dir, 'jd.txt');
    const cvPath = join(dir, 'cv.md');
    writeFileSync(
      jdPath,
      '## Requirements\n- Snowflake, dbt, Airflow, Python, Power BI, DAX experience required.'
    );
    writeFileSync(
      cvPath,
      'Matt — Snowflake, dbt, Airflow, Python, Power BI, DAX practitioner for 10 years.'
    );
    const gate = spawnSync(
      process.execPath,
      [
        'scripts/ats-gate.mjs',
        `--jd=${jdPath}`,
        `--cv=${cvPath}`,
        '--threshold=60',
        '--json',
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    assert.equal(gate.status, 0, gate.stderr);
    const appended = readNewAutomationEvents(logPath, startSize);
    const ats = appended.filter((e) => e.type && String(e.type).includes('automation.ats_gate'));
    assert.ok(ats.length >= 1, 'expected an automation.ats_gate event');
    const last = ats[ats.length - 1];
    assert.equal(last.details?.source, 'computed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ats-preflight.mjs: score + cached gate in one process tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ats-preflight-'));
  try {
    const jdPath = join(dir, 'jd.txt');
    const cvPath = join(dir, 'cv.md');
    const scorePath = join(dir, 'score.json');
    writeFileSync(
      jdPath,
      '## Requirements\n- Snowflake, dbt, Airflow, Python, Power BI, DAX experience required.'
    );
    writeFileSync(
      cvPath,
      'Matt — Snowflake, dbt, Airflow, Python, Power BI, DAX practitioner for 10 years.'
    );
    const r = spawnSync(
      process.execPath,
      [
        'scripts/ats-preflight.mjs',
        `--jd=${jdPath}`,
        `--cv=${cvPath}`,
        `--write-json=${scorePath}`,
        '--threshold=60',
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    const score = JSON.parse(readFileSync(scorePath, 'utf8'));
    assert.equal(typeof score.pct, 'number');
    assert.ok(score.pct >= 60);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
