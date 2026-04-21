#!/usr/bin/env node
/**
 * generate-followups.mjs — Draft follow-up emails for stale pending applications.
 *
 * Reads data/applications.md + data/responses.md, filters applications whose
 * last event is >= STALE_DAYS ago, and writes a short Claude-Haiku-drafted
 * follow-up email for each to data/outreach/followup-YYYY-MM-DD-{slug}.md.
 *
 * Never sends. Drafts are ready for Matt to review and copy-paste.
 *
 * Usage:
 *   node scripts/generate-followups.mjs                   # full run, defaults to 7d threshold
 *   node scripts/generate-followups.mjs --dry-run         # list what would be drafted, don't call Claude
 *   node scripts/generate-followups.mjs --stale-days=14   # override threshold
 *   node scripts/generate-followups.mjs --application-id=024   # one specific app (used by check-cadence-alert)
 *
 * Ethical note: drafts are suggestions, not sends. The --force flag only
 * bypasses idempotency; no flag sends messages. Matt reviews each draft.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseApplicationsTracker } from './lib/career-data.mjs';
import { daysSinceIsoDate, toIsoDate } from './lib/dates.mjs';
import { isMainEntry } from './lib/main-entry.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const OUTREACH_DIR = join(ROOT, 'data', 'outreach');

// Statuses where a follow-up makes sense. Skips terminal states (Rejected,
// Offer, Discarded) and early states that Matt hasn't yet submitted.
const FOLLOWUPABLE_STATUSES = new Set([
  'Applied',
  'Responded',
  'Contact',
  'Interview',
  'In Progress',
]);

const TERMINAL_STATUSES = new Set([
  'Rejected', 'Offer', 'Discarded', 'Withdrew', 'SKIP',
]);

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    staleDays: 7,
    dryRun: false,
    applicationId: null,
    force: false,
    idempotencyDays: 7,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.indexOf('=');
    const [k, v] = eq >= 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, args[i + 1]];
    if (k === '--stale-days')          { out.staleDays = parseInt(v, 10); if (eq < 0) i++; }
    else if (k === '--idempotency-days') { out.idempotencyDays = parseInt(v, 10); if (eq < 0) i++; }
    else if (k === '--application-id') { out.applicationId = String(v).padStart(3, '0'); if (eq < 0) i++; }
    else if (k === '--dry-run')        { out.dryRun = true; }
    else if (k === '--force')          { out.force = true; }
  }
  return out;
}

// Parse responses.md minimal schema — extract per-app { lastEvent, lastEventType }.
function parseResponses(root) {
  const path = join(root, 'data', 'responses.md');
  if (!existsSync(path)) return new Map();
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const map = new Map(); // app_id → { lastEventAt, status, responseDays, notes }
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 9) continue;
    const [appId, , , , , status, lastEventAt, responseDays, notes] = cells;
    if (!/^\d{3}$/.test(appId)) continue; // skip header/divider rows
    const existing = map.get(appId);
    // Keep the row with the latest lastEventAt (responses.md can have
    // multiple rows per app from different sync runs).
    if (!existing || (lastEventAt || '') > (existing.lastEventAt || '')) {
      map.set(appId, {
        lastEventAt: lastEventAt || '',
        status: status || '',
        responseDays: responseDays || '',
        notes: notes || '',
      });
    }
  }
  return map;
}

function slugify(s) {
  return String(s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Return drafts written in the last `idempotencyDays` so we can skip re-drafts.
function recentDrafts(dir, idempotencyDays) {
  if (!existsSync(dir)) return new Map();
  const map = new Map(); // appId → most-recent draft path
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('followup-') || !name.endsWith('.md')) continue;
    const m = name.match(/^followup-(\d{4}-\d{2}-\d{2})-(\d{3})-/);
    if (!m) continue;
    const [, dateStr, appId] = m;
    if (daysSinceIsoDate(dateStr) > idempotencyDays) continue;
    const prev = map.get(appId);
    if (!prev || dateStr > prev.dateStr) {
      map.set(appId, { dateStr, path: join(dir, name) });
    }
  }
  return map;
}

// Compose a short follow-up email via Claude Haiku. Falls back to a
// template when ANTHROPIC_API_KEY is missing or the API errors.
async function draftFollowup(app, context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fallback = () => ({
    subject: `Following up — ${app.role} at ${app.company}`,
    body: [
      `Hi${context.recruiterName ? ' ' + context.recruiterName : ''},`,
      '',
      `I wanted to follow up on my application for the ${app.role} role at ${app.company}, submitted on ${app.date || 'the date above'}. I remain very interested and wanted to confirm you have everything needed on your end.`,
      '',
      'Happy to provide additional materials or answer any questions. Looking forward to hearing from you.',
      '',
      'Best,',
      'Matt Amundson',
    ].join('\n'),
    source: 'template',
  });

  if (!apiKey) return { ...fallback(), source: 'template (no API key)' };

  const prompt = `You are drafting a follow-up email for a job application. Match this tone exactly: polite, brief, value-added, never pushy. Do NOT invent facts.

Application:
- Company: ${app.company}
- Role: ${app.role}
- Applied: ${app.date || 'unknown'}
- Current status: ${app.status}
- Days silent: ${context.daysSilent}
- Last response event: ${context.lastEventType || 'none'}
- Notes: ${context.notes || 'none'}

Write a 2-3 sentence follow-up email (plus greeting + sign-off) for Matt Amundson to send. Key constraints:
- Under 90 words total
- Reference the specific role and company
- Do NOT reference the days-silent count directly (sounds desperate)
- Offer to provide additional materials or answer questions
- Sign off as "Matt Amundson"

Respond with ONLY a JSON object (no markdown):
{"subject":"...","body":"Hi ..."}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic ${response.status}: ${err.slice(0, 200)}`);
    }
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subject || !parsed.body) throw new Error('Missing subject/body');
    return { subject: String(parsed.subject), body: String(parsed.body), source: 'claude-haiku' };
  } catch (err) {
    console.warn(`  [haiku] ${app.company} fallback to template: ${err.message}`);
    return { ...fallback(), source: `template (${err.message.slice(0, 80)})` };
  }
}

export async function main() {
  const opts = parseArgs(process.argv);
  const today = toIsoDate();

  const apps = parseApplicationsTracker(ROOT);
  const responsesByApp = parseResponses(ROOT);

  // Build the stale candidate list.
  const candidates = [];
  for (const app of apps) {
    if (opts.applicationId && app.id !== opts.applicationId) continue;
    if (TERMINAL_STATUSES.has(app.status)) continue;
    if (!FOLLOWUPABLE_STATUSES.has(app.status)) continue;

    const resp = responsesByApp.get(app.id);
    const lastEventAt = resp?.lastEventAt || app.date;
    const daysSilent = daysSinceIsoDate(lastEventAt);
    if (daysSilent < opts.staleDays) continue;

    candidates.push({
      app,
      lastEventAt,
      daysSilent,
      lastEventType: resp?.status || 'applied',
      notes: resp?.notes || app.notes,
    });
  }

  // Sort most-silent first — those are the highest priority to nudge.
  candidates.sort((a, b) => b.daysSilent - a.daysSilent);

  if (candidates.length === 0) {
    console.log(`[followups] no stale applications (threshold=${opts.staleDays}d)`);
    appendAutomationEvent(ROOT, {
      type: 'automation.followups.completed',
      status: 'success',
      summary: `No stale applications (threshold=${opts.staleDays}d)`,
      details: { candidates: 0, drafted: 0, skipped: 0, staleDays: opts.staleDays },
    });
    return 0;
  }

  console.log(`[followups] ${candidates.length} stale application(s) found (threshold=${opts.staleDays}d)`);

  if (opts.dryRun) {
    for (const c of candidates) {
      console.log(`  [${c.app.id}] ${c.app.company} — ${c.app.role} (${c.daysSilent}d silent, status=${c.app.status})`);
    }
    return 0;
  }

  mkdirSync(OUTREACH_DIR, { recursive: true });
  const existingDrafts = opts.force ? new Map() : recentDrafts(OUTREACH_DIR, opts.idempotencyDays);

  let drafted = 0;
  let skipped = 0;
  const outputs = [];

  for (const c of candidates) {
    const { app } = c;
    if (existingDrafts.has(app.id)) {
      const prev = existingDrafts.get(app.id);
      console.log(`  [${app.id}] skip — recent draft exists at ${prev.path}`);
      skipped++;
      continue;
    }
    console.log(`  [${app.id}] drafting for ${app.company} (${c.daysSilent}d silent)...`);
    const draft = await draftFollowup(app, c);
    const slug = `${app.id}-${slugify(app.company)}`;
    const outPath = join(OUTREACH_DIR, `followup-${today}-${slug}.md`);

    const content = [
      '---',
      `application_id: "${app.id}"`,
      `company: ${JSON.stringify(app.company)}`,
      `role: ${JSON.stringify(app.role)}`,
      `status: ${JSON.stringify(app.status)}`,
      `applied_at: "${app.date}"`,
      `last_event_at: "${c.lastEventAt}"`,
      `days_silent: ${c.daysSilent}`,
      `suggested_send_date: "${today}"`,
      `drafted_at: "${today}"`,
      `drafted_by: "${draft.source}"`,
      '---',
      '',
      `# Follow-up draft — ${app.company} / ${app.role}`,
      '',
      `**Application #${app.id}** · status: ${app.status} · ${c.daysSilent} days silent since ${c.lastEventAt}`,
      '',
      '## Subject',
      '',
      draft.subject,
      '',
      '## Body',
      '',
      draft.body,
      '',
      '---',
      '',
      '_Review before sending. Does not auto-send. To retire this draft, delete this file._',
      '',
    ].join('\n');

    writeFileSync(outPath, content, 'utf-8');
    drafted++;
    outputs.push({ appId: app.id, company: app.company, daysSilent: c.daysSilent, path: outPath });
  }

  console.log(`[followups] drafted=${drafted} skipped=${skipped} candidates=${candidates.length}`);
  console.log(`[followups] review drafts under: ${OUTREACH_DIR}`);

  appendAutomationEvent(ROOT, {
    type: 'automation.followups.completed',
    status: 'success',
    summary: `Drafted ${drafted} follow-up(s), skipped ${skipped} idempotent`,
    details: {
      candidates: candidates.length,
      drafted,
      skipped,
      staleDays: opts.staleDays,
      applications: outputs.map((o) => ({ id: o.appId, company: o.company, days_silent: o.daysSilent })),
    },
  });

  return 0;
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    console.error('[generate-followups] Fatal:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

export { parseArgs, parseResponses, slugify, recentDrafts };
