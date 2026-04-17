#!/usr/bin/env node
/**
 * log-response.mjs — CLI helper to append response events to data/responses.md
 *
 * Usage:
 *   node scripts/log-response.mjs --app-id 011 --event acknowledged --date 2026-04-11
 *   node scripts/log-response.mjs --app-id 011 --event recruiter_reply --date 2026-04-12 --notes "Jen from talent team wants to chat"
 *   node scripts/log-response.mjs --new --company "Agility Robotics" --role "Manager, BI" --ats Greenhouse --date 2026-04-10
 *   node scripts/log-response.mjs --app-id 017 --event deferred --reason "Priority reversal — revisit if remote priority returns"
 *   node scripts/log-response.mjs --app-id 025 --event discarded --reason "Offer closed before submission"
 *
 * Event types:
 *   submitted       - Initial application sent (usually via --new for new entries)
 *   acknowledged    - Auto-reply or "received" email from ATS
 *   recruiter_reply - Human recruiter responded (email/call/LinkedIn)
 *   phone_screen    - Phone screen scheduled or completed
 *   interview       - Technical/panel interview scheduled or completed
 *   offer           - Offer received
 *   rejected        - Rejection received
 *   withdrew        - Matt withdrew application
 *   ghosted         - No response after 14 days
 *   deferred        - Pre-submission: paused for priority reasons, may revive (--reason required)
 *   discarded       - Pre-submission: permanently out (offer closed, disqualifier) (--reason required)
 *
 * Pre-submission events (deferred, discarded) auto-create a responses.md row
 * if the app_id doesn't exist yet, with submitted_at='—'. Use these instead
 * of --new when the app was queued but never actually submitted.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const RESPONSES_FILE = resolve(ROOT, 'data', 'responses.md');

// ---- arg parsing ----
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  return args[i + 1] ?? true;
}

const isNew = args.includes('--new');
const appId = getArg('app-id');
const company = getArg('company');
const role = getArg('role');
const ats = getArg('ats');
const event = getArg('event') ?? 'submitted';
const date = getArg('date') ?? new Date().toISOString().slice(0, 10);
const notes = getArg('notes') ?? '';
const reason = getArg('reason') ?? '';

const VALID_EVENTS = [
  'submitted', 'acknowledged', 'recruiter_reply',
  'phone_screen', 'interview', 'offer',
  'rejected', 'withdrew', 'ghosted', 'in_progress',
  'deferred', 'discarded',
];

// Events that represent pre-submission state changes — allow auto-creation
// of a responses.md row if the app_id doesn't exist yet, and require --reason
// for audit trail (per templates/states.yml semantics).
const PRE_SUBMIT_EVENTS = new Set(['deferred', 'discarded']);

if (!VALID_EVENTS.includes(event)) {
  console.error(`[log-response] Invalid --event "${event}". Valid: ${VALID_EVENTS.join(', ')}`);
  process.exit(1);
}

if (PRE_SUBMIT_EVENTS.has(event) && !reason && !notes) {
  console.error(`[log-response] --event ${event} requires --reason "<explanation>" (or --notes) for audit trail.`);
  process.exit(1);
}

// ---- parse responses.md ----
function parseResponses() {
  if (!existsSync(RESPONSES_FILE)) {
    console.error(`[log-response] Missing ${RESPONSES_FILE}`);
    process.exit(1);
  }
  const raw = readFileSync(RESPONSES_FILE, 'utf8');
  const lines = raw.split('\n');
  const headerIdx = lines.findIndex(l => l.trim().startsWith('| app_id'));
  if (headerIdx === -1) {
    console.error('[log-response] Could not find header row in responses.md');
    process.exit(1);
  }
  const preamble = lines.slice(0, headerIdx).join('\n');
  const header = lines[headerIdx];
  const separator = lines[headerIdx + 1];
  const dataRows = lines.slice(headerIdx + 2).filter(l => l.trim().startsWith('|'));
  const trailingEmpty = lines.slice(headerIdx + 2).filter(l => !l.trim().startsWith('|')).join('\n');
  return { preamble, header, separator, dataRows, trailingEmpty };
}

function parseRow(line) {
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  return {
    app_id: cells[0] || '',
    company: cells[1] || '',
    role: cells[2] || '',
    submitted_at: cells[3] || '',
    ats: cells[4] || '',
    status: cells[5] || '',
    last_event_at: cells[6] || '',
    response_days: cells[7] || '',
    notes: cells[8] || ''
  };
}

function formatRow(r) {
  return `| ${r.app_id} | ${r.company} | ${r.role} | ${r.submitted_at} | ${r.ats} | ${r.status} | ${r.last_event_at} | ${r.response_days} | ${r.notes} |`;
}

function computeResponseDays(submittedAt, lastEventAt) {
  if (!submittedAt || !lastEventAt || submittedAt === lastEventAt) return '—';
  const a = new Date(submittedAt);
  const b = new Date(lastEventAt);
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return String(diff);
}

// ---- main ----
const { preamble, header, separator, dataRows, trailingEmpty } = parseResponses();
const rows = dataRows.map(parseRow);

if (isNew) {
  if (!company || !role || !ats) {
    console.error('[log-response] --new requires --company, --role, --ats, and --date');
    process.exit(1);
  }
  const maxId = Math.max(0, ...rows.map(r => parseInt(r.app_id, 10)).filter(n => !Number.isNaN(n)));
  const newId = String(maxId + 1).padStart(3, '0');
  const newRow = {
    app_id: newId,
    company,
    role,
    submitted_at: date,
    ats,
    status: 'submitted',
    last_event_at: date,
    response_days: '—',
    notes: notes || 'Submitted via log-response.mjs'
  };
  rows.push(newRow);
  console.log(`[log-response] Added new entry #${newId}: ${company} — ${role} (${ats})`);
} else {
  if (!appId) {
    console.error('[log-response] Requires --app-id (or use --new to create)');
    process.exit(1);
  }
  const paddedId = appId.padStart(3, '0');
  let row = rows.find(r => r.app_id === paddedId || r.app_id === appId);

  // Pre-submission events auto-create a minimal row when the app was queued
  // but never actually submitted (so it isn't in responses.md yet).
  if (!row && PRE_SUBMIT_EVENTS.has(event)) {
    const noteText = reason || notes || `Pre-submission ${event}`;
    row = {
      app_id: paddedId,
      company: company || '—',
      role: role || '—',
      submitted_at: '—',
      ats: ats || '—',
      status: event,
      last_event_at: date,
      response_days: '—',
      notes: noteText,
    };
    rows.push(row);
    console.log(`[log-response] Created pre-submission entry #${row.app_id} → ${event} on ${date} (${noteText})`);
  } else if (!row) {
    console.error(`[log-response] No row found for app_id=${appId}`);
    console.error(`Existing IDs: ${rows.map(r => r.app_id).join(', ')}`);
    process.exit(1);
  } else {
    row.status = event;
    row.last_event_at = date;
    row.response_days = computeResponseDays(row.submitted_at, row.last_event_at);
    const extraNote = reason || notes;
    if (extraNote) {
      row.notes = row.notes ? `${row.notes}; ${extraNote}` : extraNote;
    }
    console.log(`[log-response] Updated #${row.app_id} (${row.company}) → ${event} on ${date}${reason ? ` — ${reason}` : ''}`);
  }
}

// ---- write back ----
const out = [
  preamble,
  header,
  separator,
  ...rows.map(formatRow),
  trailingEmpty
].join('\n');

writeFileSync(RESPONSES_FILE, out);
console.log(`[log-response] Wrote ${rows.length} entries to ${RESPONSES_FILE}`);
