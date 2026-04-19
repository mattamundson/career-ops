// Cron task entry-point wrapper.
//
// Wraps the entry function of every scheduled task so that:
//   1. A `task.start` event is emitted to data/events/YYYY-MM-DD.jsonl
//   2. On success, a `task.complete` event with elapsed_ms is emitted
//   3. On failure, a `task.failed` event with error message + stack is
//      emitted (capped to keep JSONL line size sane)
//   4. The process exits non-zero on failure so Windows Task Scheduler
//      can mark the run as failed
//
// verify-all.mjs (and dashboard Operator Health) read these events to
// surface failed cron runs from the last 24h instead of letting them rot
// silently.
//
// Usage in any cron entry script:
//
//   #!/usr/bin/env node
//   import { runCronTask } from './lib/cron-wrap.mjs';
//   runCronTask('evening-scan', async () => {
//     // ... actual scan logic ...
//   });
//
// The wrapper handles uncaught rejections, sigterm, and event flushing.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendAutomationEvent } from './automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..', '..');

const MAX_ERROR_MSG = 500;
const MAX_STACK = 2000;

export async function runCronTask(taskName, fn, opts = {}) {
  const { rootPath = ROOT, exitOnFinish = true } = opts;
  const started = new Date();
  const startedIso = started.toISOString();

  appendAutomationEvent(rootPath, {
    type: 'task.start',
    task: taskName,
    started_at: startedIso,
    pid: process.pid,
    node_version: process.version,
  });

  // Catch uncaught errors — they bypass the try/catch below.
  let unhandledFired = false;
  const onUnhandled = (err) => {
    if (unhandledFired) return;
    unhandledFired = true;
    emitFailure(rootPath, taskName, started, err, 'unhandledRejection');
    if (exitOnFinish) process.exit(1);
  };
  process.on('unhandledRejection', onUnhandled);
  process.on('uncaughtException', onUnhandled);

  // SIGTERM / SIGINT — Windows Task Scheduler may kill long-running tasks
  // when the execution time limit is exceeded. Record this as a failure.
  const onSignal = (signal) => {
    emitFailure(
      rootPath,
      taskName,
      started,
      new Error(`Process received ${signal} (likely Task Scheduler timeout)`),
      'signal'
    );
    if (exitOnFinish) process.exit(143);
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  try {
    const result = await fn({ taskName, rootPath, startedAt: started });
    const elapsedMs = Date.now() - started.getTime();
    appendAutomationEvent(rootPath, {
      type: 'task.complete',
      task: taskName,
      started_at: startedIso,
      completed_at: new Date().toISOString(),
      elapsed_ms: elapsedMs,
      // Allow the task to return a small summary object to embed in the
      // event for dashboards (e.g., {scanned: 42, new: 3}). Keep it small.
      summary: serializeSummary(result),
    });
    if (exitOnFinish) process.exit(0);
    return result;
  } catch (err) {
    emitFailure(rootPath, taskName, started, err, 'caught');
    if (exitOnFinish) process.exit(1);
    throw err;
  }
}

function emitFailure(rootPath, taskName, started, err, source) {
  const elapsedMs = Date.now() - started.getTime();
  const msg = String(err?.message || err || 'unknown error').slice(0, MAX_ERROR_MSG);
  const stack = String(err?.stack || '').slice(0, MAX_STACK);
  appendAutomationEvent(rootPath, {
    type: 'task.failed',
    task: taskName,
    started_at: started.toISOString(),
    failed_at: new Date().toISOString(),
    elapsed_ms: elapsedMs,
    error: msg,
    error_source: source, // 'caught' | 'unhandledRejection' | 'signal'
    error_code: err?.code || err?.status || null,
    stack,
    retry_attempts: err?.retryAttempts ?? null,
    retry_label: err?.retryLabel ?? null,
  });
}

function serializeSummary(result) {
  if (result === undefined || result === null) return null;
  if (typeof result !== 'object') return String(result).slice(0, 200);
  try {
    const json = JSON.stringify(result);
    if (json.length > 1000) return { _truncated: true, preview: json.slice(0, 800) };
    return result;
  } catch {
    return { _unserializable: true };
  }
}

// Helper: read recent task events for verify-all + dashboard checks.
// Returns { failed: [...], completed: [...], started: [...] } from the
// trailing N hours across data/events/*.jsonl.
//
// Recognizes BOTH:
//   - cron-wrap convention: type starts with "task." (task.start /
//     task.complete / task.failed)
//   - legacy convention used by generate-dashboard, auto-scan, etc:
//     {type: "<name>.<verb>", status: "success"|"failure"} where any
//     status === "failure" is treated as a failure regardless of type
import { readFileSync, readdirSync, existsSync } from 'node:fs';

export function recentTaskEvents(rootPath = ROOT, hours = 24) {
  const eventsDir = resolve(rootPath, 'data', 'events');
  if (!existsSync(eventsDir)) return { failed: [], completed: [], started: [] };

  const cutoff = Date.now() - hours * 3600_000;
  const files = readdirSync(eventsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .reverse() // most recent first
    .slice(0, 3); // last 3 days max

  const out = { failed: [], completed: [], started: [] };
  for (const file of files) {
    const lines = readFileSync(resolve(eventsDir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }

      const ts = Date.parse(
        ev.recorded_at || ev.started_at || ev.failed_at || ev.completed_at || 0,
      );
      if (!Number.isFinite(ts) || ts < cutoff) continue;

      // cron-wrap convention
      if (ev.type === 'task.failed') {
        out.failed.push(ev);
        continue;
      }
      if (ev.type === 'task.complete') {
        out.completed.push(ev);
        continue;
      }
      if (ev.type === 'task.start') {
        out.started.push(ev);
        continue;
      }

      // Legacy convention: any event with status === 'failure' counts
      // as a task failure (auto-scan emits scanner.run.failed, future
      // entry scripts may follow similar patterns)
      if (ev.status === 'failure') {
        out.failed.push({
          ...ev,
          task: ev.task || ev.type?.split('.')[0] || 'unknown',
          error: ev.error || ev.summary || 'failure (no message)',
          failed_at: ev.recorded_at || new Date(ts).toISOString(),
          error_source: 'legacy',
        });
      }
    }
  }
  return out;
}
