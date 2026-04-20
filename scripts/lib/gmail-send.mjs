/**
 * gmail-send.mjs — Minimal Gmail API send helper using existing OAuth refresh token.
 *
 * Reuses the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
 * triple already configured for gmail-recruiter-sync.mjs.
 *
 * Public API:
 *   sendGmail({ to, subject, html, text? }) → { ok: true, messageId }
 *   getAccessToken() → string (exported for callers that want raw API access)
 *
 * Set CAREER_OPS_DRY_RUN=1 to log instead of sending.
 */

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: requiredEnv('GOOGLE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`OAuth token exchange failed: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

function buildMime({ to, from, subject, html, text }) {
  // Multipart/alternative: text + html. RFC 2822 + MIME basics.
  const boundary = `=_career-ops-${Date.now().toString(36)}`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const textPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    text || stripHtml(html),
  ].join('\r\n');
  const htmlPart = [
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
  ].join('\r\n');
  const close = `--${boundary}--`;
  return `${headers}\r\n\r\n${textPart}\r\n${htmlPart}\r\n${close}`;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sendGmail({ to, subject, html, text, from }) {
  if (!to || !subject || !html) throw new Error('sendGmail requires { to, subject, html }');
  if (process.env.CAREER_OPS_DRY_RUN === '1') {
    console.log(`[gmail-send:dry] to=${to} subject="${subject}" htmlBytes=${html.length}`);
    return { ok: true, messageId: 'dry-run', dryRun: true };
  }

  const accessToken = await getAccessToken();
  const fromAddr = from || process.env.DAILY_DIGEST_FROM || to; // sender == receiver works for personal account
  const mime = buildMime({ to, from: fromAddr, subject, html, text });
  const raw = base64UrlEncode(mime);

  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error(`Gmail send failed: ${r.status} ${await r.text()}`);
  const json = await r.json();
  return { ok: true, messageId: json.id };
}
