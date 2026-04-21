// tests/ats-gate.test.mjs
// Coverage for scripts/ats-gate.mjs (pure-function contract)
// CLI integration is exercised separately via the gate script in practice.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
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
