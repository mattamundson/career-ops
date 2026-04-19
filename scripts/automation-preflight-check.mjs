#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJobReadiness, printJobReadiness } from './automation-preflight.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
const jobFlag = args.find((arg) => arg.startsWith('--job='));
const job = jobFlag ? jobFlag.split('=')[1] : null;

if (!job) {
  console.error(
    'Usage: node scripts/automation-preflight-check.mjs --job=<gmail-sync|cadence-alert|scanner>\n' +
      '  scanner — env checks before node scripts/auto-scan.mjs (Firecrawl key optional)',
  );
  process.exit(1);
}

try {
  const readiness = getJobReadiness(ROOT, job);
  printJobReadiness(readiness);
  process.exit(readiness.ready ? 0 : 1);
} catch (error) {
  console.error(`[preflight] ${error.message}`);
  process.exit(1);
}
