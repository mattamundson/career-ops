// tests/cv-docx-tailor.test.mjs
// Coverage for scripts/cv-docx-to-pdf.mjs (Node wrapper) + scripts/lib/cv_docx_tailor.py
// via --docx-only (skips Word COM conversion for CI).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'child_process';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractFromReport } from '../scripts/cv-docx-to-pdf.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER = resolve(ROOT, 'scripts', 'cv-docx-to-pdf.mjs');
const MASTER = resolve(ROOT, 'output', 'Matt_Amundson_TOP_2026.docx');

function hasMaster() {
  return existsSync(MASTER);
}

test('extractFromReport: pulls cv_headline + cv_summary from frontmatter', () => {
  const tmpDir = resolve(ROOT, 'output', 'test-reports');
  mkdirSync(tmpDir, { recursive: true });
  const reportPath = resolve(tmpDir, 'test-report.md');
  writeFileSync(
    reportPath,
    `---
company: Test
cv_headline: "Data Lead | Snowflake · dbt"
cv_summary: "Tailored summary for the test. Two sentences."
---

# Report body
`,
    'utf-8'
  );

  const { headline, summary } = extractFromReport(reportPath);
  assert.equal(headline, 'Data Lead | Snowflake · dbt');
  assert.equal(summary, 'Tailored summary for the test. Two sentences.');

  rmSync(reportPath);
});

test('extractFromReport: returns nulls when frontmatter missing', () => {
  const tmpDir = resolve(ROOT, 'output', 'test-reports');
  mkdirSync(tmpDir, { recursive: true });
  const reportPath = resolve(tmpDir, 'test-report-bare.md');
  writeFileSync(reportPath, '# No frontmatter here\n\nBody only.\n', 'utf-8');

  const { headline, summary } = extractFromReport(reportPath);
  assert.equal(headline, null);
  assert.equal(summary, null);

  rmSync(reportPath);
});

test('CLI: tailors master DOCX with headline + summary (docx-only)', { skip: !hasMaster() }, () => {
  const outStem = resolve(ROOT, 'output', 'cv-test-integration');
  const outDocx = `${outStem}.docx`;
  if (existsSync(outDocx)) rmSync(outDocx);

  const result = spawnSync(
    'node',
    [
      WRAPPER,
      '--headline', 'Test Headline | Snowflake · dbt',
      '--summary', 'Test summary sentence one. Test summary sentence two.',
      '--out', outStem,
      '--docx-only',
    ],
    { cwd: ROOT, encoding: 'utf-8' }
  );

  assert.equal(result.status, 0, `wrapper failed: ${result.stderr || result.stdout}`);
  assert.ok(existsSync(outDocx), `expected DOCX at ${outDocx}`);

  // Verify the patched paragraphs via a one-shot Python read.
  const verify = spawnSync(
    'python',
    [
      '-c',
      `from docx import Document
doc = Document(r'${outDocx.replace(/\\/g, '\\\\')}')
print('H:' + doc.paragraphs[1].text)
print('S:' + doc.paragraphs[4].text)
print('E:' + doc.paragraphs[14].text[:60])`,
    ],
    { encoding: 'utf-8' }
  );

  assert.equal(verify.status, 0, `python verify failed: ${verify.stderr}`);
  assert.match(verify.stdout, /H:Test Headline \| Snowflake/);
  assert.match(verify.stdout, /S:Test summary sentence one/);
  // Experience section should be untouched (starts with bullet).
  assert.match(verify.stdout, /E:•/);

  rmSync(outDocx);
});

test('CLI: --help exits 0 without producing output', () => {
  const result = spawnSync('node', [WRAPPER, '--help'], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(result.status, 0);
  assert.match(result.stderr || result.stdout, /Usage:/);
});

test('CLI: missing --out exits non-zero with usage', () => {
  const result = spawnSync('node', [WRAPPER, '--headline', 'x'], { cwd: ROOT, encoding: 'utf-8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /Usage:/);
});
