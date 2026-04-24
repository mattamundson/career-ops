#!/usr/bin/env node
/**
 * post-apply-refresh.mjs
 *
 * Rebuilds `data/index/applications.json`, `dashboard.html`, and `review.html` after a tracker or
 * responses change (e.g. `apply-review --confirm` post-submit hooks).
 *
 * Usage:
 *   pnpm run post-apply:refresh
 *   pnpm run post-apply:refresh:open
 *   node scripts/post-apply-refresh.mjs [--open]
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const node = process.execPath;
const open = process.argv.includes('--open');

console.log('[post-apply:refresh] build:index …');
execFileSync(node, [resolve(__dir, 'build-application-index.mjs')], { cwd: root, stdio: 'inherit' });
const dashArgs = [resolve(__dir, 'generate-dashboard.mjs')];
if (open) dashArgs.push('--open');
console.log(`[post-apply:refresh] generate-dashboard.mjs${open ? ' --open' : ''} …`);
execFileSync(node, dashArgs, { cwd: root, stdio: 'inherit' });
console.log('[post-apply:refresh] generate-review-ui.mjs …');
execFileSync(node, [resolve(__dir, 'generate-review-ui.mjs')], { cwd: root, stdio: 'inherit' });
console.log('[post-apply:refresh] Done.');
