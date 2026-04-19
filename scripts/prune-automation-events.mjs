#!/usr/bin/env node
/**
 * prune-automation-events.mjs — Remove old JSONL files under data/events/
 *
 * Files named YYYY-MM-DD.jsonl older than --days (default 90) are candidates.
 * .gitkeep and non-matching names are never deleted.
 *
 *   node scripts/prune-automation-events.mjs              # dry-run
 *   node scripts/prune-automation-events.mjs --apply     # delete
 *   node scripts/prune-automation-events.mjs --days=30
 */

import { existsSync, readdirSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  computeCutoffDay,
  listEventFilenamesToPrune,
  parseEventJsonlYmd,
} from './lib/event-log-prune.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const EVENTS_DIR = join(ROOT, 'data', 'events');
const APPLY = process.argv.includes('--apply');

function getDays() {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  if (!arg) return 90;
  const n = parseInt(arg.split('=')[1], 10);
  if (Number.isNaN(n) || n < 1) {
    console.error('Invalid --days= value');
    process.exit(1);
  }
  return n;
}

const RETAIN_DAYS = getDays();
const cutoffDay = computeCutoffDay(RETAIN_DAYS);

function main() {
  console.log(`[events:prune] retain last ${RETAIN_DAYS} day(s) (delete files dated before ${cutoffDay} local)`);
  console.log(`[events:prune] mode: ${APPLY ? 'APPLY (will delete files)' : 'dry-run'}`);
  console.log('');

  if (!existsSync(EVENTS_DIR)) {
    console.log('[events:prune] data/events/ does not exist — nothing to do.');
    return;
  }

  const names = readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.jsonl'));

  for (const name of names) {
    if (!parseEventJsonlYmd(name)) {
      console.log(`  skip (unrecognized name): ${name}`);
    }
  }

  const toDeleteNames = listEventFilenamesToPrune(names, cutoffDay);

  if (toDeleteNames.length === 0) {
    console.log('[events:prune] no files older than cutoff.');
    return;
  }

  for (const name of toDeleteNames) {
    const ymd = parseEventJsonlYmd(name);
    const abs = join(EVENTS_DIR, name);
    if (APPLY) {
      unlinkSync(abs);
      console.log(`  deleted ${name} (${ymd})`);
    } else {
      console.log(`  would delete ${name} (${ymd})`);
    }
  }

  console.log('');
  console.log(
    APPLY
      ? `[events:prune] removed ${toDeleteNames.length} file(s).`
      : `[events:prune] ${toDeleteNames.length} file(s) would be removed — re-run with --apply to delete.`,
  );
}

main();
