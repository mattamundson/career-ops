#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './load-env.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

const args = process.argv.slice(2);
const codeArg = args.find((arg) => arg.startsWith('--code='));
const code = codeArg ? codeArg.slice('--code='.length) : '';

if (!code) {
  console.error('Usage: node scripts/gmail-oauth-exchange.mjs --code=<authorization_code>');
  process.exit(1);
}

const clientId = process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost';

if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

const body = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  code,
  grant_type: 'authorization_code',
  redirect_uri: redirectUri,
});

const response = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body,
});

const json = await response.json();

if (!response.ok) {
  console.error(JSON.stringify(json, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  refresh_token: json.refresh_token || null,
  access_token: json.access_token || null,
  expires_in: json.expires_in || null,
  scope: json.scope || null,
  token_type: json.token_type || null,
}, null, 2));
