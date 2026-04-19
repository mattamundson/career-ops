#!/usr/bin/env node
/**
 * respond.mjs — Interactive wrapper around log-response.mjs.
 *
 * Designed for daily-use: zero-friction logging of recruiter responses
 * and status updates without remembering CLI flags.
 *
 * Run as:
 *   pnpm run respond               (interactive prompts)
 *   pnpm run respond -- --app-id 042 --event acknowledged   (passthrough)
 *
 * After logging, automatically runs `verify:all` (with --skip-missing-reports
 * + --skip-unit-tests for speed) so tracker drift is caught immediately.
 *
 * Skips verify if --no-verify is passed.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// Subset of VALID_EVENTS most useful for daily-use prompts. Full set
// available via passthrough (--event <whatever>).
const COMMON_EVENTS = [
  'submitted',
  'acknowledged',
  'recruiter_reply',
  'phone_screen_scheduled',
  'phone_screen_done',
  'on_site_scheduled',
  'on_site_done',
  'interview',
  'offer',
  'rejected',
  'withdrew',
  'ghosted',
];

const args = process.argv.slice(2);
const passthrough = args.length > 0 && args.some((a) => a.startsWith('--app-id') || a === '--new' || a.startsWith('--bulk'));
const skipVerify = args.includes('--no-verify');

if (passthrough) {
  // User provided full flags — just delegate to log-response.mjs
  const filtered = args.filter((a) => a !== '--no-verify');
  const r = spawnSync(
    process.execPath,
    [resolve(ROOT, 'scripts', 'log-response.mjs'), ...filtered],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
  if (!skipVerify) runVerify();
  process.exit(0);
}

// Interactive mode
const rl = createInterface({ input, output });

try {
  printRecentApps();
  console.log('');

  const appId = (await rl.question('app-id (e.g. 042 or "new"): ')).trim();
  if (!appId) exitMsg('No app-id provided.', 1);

  if (appId === 'new') {
    const company = (await rl.question('company: ')).trim();
    const role = (await rl.question('role: ')).trim();
    const ats = (await rl.question('ats (greenhouse/ashby/lever/workday/icims/...): ')).trim();
    const date = (await rl.question(`date [${today()}]: `)).trim() || today();
    if (!company || !role) exitMsg('company and role required for --new.', 1);

    rl.close();
    runLogResponse(['--new', '--company', company, '--role', role, '--ats', ats, '--date', date]);
    if (!skipVerify) runVerify();
    process.exit(0);
  }

  console.log('\nCommon events:');
  COMMON_EVENTS.forEach((e, i) => console.log(`  ${(i + 1).toString().padStart(2)}. ${e}`));
  console.log('   (or type the full event name for less common ones)\n');

  const eventInput = (await rl.question('event (number or name): ')).trim();
  let event;
  if (/^\d+$/.test(eventInput)) {
    const idx = Number(eventInput) - 1;
    if (idx < 0 || idx >= COMMON_EVENTS.length) exitMsg(`Invalid number: ${eventInput}`, 1);
    event = COMMON_EVENTS[idx];
  } else {
    event = eventInput;
  }
  if (!event) exitMsg('No event provided.', 1);

  const date = (await rl.question(`date [${today()}]: `)).trim() || today();
  const notes = (await rl.question('notes (optional, single line): ')).trim();

  // Some events need --reason; if user picked deferred/discarded, prompt
  let reason = null;
  if (event === 'deferred' || event === 'discarded') {
    reason = (await rl.question('reason (required for deferred/discarded): ')).trim();
    if (!reason) exitMsg(`--reason required for ${event}.`, 1);
  }

  rl.close();

  const cliArgs = ['--app-id', appId, '--event', event, '--date', date];
  if (notes) cliArgs.push('--notes', notes);
  if (reason) cliArgs.push('--reason', reason);

  console.log('');
  runLogResponse(cliArgs);
  if (!skipVerify) runVerify();
} catch (err) {
  rl.close();
  console.error(`[respond] ${err?.message || err}`);
  process.exit(1);
}

// ─── helpers ───────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function exitMsg(msg, code) {
  console.error(`[respond] ${msg}`);
  rl.close();
  process.exit(code);
}

function runLogResponse(cliArgs) {
  const r = spawnSync(
    process.execPath,
    [resolve(ROOT, 'scripts', 'log-response.mjs'), ...cliArgs],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error(`[respond] log-response failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function runVerify() {
  console.log('\n[respond] Running verify:all...\n');
  const r = spawnSync(
    process.execPath,
    [
      resolve(ROOT, 'scripts', 'verify-all.mjs'),
      '--skip-missing-reports',
      '--skip-unit-tests',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error(`\n[respond] verify-all reported issues (exit ${r.status}). Check output above.`);
    process.exit(r.status ?? 1);
  }
}

function printRecentApps() {
  // Quick sanity glance: last ~10 applications.md rows so user can find
  // the app-id without leaving the prompt.
  try {
    const md = readFileSync(resolve(ROOT, 'data', 'applications.md'), 'utf8');
    const lines = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    const recent = lines.slice(-10);
    if (recent.length === 0) {
      console.log('(no applications in tracker yet)');
      return;
    }
    console.log('Recent applications:');
    for (const line of recent) {
      const cols = line.split('|').map((c) => c.trim());
      // cols: '', #, Date, Company, Role, Score, Status, PDF, Report, Notes, ''
      const num = cols[1] || '?';
      const company = (cols[3] || '').slice(0, 30);
      const role = (cols[4] || '').slice(0, 35);
      const status = cols[6] || '';
      console.log(`  ${num.padStart(3)} | ${status.padEnd(18)} | ${company.padEnd(30)} | ${role}`);
    }
  } catch {
    console.log('(could not read applications.md)');
  }
}
