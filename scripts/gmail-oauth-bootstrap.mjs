#!/usr/bin/env node
/**
 * gmail-oauth-bootstrap.mjs — One-shot Gmail OAuth handshake.
 *
 * Spins up a tiny localhost HTTP server, opens the consent URL in the
 * default browser, captures the redirect with the auth code, exchanges
 * it for tokens, and writes GOOGLE_REFRESH_TOKEN straight into .env.
 *
 * Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env. The OAuth
 * client must be type "Desktop app" — those allow http://127.0.0.1:<any>
 * as a loopback redirect per RFC 8252 without per-port registration.
 *
 * Usage:
 *   pnpm run gmail-oauth:bootstrap
 *
 * After success: pnpm run preflight:gmail-sync && pnpm run gmail-sync:dry
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './load-env.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const ENV_PATH = resolve(ROOT, '.env');

loadProjectEnv(ROOT);

const clientId = process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const scope = process.env.GMAIL_OAUTH_SCOPE || 'https://www.googleapis.com/auth/gmail.readonly';

if (!clientId || !clientSecret) {
  console.error('[bootstrap] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  console.error('[bootstrap] Create a Desktop-type OAuth client in Google Cloud Console first.');
  process.exit(1);
}

// Pick an ephemeral port — Desktop OAuth clients accept any loopback port.
const server = createServer();
server.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;
const redirectUri = `http://127.0.0.1:${port}`;

const consentUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
consentUrl.searchParams.set('client_id', clientId);
consentUrl.searchParams.set('redirect_uri', redirectUri);
consentUrl.searchParams.set('response_type', 'code');
consentUrl.searchParams.set('scope', scope);
consentUrl.searchParams.set('access_type', 'offline');
consentUrl.searchParams.set('prompt', 'consent');

console.log(`[bootstrap] Listening on ${redirectUri}`);
console.log('[bootstrap] Opening consent URL in browser…');
console.log('');
console.log(consentUrl.toString());
console.log('');
console.log('[bootstrap] If the browser does not open automatically, paste the URL above.');

// Best-effort: open default browser. Don't fail if it doesn't work.
try {
  const cmd = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
  const args = process.platform === 'win32' ? ['/c', 'start', '', consentUrl.toString()] : [consentUrl.toString()];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
} catch { /* user can paste manually */ }

const code = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error('Timed out after 5 minutes waiting for OAuth redirect'));
  }, 5 * 60 * 1000);

  server.on('request', (req, res) => {
    try {
      const url = new URL(req.url, redirectUri);
      const c = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end(`<h1>OAuth error: ${err}</h1><p>Close this tab and check the terminal.</p>`);
        clearTimeout(timeout);
        reject(new Error(`OAuth error: ${err}`));
        return;
      }
      if (!c) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end('<h1>No code in redirect</h1>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Career-Ops OAuth ✓</title>
        <body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:24px;color:#1e1e2e">
        <h1 style="color:#a6e3a1">✓ Career-Ops Gmail OAuth complete</h1>
        <p>You can close this tab and return to the terminal.</p>
        </body>`);
      clearTimeout(timeout);
      resolve(c);
    } catch (e) {
      reject(e);
    }
  });
});

console.log('\n[bootstrap] Got authorization code, exchanging for tokens…');
server.close();

const body = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  code,
  grant_type: 'authorization_code',
  redirect_uri: redirectUri,
});

const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body,
});
const tokenJson = await tokenResp.json();

if (!tokenResp.ok) {
  console.error('[bootstrap] Token exchange failed:');
  console.error(JSON.stringify(tokenJson, null, 2));
  process.exit(1);
}

const refreshToken = tokenJson.refresh_token;
if (!refreshToken) {
  console.error('[bootstrap] No refresh_token in response. Google only returns one on first consent.');
  console.error('[bootstrap] Revoke the app at https://myaccount.google.com/permissions and rerun.');
  console.error(JSON.stringify(tokenJson, null, 2));
  process.exit(1);
}

// Write refresh token into .env. Replace existing line if present.
let envText;
try { envText = readFileSync(ENV_PATH, 'utf8'); }
catch { envText = ''; }

const lines = envText.split(/\r?\n/);
let found = false;
const updated = lines.map((line) => {
  if (/^\s*GOOGLE_REFRESH_TOKEN\s*=/.test(line)) {
    found = true;
    return `GOOGLE_REFRESH_TOKEN=${refreshToken}`;
  }
  return line;
});
if (!found) {
  if (updated.length > 0 && updated[updated.length - 1] !== '') updated.push('');
  updated.push(`GOOGLE_REFRESH_TOKEN=${refreshToken}`);
}
writeFileSync(ENV_PATH, updated.join('\n'), 'utf8');

console.log('');
console.log('[bootstrap] ✓ GOOGLE_REFRESH_TOKEN written to .env');
console.log(`[bootstrap]   scope:      ${tokenJson.scope || '(unspecified)'}`);
console.log(`[bootstrap]   token_type: ${tokenJson.token_type || '(unspecified)'}`);
console.log(`[bootstrap]   expires_in: ${tokenJson.expires_in || '?'}s (access token; refresh persists)`);
console.log('');
console.log('Next:');
console.log('  pnpm run preflight:gmail-sync');
console.log('  pnpm run gmail-sync:dry');
