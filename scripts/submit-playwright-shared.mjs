import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { attachApplyArtifact } from './ats-run-state.mjs';
import { loadProjectEnv } from './load-env.mjs';
import { runChromePreflight } from './lib/chrome-preflight.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);
const DRY_RUN = process.env.CAREER_OPS_DRY_RUN === '1';

/**
 * Launch persistent browser context for submission automation.
 * Headless: false for debugging and manual intervention (captcha solving).
 * Session saved to .playwright-session/ for cookie persistence across runs.
 */
export async function launchBrowser() {
  runChromePreflight('browser-preflight');
  return await chromium.launchPersistentContext('.playwright-session', {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });
}

function todayStamp() {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/\..+/, 'Z');
}

function compactWhitespace(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function appendUniqueNote(existing, addition) {
  if (!addition) return existing;
  if (!existing) return addition;
  if (existing.includes(addition)) return existing;
  return `${existing}; ${addition}`;
}

function parseMarkdownTable(filePath, headerPrefix) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim().startsWith(headerPrefix));
  if (headerIndex === -1) {
    throw new Error(`Could not find ${headerPrefix} in ${filePath}`);
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

function formatApplicationRow(row) {
  return `| ${row.id} | ${row.date} | ${row.company} | ${row.role} | ${row.score} | ${row.status} | ${row.pdf} | ${row.report} | ${row.notes} |`;
}

function annotateApplication(appId, note) {
  if (!appId) return;
  const file = resolve(ROOT, 'data', 'applications.md');
  if (!existsSync(file)) return;

  const table = parseMarkdownTable(file, '| # |');
  const rows = table.rowLines.map((line) => {
    const cells = splitRow(line);
    const [id, date, company, role, score, status, pdf, report, ...notes] = cells;
    return { id, date, company, role, score, status, pdf, report, notes: notes.join(' | ') };
  });

  const row = rows.find((entry) => entry.id === String(appId).padStart(3, '0') || entry.id === String(appId));
  if (!row) return;

  row.notes = appendUniqueNote(row.notes, note);
  const content = [
    table.prefix,
    table.header,
    table.separator,
    ...rows.map(formatApplicationRow),
    table.trailing,
  ].join('\n');
  writeFileSync(file, content, 'utf8');
}

function buildCaptchaMessage(meta, screenshotPath) {
  const lines = [
    'Career-Ops Captcha Escalation',
    `${meta.ats || 'ATS'} flow is blocked and needs manual intervention.`,
  ];
  if (meta.appId) lines.push(`Application: #${String(meta.appId).padStart(3, '0')}`);
  if (meta.company || meta.role) lines.push(`Role: ${meta.company || 'Unknown'} | ${meta.role || 'Unknown role'}`);
  if (meta.applyUrl) lines.push(`URL: ${meta.applyUrl}`);
  if (screenshotPath) lines.push(`Screenshot: ${screenshotPath}`);
  lines.push('Action: solve the captcha in the open browser window, then press ENTER in the terminal.');
  return lines.join('\n');
}

function sendViaOpenClaw(message) {
  const phone = (process.env.OPENCLAW_WHATSAPP_TO || '').trim();
  if (!phone) return false;
  if (DRY_RUN) {
    console.log('[DRY RUN] Would send captcha alert via OpenClaw WhatsApp');
    return true;
  }

  const result = spawnSync(
    'wsl',
    ['-d', 'Ubuntu', '-e', 'openclaw', 'message', 'send', '--channel', 'whatsapp', '--target', phone, '-m', message],
    { encoding: 'utf8', timeout: 30000 }
  );
  if (result.status === 0) {
    console.log(`[captcha-alert] OpenClaw WhatsApp sent to ${phone}.`);
    return true;
  }
  console.warn('[captcha-alert] OpenClaw send failed:', result.stderr || result.error?.message || 'unknown error');
  return false;
}

function sendViaToast(message) {
  if (DRY_RUN) {
    console.log('[DRY RUN] Would send captcha alert via Windows toast');
    return true;
  }
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
  ${JSON.stringify(message)},
  'Career-Ops Captcha Alert',
  'OK',
  'Warning'
) | Out-Null
`;
  const result = spawnSync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-Command', psScript],
    { encoding: 'utf8', timeout: 30000 }
  );
  if (result.status === 0) {
    console.log('[captcha-alert] Windows toast sent.');
    return true;
  }
  console.warn('[captcha-alert] Toast send failed:', result.stderr || result.error?.message || 'unknown error');
  return false;
}

async function hasCaptchaSignals(page) {
  const selectors = [
    'iframe[src*="captcha"]',
    'iframe[title*="captcha" i]',
    '[data-sitekey]',
    '.h-captcha',
    '.g-recaptcha',
    '#captcha',
    '[aria-label*="captcha" i]',
  ];
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count > 0) return true;
  }
  const bodyText = compactWhitespace(await page.locator('body').innerText().catch(() => ''));
  return /\b(hcaptcha|recaptcha|captcha)\b/i.test(bodyText);
}

async function recordCaptchaIncident(page, meta) {
  const dir = resolve(ROOT, 'data', 'outreach');
  mkdirSync(dir, { recursive: true });
  const stamp = todayStamp();
  const slugBase = [meta.appId ? String(meta.appId).padStart(3, '0') : null, meta.ats || 'ats']
    .filter(Boolean)
    .join('-')
    .toLowerCase();
  const screenshotPath = resolve(dir, `captcha-${slugBase}-${stamp}.png`);
  const reportPath = resolve(dir, `captcha-${slugBase}-${stamp}.md`);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const message = buildCaptchaMessage(meta, screenshotPath);
  const report = [
    `# Captcha Escalation — ${stamp}`,
    '',
    `- ATS: ${meta.ats || 'Unknown'}`,
    `- Application ID: ${meta.appId ? String(meta.appId).padStart(3, '0') : 'Unknown'}`,
    `- Company: ${meta.company || 'Unknown'}`,
    `- Role: ${meta.role || 'Unknown'}`,
    `- URL: ${meta.applyUrl || 'Unknown'}`,
    `- Screenshot: ${screenshotPath}`,
    '',
    '```text',
    message,
    '```',
    '',
  ].join('\n');
  writeFileSync(reportPath, report, 'utf8');

  const note = `Captcha escalation ${stamp} (${meta.ats || 'ATS'})`;
  annotateApplication(meta.appId, note);
  if (meta.runCtx) {
    attachApplyArtifact(meta.runCtx, screenshotPath);
    attachApplyArtifact(meta.runCtx, reportPath);
  }

  return { screenshotPath, reportPath, message };
}

/**
 * Pause execution for manual user action (e.g., captcha solving).
 * Blocks until user presses ENTER in terminal.
 * Useful for hCaptcha, reCAPTCHA, or other interactive gates.
 */
export async function pauseForCaptcha(page, msg = 'Solve captcha and press ENTER', meta = {}) {
  const shouldNotify = await hasCaptchaSignals(page).catch(() => false);
  if (shouldNotify) {
    const incident = await recordCaptchaIncident(page, meta);
    console.log(`[captcha-alert] Incident report: ${incident.reportPath}`);
    const sent = sendViaOpenClaw(incident.message) || sendViaToast(incident.message);
    if (!sent) {
      console.log('[captcha-alert] Alert delivery failed; incident report was still written to disk.');
    }
  }
  console.log('\n>>> ' + msg + ' <<<\n');
  await new Promise(r => process.stdin.once('data', r));
}

/**
 * Candidate profile for all application forms.
 * Used in WorkDay and iCIMS submission flows.
 */
export const CANDIDATE = {
  firstName: 'Matthew',
  middleInitial: 'M.',
  lastName: 'Amundson',
  fullName: 'Matthew M. Amundson',
  email: 'MattMAmundson@gmail.com',
  phone: '6128771189',
  city: 'Minneapolis',
  state: 'Minnesota',
  country: 'United States',
  zip: '55401',
  linkedin: 'https://linkedin.com/in/mmamundson',
};

/**
 * Utility: Click element safely, retry on stale reference.
 */
export async function safeClick(page, ref, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.click(ref);
      return;
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`Retry click (${i + 1}/${retries})...`);
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Utility: Fill form field safely with stale ref handling.
 */
export async function safeFill(page, ref, value, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.fill(ref, value);
      return;
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`Retry fill (${i + 1}/${retries})...`);
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Utility: Query accessible name for debugging field detection.
 * Helps identify form fields during dry-run mode.
 */
export async function getAccessibleNames(page) {
  return await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    return inputs.map(el => ({
      tag: el.tagName,
      type: el.type,
      name: el.name,
      id: el.id,
      ariaLabel: el.getAttribute('aria-label'),
      label: document.querySelector(`label[for="${el.id}"]`)?.innerText,
      placeholder: el.placeholder,
    }));
  });
}
