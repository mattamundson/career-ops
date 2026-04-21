// tests/ats-gate.test.mjs
// Coverage for scripts/ats-gate.mjs (pure-function contract)
// CLI integration is exercised separately via the gate script in practice.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseGateArgs, evaluateGate } from '../scripts/ats-gate.mjs';
import { scoreAtsMatch } from '../scripts/ats-score.mjs';

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
