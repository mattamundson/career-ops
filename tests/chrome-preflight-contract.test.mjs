import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { join } from 'path';

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
