// Exit-event trap.
//
// Add ONE line at the top of any cron entry script:
//
//   import { installExitTrap } from './lib/exit-event-trap.mjs';
//   installExitTrap('cadence-alert');
//
// On process exit:
//   - exit code 0 → no event (assume the script emitted its own success event)
//   - exit code != 0 → emit task.failed to data/events/YYYY-MM-DD.jsonl
//
// This catches the silent-failure class where a cron entry script calls
// process.exit(1) directly without ever touching the event log
// (the case that hit Career-Ops Cadence Alert on 2026-04-18 — exit 1
// with zero events recorded).
//
// Lighter than runCronTask: doesn't capture task.start/task.complete or
// elapsed_ms. Just guarantees task.failed when something goes wrong.
// Combine with runCronTask if you want both lifecycle events AND the
// uncaught-exit safety net.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendAutomationEvent } from './automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..', '..');

let installed = false;

export function installExitTrap(taskName, opts = {}) {
  if (installed) return; // idempotent — only first call wins
  installed = true;
  const startedAt = new Date().toISOString();
  const rootPath = opts.rootPath || ROOT;

  process.on('exit', (code) => {
    if (code === 0) return;
    try {
      appendAutomationEvent(rootPath, {
        type: 'task.failed',
        task: taskName,
        started_at: startedAt,
        failed_at: new Date().toISOString(),
        error: `Process exited with non-zero code ${code}`,
        error_code: code,
        error_source: 'exit-trap',
      });
    } catch {
      // Last resort — exit handler should never throw or it suppresses
      // the original exit. Swallow.
    }
  });

  // Also catch unhandled errors that bypass the script's own try/catch.
  process.on('unhandledRejection', (err) => {
    try {
      appendAutomationEvent(rootPath, {
        type: 'task.failed',
        task: taskName,
        started_at: startedAt,
        failed_at: new Date().toISOString(),
        error: String(err?.message || err || 'unhandledRejection').slice(0, 500),
        error_code: err?.code || err?.status || null,
        error_source: 'unhandledRejection',
        stack: String(err?.stack || '').slice(0, 2000),
      });
    } catch {
      /* swallow */
    }
  });
}
