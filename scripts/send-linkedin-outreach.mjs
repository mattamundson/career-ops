#!/usr/bin/env node
/**
 * send-linkedin-outreach.mjs — Draft + log LinkedIn outreach messages.
 *
 * Default mode is DRAFT ONLY: prints the message it would send and writes
 * it to data/outreach/linkedin-YYYY-MM-DD-NNN-slug.md. Does NOT send.
 *
 * --confirm is required to actually send. Even with --confirm the script
 * asks for final TTY confirmation unless --no-interactive is also passed.
 *
 * Sending uses mcp__linkedin__send_message — available when the career-ops
 * MCP is running. If the MCP is not available, the script still drafts and
 * logs but never sends.
 *
 * Usage:
 *   node scripts/send-linkedin-outreach.mjs \
 *     --company "Acme Robotics" \
 *     --role "Senior Data Architect" \
 *     --recipient "https://www.linkedin.com/in/jane-smith-abc123/" \
 *     --scenario hiring-manager \
 *     [--confirm] [--no-interactive]
 *
 * Flags:
 *   --company       (required) Target company name
 *   --role          (required) Role title we're reaching out about
 *   --recipient     (required) LinkedIn profile URL or public identifier
 *   --scenario      (required) recruiter | referral | hiring-manager
 *   --archetype     Optional — one of the 6 archetypes from _shared.md
 *   --message       Optional — pre-written message text (skips generation)
 *   --cooldown-hours Don't send if the same company was contacted within N hours (default 24)
 *   --confirm       Required to actually send; default is draft-only
 *   --no-interactive Skip stdin confirmation prompt (for scripted runs)
 *   --dry-run       Alias for the default (no-send) behavior; explicit
 *
 * Exit codes:
 *   0 — success (draft written, or send succeeded)
 *   1 — missing required flag / validation failure
 *   2 — cooldown active (same-company outreach sent in last N hours)
 *   3 — send failed (MCP error, profile unreachable, etc.)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { isMainEntry } from './lib/main-entry.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';
import { daysBetween, toIsoDate } from './lib/dates.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const OUTREACH_DIR = join(ROOT, 'data', 'outreach');

const VALID_SCENARIOS = new Set(['recruiter', 'referral', 'hiring-manager']);

export function slugify(s) {
  return String(s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i++; }
    else args[key] = true;
  }
  return {
    company: typeof args.company === 'string' ? args.company : null,
    role: typeof args.role === 'string' ? args.role : null,
    recipient: typeof args.recipient === 'string' ? args.recipient : null,
    scenario: typeof args.scenario === 'string' ? args.scenario : null,
    archetype: typeof args.archetype === 'string' ? args.archetype : null,
    message: typeof args.message === 'string' ? args.message : null,
    cooldownHours: Number(args['cooldown-hours'] ?? 24),
    confirm: Boolean(args.confirm),
    noInteractive: Boolean(args['no-interactive']),
    dryRun: Boolean(args['dry-run']),
  };
}

export function validateOpts(opts) {
  const errors = [];
  if (!opts.company) errors.push('--company is required');
  if (!opts.role) errors.push('--role is required');
  if (!opts.recipient) errors.push('--recipient is required (LinkedIn URL or identifier)');
  if (!opts.scenario) errors.push('--scenario is required (recruiter | referral | hiring-manager)');
  if (opts.scenario && !VALID_SCENARIOS.has(opts.scenario)) {
    errors.push(`--scenario must be one of: ${[...VALID_SCENARIOS].join(', ')}`);
  }
  return errors;
}

/**
 * Check cooldown: was any LinkedIn outreach to the same company sent within
 * the last N hours? Returns { blocked, lastSent?, hoursSince? }.
 */
export function checkCooldown(outreachDir, company, hours) {
  if (!existsSync(outreachDir)) return { blocked: false };
  const slug = slugify(company);
  const candidates = readdirSync(outreachDir).filter((n) => n.startsWith('linkedin-') && n.endsWith('.md'));
  for (const name of candidates) {
    const m = name.match(/^linkedin-(\d{4}-\d{2}-\d{2})-(\d{3})-(.+)\.md$/);
    if (!m) continue;
    const [, dateStr, , fileSlug] = m;
    if (fileSlug !== slug) continue;
    const content = readFileSync(join(outreachDir, name), 'utf-8');
    const sentMatch = content.match(/^sent_at:\s*"?([0-9T:Z.\-]+)"?\s*$/m);
    if (!sentMatch) continue; // drafts never sent aren't blocking
    const sentDate = sentMatch[1].slice(0, 10);
    const daysOld = daysBetween(toIsoDate(), sentDate);
    const hoursOld = daysOld * 24;
    if (hoursOld < hours) {
      return { blocked: true, lastSent: sentMatch[1], hoursSince: hoursOld };
    }
  }
  return { blocked: false };
}

/**
 * Compose a 3-sentence message: hook / proof / proposal.
 * Template-based to keep it zero-LLM-dependency; operator can override via --message.
 */
export function composeMessage({ company, role, scenario, archetype, recipientName }) {
  const greeting = recipientName ? `Hi ${recipientName.split(' ')[0]}` : 'Hi';
  const archetypeHooks = {
    'Operational Data Architect': `I built an ERP-to-BI-to-AI pipeline end-to-end as COO of a manufacturer — zero manual handoffs across purchasing, inventory, and production.`,
    'AI Automation / Workflow Engineer': `I run Career-Ops and several n8n closed-loop automations as production systems — not demos.`,
    'BI & Analytics Lead': `I delivered Power BI dashboards that replaced manual decisions at Pretium ($25B+ distressed debt) and a mid-market manufacturer.`,
    'Business Systems / ERP Specialist': `I integrated Paradigm ERP with barcode and BI as COO — lived on both sides of the ops/tech boundary.`,
    'Applied AI / Solutions Architect': `I built Career-Ops with a layered decision pipeline — observability, fallbacks, production reliability, and all the enterprise gates built in.`,
    'Operations Technology Leader': `I built the entire operational tech stack as COO of a manufacturer — ERP, BI, AI, barcode, automation. Zero contractors.`,
  };
  const proof = (archetype && archetypeHooks[archetype])
    || `I spent the last 10 years building production data systems as a technical operator — ERP, BI, AI automation.`;

  const proposalByScenario = {
    'recruiter': `Open to a 15-min chat about ${role} at ${company} — what's the ideal candidate shape?`,
    'referral': `Could you point me to the hiring manager for ${role} at ${company}, or pass this along?`,
    'hiring-manager': `Would love 15 minutes to chat about ${role} at ${company} — what are you trying to solve with this hire?`,
  };

  const hook = `Saw ${company} is hiring for ${role}.`;
  const proposal = proposalByScenario[scenario] || proposalByScenario['hiring-manager'];

  let msg = `${greeting} — ${hook} ${proof} ${proposal}`;
  // LinkedIn connection requests cap at ~300 chars. Trim proof if necessary.
  if (msg.length > 300) {
    const budget = 300 - (`${greeting} — `.length + hook.length + proposal.length + 2);
    const shortProof = proof.length > budget ? proof.slice(0, budget - 1) + '…' : proof;
    msg = `${greeting} — ${hook} ${shortProof} ${proposal}`;
  }
  return msg.length > 300 ? msg.slice(0, 299) + '…' : msg;
}

function nextOutreachSeq(outreachDir) {
  if (!existsSync(outreachDir)) return '001';
  const today = toIsoDate();
  const prefix = `linkedin-${today}-`;
  const nums = readdirSync(outreachDir)
    .filter((n) => n.startsWith(prefix) && n.endsWith('.md'))
    .map((n) => parseInt(n.slice(prefix.length, prefix.length + 3), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return String(max + 1).padStart(3, '0');
}

async function confirmInteractive(message) {
  return new Promise((resolveFn) => {
    process.stdout.write('\n─────────────────────────────────────────\n');
    process.stdout.write('READY TO SEND LinkedIn message:\n\n');
    process.stdout.write(`${message}\n\n`);
    process.stdout.write('Type "send" to transmit, anything else to abort: ');
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (buf) => {
      const answer = String(buf).trim().toLowerCase();
      resolveFn(answer === 'send');
    });
  });
}

export async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const errors = validateOpts(opts);
  if (errors.length > 0) {
    console.error('[send-linkedin-outreach] Validation errors:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const cooldown = checkCooldown(OUTREACH_DIR, opts.company, opts.cooldownHours);
  if (cooldown.blocked) {
    console.error(`[send-linkedin-outreach] COOLDOWN: ${opts.company} was contacted ${cooldown.hoursSince}h ago (threshold=${opts.cooldownHours}h).`);
    process.exit(2);
  }

  const message = opts.message || composeMessage(opts);
  const today = toIsoDate();
  mkdirSync(OUTREACH_DIR, { recursive: true });
  const seq = nextOutreachSeq(OUTREACH_DIR);
  const outPath = join(OUTREACH_DIR, `linkedin-${today}-${seq}-${slugify(opts.company)}.md`);

  const willSend = opts.confirm && !opts.dryRun;
  const sentAt = willSend ? new Date().toISOString() : null;

  // Actual send via MCP — only when --confirm and TTY confirmation pass.
  let sendStatus = 'draft';
  let sendError = null;
  if (willSend) {
    if (!opts.noInteractive && process.stdin.isTTY) {
      const ok = await confirmInteractive(message);
      if (!ok) {
        console.log('[send-linkedin-outreach] Interactive confirmation declined — saving as draft.');
        sendStatus = 'draft-declined';
      }
    }
    if (sendStatus !== 'draft-declined') {
      // The MCP tool is only available when this script runs inside Claude
      // Code's MCP environment. Outside that, we emit a clear error and
      // leave the draft on disk for manual send.
      if (typeof globalThis.mcp__linkedin__send_message !== 'function') {
        console.error('[send-linkedin-outreach] mcp__linkedin__send_message not available — saving draft only.');
        console.error('  Invoke this script from Claude Code (MCP) to actually send.');
        sendStatus = 'draft-no-mcp';
      } else {
        try {
          await globalThis.mcp__linkedin__send_message({ profile_url: opts.recipient, message });
          sendStatus = 'sent';
        } catch (err) {
          sendError = err.message;
          sendStatus = 'send-failed';
        }
      }
    }
  }

  const frontmatter = [
    '---',
    `company: ${JSON.stringify(opts.company)}`,
    `role: ${JSON.stringify(opts.role)}`,
    `recipient: ${JSON.stringify(opts.recipient)}`,
    `scenario: "${opts.scenario}"`,
    `archetype: ${JSON.stringify(opts.archetype || '')}`,
    `drafted_at: "${today}"`,
    sentAt && sendStatus === 'sent' ? `sent_at: "${sentAt}"` : '',
    `status: "${sendStatus}"`,
    '---',
  ].filter(Boolean).join('\n');

  const body = [
    frontmatter,
    '',
    `# LinkedIn outreach — ${opts.company} / ${opts.role}`,
    '',
    `**Recipient:** ${opts.recipient}`,
    `**Scenario:** ${opts.scenario}`,
    `**Status:** ${sendStatus}`,
    '',
    '## Message',
    '',
    message,
    '',
    '---',
    '',
    sendStatus === 'sent'
      ? `_Sent ${sentAt}. Track the thread via \`mcp__linkedin__get_conversation\`._`
      : sendStatus === 'send-failed'
        ? `_Send FAILED: ${sendError}. Review and retry manually._`
        : '_Draft only. Re-run with `--confirm` to send, or copy/paste the message above manually._',
    '',
  ].join('\n');

  writeFileSync(outPath, body, 'utf-8');
  console.log(`[send-linkedin-outreach] ${sendStatus.toUpperCase()} — written to ${outPath}`);
  if (sendStatus === 'draft' || sendStatus === 'draft-no-mcp' || sendStatus === 'draft-declined') {
    console.log(`\nMessage preview (${message.length} chars):\n  ${message}\n`);
  }

  appendAutomationEvent(ROOT, {
    type: `linkedin-outreach.${sendStatus.replace(/-/g, '_')}`,
    status: sendStatus === 'sent' ? 'success' : (sendStatus === 'send-failed' ? 'failure' : 'success'),
    summary: `${sendStatus} outreach for ${opts.company} / ${opts.role}`,
    details: {
      company: opts.company,
      role: opts.role,
      scenario: opts.scenario,
      archetype: opts.archetype,
      recipient: opts.recipient,
      draft_path: outPath,
      message_length: message.length,
      send_error: sendError,
    },
  });

  process.exit(sendStatus === 'send-failed' ? 3 : 0);
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    console.error(`[send-linkedin-outreach] Fatal: ${err.message}`);
    process.exit(1);
  });
}
