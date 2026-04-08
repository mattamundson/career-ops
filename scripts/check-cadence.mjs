#!/usr/bin/env node
/**
 * check-cadence.mjs — Follow-up cadence checker for career-ops
 * Usage: node scripts/check-cadence.mjs
 * No external dependencies. ESM.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── YAML parser (minimal, handles flat + nested key: value only) ────────────
function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let currentSection = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;

    // Top-level key with no value → section header
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*$/);
    if (topMatch) {
      currentSection = topMatch[1];
      result[currentSection] = {};
      continue;
    }

    // Nested key: value (2-space indent)
    const nestedMatch = line.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)$/);
    if (nestedMatch && currentSection) {
      const key = nestedMatch[1];
      const raw_val = nestedMatch[2].trim().replace(/^["']|["']$/g, '');
      const num = Number(raw_val);
      result[currentSection][key] = isNaN(num) ? raw_val : num;
      continue;
    }

    // Top-level key: value (no indent, has value)
    const flatMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)$/);
    if (flatMatch) {
      currentSection = null; // exit section context
    }
  }

  return result;
}

// ── Load config ─────────────────────────────────────────────────────────────
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
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_THRESHOLDS };
}

// ── Markdown table parser ────────────────────────────────────────────────────
function parseMarkdownTable(text) {
  const lines = text.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 2) return [];

  // Header row
  const headers = lines[0]
    .split('|')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);

  // Skip separator row (---|---)
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
const TODAY = new Date('2026-04-07');

function daysSince(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((TODAY - d) / (1000 * 60 * 60 * 24));
}

// ── Threshold lookup ──────────────────────────────────────────────────────────
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
    evaluated: 'Submit application or archive',
    applied:   'Send follow-up email',
    responded: 'Schedule next step or reply',
    contact:   'Follow up with contact',
    interview: 'Send thank-you / request decision',
  };
  return actions[s] ?? 'Review and act';
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
    console.log('No application rows found in data/applications.md.');
    process.exit(0);
  }

  const stale = [];

  for (const row of rows) {
    const date    = row['date']    || '';
    const company = row['company'] || '(unknown)';
    const role    = row['role']    || '(unknown)';
    const status  = row['status'] || '';

    const days = daysSince(date);
    if (days === null) continue;

    const threshold = getThreshold(status, thresholds);
    if (threshold === null) continue; // unknown status — skip

    if (days >= threshold) {
      stale.push({ company, role, status, date, days, threshold });
    }
  }

  // Sort oldest first (highest days first)
  stale.sort((a, b) => b.days - a.days);

  // Output
  const dateStr = TODAY.toISOString().slice(0, 10);
  const lines = [];
  lines.push(`## Follow-Up Actions (${dateStr})`);
  lines.push('');

  if (stale.length === 0) {
    lines.push('_No stale entries — all follow-ups are within cadence._');
  } else {
    lines.push('| Priority | Company | Role | Status | Days | Action |');
    lines.push('|----------|---------|------|--------|------|--------|');

    stale.forEach((entry, i) => {
      const priority = i + 1;
      const overdue  = entry.days - entry.threshold;
      const daysLabel = `${entry.days}d (${overdue >= 0 ? '+' : ''}${overdue}d over)`;
      const action   = getAction(entry.status);
      lines.push(`| ${priority} | ${entry.company} | ${entry.role} | ${entry.status} | ${daysLabel} | ${action} |`);
    });
  }

  lines.push('');
  console.log(lines.join('\n'));

  // Summary to stderr so it doesn't pollute piped output
  process.stderr.write(`[check-cadence] ${rows.length} entries scanned, ${stale.length} stale.\n`);
}

main();
