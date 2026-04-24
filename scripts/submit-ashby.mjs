#!/usr/bin/env node
/**
 * submit-ashby.mjs — Back-compat shim for submit-ashby-playwright.mjs
 *
 * Ashby has no public candidate JSON API (employer API keys only). The real
 * implementation is `submit-ashby-playwright.mjs` (routed from submit-dispatch).
 * This file delegates so older docs and muscle memory keep working.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntry } from './lib/main-entry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

export function isAshbyUrl(url) {
  return Boolean(url && /ashby(hq)?\.com/i.test(url));
}

function main() {
  const target = resolve(__dir, 'submit-ashby-playwright.mjs');
  const r = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  process.exit(r.status === null ? 1 : r.status);
}

if (isMainEntry(import.meta.url)) {
  main();
}
