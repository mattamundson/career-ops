#!/usr/bin/env node
/**
 * validate-automation-events.mjs — Ensure data/events/*.jsonl lines parse as JSON.
 *
 * Exits 0 if dir missing, no jsonl files, or all lines valid.
 * Exits 1 on first invalid line (for CI).
 *
 * Optional: CAREER_OPS_EVENTS_DIR=/abs/path/to/events — must exist (tests / custom layout).
 *
 *   node scripts/validate-automation-events.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const customEvents = process.env.CAREER_OPS_EVENTS_DIR?.trim();
const EVENTS_DIR = customEvents ? resolve(customEvents) : join(ROOT, 'data', 'events');

function main() {
  if (customEvents) {
    if (!existsSync(EVENTS_DIR) || !statSync(EVENTS_DIR).isDirectory()) {
      console.error(`[validate-events] CAREER_OPS_EVENTS_DIR is not a directory: ${EVENTS_DIR}`);
      process.exit(1);
    }
  } else if (!existsSync(EVENTS_DIR)) {
    console.log('[validate-events] data/events/ missing — skip.');
    return;
  }

  const files = readdirSync(EVENTS_DIR).filter((n) => n.endsWith('.jsonl')).sort();
  if (files.length === 0) {
    console.log('[validate-events] no *.jsonl — skip.');
    return;
  }

  let bad = 0;
  for (const fn of files) {
    const abs = join(EVENTS_DIR, fn);
    const text = readFileSync(abs, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        JSON.parse(line);
      } catch (e) {
        bad++;
        console.error(`[validate-events] ${fn}:${i + 1} invalid JSON: ${e.message}`);
      }
    }
  }

  if (bad > 0) {
    console.error(`[validate-events] ${bad} invalid line(s).`);
    process.exit(1);
  }
  console.log(`[validate-events] OK (${files.length} file(s)).`);
}

main();
