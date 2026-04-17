import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { join } from 'path';
import os from 'os';

import { runChromePreflight } from '../scripts/lib/chrome-preflight.mjs';

test('chrome-preflight exports a reusable runChromePreflight helper', () => {
  const text = fs.readFileSync(join(process.cwd(), 'scripts', 'lib', 'chrome-preflight.mjs'), 'utf8');
  assert.match(text, /export function runChromePreflight\s*\(/, 'chrome-preflight should expose a reusable wrapper');
});

test('Playwright launchers use the shared preflight wrapper', () => {
  const scripts = [
    'scan-indeed.mjs',
    'scan-indeed-direct.mjs',
    'scan-linkedin-direct.mjs',
    'scan-careerbuilder.mjs',
    'scan-wellfound.mjs',
    'resolve-aggregator-urls.mjs',
    'auto-scan.mjs',
    'submit-universal-playwright.mjs',
    'submit-playwright-shared.mjs',
  ];

  for (const script of scripts) {
    const text = fs.readFileSync(join(process.cwd(), 'scripts', script), 'utf8');
    assert.match(text, /\brunChromePreflight\s*\(/, `${script} should invoke runChromePreflight()`);
  }
});

test('runChromePreflight emits cleanup logs to stderr channel by default', () => {
  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'career-ops-preflight-'));
  const profileDir = join(tempDir, 'mcp-chrome-test');
  fs.mkdirSync(profileDir, { recursive: true });
  const lockPath = join(profileDir, 'lockfile');
  fs.writeFileSync(lockPath, '');
  const staleTime = new Date(Date.now() - (2 * 60 * 60 * 1000));
  fs.utimesSync(lockPath, staleTime, staleTime);

  const originalLog = console.log;
  const originalError = console.error;
  const seen = { log: 0, error: 0 };
  console.log = () => { seen.log += 1; };
  console.error = () => { seen.error += 1; };

  try {
    const result = runChromePreflight('test-preflight', { baseDir: tempDir, maxAgeMs: 1000 });
    assert.equal(result.cleared.length, 1);
    assert.equal(seen.log, 0, 'wrapper should not write cleanup logs to stdout by default');
    assert.ok(seen.error >= 1, 'wrapper should emit cleanup logs to stderr by default');
  } finally {
    console.log = originalLog;
    console.error = originalError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
