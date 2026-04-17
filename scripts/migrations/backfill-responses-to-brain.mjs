#!/usr/bin/env node
// One-shot backfill: every row in data/responses.md → brain timeline entry on
// the matching app-NNN page. Idempotency is provided by gbrain
// (timeline entries are appended; re-running produces duplicates, so run once).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addTimelineEntry, isBrainAvailable } from '../lib/brain-client.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESPONSES = join(ROOT, 'data', 'responses.md');

if (!isBrainAvailable()) {
  console.error('[backfill] brain runtime not available; aborting');
  process.exit(1);
}

const raw = readFileSync(RESPONSES, 'utf8');
const rows = raw.split(/\r?\n/)
  .filter((l) => l.trim().startsWith('|') && !/^\|\s*[-]/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .filter((r) => r.length >= 9 && /^\d+$/.test(r[0]));

let ok = 0, fail = 0;
for (const r of rows) {
  const [app_id, company, role, submitted_at, ats, status, last_event_at, , notes] = r;
  const slug = `app-${app_id}`;
  const summary = `${status} — ${company} / ${role}${notes ? `: ${notes}` : ''}`.slice(0, 240);
  const date = last_event_at && last_event_at !== '—' ? last_event_at : submitted_at;
  if (!date || date === '—') { console.warn(`[backfill] skip #${app_id} (no date)`); continue; }
  const res = addTimelineEntry(slug, date, summary);
  if (res.ok) { ok++; console.log(`[backfill] ${slug} ${date}: ${status}`); }
  else { fail++; console.warn(`[backfill] ${slug} FAILED: ${res.error}`); }
}
console.log(`[backfill] ${ok} ok, ${fail} failed, ${rows.length} total`);
