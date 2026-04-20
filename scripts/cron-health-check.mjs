#!/usr/bin/env node
/**
 * cron-health-check.mjs
 *
 * Wraps health-check.mjs for scheduled-task execution. Runs the same checks
 * but post-processes the JSON output:
 *   - any FAIL → notify({ urgency: 'high' }) with the failing checks
 *   - 3+ WARNs → notify({ urgency: 'normal' }) with a summary
 *   - 0 fail + < 3 warn → silent (no notification spam)
 *
 * Always emits a health.check.completed event regardless of outcome so the
 * freshness badges show this task is running.
 *
 * Usage:
 *   node scripts/cron-health-check.mjs
 *   node scripts/cron-health-check.mjs --always-notify   # for testing
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './load-env.mjs';
import { notify } from './lib/notify.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { installExitTrap } from './lib/exit-event-trap.mjs';

installExitTrap('cron-health-check');

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

const ALWAYS_NOTIFY = process.argv.includes('--always-notify');

const r = spawnSync(process.execPath, [resolve(__dir, 'health-check.mjs'), '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 60_000,
});

if (r.error) {
  await notify({
    kind: 'cron-failure',
    title: '⚠ health-check could not run',
    body: `health-check.mjs failed to spawn: ${r.error.message}`,
    action: 'Investigate manually: pnpm run health',
    urgency: 'high',
  });
  appendAutomationEvent(ROOT, {
    type: 'task.failed',
    job: 'cron-health-check',
    error: `spawn failed: ${r.error.message}`,
  });
  process.exit(2);
}

let report;
try {
  report = JSON.parse(r.stdout);
} catch (e) {
  await notify({
    kind: 'cron-failure',
    title: '⚠ health-check produced invalid JSON',
    body: `Could not parse health output. stderr:\n${(r.stderr || '').slice(0, 400)}`,
    action: 'Investigate: pnpm run health',
    urgency: 'high',
  });
  process.exit(2);
}

const { summary, checks } = report;
const fails = checks.filter((c) => c.status === 'fail');
const warns = checks.filter((c) => c.status === 'warn');

appendAutomationEvent(ROOT, {
  type: 'health.check.completed',
  job: 'cron-health-check',
  status: fails.length > 0 ? 'fail' : (warns.length > 0 ? 'warn' : 'pass'),
  summary,
  failed_checks: fails.map((c) => c.name),
  warned_checks: warns.map((c) => c.name),
});

const shouldNotify = ALWAYS_NOTIFY || fails.length > 0 || warns.length >= 3;
if (!shouldNotify) {
  console.log(`[cron-health-check] silent: ${summary.pass}/${summary.warn}/${summary.fail} (pass/warn/fail)`);
  process.exit(0);
}

const lines = [];
if (fails.length > 0) {
  lines.push('FAILS:');
  for (const f of fails) lines.push(`  ✖ ${f.name}: ${f.detail}`);
}
if (warns.length > 0) {
  lines.push(fails.length > 0 ? '' : 'WARNS:');
  for (const w of warns) lines.push(`  ⚠ ${w.name}: ${w.detail}`);
}

await notify({
  kind: 'health-check',
  title: fails.length > 0
    ? `⚠ Career-Ops health: ${fails.length} fail${fails.length === 1 ? '' : 's'}`
    : `Career-Ops health: ${warns.length} warns`,
  body: lines.join('\n'),
  action: 'pnpm run health for full report',
  urgency: fails.length > 0 ? 'high' : 'normal',
});

process.exit(fails.length > 0 ? 1 : 0);
