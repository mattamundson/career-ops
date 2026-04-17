import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { join } from 'path';

test('submit-workable logs a valid submitted event', () => {
  const text = fs.readFileSync(join(process.cwd(), 'scripts', 'submit-workable.mjs'), 'utf8');
  assert.match(text, /--event submitted\b/, 'submit-workable should log the canonical submitted event');
  assert.doesNotMatch(text, /--event applied\b/, 'submit-workable should not emit the invalid applied event');
});

test('API submitters do not reference undefined appRow', () => {
  const scripts = [
    'submit-greenhouse.mjs',
    'submit-ashby.mjs',
    'submit-lever.mjs',
    'submit-smartrecruiters.mjs',
  ];

  for (const script of scripts) {
    const text = fs.readFileSync(join(process.cwd(), 'scripts', script), 'utf8');
    assert.doesNotMatch(text, /\bappRow\b/, `${script} should not reference undefined appRow`);
  }
});
