#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './load-env.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
loadProjectEnv(ROOT);

const clientId = process.env.GOOGLE_CLIENT_ID || '';
if (!clientId) {
  console.error('Missing GOOGLE_CLIENT_ID in .env');
  process.exit(1);
}

const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost';
const scope = process.env.GMAIL_OAUTH_SCOPE
  || 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';

const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.searchParams.set('client_id', clientId);
url.searchParams.set('redirect_uri', redirectUri);
url.searchParams.set('response_type', 'code');
url.searchParams.set('scope', scope);
url.searchParams.set('access_type', 'offline');
url.searchParams.set('prompt', 'consent');

console.log(url.toString());
