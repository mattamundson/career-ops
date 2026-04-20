/**
 * notify.mjs — Cross-channel notification helper for career-ops.
 *
 * Channels (in order of preference):
 *   1. PUSHOVER_TOKEN + PUSHOVER_USER set → Pushover push (mobile + desktop)
 *   2. process.platform === 'win32' → Windows toast via PowerShell BurntToast
 *      (falls back to MessageBox if BurntToast not installed)
 *   3. Always: write alert file at data/notifications/{kind}-{timestamp}.md
 *
 * Public API:
 *   notify({ kind, title, body, action?, urgency? })
 *     - kind:    short slug for filename grouping (e.g. 'gmail-sync', 'cron-failure')
 *     - title:   one-line headline (≤ 80 chars recommended)
 *     - body:    multi-line detail (kept intact in toast/file; truncated for Pushover)
 *     - action:  optional one-line "what to do next" hint surfaced in toast
 *     - urgency: 'low' | 'normal' | 'high' (affects Pushover priority + toast color)
 *
 * Returns { delivered: ['pushover', 'toast'?, 'file'], errors: [...] }
 *
 * Set CAREER_OPS_DRY_RUN=1 to log instead of sending.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..', '..');

export async function notify(opts = {}) {
  const {
    kind = 'general',
    title = '(no title)',
    body = '',
    action = '',
    urgency = 'normal',
  } = opts;

  const dryRun = process.env.CAREER_OPS_DRY_RUN === '1';
  const delivered = [];
  const errors = [];

  // 1. Pushover (cross-device, requires user setup)
  const pushToken = (process.env.PUSHOVER_TOKEN || '').trim();
  const pushUser = (process.env.PUSHOVER_USER || '').trim();
  if (pushToken && pushUser) {
    if (dryRun) {
      console.log(`[notify:dry] would send Pushover: ${title}`);
      delivered.push('pushover');
    } else {
      try {
        const priority = urgency === 'high' ? 1 : urgency === 'low' ? -1 : 0;
        const params = new URLSearchParams({
          token: pushToken,
          user: pushUser,
          title: title.slice(0, 250),
          message: (action ? `${body}\n\n→ ${action}` : body).slice(0, 1024),
          priority: String(priority),
        });
        const r = await fetch('https://api.pushover.net/1/messages.json', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params,
        });
        if (r.ok) delivered.push('pushover');
        else errors.push(`pushover: HTTP ${r.status}`);
      } catch (e) {
        errors.push(`pushover: ${e.message}`);
      }
    }
  }

  // 2. Windows toast (BurntToast or MessageBox fallback)
  if (process.platform === 'win32') {
    if (dryRun) {
      console.log(`[notify:dry] would send Windows toast: ${title}`);
      delivered.push('toast');
    } else {
      const toastResult = sendWindowsToast({ title, body, action, urgency });
      if (toastResult.ok) delivered.push('toast');
      else errors.push(`toast: ${toastResult.error}`);
    }
  }

  // 3. Always write a durable alert file (so cron failures don't silently drop)
  try {
    const dir = resolve(ROOT, 'data', 'notifications');
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = resolve(dir, `${kind}-${ts}.md`);
    const content = [
      `# ${title}`,
      '',
      `**Kind:** ${kind}  `,
      `**Urgency:** ${urgency}  `,
      `**Time:** ${new Date().toISOString()}`,
      '',
      body || '(no body)',
      '',
      action ? `## Next action\n\n${action}\n` : '',
    ].join('\n');
    writeFileSync(file, content, 'utf8');
    delivered.push('file');
  } catch (e) {
    errors.push(`file: ${e.message}`);
  }

  return { delivered, errors };
}

function sendWindowsToast({ title, body, action, urgency }) {
  const fullText = action ? `${body}\n\n→ ${action}` : body;
  // Try BurntToast first (richer); fall back to MessageBox.
  const burntScript = `
$ErrorActionPreference = 'Stop'
try {
  Import-Module BurntToast -ErrorAction Stop
  New-BurntToastNotification -Text ${psString(title)}, ${psString(fullText.slice(0, 400))} -AppLogo $null
  exit 0
} catch {
  exit 42
}
`;
  let r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', burntScript], {
    encoding: 'utf8', timeout: 15_000,
  });
  if (r.status === 0) return { ok: true };

  // Fallback: blocking MessageBox (less ideal but always works)
  const icon = urgency === 'high' ? 'Warning' : 'Information';
  const mboxScript = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
[System.Windows.Forms.MessageBox]::Show(${psString(fullText.slice(0, 1000))}, ${psString(title.slice(0, 80))}, 'OK', '${icon}') | Out-Null
`;
  r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', mboxScript], {
    encoding: 'utf8', timeout: 30_000,
  });
  if (r.status === 0) return { ok: true };
  return { ok: false, error: `powershell exit ${r.status}: ${(r.stderr || '').slice(0, 200)}` };
}

function psString(s) {
  // PowerShell single-quoted literal: escape ' as ''.
  return `'${String(s ?? '').replace(/'/g, "''")}'`;
}
