#!/usr/bin/env node
/**
 * check-secrets.mjs — Fail if `.env` is tracked by git (should stay local).
 * Run: node scripts/check-secrets.mjs
 */

import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const r = spawnSync('git', ['ls-files', '--error-unmatch', '.env'], {
  cwd: ROOT,
  encoding: 'utf8',
});

if (r.status === 0 && (r.stdout || '').trim()) {
  console.error('❌ .env is tracked by git — remove from index: git rm --cached .env');
  process.exit(1);
}

console.log('✅ .env is not tracked (or git unavailable / not a repo — ok)');
process.exit(0);
