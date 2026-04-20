# Gmail Sync Setup

This document covers the manual setup for `scripts/gmail-recruiter-sync.mjs`.

## Required Values

Copy [`.env.example`](../.env.example) to `.env` in the repo root, then fill in values. Typical keys:

Add the following keys to `.env` (example path `C:\Users\mattm\career-ops\.env`):

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GMAIL_OAUTH_SCOPE=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send
GMAIL_RECRUITER_QUERY=label:Recruiting newer_than:7d
GMAIL_RECRUITER_MAX=10
```

`GMAIL_RECRUITER_QUERY` and `GMAIL_RECRUITER_MAX` are optional, but start narrow for the first live validation. `GOOGLE_REDIRECT_URI` is **not needed** when using `gmail-oauth:bootstrap` — the loopback port is chosen at runtime.

## Google OAuth Setup

**Important:** career-ops should have its **own dedicated Google Cloud project** — do not share an OAuth client with other tools (e.g. jarvis-trader). Sharing causes scope, consent-screen, and quota collisions.

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project named `career-ops` (project picker → New Project).
3. Enable the **Gmail API** for that project (APIs & Services → Library → Gmail API → Enable).
4. Configure OAuth consent screen:
   - User Type: **External**
   - App name: `career-ops`
   - User support email: your address
   - Scopes: add `https://www.googleapis.com/auth/gmail.readonly` AND `https://www.googleapis.com/auth/gmail.send` (the second is required for `daily-digest`; if you only need read, omit `gmail.send`)
   - Test users: add the Gmail address you want to sync (e.g. `mattmamundson@gmail.com`)
5. Create credentials:
   - APIs & Services → Credentials → Create Credentials → **OAuth client ID**
   - Application type: **Desktop app** (this is critical — Desktop clients accept any `http://127.0.0.1:<port>` loopback redirect per RFC 8252, so no per-port URI registration is needed)
   - Name: `career-ops-cli`
6. Copy the generated `client_id` and `client_secret` into `.env`.
7. Run the one-shot bootstrap:

```bash
pnpm run gmail-oauth:bootstrap
```

The bootstrap script will:
- Open the consent URL in your default browser
- Listen on a free localhost port for the redirect
- Exchange the auth code for tokens
- Write `GOOGLE_REFRESH_TOKEN` directly into `.env`

No copy/paste of authorization codes required.

### Legacy two-step flow (fallback)

If the bootstrap fails (e.g. browser can't reach localhost from a remote/SSH session), use the manual flow:

```bash
pnpm run gmail-oauth:url
# open URL, approve, copy `code=...` value from redirect URL bar
pnpm run gmail-oauth:exchange -- --code=PASTE_CODE_HERE
# copy refresh_token into .env as GOOGLE_REFRESH_TOKEN
```

For the manual flow the OAuth client must have `http://localhost` (no port) added under **Authorized redirect URIs** in the Google Cloud Console.

## Preflight Checks

Run these before touching the scheduler:

```bash
pnpm run preflight:gmail-sync
pnpm run gmail-sync:dry
```

Expected result:

- preflight reports `READY`
- the dry run authenticates
- a run summary is written to `data/run-summaries/`
- unmatched messages, if any, are written to `data/outreach/gmail-sync-review-YYYY-MM-DD.md`

## First Live Validation

After the dry run looks correct:

```bash
pnpm run gmail-sync
```

Review:

- `data/responses.md`
- `data/applications.md`
- the newest file in `data/run-summaries/`

## Scheduler Registration

Only register the Gmail task after the dry run and first live run both look correct:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-gmail-sync-task.ps1
```

The registration script will refuse to install if the required Gmail OAuth keys are still missing.

---
Inspired by the upstream repository: https://github.com/santifer/career-ops
