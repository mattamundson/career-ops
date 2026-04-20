#!/usr/bin/env node
/**
 * gmail-recruiter-sync.mjs
 *
 * Pulls recruiter-related Gmail messages into the markdown-native career-ops
 * tracker by updating:
 * - data/responses.md
 * - data/applications.md
 * - data/outreach/gmail-sync-review-YYYY-MM-DD.md (for unmatched emails)
 *
 * Auth uses a Google OAuth refresh token. Required env vars:
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_REFRESH_TOKEN
 *
 * Optional env vars:
 * - GMAIL_RECRUITER_QUERY      default: label:Recruiting newer_than:14d
 * - GMAIL_RECRUITER_MAX        default: 25
 *
 * Usage:
 *   node scripts/gmail-recruiter-sync.mjs --dry-run
 *   node scripts/gmail-recruiter-sync.mjs --apply
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertJobReady } from './automation-preflight.mjs';
import { loadProjectEnv } from './load-env.mjs';
import { createRunSummaryContext, finalizeRunSummary } from './run-summary.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { selectBestApplicationMatch } from './lib/scoring-core.mjs';
import { classifyResponse as aiClassifyResponse } from './lib/response-classifier.mjs';
import { notify } from './lib/notify.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const DATA_DIR = resolve(ROOT, 'data');
const APPLICATIONS_FILE = resolve(DATA_DIR, 'applications.md');
const RESPONSES_FILE = resolve(DATA_DIR, 'responses.md');
const STATE_FILE = resolve(DATA_DIR, 'gmail-sync-state.json');
const OUTREACH_DIR = resolve(DATA_DIR, 'outreach');
const DEFAULT_QUERY = 'label:Recruiting newer_than:14d';
const DEFAULT_MAX = 25;

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DRY_RUN = !APPLY || args.has('--dry-run');
const AI_CLASSIFY = args.has('--ai-classify');
const NO_CLASSIFY = args.has('--no-classify');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactWhitespace(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseMarkdownTable(filePath, expectedHeaderPrefix) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim().startsWith(expectedHeaderPrefix));
  if (headerIndex === -1) {
    throw new Error(`Could not find header ${expectedHeaderPrefix} in ${filePath}`);
  }
  const prefix = lines.slice(0, headerIndex).join('\n');
  const header = lines[headerIndex];
  const separator = lines[headerIndex + 1];
  const rowLines = [];
  let trailingStart = lines.length;
  for (let i = headerIndex + 2; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) {
      rowLines.push(lines[i]);
      continue;
    }
    trailingStart = i;
    break;
  }
  const trailing = lines.slice(trailingStart).join('\n');
  return { prefix, header, separator, rowLines, trailing };
}

function splitRow(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function parseApplications() {
  const table = parseMarkdownTable(APPLICATIONS_FILE, '| # |');
  const rows = table.rowLines.map((line) => {
    const cells = splitRow(line);
    const [id, date, company, role, score, status, pdf, report, ...notes] = cells;
    return {
      id,
      date,
      company,
      role,
      score,
      status,
      pdf,
      report,
      notes: notes.join(' | '),
    };
  });
  return { ...table, rows };
}

function formatApplicationRow(row) {
  return `| ${row.id} | ${row.date} | ${row.company} | ${row.role} | ${row.score} | ${row.status} | ${row.pdf} | ${row.report} | ${row.notes} |`;
}

function parseResponses() {
  const table = parseMarkdownTable(RESPONSES_FILE, '| app_id |');
  const rows = table.rowLines.map((line) => {
    const cells = splitRow(line);
    return {
      app_id: cells[0] || '',
      company: cells[1] || '',
      role: cells[2] || '',
      submitted_at: cells[3] || '',
      ats: cells[4] || '',
      status: cells[5] || '',
      last_event_at: cells[6] || '',
      response_days: cells[7] || '',
      notes: cells[8] || '',
    };
  });
  return { ...table, rows };
}

function formatResponseRow(row) {
  return `| ${row.app_id} | ${row.company} | ${row.role} | ${row.submitted_at} | ${row.ats} | ${row.status} | ${row.last_event_at} | ${row.response_days} | ${row.notes} |`;
}

function computeResponseDays(submittedAt, lastEventAt) {
  if (!submittedAt || !lastEventAt || submittedAt === lastEventAt) return '—';
  const delta = Math.round((new Date(lastEventAt) - new Date(submittedAt)) / 86400000);
  return String(Math.max(0, delta));
}

function loadState() {
  if (!existsSync(STATE_FILE)) {
    return { processed_message_ids: [] };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { processed_message_ids: [] };
  }
}

function saveState(state) {
  const trimmed = {
    processed_message_ids: Array.from(new Set(state.processed_message_ids)).slice(-1000),
    last_run_at: new Date().toISOString(),
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return response.json();
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: requiredEnv('GOOGLE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${response.status} ${await response.text()}`);
  }
  const json = await response.json();
  return json.access_token;
}

async function listMessages(accessToken, query, maxResults) {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(maxResults));
  return fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function decodeBase64Url(value) {
  if (!value) return '';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function extractTextFromPayload(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  const parts = payload.parts || [];
  for (const part of parts) {
    const text = extractTextFromPayload(part);
    if (text) return text;
  }
  return '';
}

async function getMessage(accessToken, id) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
  url.searchParams.set('format', 'full');
  const json = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const headers = Object.fromEntries(
    (json.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value])
  );
  const bodyText = compactWhitespace(extractTextFromPayload(json.payload));
  const snippet = compactWhitespace(json.snippet || '');
  return {
    id: json.id,
    threadId: json.threadId,
    internalDate: json.internalDate,
    subject: headers.subject || '',
    from: headers.from || '',
    date: headers.date || '',
    snippet,
    bodyText,
  };
}

function classifyEvent(message) {
  const haystack = normalize(`${message.subject} ${message.from} ${message.snippet} ${message.bodyText}`);
  if (/\b(unfortunately|not moving forward|will not be moving forward|regret to inform|decided to move forward with other candidates|position has been filled|rejection)\b/.test(haystack)) {
    return 'rejected';
  }
  if (/\b(offer letter|written offer|verbal offer|we are pleased to offer|offer details)\b/.test(haystack)) {
    return 'offer';
  }
  if (/\b(on site|onsite|panel interview|final interview|technical interview|interview loop)\b/.test(haystack)) {
    return 'interview';
  }
  if (/\b(phone screen|screening call|intro call|recruiter call|schedule a call|schedule time)\b/.test(haystack)) {
    return 'phone_screen_scheduled';
  }
  if (/\b(application received|thank you for applying|received your application|we have received your application|candidate portal)\b/.test(haystack)) {
    return 'acknowledged';
  }
  if (/\b(recruiter|talent acquisition|talent partner|hiring manager|sourcer)\b/.test(haystack)) {
    return 'recruiter_reply';
  }
  return 'recruiter_reply';
}

function canonicalStatusForEvent(event, currentStatus) {
  const rank = {
    Evaluated: 0,
    'Conditional GO': 0,
    GO: 0,
    'Ready to Submit': 0,
    Applied: 1,
    Contact: 2,
    Responded: 3,
    'In Progress': 3,
    Interview: 4,
    Offer: 5,
    Rejected: 5,
    Discarded: 5,
    SKIP: 5,
  };
  const mapping = {
    acknowledged: 'Applied',
    recruiter_reply: 'Responded',
    phone_screen_scheduled: 'Interview',
    phone_screen_done: 'Interview',
    interview: 'Interview',
    on_site_scheduled: 'Interview',
    on_site_done: 'Interview',
    offer: 'Offer',
    rejected: 'Rejected',
    withdrew: 'Discarded',
  };
  const candidate = mapping[event];
  if (!candidate) return currentStatus;
  if (currentStatus === 'SKIP' || currentStatus === 'Discarded') return currentStatus;
  return (rank[candidate] ?? 0) >= (rank[currentStatus] ?? 0) ? candidate : currentStatus;
}

function messageSummary(message, event) {
  const source = compactWhitespace(message.from.replace(/\s*<[^>]+>/, ''));
  const detail = compactWhitespace(message.snippet || message.subject).slice(0, 180);
  return `${event} via Gmail from ${source}: ${detail}`;
}

function appendUniqueNote(existing, addition) {
  if (!addition) return existing;
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}; ${addition}`;
}

function writeReviewFile(unmatched) {
  if (unmatched.length === 0) return null;
  mkdirSync(OUTREACH_DIR, { recursive: true });
  const file = resolve(OUTREACH_DIR, `gmail-sync-review-${todayString()}.md`);
  const lines = [
    `# Gmail Sync Review — ${todayString()}`,
    '',
    'Unmatched recruiter emails that need manual triage.',
    '',
  ];
  for (const item of unmatched) {
    lines.push(`## ${item.message.subject || '(no subject)'}`);
    lines.push(`- Event: ${item.event}`);
    lines.push(`- From: ${item.message.from || '(unknown sender)'}`);
    lines.push(`- Date: ${item.date}`);
    if (item.confidence !== undefined) {
      lines.push(`- Match confidence: ${Math.round(item.confidence * 100)}%`);
    }
    if (item.topCandidates?.length) {
      lines.push(`- Top candidates: ${item.topCandidates.join('; ')}`);
    }
    lines.push(`- Snippet: ${item.message.snippet || '(none)'}`);
    lines.push('');
  }
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

function writeApplications(table) {
  const content = [
    table.prefix,
    table.header,
    table.separator,
    ...table.rows.map(formatApplicationRow),
    table.trailing,
  ].join('\n');
  writeFileSync(APPLICATIONS_FILE, content, 'utf8');
}

function writeResponses(table) {
  const content = [
    table.prefix,
    table.header,
    table.separator,
    ...table.rows.map(formatResponseRow),
    table.trailing,
  ].join('\n');
  writeFileSync(RESPONSES_FILE, content, 'utf8');
}

async function main() {
  loadProjectEnv(ROOT);
  const readiness = assertJobReady(ROOT, 'gmail-sync');
  const run = createRunSummaryContext(ROOT, 'gmail-sync', { warnings: readiness.warnings });

  const query = process.env.GMAIL_RECRUITER_QUERY || DEFAULT_QUERY;
  const maxResults = parseInt(process.env.GMAIL_RECRUITER_MAX || String(DEFAULT_MAX), 10);
  const state = loadState();
  const applicationsTable = parseApplications();
  const responsesTable = parseResponses();

  const accessToken = await getAccessToken();
  const listed = await listMessages(accessToken, query, maxResults);
  const ids = (listed.messages || []).map((m) => m.id);
  const unseenIds = ids.filter((id) => !state.processed_message_ids.includes(id));

  if (unseenIds.length === 0) {
    console.log(`[gmail-sync] No new Gmail messages for query: ${query}`);
    const { mdPath } = finalizeRunSummary(run, 'success', {
      stats: { query, maxResults, scanned_messages: ids.length, new_messages: 0, matched: 0, unmatched: 0 },
    });
    appendAutomationEvent(ROOT, {
      type: 'gmail-sync.run.completed',
      status: 'no_new_messages',
      summary: `No new Gmail messages (${ids.length} scanned, all already processed).`,
      details: {
        query,
        scanned_messages: ids.length,
        new_messages: 0,
        matched: 0,
        unmatched: 0,
        summary_report: mdPath,
      },
    });
    console.log(`[gmail-sync] Run summary: ${mdPath}`);
    return;
  }

  const messages = [];
  for (const id of unseenIds) {
    messages.push(await getMessage(accessToken, id));
  }
  messages.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));

  let matchedCount = 0;
  let updatedResponses = 0;
  let updatedApplications = 0;
  const unmatched = [];
  const matchedSummary = []; // [{app_id, company, role, event, date, subject}] — for notification body

  for (const message of messages) {
    let event = classifyEvent(message);

    // AI-powered classification (opt-in via --ai-classify, requires ANTHROPIC_API_KEY)
    if (AI_CLASSIFY && !NO_CLASSIFY && process.env.ANTHROPIC_API_KEY) {
      try {
        const aiResult = await aiClassifyResponse(
          message.subject || '',
          message.bodyText || message.snippet || '',
          {}, // context filled after match below
        );
        if (aiResult.confidence > 0.7 && !aiResult.error) {
          // Map AI classification to existing event names
          const aiToEvent = {
            interview_invite: 'phone_screen_scheduled',
            rejection: 'rejected',
            info_request: 'recruiter_reply',
            offer: 'offer',
            follow_up: 'recruiter_reply',
            automated: 'acknowledged',
          };
          const mapped = aiToEvent[aiResult.classification];
          if (mapped) {
            console.log(`  [AI] ${message.subject?.slice(0, 50)} → ${aiResult.classification} (${(aiResult.confidence * 100).toFixed(0)}%)`);
            event = mapped;
          }
        }
      } catch { /* fall back to regex classification */ }
    }

    const match = selectBestApplicationMatch(applicationsTable.rows, message);
    const app = match.match;
    const eventDate = new Date(Number(message.internalDate || Date.now())).toISOString().slice(0, 10);
    if (!app) {
      unmatched.push({
        message,
        event,
        date: eventDate,
        confidence: match.confidence,
        topCandidates: (match.ranked || [])
          .slice(0, 3)
          .map((candidate) => `${candidate.application.company} / ${candidate.application.role} (${candidate.score})`),
      });
      continue;
    }

    matchedCount++;
    matchedSummary.push({
      app_id: app.id,
      company: app.company,
      role: app.role,
      event,
      date: eventDate,
      subject: (message.subject || '').slice(0, 100),
    });
    const note = messageSummary(message, event);

    let response = responsesTable.rows.find((row) => row.app_id === app.id);
    if (!response) {
      response = {
        app_id: app.id,
        company: app.company,
        role: app.role,
        submitted_at: app.date,
        ats: 'Gmail Sync',
        status: event,
        last_event_at: eventDate,
        response_days: computeResponseDays(app.date, eventDate),
        notes: note,
      };
      responsesTable.rows.push(response);
      updatedResponses++;
    } else {
      const original = JSON.stringify(response);
      response.status = event;
      response.last_event_at = eventDate;
      response.response_days = computeResponseDays(response.submitted_at, eventDate);
      response.notes = appendUniqueNote(response.notes, note);
      if (JSON.stringify(response) !== original) updatedResponses++;
    }

    const nextStatus = canonicalStatusForEvent(event, app.status);
    const nextAppNote = appendUniqueNote(app.notes, `Gmail sync ${eventDate}: ${event}`);
    if (nextStatus !== app.status || nextAppNote !== app.notes) {
      app.status = nextStatus;
      app.notes = nextAppNote;
      updatedApplications++;
    }
  }

  const reviewFile = writeReviewFile(unmatched);

  console.log(`[gmail-sync] Query: ${query}`);
  console.log(`[gmail-sync] New Gmail messages: ${messages.length}`);
  console.log(`[gmail-sync] Matched applications: ${matchedCount}`);
  console.log(`[gmail-sync] Unmatched messages: ${unmatched.length}`);
  console.log(`[gmail-sync] responses.md changes: ${updatedResponses}`);
  console.log(`[gmail-sync] applications.md changes: ${updatedApplications}`);
  if (reviewFile) {
    console.log(`[gmail-sync] Review file: ${reviewFile}`);
  }

  if (DRY_RUN) {
    console.log('[gmail-sync] Dry run only. No markdown files were modified.');
    const { mdPath } = finalizeRunSummary(run, 'success', {
      stats: {
        query,
        maxResults,
        scanned_messages: ids.length,
        new_messages: messages.length,
        matched: matchedCount,
        unmatched: unmatched.length,
        responses_changed: updatedResponses,
        applications_changed: updatedApplications,
        dry_run: true,
      },
      artifacts: reviewFile ? [reviewFile] : [],
    });
    appendAutomationEvent(ROOT, {
      type: 'gmail-sync.run.completed',
      status: 'dry_run',
      summary: `Processed ${messages.length} recruiter emails with ${matchedCount} matches.`,
      details: {
        query,
        matched: matchedCount,
        unmatched: unmatched.length,
        dry_run: true,
        summary_report: mdPath,
      },
    });
    console.log(`[gmail-sync] Run summary: ${mdPath}`);
    return;
  }

  writeResponses(responsesTable);
  writeApplications(applicationsTable);
  state.processed_message_ids.push(...messages.map((m) => m.id));
  saveState(state);
  console.log('[gmail-sync] Applied changes to tracker files.');

  // Notify on real signal: at least one matched recruiter touch.
  // High-priority events (interview/offer/rejected) escalate urgency.
  if (matchedCount > 0) {
    const escalateEvents = new Set(['phone_screen_scheduled', 'on_site_scheduled', 'interview', 'offer', 'rejected']);
    const escalate = matchedSummary.some((m) => escalateEvents.has(m.event));
    const lines = matchedSummary.slice(0, 8).map((m) =>
      `• #${m.app_id} ${m.company} — ${m.event}${m.subject ? `\n   ↳ "${m.subject}"` : ''}`);
    const more = matchedSummary.length > 8 ? `\n…and ${matchedSummary.length - 8} more` : '';
    const action = 'See docs/RESPONSE-PLAYBOOK.md. Log via: pnpm run respond';
    try {
      const r = await notify({
        kind: 'gmail-sync',
        title: `📬 ${matchedCount} recruiter touch${matchedCount === 1 ? '' : 'es'} — career-ops`,
        body: `${lines.join('\n')}${more}`,
        action,
        urgency: escalate ? 'high' : 'normal',
      });
      console.log(`[gmail-sync] Notify delivered: ${r.delivered.join(', ') || '(none)'}${r.errors.length ? ` | errors: ${r.errors.join('; ')}` : ''}`);
    } catch (err) {
      console.error(`[gmail-sync] Notify failed: ${err.message}`);
    }
  }
  const { mdPath } = finalizeRunSummary(run, 'success', {
    stats: {
      query,
      maxResults,
      scanned_messages: ids.length,
      new_messages: messages.length,
      matched: matchedCount,
      unmatched: unmatched.length,
      responses_changed: updatedResponses,
      applications_changed: updatedApplications,
      dry_run: false,
    },
    artifacts: [STATE_FILE, ...(reviewFile ? [reviewFile] : [])],
  });
  appendAutomationEvent(ROOT, {
    type: 'gmail-sync.run.completed',
    status: 'success',
    summary: `Processed ${messages.length} recruiter emails with ${matchedCount} matches.`,
    details: {
      query,
      matched: matchedCount,
      unmatched: unmatched.length,
      responses_changed: updatedResponses,
      applications_changed: updatedApplications,
      dry_run: false,
      summary_report: mdPath,
    },
  });
  console.log(`[gmail-sync] Run summary: ${mdPath}`);
}

main().catch((error) => {
  try {
    const run = createRunSummaryContext(ROOT, 'gmail-sync');
    const { mdPath } = finalizeRunSummary(run, 'failure', { error: error.message });
    appendAutomationEvent(ROOT, {
      type: 'gmail-sync.run.failed',
      status: 'failure',
      summary: error.message,
      details: { summary_report: mdPath },
    });
    console.error(`[gmail-sync] Run summary: ${mdPath}`);
  } catch {}
  console.error(`[gmail-sync] FATAL: ${error.message}`);
  process.exit(1);
});
