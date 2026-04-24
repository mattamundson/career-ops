# Daily Usage — Career-Ops

> How to use career-ops every morning without thinking about it.

For **phase goals, deadlines, and a weekly scorecard**, see [`career-search-roadmap-2026.md`](career-search-roadmap-2026.md) (complements this doc: *how* each day; roadmap = *what* by *when*).

## The 30-Second Morning Routine

1. **Read the 7:55 AM digest email** (sent to your Gmail). Top 7 actions, recruiter touches, yesterday's activity.
2. **Open the dashboard** if you want detail: `dashboard.html` (auto-refreshed hourly).
3. **Act on the top 3** (apply, follow up, log a response — usually one click each).
4. **Done.** The system handles everything else.

If the system is healthy, that's the entire ritual. The rest of this doc covers what to do when it isn't, or when you want to go deeper.

### What surfaces what

| Surface | Cadence | What you see |
|---|---|---|
| 📧 Email digest (`scripts/daily-digest.mjs`) | 7:55 AM CT daily | Top actions, recruiter touches (14d), **dead listings to discard**, yesterday's activity, pipeline counts |
| 🖥 Dashboard `dashboard.html` | regenerated hourly | Morning Briefing, Recruiter Inbox, Stale Applications, freshness badges, full table |
| 📱 Toast/Pushover via `scripts/lib/notify.mjs` | event-driven | Recruiter replies (gmail-sync), health-check failures, cron-task failures |
| 📨 WhatsApp via OpenClaw | event-driven | Cadence stale-app summary (one daily message if any apps overdue) |

When a recruiter replies, see [`docs/RESPONSE-PLAYBOOK.md`](RESPONSE-PLAYBOOK.md) for what to do per event type.

---

## Morning checklist (before the routine, when first sitting down)

```bash
# 1. Open dashboard in browser (no terminal needed if already open)
start dashboard.html

# 2. Optional: see system health in one glance
pnpm run verify:all
```

`verify:all` runs in ~10 seconds and tells you:
- Tracker is consistent (no broken statuses, missing reports, dup rows)
- CV ↔ profile.yml in sync
- Application index regenerated
- Dashboard regenerated
- Automation event JSONL parses cleanly
- 74 unit tests pass
- **No scheduled tasks failed in the last 24 hours**

If all 7 checks pass, the system is healthy. If anything is yellow/red, see [Troubleshooting](#troubleshooting) below.

### Faster: `pnpm run health`

`pnpm run health` is a 5-bucket probe (task freshness, recent failures, applications.md parse, stale-app count, brain coverage) — colored TTY output, exit-code-aware. Runs in <1s. Wired into a 6-hour cron (`Career-Ops Health Check`) that fires a notification when something fails or 3+ checks warn.

---

## What the system does autonomously (no action from you)

| When | What | Verify it ran |
|---|---|---|
| Every hour | Regenerates `dashboard.html` from `data/applications.md` + `data/pipeline.md` | `dashboard.generated` event in `data/events/YYYY-MM-DD.jsonl` |
| Daily 18:00 CT | Full scan (Greenhouse, Ashby, Lever, Workday, iCIMS, etc.) + prefilter | `scanner.run.completed` event |
| Daily 07:00 CT | **Prefilter auto-score + promote** — LLM-scores EVALUATE cards, promotes ≥4.0 into tracker so morning digest sees them | `cron-prefilter` task.complete event with `{scored, promoted, skipped}` |
| Daily | Gmail recruiter sync — pulls labeled mail, classifies, maps to applications | `gmail-sync.completed` event |
| Daily 6:00 AM CT | Apply-queue liveness — probes every GO/Conditional GO URL with HEAD + render-mode for SPAs. Catches dead listings before they waste prep cycles. | `data/apply-liveness-YYYY-MM-DD.md` and `apply-liveness.run.completed` event |
| Daily | Cadence alert — flags applications stale > 14 days | `data/stale-alert-YYYY-MM-DD.md` |

If a task hasn't run, see [Scheduled Tasks](#scheduled-tasks-windows-task-scheduler).

---

## Common daily commands

```bash
# Evaluate a job (paste a URL or JD)
# → Drop URL into the chat with /career-ops or just paste it

# Log a response from a recruiter
node scripts/log-response.mjs --app-id 042 --event recruiter_reply --notes "wants Tuesday call"

# Package a GO-scored report for submission (NEW — meta-orchestrator)
# Runs ATS preflight → PDF → cover letter → portal-branch artifact → tracker update.
# Output lands in packages/<N>/ with manifest.json + warnings.jsonl.
node scripts/package-from-report.mjs --report-num 219              # full pipeline
node scripts/package-from-report.mjs --report-num 219 --skip-pdf   # if DOCX→PDF flow not available
node scripts/package-from-report.mjs --report-num 219 --dry-run    # preview without writing
# Portal branches emit:
#   greenhouse/lever/ashby → packages/<N>/apply-flow.md  (essay checklist + gh_jid if known)
#   email                  → packages/<N>/email.eml      (multipart/mixed, open in Outlook/Thunderbird)
#   workday/icims/universal → packages/<N>/apply-preview.md  (form preview stub)

# Apply-Review queue — see what's ready to prep, with URL classification
pnpm run apply-review               # list all GO / Conditional GO with URL kind + ATS
pnpm run apply-review --prepare 003 # dry-run: open browser, fill form, screenshot, no submit
pnpm run apply-review --confirm 003 # actually submit (needs a recent prepare bundle)
# LinkedIn jobs Apply URL (linkedin.com/jobs/...) → submit-linkedin-easy-apply via dispatch; see docs/tos-risk-register.md
pnpm run review:ui:open            # single-page review cockpit (GO / Conditional / Ready) — or open review.html

# Cover letters
pnpm run cover-letter -- --app-id 003       # generate (auto-runs lint, blocks bad output)
pnpm run cover-letter:lint                  # lint everything in output/cover-letters/
pnpm run cover-letter:lint -- --strict      # treat em-dash as error

# Apply-queue liveness
pnpm run apply-liveness                     # cheap HEAD probe (catches 404/410)
pnpm run apply-liveness:render              # +Playwright render for SPA hosts (Workable etc.)

# Check the apply queue (what's ready to submit)
grep -E '^\| .* \| (Ready to Submit|GO|Conditional GO) \|' data/applications.md

# Mark an application as submitted
# (do this AFTER you click Submit on the employer site)
node scripts/log-response.mjs --app-id 042 --event submitted --date 2026-04-19

# Batch Phase A — package every GO / Conditional GO (score ≥ min) with a report on disk
pnpm run prep-queue -- --dry-run
pnpm run prep-queue -- --min-score=3 --limit=5
pnpm run prep-queue -- --skip-liveness

# Phase B' — batch prepare/confirm (same guardrails as apply-review; --confirm needs --accept-submit-risk)
pnpm run apply-review:batch -- --prepare --dry-run --ids=016,042
pnpm run apply-review:batch -- --prepare --ids=016,042 --delay-ms=10000
pnpm run apply-review:batch -- --confirm --ids=016 --accept-submit-risk

# Diagnose recent scheduler failures (Windows Task Scheduler)
pnpm run tasks:inspect
pnpm run tasks:inspect -- --task="Career-Ops Dashboard" --hours=48
pnpm run tasks:remediate          # dry-run: export patched XML for repeated 267014 dashboard exits

# Generate a tailored PDF for a specific app
node generate-pdf.mjs --app-id 042 --output output/cv-matt-{company}-2026-04-19.pdf

# Manual scan (don't wait for 18:00)
node scripts/auto-scan.mjs --since=7

# Manual dashboard regen (don't wait for the hour)
node scripts/generate-dashboard.mjs

# Pipeline hygiene (dedupe + prune already-tracked URLs)
pnpm run pipeline:hygiene          # dry run
pnpm run pipeline:hygiene:apply    # actually apply
```

---

## Decision flow: "I have 30 minutes — what do I do?"

```
Open dashboard → look at Top Actions
   │
   ├─ Recruiter replied?
   │     → log-response with --event recruiter_reply
   │     → if interview requested, set Status = Interview
   │
   ├─ Application ready to submit (Status = Ready to Submit)?
   │     → Click apply URL → fill form using pre-filled draft
   │     → Click Submit on employer site
   │     → log-response with --event submitted
   │
   ├─ New high-score evaluation (4.0+, Status = Evaluated)?
   │     → Read the report in reports/{NUM}-{slug}-{date}.md
   │     → If go, set Status = GO + decide on outreach
   │
   ├─ Stale application (in stale-alert-*.md, no response > 14 days)?
   │     → Send polite follow-up via LinkedIn or email
   │     → log-response with --event followup_sent
   │
   └─ Nothing urgent?
         → Pipeline triage: pnpm run pipeline:hygiene
         → Or close the laptop. The system keeps running.
```

---

## When you do nothing for a week

The system continues to:
- Scan portals daily
- Pull gmail responses
- Regenerate the dashboard hourly
- Flag stale applications
- Record everything to `data/events/*.jsonl`

You can come back, run `pnpm run verify:all`, and see exactly what happened. Nothing is lost.

If a scheduled task fails, the next `verify:all` (or pre-push hook) surfaces it as:

```
=== 7/7 recent cron-task failures (last 24h) ===
  ⚠️  3 failed task run(s) in the last 24h:
    - 2026-04-18T18:00:42Z evening-scan: Navigation timeout (TimeoutError)
    - 2026-04-18T19:00:13Z gmail-sync: 429 (rate-limit)
    - 2026-04-18T20:01:55Z evening-scan: ECONNRESET (no code)
```

---

## What requires you (and always will, per CLAUDE.md ethics rule)

- **Final Submit click** on every application — automation drafts + renders, you submit
- **Tracker status updates after submit** — `log-response.mjs --event submitted`
- **Recruiter reply judgement** — system flags + classifies, you choose to engage
- **Offer evaluation** — `/career-ops offer` mode helps but doesn't decide
- **Negotiation** — system drafts scripts, you deliver

---

## Scheduled Tasks (Windows Task Scheduler)

The autonomy lives in 6 registered tasks. Verify they exist:

```bash
schtasks /query /tn "Career-Ops*" /fo LIST | grep -i taskname
```

You should see (registered as of 2026-04-19):
- Career-Ops Dashboard — hourly regen
- Career-Ops Scan — daily 06:00 CT (Greenhouse + portals)
- Career-Ops Prefilter — daily 07:00 CT (post-scan)
- Career-Ops Evening Scan — daily 18:00 CT (full source matrix + prefilter)
- Career-Ops Cadence Alert — daily 09:00 + 16:00 CT (stale-app alerts)
- Career-Ops Gmail Sync — **NOT YET REGISTERED**: requires `GOOGLE_REFRESH_TOKEN` in `.env`. Complete OAuth bootstrap per `docs/GMAIL_SYNC_SETUP.md`, then run `powershell -ExecutionPolicy Bypass -File scripts/register-gmail-sync-task.ps1`
- Career-Ops Brain Refresh — not yet built (Week 2 plan; would chain off Evening Scan)

**If any task is missing**: re-run its registration script as the current user (no admin needed):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-dashboard-task.ps1
powershell -ExecutionPolicy Bypass -File scripts/register-evening-scan-task.ps1
powershell -ExecutionPolicy Bypass -File scripts/register-gmail-sync-task.ps1
powershell -ExecutionPolicy Bypass -File scripts/register-cadence-alert-task.ps1
powershell -ExecutionPolicy Bypass -File scripts/register-prefilter-task.ps1
```

**Force a task to run now** (without waiting for the schedule):

```bash
schtasks /run /tn "Career-Ops Evening Scan"
```

**Disable a task temporarily** (e.g., during travel):

```bash
schtasks /change /tn "Career-Ops Evening Scan" /disable
schtasks /change /tn "Career-Ops Evening Scan" /enable
```

---

## Troubleshooting

### "Dashboard hasn't updated in hours"
1. Is the scheduled task still registered? `schtasks /query /tn "Career-Ops Dashboard"`
2. Did it last run successfully? `schtasks /query /tn "Career-Ops Dashboard" /v /fo LIST | grep -i "Last Run"`
3. Can you regenerate manually? `node scripts/generate-dashboard.mjs`
4. If manual works but cron doesn't, check Windows Event Viewer → Applications → Task Scheduler

### "Verify-all says cron tasks are failing"
1. Look at the last 10 failed events: `tail -20 data/events/$(date +%Y-%m-%d).jsonl | grep task.failed`
2. Common causes:
   - **OpenAI 429**: rate limit — retry wrapper handles transient ones automatically; if persistent, check API key + quota
   - **Playwright TimeoutError**: portal blocked or site changed — see `docs/playwright-submit-gotchas.md`
   - **Navigation timeout**: network blip or portal down — usually self-resolves next run
   - **ECONNRESET / ENOTFOUND**: transient network — retry handles
3. If a task fails 3+ times in 24h, investigate root cause; don't `--no-verify` past it

### "I clicked Submit but the dashboard still shows it as Ready to Submit"
You forgot to log it:
```bash
node scripts/log-response.mjs --app-id NNN --event submitted --date YYYY-MM-DD
```
Then `pnpm run verify:all` to confirm tracker is consistent.

### "I'm getting too many low-score evaluations"
Tighten the prefilter. Edit `portals.yml` `title_filter` keywords. Or raise the score threshold in the morning briefing (when implemented in Week 2).

### "Brain MCP isn't working"
- `restart Claude Code` (loads the MCP server fresh in this directory)
- Check coverage: in chat, ask for `mcp__brain__get_health` — should be 100% embed coverage
- If coverage is low, re-run: `bun run vendor/gbrain/src/cli.ts ingest && bun run vendor/gbrain/src/cli.ts embed`

### "Pre-push hook is blocking me"
Don't bypass with `--no-verify`. Read the failure, fix the root cause. Common:
- New `.test.mjs` file failing → fix the test or the implementation
- Tracker has duplicates → `node dedup-tracker.mjs`
- Status not canonical → `node normalize-statuses.mjs`

---

## Files you can edit safely

| File | What it does |
|---|---|
| `data/applications.md` | Tracker — edit existing rows for status/notes; never add new rows by hand (use TSV merge per CLAUDE.md) |
| `cv.md` | Source-of-truth CV — edit then run `pnpm run verify:all` |
| `config/profile.yml` | Identity, targets, narrative |
| `portals.yml` | Companies + queries to scan |
| `templates/states.yml` | Canonical statuses (rare edits) |

## Files you should NOT hand-edit

| File | Why |
|---|---|
| `dashboard.html` | Regenerated every hour; manual edits will be overwritten |
| `data/scan-history.tsv` | Maintained by scanners |
| `data/index/applications.json` | Built by `build-application-index.mjs` |
| `data/events/*.jsonl` | Append-only telemetry; corruption breaks `verify-all` |
| `reports/{NUM}-*.md` | Generated by evaluation mode |

---

## When in doubt

```bash
pnpm run verify:all
```

If that's green, the system is healthy and you can proceed with whatever you were doing. If it's not green, the output tells you exactly what's wrong and where to look.

For the full operating model see:
- `docs/COMPLETION-ROADMAP-2026-04-19.md` — what's built vs what's planned
- `docs/SYSTEM-STATUS.md` — current capabilities snapshot
- `docs/APPLICATION-RUNBOOK.md` — the human loop for submit + log
- `docs/MAINTENANCE-RITUALS.md` — periodic hygiene
- `docs/STATUS-MODEL.md` — canonical status definitions
