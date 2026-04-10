#!/usr/bin/env node
/**
 * check-cadence-alert.mjs — Staleness detector + OpenClaw WhatsApp alert
 *
 * Runs the same cadence-check logic as check-cadence.mjs and sends stale
 * entries to WhatsApp via the OpenClaw gateway CLI.
 *
 * Usage:
 *   node scripts/check-cadence-alert.mjs
 *
 * Env vars:
 *   OPENCLAW_WHATSAPP_TO  — E.164 recipient (e.g. +16128771189). Required for
 *                           WhatsApp send. If unset, falls back to a Windows
 *                           toast notification via PowerShell.
 *   CAREER_OPS_DRY_RUN    — If "1", prints the alert message but does not send.
 *
 * Exit codes:
 *   0  — success (including "no stale entries" case)
 *   1  — fatal error (cannot read applications.md or send failed)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DRY_RUN = process.env.CAREER_OPS_DRY_RUN === '1';
const PHONE_TO = (process.env.OPENCLAW_WHATSAPP_TO || '').trim();

// ── YAML parser (minimal — mirrors check-cadence.mjs) ───────────────────────
function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let currentSection = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;

    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*$/);
    if (topMatch) {
      currentSection = topMatch[1];
      result[currentSection] = {};
      continue;
    }

    const nestedMatch = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)$/);
    if (nestedMatch && currentSection) {
      const key = nestedMatch[1];
      const raw_val = nestedMatch[2].trim().replace(/^["']|["']$/g, '');
      const num = Number(raw_val);
      result[currentSection][key] = isNaN(num) ? raw_val : num;
      continue;
    }

    const flatMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)$/);
    if (flatMatch) currentSection = null;
  }
  return result;
}

// ── Load thresholds ──────────────────────────────────────────────────────────
const DEFAULT_THRESHOLDS = {
  evaluated_days: 14,
  applied_days:   7,
  responded_days: 5,
  contact_days:   5,
  interview_days: 10,
};

function loadThresholds() {
  try {
    const yml = readFileSync(resolve(ROOT, 'config/profile.yml'), 'utf8');
    const parsed = parseYaml(yml);
    if (parsed.cadence && Object.keys(parsed.cadence).length > 0) {
      return { ...DEFAULT_THRESHOLDS, ...parsed.cadence };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_THRESHOLDS };
}

// ── Markdown table parser ────────────────────────────────────────────────────
function parseMarkdownTable(text) {
  const lines = text.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 2) return [];

  const headers = lines[0]
    .split('|')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);

  const dataLines = lines.slice(1).filter(l => !/^\|\s*[-:]+/.test(l));

  const rows = [];
  for (const line of dataLines) {
    const cells = line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < headers.length) continue;
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    rows.push(row);
  }
  return rows;
}

// ── Date helpers ─────────────────────────────────────────────────────────────
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function daysSince(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((TODAY - d) / (1000 * 60 * 60 * 24));
}

function getThreshold(status, thresholds) {
  const s = status.toLowerCase().trim();
  const map = {
    evaluated: thresholds.evaluated_days,
    applied:   thresholds.applied_days,
    responded: thresholds.responded_days,
    contact:   thresholds.contact_days,
    interview: thresholds.interview_days,
  };
  return map[s] ?? null;
}

function getAction(status) {
  const s = status.toLowerCase().trim();
  const actions = {
    evaluated: 'Submit or archive',
    applied:   'Follow up',
    responded: 'Schedule next step',
    contact:   'Follow up with contact',
    interview: 'Send thank-you / request decision',
  };
  return actions[s] ?? 'Review and act';
}

// ── Build alert message ──────────────────────────────────────────────────────
function buildAlertMessage(stale, dateStr) {
  const header = `Career-Ops Cadence Alert (${dateStr})\n${stale.length} stale application${stale.length === 1 ? '' : 's'} need action:\n`;

  const lines = stale.map((e, i) => {
    const overdue = e.days - e.threshold;
    const overdueStr = overdue >= 0 ? `+${overdue}d over` : `${Math.abs(overdue)}d left`;
    return `${i + 1}. ${e.company} | ${e.role} | ${e.status} | ${e.days}d (${overdueStr}) — ${getAction(e.status)}`;
  });

  return header + lines.join('\n');
}

// ── Send via OpenClaw WhatsApp ───────────────────────────────────────────────
function sendViaOpenClaw(message, phone) {
  if (DRY_RUN) {
    console.log('[DRY RUN] Would send via OpenClaw WhatsApp:');
    console.log(message);
    return true;
  }

  const result = spawnSync(
    'wsl',
    ['-d', 'Ubuntu', '-e', 'openclaw', 'message', 'send',
      '--channel', 'whatsapp',
      '--target', phone,
      '-m', message,
    ],
    { encoding: 'utf8', timeout: 30_000 }
  );

  if (result.status === 0) {
    console.log(`[check-cadence-alert] OpenClaw WhatsApp sent to ${phone}.`);
    return true;
  }

  console.error('[check-cadence-alert] OpenClaw send failed:', result.stderr || result.error?.message);
  return false;
}

// ── Fallback: PowerShell toast notification ──────────────────────────────────
function sendViaToast(message) {
  if (DRY_RUN) {
    console.log('[DRY RUN] Would send Windows toast:');
    console.log(message);
    return true;
  }

  // Windows toast via BurntToast or MessageBox fallback
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
  ${JSON.stringify(message)},
  'Career-Ops Stale Alert',
  'OK',
  'Warning'
) | Out-Null
`;

  const result = spawnSync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-Command', psScript],
    { encoding: 'utf8', timeout: 30_000 }
  );

  if (result.status === 0) {
    console.log('[check-cadence-alert] Windows toast notification sent.');
    return true;
  }

  console.error('[check-cadence-alert] Toast fallback failed:', result.stderr || result.error?.message);
  return false;
}

// ── Fallback: write markdown alert file ─────────────────────────────────────
function writeAlertFile(message, dateStr) {
  const alertDir = resolve(ROOT, 'data');
  try { mkdirSync(alertDir, { recursive: true }); } catch { /* exists */ }

  const filename = resolve(alertDir, `stale-alert-${dateStr}.md`);
  writeFileSync(filename, `# Stale Alert — ${dateStr}\n\n\`\`\`\n${message}\n\`\`\`\n`, 'utf8');
  console.log(`[check-cadence-alert] Alert written to ${filename}`);
  return filename;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const thresholds = loadThresholds();

  let mdText;
  try {
    mdText = readFileSync(resolve(ROOT, 'data/applications.md'), 'utf8');
  } catch (e) {
    console.error('ERROR: Cannot read data/applications.md —', e.message);
    process.exit(1);
  }

  const rows = parseMarkdownTable(mdText);
  if (rows.length === 0) {
    console.log('[check-cadence-alert] No application rows found — nothing to check.');
    process.exit(0);
  }

  const stale = [];
  for (const row of rows) {
    const date    = row['date']    || '';
    const company = row['company'] || '(unknown)';
    const role    = row['role']    || '(unknown)';
    const status  = row['status']  || '';

    const days = daysSince(date);
    if (days === null) continue;

    const threshold = getThreshold(status, thresholds);
    if (threshold === null) continue;

    if (days >= threshold) {
      stale.push({ company, role, status, date, days, threshold });
    }
  }

  // Sort oldest first
  stale.sort((a, b) => b.days - a.days);

  const dateStr = TODAY.toISOString().slice(0, 10);

  process.stderr.write(
    `[check-cadence-alert] ${rows.length} entries scanned, ${stale.length} stale.\n`
  );

  if (stale.length === 0) {
    console.log(`[check-cadence-alert] All applications within cadence as of ${dateStr}.`);
    process.exit(0);
  }

  const message = buildAlertMessage(stale, dateStr);

  // Strategy 1: OpenClaw WhatsApp (requires OPENCLAW_WHATSAPP_TO)
  if (PHONE_TO) {
    const sent = sendViaOpenClaw(message, PHONE_TO);
    if (sent) process.exit(0);
  } else {
    console.warn('[check-cadence-alert] OPENCLAW_WHATSAPP_TO not set — skipping WhatsApp send.');
  }

  // Strategy 2: Windows toast notification
  console.log('[check-cadence-alert] Trying Windows toast fallback...');
  const toastSent = sendViaToast(message);

  // Strategy 3: Always write alert file as a durable record
  writeAlertFile(message, dateStr);

  process.exit(toastSent ? 0 : 1);
}

main();
