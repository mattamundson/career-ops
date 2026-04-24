#!/usr/bin/env node
/**
 * inspect-scheduled-task.mjs
 *
 * Diagnostics helper for Windows Task Scheduler jobs in the Career-Ops family.
 * Shows the latest status for one task, plus recent non-zero exits across the
 * task prefix so you can quickly understand if a failure is isolated or broad.
 *
 * Usage:
 *   node scripts/inspect-scheduled-task.mjs
 *   node scripts/inspect-scheduled-task.mjs --task="Career-Ops Dashboard"
 *   node scripts/inspect-scheduled-task.mjs --prefix="Career-Ops" --hours=48
 */
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const args = process.argv.slice(2);
const taskName = args.find((a) => a.startsWith('--task='))?.split('=').slice(1).join('=') || 'Career-Ops Dashboard';
const prefix = args.find((a) => a.startsWith('--prefix='))?.split('=').slice(1).join('=') || 'Career-Ops';
const hours = Number(args.find((a) => a.startsWith('--hours='))?.split('=')[1] || '24');

if (platform() !== 'win32') {
  console.log('[inspect-scheduled-task] Windows only.');
  process.exit(0);
}

const codeHints = {
  0: 'Success',
  267009: 'Task is currently running',
  267011: 'Task has not yet run',
  267014: 'Task terminated by scheduler/user or external stop',
  267045: 'Task queued',
};

function parseDate(d) {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  if (typeof d === 'string') {
    const m = d.match(/\/Date\((\d+)\)\//);
    if (m) return Number(m[1]);
    const t = Date.parse(d);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function psJson(script) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    const err = (r.stderr || '').trim().slice(0, 240);
    throw new Error(`PowerShell failed (${r.status}): ${err}`);
  }
  const raw = (r.stdout || '').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

try {
  const oneScript =
    `$t = Get-ScheduledTask -TaskName '${taskName}' -ErrorAction Stop; ` +
    `$i = Get-ScheduledTaskInfo -TaskName '${taskName}' -ErrorAction Stop; ` +
    `[PSCustomObject]@{ Name=$t.TaskName; State=$t.State; LastRunTime=$i.LastRunTime; ` +
    `NextRunTime=$i.NextRunTime; LastTaskResult=$i.LastTaskResult; NumberOfMissedRuns=$i.NumberOfMissedRuns } ` +
    `| ConvertTo-Json -Depth 3 -Compress`;
  const one = psJson(oneScript);

  const code = Number(one.LastTaskResult);
  const hint = codeHints[code] || 'Unknown/non-zero task code';
  const lastRunIso = parseDate(one.LastRunTime) ? new Date(parseDate(one.LastRunTime)).toISOString() : '(never)';
  const nextRunIso = parseDate(one.NextRunTime) ? new Date(parseDate(one.NextRunTime)).toISOString() : '(none)';

  console.log(`\n[inspect-scheduled-task] ${one.Name}`);
  console.log(`  state:       ${one.State}`);
  console.log(`  last run:    ${lastRunIso}`);
  console.log(`  next run:    ${nextRunIso}`);
  console.log(`  last result: ${code} (${hint})`);
  console.log(`  missed runs: ${one.NumberOfMissedRuns ?? 0}`);

  const allScript =
    `Get-ScheduledTask | Where-Object { $_.TaskName -like '${prefix}*' } | ` +
    `ForEach-Object { $i = Get-ScheduledTaskInfo -TaskName $_.TaskName; ` +
    `[PSCustomObject]@{ Name=$_.TaskName; LastRunTime=$i.LastRunTime; LastTaskResult=$i.LastTaskResult } } | ` +
    `ConvertTo-Json -Depth 2 -Compress`;
  const rawAll = psJson(allScript);
  const all = Array.isArray(rawAll) ? rawAll : rawAll ? [rawAll] : [];
  const cutoff = Date.now() - hours * 3600_000;
  const bad = all
    .map((t) => ({
      name: t.Name,
      code: Number(t.LastTaskResult),
      ts: parseDate(t.LastRunTime),
    }))
    .filter((t) => t.ts >= cutoff && t.code !== 0 && t.code !== 267009 && t.code !== 267011 && t.code !== 267045)
    .sort((a, b) => b.ts - a.ts);

  if (bad.length === 0) {
    console.log(`\n[inspect-scheduled-task] No non-zero task exits for prefix '${prefix}' in last ${hours}h.`);
  } else {
    console.log(`\n[inspect-scheduled-task] Non-zero exits for prefix '${prefix}' in last ${hours}h:`);
    for (const f of bad.slice(0, 15)) {
      const tsIso = new Date(f.ts).toISOString();
      const h = codeHints[f.code] || 'Unknown/non-zero task code';
      console.log(`  - ${tsIso} ${f.name}: ${f.code} (${h})`);
    }
    console.log(`  hint: run 'net helpmsg <code>' for Win32 codes when applicable`);
  }
  process.exit(0);
} catch (e) {
  console.error(`[inspect-scheduled-task] ${e.message}`);
  process.exit(1);
}

