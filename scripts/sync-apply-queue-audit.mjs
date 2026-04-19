#!/usr/bin/env node
/**
 * sync-apply-queue-audit.mjs — Compare apply-queue checklist labels to applications.md.
 *
 * Finds `[NNN — Status]` tokens in data/apply-queue.md and flags:
 * - Orphan numbers (not in tracker)
 * - Status drift (queue label ≠ tracker status column)
 * - Stale "ship" labels when tracker already moved past GO / Ready to Submit
 *
 * Writes data/apply-queue-audit.md (overwrite). Read-only on tracker/queue.
 *
 *   node scripts/sync-apply-queue-audit.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = join(ROOT, 'data', 'applications.md');
const QUEUE = join(ROOT, 'data', 'apply-queue.md');
const OUT = join(ROOT, 'data', 'apply-queue-audit.md');

/** @returns {Map<number, string>} */
function trackerByNum(appsPath) {
  const map = new Map();
  if (!existsSync(appsPath)) return map;
  for (const line of readFileSync(appsPath, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 9) continue;
    const num = parseInt(parts[1], 10);
    if (Number.isNaN(num)) continue;
    const status = parts[6].replace(/\*\*/g, '').trim();
    map.set(num, status);
  }
  return map;
}

function norm(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Tracker rows that mean the queue should not still read like “ship today”. */
const STALE_IF_QUEUE_SHIPS = new Set(
  ['applied', 'responded', 'contact', 'interview', 'offer', 'rejected', 'discarded', 'skip'].map(norm),
);

function main() {
  if (!existsSync(QUEUE)) {
    console.error(`Missing ${QUEUE}`);
    process.exit(1);
  }

  const tracker = trackerByNum(APPS);
  const qText = readFileSync(QUEUE, 'utf8');

  const re = /\[(\d{3})\s*[—–-]\s*([^\]\n]+?)\]/g;
  const refs = [];
  let m;
  while ((m = re.exec(qText)) !== null) {
    refs.push({
      num: parseInt(m[1], 10),
      queueLabel: m[2].trim(),
      index: m.index,
    });
  }

  const orphans = [];
  const drift = [];
  const staleShip = [];

  for (const r of refs) {
    if (!tracker.has(r.num)) {
      orphans.push(r);
      continue;
    }
    const tStatus = tracker.get(r.num);
    if (norm(tStatus) !== norm(r.queueLabel)) {
      drift.push({ ...r, trackerStatus: tStatus });
    }
    const tn = norm(tStatus);
    const queueSoundsReady =
      /\bgo\b/i.test(r.queueLabel) ||
      /ready\s+to\s+submit/i.test(r.queueLabel) ||
      /conditional\s+go/i.test(r.queueLabel);
    if (queueSoundsReady && STALE_IF_QUEUE_SHIPS.has(tn)) {
      staleShip.push({ ...r, trackerStatus: tStatus });
    }
  }

  const lines = [];
  lines.push('# Apply queue vs tracker audit');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString().slice(0, 19)}Z`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Check | Count |`);
  lines.push('|-------|-------|');
  lines.push(`| \`[NNN — …]\` refs found in apply-queue | ${refs.length} |`);
  lines.push(`| Orphan # (missing from applications.md) | ${orphans.length} |`);
  lines.push(`| Status text differs from tracker | ${drift.length} |`);
  lines.push(`| Queue still says GO-ish but tracker is terminal / SKIP | ${staleShip.length} |`);
  lines.push('');

  lines.push('## Orphans');
  lines.push('');
  if (orphans.length === 0) lines.push('_None._');
  else for (const r of orphans) lines.push(`- **#${r.num}** — queue label: “${r.queueLabel}”`);
  lines.push('');

  lines.push('## Status drift (update queue heading or tracker)');
  lines.push('');
  if (drift.length === 0) lines.push('_None._');
  else {
    for (const r of drift) {
      lines.push(
        `- **#${r.num}** — queue: “${r.queueLabel}” — tracker: **${r.trackerStatus}**`,
      );
    }
  }
  lines.push('');

  lines.push('## Stale “ship” labels (tracker already moved on)');
  lines.push('');
  lines.push('_Heuristic: queue bracket mentions GO / Ready / Conditional, tracker is Applied+ / Rejected / SKIP / etc._');
  lines.push('');
  if (staleShip.length === 0) lines.push('_None._');
  else {
    for (const r of staleShip) {
      lines.push(
        `- **#${r.num}** — queue: “${r.queueLabel}” — tracker: **${r.trackerStatus}**`,
      );
    }
  }
  lines.push('');

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUT}`);
  console.log(`Refs ${refs.length}, orphans ${orphans.length}, drift ${drift.length}, staleShip ${staleShip.length}`);
}

main();
