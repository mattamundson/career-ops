#!/usr/bin/env node
/**
 * check-scheduled-tasks.mjs
 *
 * Reads the Last Task Result + Last Run Time of every registered Windows
 * scheduled task whose name matches the prefix and surfaces any task
 * with a non-zero exit code in the trailing 24h. Complements cron-wrap's
 * event-log surface — catches the case where the entry script crashes
 * before its own event emitter runs (or where Task Scheduler kills it).
 *
 * Used by verify-all step 7. Returns:
 *   - exit 0: nothing wrong
 *   - exit 0 + warnings to stdout: failures detected (warn-only)
 *   - exit 1: failures detected AND --strict was passed
 *
 * Usage:
 *   node scripts/check-scheduled-tasks.mjs [--prefix=Career-Ops] [--hours=24] [--strict]
 *
 * Windows-only (uses PowerShell Get-ScheduledTask under the hood).
 * Silently no-ops on non-Windows.
 */

import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const args = process.argv.slice(2);
const prefix = args.find((a) => a.startsWith('--prefix='))?.split('=')[1] || 'Career-Ops';
const hours = Number(args.find((a) => a.startsWith('--hours='))?.split('=')[1] || '24');
const strict = args.includes('--strict');

if (platform() !== 'win32') {
  console.log(`[scheduled-tasks] non-Windows platform — skipping`);
  process.exit(0);
}

// Windows "task has never run" exit code
const NEVER_RUN = 267011;
// Windows "task is currently running" exit code
const RUNNING = 267009;
// Windows "task is queued" exit code
const QUEUED = 267045;

const benignCodes = new Set([0, NEVER_RUN, RUNNING, QUEUED]);

// Single PowerShell call for all matching tasks; output as JSON for parsing.
// Pass via array args to spawnSync — execSync via shell mangles the pipes.
const psScript =
  `Get-ScheduledTask | Where-Object { $_.TaskName -like '${prefix}*' } | ` +
  `ForEach-Object { $info = Get-ScheduledTaskInfo -TaskName $_.TaskName; ` +
  `[PSCustomObject]@{ Name=$_.TaskName; LastRunTime=$info.LastRunTime; ` +
  `LastTaskResult=$info.LastTaskResult; NextRunTime=$info.NextRunTime } } | ` +
  `ConvertTo-Json -Depth 2 -Compress`;

const r = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (r.status !== 0) {
  console.log(
    `[scheduled-tasks] PowerShell call failed ` +
      `(exit ${r.status}: ${(r.stderr || '').trim().slice(0, 200)}) — skipping`,
  );
  process.exit(0);
}
const raw = r.stdout;

let tasks;
try {
  const parsed = JSON.parse(raw || '[]');
  tasks = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  console.log(`[scheduled-tasks] could not parse PowerShell output — skipping`);
  process.exit(0);
}

if (tasks.length === 0 || tasks[0] === null) {
  console.log(`[scheduled-tasks] no tasks matched prefix '${prefix}'`);
  process.exit(0);
}

const cutoff = Date.now() - hours * 3600_000;

const findings = [];
for (const t of tasks) {
  const code = Number(t.LastTaskResult);
  // PowerShell ConvertTo-Json serializes DateTime as "/Date(epochms)/" or ISO
  // string depending on PSVersion. Handle both.
  const lastRunMs = parseDate(t.LastRunTime);
  if (!lastRunMs || lastRunMs < cutoff) continue; // outside window
  if (benignCodes.has(code)) continue;
  findings.push({
    name: t.Name,
    code,
    lastRun: new Date(lastRunMs).toISOString(),
    nextRun: t.NextRunTime ? new Date(parseDate(t.NextRunTime)).toISOString() : 'unknown',
  });
}

if (findings.length === 0) {
  console.log(
    `[scheduled-tasks] ✅ no scheduled-task exit-code failures in last ${hours}h ` +
      `(checked ${tasks.length} task(s) with prefix '${prefix}')`,
  );
  process.exit(0);
}

console.log(
  `[scheduled-tasks] ⚠️  ${findings.length} task(s) exited with non-zero code in last ${hours}h:`,
);
for (const f of findings) {
  console.log(`  - ${f.lastRun} ${f.name}: exit ${f.code} (next run ${f.nextRun})`);
}
console.log(`[scheduled-tasks] interpret codes via 'net helpmsg <code>' or Microsoft docs`);

if (strict) {
  console.log(`[scheduled-tasks] --strict set; failing.`);
  process.exit(1);
}

process.exit(0);

function parseDate(d) {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  if (typeof d === 'string') {
    // /Date(123456789)/
    const m = d.match(/\/Date\((\d+)\)\//);
    if (m) return Number(m[1]);
    // ISO
    const t = Date.parse(d);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}
