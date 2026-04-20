# Incident Runbook — Career-Ops

> One page. When a notification fires or a cron task fails, find the failure mode below and follow the steps. If you can't recover in 5 minutes, fall back to **manual mode** (skip the cron, do the task yourself, fix the cron later).

## How to use this doc

1. Notification arrives via Pushover / Windows toast / `data/notifications/*.md`.
2. Find the matching section below by **task name** (notification title prefix).
3. Run the diagnostic command. If clean: dismiss and move on. If dirty: follow the recovery steps.
4. If the same incident fires twice in 24h, escalate — the auto-recovery isn't enough. File a TODO in `docs/PIPELINE-TRIAGE.md`.

## Quick diagnostic (run this first)

```powershell
pnpm run health:json
```

Returns 5 buckets — tasks, failures, parse, stale, brain. Any `fail` → that section below. Any `warn` repeating across health runs → still worth a look.

---

## health-check (cron-health-check.mjs)

**Notification:** `[health] WARN <n>` or `[health] FAIL <n>`
**Schedule:** every 6h
**What it does:** runs `pnpm run health:json`, applies smart thresholds, notifies only if `fail >= 1` OR `warn >= 3`.

### Recovery
| Symptom | Action |
|---|---|
| `tasks.fail` | Identify the stale task in JSON output, jump to its section below. |
| `failures.fail` (5+ task.failed in 24h) | `Get-Content data/events/*.jsonl | Select-String task.failed | Select-Object -Last 5` — read the errors, fix root cause. |
| `parse.fail` | Validation failed on `data/events/*.jsonl`. Run `pnpm run verify:all` to see the bad row. Edit/delete it. |
| `stale.fail` (10+ apps not touched in 14d) | Run `pnpm run apply-liveness:render` to find dead listings. Mark closed listings as Discarded. Close stale apps that aren't progressing. |
| `brain.fail` (<80% chunk coverage) | Brain embedding pipeline broken. First run `cd vendor/gbrain && bun run src/cli.ts config show` — if `database_path` points outside career-ops (e.g. `.gbrain-trading` for JARVIS), the metric is reading the wrong brain. The shared PGLite DB can be re-targeted with `gbrain init` at a career-ops-specific path. If the path is right, run `cd vendor/gbrain && bun run src/cli.ts embed --stale` to backfill embeddings. |

### Notify-spam control
The cron only notifies when `fail>=1` OR `warn>=3`. If you're getting paged on every run, threshold drift is the problem — adjust `scripts/cron-health-check.mjs` notify gate, not the underlying check.

---

## gmail-recruiter-sync (gmail-recruiter-sync.mjs)

**Notification:** `[gmail-sync] failed` (no notification on success, by design)
**Schedule:** every 4h (configurable in `scripts/register-gmail-sync-task.ps1`)
**What it does:** Pulls recent recruiter mail, fuzzy-matches to apps, writes review file.

### Recovery
| Symptom | Action |
|---|---|
| `403` / scope insufficient | Refresh token missing `gmail.send` (added 2026-04-19). Re-bootstrap: `pnpm run gmail-oauth:bootstrap`. |
| `401` invalid_grant | Token revoked. Re-bootstrap as above. |
| `429` rate limit | Back off automatically via retry. If persistent, wait 1h and check Google Cloud quota dashboard. |
| Network timeout | Transient. Skip and wait for next cron tick. |
| "Stale GOOGLE_CLIENT_ID" | `loadProjectEnv` should override. If not, check shell env: `Get-ChildItem env:GOOGLE_*`. Unset stale vars, restart shell. |

### Why it might silently no-op
- Inbox query is too narrow / too broad. Compare last `data/outreach/gmail-sync-review-*.md` for surprising matches or empty files. Tighten in `GMAIL_RECRUITER_QUERY` env or `scripts/gmail-recruiter-sync.mjs` constants.

---

## cadence-alert (check-cadence-alert.mjs)

**Notification:** WhatsApp DM if any GO/Conditional GO app crossed cadence threshold; durable file at `data/stale-alert-YYYY-MM-DD.md`.
**Schedule:** daily at 9 AM CT
**What it does:** finds stale apps, sends WhatsApp + file alert, emits `cadence-alert.run.completed`.

### Recovery
| Symptom | Action |
|---|---|
| No event emitted in 36h | Cron didn't fire. Check `Get-ScheduledTask | Where TaskName -like "*cadence*"`. If missing, re-run `scripts/register-cadence-alert-task.ps1`. |
| WhatsApp send failed | Check Twilio (or whatever sender) credentials in `.env`. Fall back to durable file — it's already written FIRST. |
| File written but WhatsApp didn't fire | Same as above — Twilio creds. |
| False-positive stale apps | Check the apps' notes/responses log. If recently-touched but cadence script missed it, the touch event isn't being counted. Open issue in `docs/PIPELINE-TRIAGE.md`. |

---

## scanner / auto-scan (auto-scan.mjs)

**Notification:** `[scanner] failed` only
**Schedule:** evening (`register-evening-scan-task.ps1`) + ad-hoc via `register-scan-task.ps1`
**What it does:** Hits portals, dedupes vs `data/scan-history.tsv`, writes `data/scan-summary-YYYY-MM-DD.md`.

### Recovery
| Symptom | Action |
|---|---|
| Firecrawl 401/429 | Check `FIRECRAWL_API_KEY` in `.env`. If valid: rate-limited, wait next tick. |
| Empty results consistently | Portal selectors broke (LinkedIn DOM rotation). Open Playwright manually, inspect, update selectors in `scripts/lib/portals/*.mjs`. |
| Scanner runs but no new candidates | Healthy if dedupe is working. Check `data/scan-history.tsv` size — should grow each run. |

---

## daily-digest (daily-digest.mjs)

**Notification:** Email to `mattmamundson@gmail.com`. Notification only fires if **send failed**.
**Schedule:** daily at 7:55 AM CT
**What it does:** Pulls top actions, recruiter touches, yesterday activity, pipeline counts → renders HTML email.

### Recovery
| Symptom | Action |
|---|---|
| No email arrived | First check spam folder. Then run `pnpm run digest:dry` — confirms the digest renders. Then `pnpm run digest` — sends a real one. If failure: check `gmail-send` retry logs. |
| Empty / blank digest | The data fetchers returned nothing. Run `pnpm run digest:dry` and inspect HTML output. Likely stale event log. |
| Send 403 insufficient scopes | Re-bootstrap with `gmail.send` scope (see gmail-recruiter-sync above). |

---

## dashboard (generate-dashboard.mjs)

**Notification:** None directly. Surfaces in health-check `tasks.warn` if no `dashboard.generated` event in 90+ min.
**Schedule:** hourly via `register-dashboard-task.ps1`
**What it does:** Re-renders `dashboard.html` from `data/applications.md` + `data/responses.md` + event logs.

### Recovery
| Symptom | Action |
|---|---|
| Dashboard shows wrong app count | Parser broke on a malformed `data/applications.md` row. Run `pnpm run apply-queue:audit` to find the bad row. |
| Dashboard hasn't refreshed | Cron failed silently. `Get-Content data/events/*.jsonl | Select-String dashboard.generated | Select-Object -Last 3` — confirm gap. Re-register the task. |
| Recruiter Inbox panel shows wrong items | `parseGmailReview()` filter set is wrong. Check `scripts/generate-dashboard.mjs` recruiterEvents Set; should NOT include `submitted`, `in_progress`, `withdrew`. |

---

## apply-liveness (check-apply-queue-liveness.mjs)

**Notification:** None yet. Writes `data/apply-liveness-YYYY-MM-DD.md`.
**Schedule:** daily at 6 AM CT (after registering `register-apply-liveness-task.ps1`)
**What it does:** Probes every GO/Conditional GO/Ready to Submit URL. Optional `--render` mode catches SPA-rendered closed listings.

### Recovery
| Symptom | Action |
|---|---|
| All URLs `UNREACHABLE` | Network issue. Skip and re-run later. |
| Same DEAD app reported daily | You haven't updated its status to Discarded yet. Update `data/applications.md`, then it drops out of the queue. |
| `--render` mode times out per app | Playwright headless misconfigured. Run `pnpm run preflight:scanner` to validate Playwright install. |

---

## prune-automation-events

**Notification:** None
**Schedule:** weekly (or ad-hoc — `pnpm run events:prune` for dry-run, `events:prune:apply` to delete)
**What it does:** Trims `data/events/*.jsonl` files older than the keep window.

### Recovery
- Almost never fails. If it does, the event log is corrupt — likely a process killed mid-write. Inspect with `Get-Content data/events/<file>.jsonl | Select-Object -Last 20`, manually trim the half-line.

---

## Manual fallback (when nothing else works)

1. Daily digest didn't arrive → open `dashboard.html` in browser. Same data, no email.
2. Cadence-alert didn't fire → `pnpm run apply-queue:audit` shows the same staleness signals.
3. Health-check is broken → `pnpm run verify:all` is the cross-check (slower but more thorough).
4. Brain MCP is down → all `mcp__brain__*` calls fail. Restart MCP server config: re-register via the project-MCP setup (see commit `db95127`).

## Known false-positives

### Windows Task Scheduler reports exit-1 but `*.run.completed` event is present

Windows + Node sometimes reports a non-zero exit code when the script completed cleanly but had async handles still mid-close at `process.exit()`. Symptom: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in console output.

**Diagnosis:** Check `data/events/automation_events-YYYY-MM-DD.jsonl` for the matching `*.run.completed` event. If `status: success` (or `partial_success` with all expected work done), the script logic finished — Windows is reporting a libuv quirk, not a real failure.

**When to actually worry:** No completion event at all, OR `status: failed` in the event, OR repeated exit-1s with no completion event over multiple runs.

Confirmed seen on: cadence-alert (2026-04-19 21:01 — partial_success completion event present, Task Scheduler still reported exit-1).

---

## Standing principle

The notify channel is the canary, not the only signal. Every failure has a durable artifact (file under `data/` or event in `data/events/`). When notify is wrong, trust the artifact; when both are silent, trust the dashboard; when the dashboard is wrong, trust `pnpm run verify:all`.

If you're ever unsure whether the system is "actually broken" vs "noisy", run `pnpm run health:json | jq '.totals'` — that's the authoritative answer.
