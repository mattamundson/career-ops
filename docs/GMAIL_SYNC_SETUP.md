# Gmail Sync Setup

This document covers the remaining manual setup for `scripts/gmail-recruiter-sync.mjs`.

## Required Values

Copy [`.env.example`](../.env.example) to `.env` in the repo root, then fill in values. Typical keys:

Add the following keys to `.env` (example path `C:\Users\mattm\career-ops\.env`):

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_REDIRECT_URI=http://localhost
GMAIL_OAUTH_SCOPE=https://www.googleapis.com/auth/gmail.readonly
GMAIL_RECRUITER_QUERY=label:Recruiting newer_than:7d
GMAIL_RECRUITER_MAX=10
```

`GMAIL_RECRUITER_QUERY` and `GMAIL_RECRUITER_MAX` are optional, but start narrow for the first live validation.

## Google OAuth Setup

1. Create or reuse a Google Cloud project.
2. Enable the Gmail API for that project.
3. Create an OAuth client for a desktop app or local tool.
4. Capture the generated `client_id` and `client_secret`.
5. Generate a consent URL locally:

```bash
pnpm run gmail-oauth:url
```

6. Open that URL, approve access, and copy the returned `code=` value from the redirect URL.
7. Exchange the authorization code for tokens:

```bash
pnpm run gmail-oauth:exchange -- --code=PASTE_CODE_HERE
```

8. Save the returned `refresh_token` as `GOOGLE_REFRESH_TOKEN` in `.env`.
9. Save the three values in `.env`.

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
