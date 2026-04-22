#!/usr/bin/env node
/**
 * apply-via-email.mjs — Direct-email application path
 *
 * Generates an RFC 822 / MIME email draft (.eml) with the CV PDF + cover
 * letter attached, ready for Matt to open in Outlook/Thunderbird/Apple Mail
 * and click Send. Keeps the final Submit click human — the ethical gate.
 *
 * No SMTP, no stored credentials, no new dependencies. The .eml file IS
 * the handoff — open it in a mail client and review.
 *
 * Usage:
 *   node scripts/apply-via-email.mjs --app-id 216 --draft
 *   node scripts/apply-via-email.mjs --app-id 216 --draft --package-dir packages/216
 *   node scripts/apply-via-email.mjs --app-id 216 --draft --to careers@govdocs.com
 *
 * Reads:
 *   - reports/<id>-*.md — extract company, role, subject hints
 *   - output/email-bodies/<slug>.md — body (if present; else generated)
 *   - config/apply-emails.yml — target email override (if present)
 *   - output/cv-pdfs/cv-matt-<slug>.pdf — attachment (if present)
 *   - output/cover-letters/<slug>.md — attachment (converted to .txt if no PDF)
 *
 * Writes:
 *   - packages/<id>/email.eml (by default) or $PWD/email-<id>.eml
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntry } from './lib/main-entry.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const FROM_NAME = 'Matthew M. Amundson';
const FROM_EMAIL = 'MattMAmundson@gmail.com'; // per memory: greenfieldmetalsales.com is revoked

// ── Args ────────────────────────────────────────────────────────────────────

export function parseEmailArgs(argv) {
  const out = { appId: null, draft: false, send: false, packageDir: null, to: null, cc: null, bcc: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app-id') out.appId = argv[++i];
    else if (a.startsWith('--app-id=')) out.appId = a.slice(9);
    else if (a === '--draft') out.draft = true;
    else if (a === '--send') out.send = true;
    else if (a === '--package-dir') out.packageDir = argv[++i];
    else if (a.startsWith('--package-dir=')) out.packageDir = a.slice(14);
    else if (a === '--to') out.to = argv[++i];
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a === '--cc') out.cc = argv[++i];
    else if (a.startsWith('--cc=')) out.cc = a.slice(5);
    else if (a === '--bcc') out.bcc = argv[++i];
    else if (a.startsWith('--bcc=')) out.bcc = a.slice(6);
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function padId(id) {
  return String(id).padStart(3, '0');
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function findReport(appId) {
  const id = padId(appId);
  const dir = resolve(ROOT, 'reports');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => x.startsWith(`${id}-`) && x.endsWith('.md'));
  return f ? resolve(dir, f) : null;
}

function parseReportMeta(reportPath) {
  const body = readFileSync(reportPath, 'utf8');
  const readBold = (key) =>
    body.match(new RegExp(`^\\*\\*${key}:\\*\\*\\s+(.+?)\\s*$`, 'm'))?.[1]?.trim() || null;
  const title = body.match(/^#\s+Evaluation:\s+(.+?)\s*$/m)?.[1] || null;
  let company = null;
  let role = null;
  if (title) {
    const sep = title.match(/\s+[—–-]\s+/);
    if (sep) {
      company = title.slice(0, sep.index).trim();
      role = title.slice(sep.index + sep[0].length).trim();
    } else {
      company = title.trim();
    }
  }
  return {
    path: reportPath,
    company,
    role,
    url: readBold('URL'),
    applyUrl: readBold('Apply URL') || readBold('Apply'),
    score: readBold('Score'),
    applyEmail: readBold('Apply Email') || readBold('Email'),
  };
}

function loadApplyEmails() {
  const path = resolve(ROOT, 'config', 'apply-emails.yml');
  if (!existsSync(path)) return {};
  const out = {};
  const body = readFileSync(path, 'utf8');
  // Lightweight YAML: `slug: email@example.com` or `slug: "email@example.com"`
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-z0-9][a-z0-9-]*):\s*["']?([^"'\s]+@[^"'\s]+)["']?/i);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function findEmailBody(meta) {
  const emailBodiesDir = resolve(ROOT, 'output', 'email-bodies');
  if (!existsSync(emailBodiesDir)) return null;
  const companySlug = slugify(meta.company);
  const files = readdirSync(emailBodiesDir).filter((f) => /\.(md|txt)$/.test(f));
  const match = files.find((f) => f.startsWith(companySlug));
  return match ? readFileSync(resolve(emailBodiesDir, match), 'utf8') : null;
}

function findCvPdf(meta) {
  const dir = resolve(ROOT, 'output', 'cv-pdfs');
  if (!existsSync(dir)) return null;
  const companySlug = slugify(meta.company);
  const files = readdirSync(dir).filter((f) => f.endsWith('.pdf'));
  // Prefer exact company match
  const match =
    files.find((f) => f.includes(companySlug) && f.includes(slugify(meta.role || ''))) ||
    files.find((f) => f.includes(companySlug));
  return match ? resolve(dir, match) : null;
}

function findCoverLetter(meta) {
  const dir = resolve(ROOT, 'output', 'cover-letters');
  if (!existsSync(dir)) return null;
  const companySlug = slugify(meta.company);
  const files = readdirSync(dir);
  const match =
    files.find((f) => f.includes(companySlug) && /\.(pdf|txt|md)$/.test(f)) ||
    files.find((f) => f.includes(companySlug));
  return match ? resolve(dir, match) : null;
}

function generateFallbackBody(meta) {
  return [
    `Hello,`,
    ``,
    `I'd like to apply for the ${meta.role || 'role'} role at ${meta.company}. I've attached my resume and cover letter.`,
    ``,
    `Quick context on fit:`,
    `- 10+ years across data architecture, BI, and operational data leadership`,
    `- Recent role: COO at Greenfield Metal Sales — end-to-end data platform ownership`,
    `- Prior: Land O'Lakes (Fortune 500 ag-coop), FirstEnergy (NERC-CIP compliance), Pretium ($25B AUM)`,
    ``,
    `Happy to share more detail — resume and cover letter attached.`,
    ``,
    `Best,`,
    `Matthew M. Amundson`,
    `${FROM_EMAIL}`,
    `linkedin.com/in/mattamundson`,
    ``,
  ].join('\n');
}

// ── MIME build ──────────────────────────────────────────────────────────────

function encodeBase64Chunked(buf) {
  const b64 = buf.toString('base64');
  return b64.match(/.{1,76}/g).join('\r\n');
}

function mimeType(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  return 'application/octet-stream';
}

function buildEml({ from, to, cc, bcc, subject, body, attachments }) {
  const boundary = `----=_Part_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    `Date: ${new Date().toUTCString()}`,
    `X-Generated-By: career-ops apply-via-email.mjs`,
  ].filter(Boolean);

  const parts = [];
  // Body (plain text)
  parts.push(
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body.replace(/\r?\n/g, '\r\n'),
    ].join('\r\n')
  );

  // Attachments
  for (const a of attachments || []) {
    if (!existsSync(a.path)) continue;
    const buf = readFileSync(a.path);
    parts.push(
      [
        `--${boundary}`,
        `Content-Type: ${mimeType(a.path)}; name="${basename(a.path)}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${basename(a.path)}"`,
        '',
        encodeBase64Chunked(buf),
      ].join('\r\n')
    );
  }

  parts.push(`--${boundary}--`);
  return headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + '\r\n';
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function applyViaEmail(opts) {
  const { appId, to: toOverride, cc, bcc, packageDir } = opts;
  if (!appId) throw new Error('missing --app-id');
  const id = padId(appId);

  const reportPath = findReport(id);
  if (!reportPath) throw new Error(`Report #${id} not found`);
  const meta = parseReportMeta(reportPath);

  // Resolve target email
  const emails = loadApplyEmails();
  const companySlug = slugify(meta.company);
  const to = toOverride || meta.applyEmail || emails[companySlug] || null;
  if (!to) {
    throw new Error(
      `No target email found for #${id} (${meta.company}). Provide via --to, report "**Apply Email:**" field, or config/apply-emails.yml (${companySlug}: email@example.com)`
    );
  }

  // Body
  const body = findEmailBody(meta) || generateFallbackBody(meta);

  // Attachments
  const cvPdf = findCvPdf(meta);
  const coverLetter = findCoverLetter(meta);
  const attachments = [];
  if (cvPdf) attachments.push({ path: cvPdf, label: 'CV' });
  if (coverLetter) attachments.push({ path: coverLetter, label: 'Cover Letter' });

  // Subject
  const subject = `Application: ${meta.role || 'Data role'} — ${FROM_NAME}`;

  // Build .eml
  const eml = buildEml({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    cc,
    bcc,
    subject,
    body,
    attachments,
  });

  // Output path
  const outDir = packageDir || resolve(ROOT, 'packages', id);
  mkdirSync(outDir, { recursive: true });
  const emlPath = resolve(outDir, 'email.eml');
  writeFileSync(emlPath, eml, 'utf8');

  // Companion README for mail client hand-off
  const readme = [
    `# Email Draft for #${id} — ${meta.company}`,
    ``,
    `**To:** ${to}`,
    `**Subject:** ${subject}`,
    `**Attachments:** ${attachments.length ? attachments.map((a) => basename(a.path)).join(', ') : '(none found — attach cv.pdf + cover letter manually)'}`,
    ``,
    `## How to send`,
    `1. Open \`email.eml\` in Outlook/Thunderbird/Apple Mail.`,
    `2. Review the body and attachments.`,
    `3. Send when ready.`,
    ``,
    `## Body`,
    '',
    body,
    '',
  ].join('\n');
  writeFileSync(resolve(outDir, 'email-README.md'), readme, 'utf8');

  appendAutomationEvent(ROOT, {
    type: 'email.draft',
    app_id: id,
    company: meta.company,
    to,
    attachments: attachments.map((a) => basename(a.path)),
    eml_path: `packages/${id}/email.eml`,
  });

  return { emlPath, to, subject, attachments };
}

function main() {
  const opts = parseEmailArgs(process.argv.slice(2));
  if (!opts.appId) {
    console.error('Usage: node scripts/apply-via-email.mjs --app-id <N> --draft [--to <email>] [--cc <email>] [--package-dir <path>]');
    process.exit(2);
  }
  if (opts.send) {
    console.error(
      'ERROR: --send is not supported. No SMTP credentials are stored.\n' +
        'Use --draft and open the generated .eml in your mail client (Outlook/Thunderbird/Apple Mail).\n' +
        'This preserves the ethical gate — human review + human click-to-send.'
    );
    process.exit(2);
  }
  if (!opts.draft) {
    console.error('Pass --draft to generate the .eml');
    process.exit(2);
  }
  applyViaEmail(opts).then(
    ({ emlPath, to, subject, attachments }) => {
      console.log(`✓ Email draft written: ${emlPath}`);
      console.log(`  To: ${to}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Attachments: ${attachments.length}`);
      console.log(`  Next: open the .eml in your mail client, review, send.`);
      process.exit(0);
    },
    (err) => {
      console.error(`✗ apply-via-email failed: ${err.message}`);
      process.exit(1);
    }
  );
}

if (isMainEntry(import.meta.url)) {
  main();
}
