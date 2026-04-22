# Career-Ops Operator Guide

**One-page entry point for running, operating, and pausing career-ops. Read this first; deep-dive docs linked from each section.**

Last updated: 2026-04-22

---

## 1. What this system does (90 seconds)

Career-ops is a job-search pipeline that runs autonomously on your Windows machine. It scans job boards, scores each listing against your CV, evaluates high-scoring cards via an A–F rubric, packages submittable applications, tracks everything in `data/applications.md`, and surfaces daily action items via email digest + dashboard.

**The only step that needs you:** the final Submit click on each application. Everything upstream is automated. Ethical-use rule — the system never submits on your behalf.

Flow:

```
Portal scan (8 sources)
  → Prefilter (LLM score + archetype)
  → Auto-promote ≥4.0 → Evaluated
  → /career-ops deep eval → GO
  → package-from-report.mjs → Ready to Submit
  → YOU review packages/<N>/ and submit
  → log-response.mjs --event submitted → Applied
  → Gmail recruiter sync picks up replies → Responded / Interview
```

---

## 2. What to read, in what order

| If you want to… | Read |
|---|---|
| Run the morning routine (30 sec/day) | [`DAILY-USAGE.md`](DAILY-USAGE.md) |
| Understand every mode + command | [`USER-MANUAL.md`](USER-MANUAL.md) §§ 2–5 |
| See the system architecture | [`ARCHITECTURE.md`](ARCHITECTURE.md) + [`ARCHITECTURE-scan-pipeline.md`](ARCHITECTURE-scan-pipeline.md) |
| Respond to a recruiter reply | [`RESPONSE-PLAYBOOK.md`](RESPONSE-PLAYBOOK.md) |
| Fix a broken scheduled task / MCP | [`RUNBOOK-linkedin-mcp.md`](RUNBOOK-linkedin-mcp.md) + [`INCIDENT-RUNBOOK.md`](INCIDENT-RUNBOOK.md) |
| Weekly / monthly housekeeping | [`MAINTENANCE-RITUALS.md`](MAINTENANCE-RITUALS.md) |
| Apply to a new employer safely | [`APPLICATION-RUNBOOK.md`](APPLICATION-RUNBOOK.md) |
| Customize archetypes, portals, or scoring | [`CUSTOMIZATION.md`](CUSTOMIZATION.md) |

---

## 3. What's running right now

### 3a. Scheduled Tasks (Windows Task Scheduler)

Registered tasks — all run as the current user, no admin needed:

| Task | Cadence | Purpose |
|---|---|---|
| Career-Ops Dashboard | hourly | Regen `dashboard.html` |
| Career-Ops Morning Scan | daily 06:00 CT | Portal scan + dedup |
| Career-Ops Apply-Liveness | daily 06:00 CT | Probe GO/Ready URLs; flag dead |
| Career-Ops Prefilter | daily 07:00 CT | LLM-score pipeline items |
| Career-Ops Daily Digest | daily 07:55 CT | Email summary of today's actions |
| Career-Ops Cadence Alert | daily 09:00 + 16:00 CT | Stale-app detection |
| Career-Ops Evening Scan | daily 18:00 CT | Full source matrix scan |
| Career-Ops Gmail Sync | every 4 hours | Classify recruiter replies |
| Career-Ops Health Check | every 6 hours | 5-bucket probe, notifies on failure |

### 3b. List everything, confirm it's healthy

```bash
# What's registered
schtasks /query /fo LIST | grep -i "TaskName:.*Career"

# When did each last run
schtasks /query /tn "Career-Ops Dashboard" /v /fo LIST | grep -i "Last Run"

# One-command system health
pnpm run verify:all
```

`verify:all` is the single-command truth. If it exits 0, the system is healthy.

### 3c. Event telemetry (everything that happened today)

```bash
cat data/events/$(date +%Y-%m-%d).jsonl | tail -30
```

Each line is one event (task.start, task.complete, task.failed, package.ready, automation.ats_gate.*, etc.).

---

## 4. How to turn things off

### 4a. Pause one task (e.g., going on vacation)

```bash
schtasks /change /tn "Career-Ops Evening Scan" /disable
# ...re-enable:
schtasks /change /tn "Career-Ops Evening Scan" /enable
```

### 4b. Pause everything (full stop)

```bash
for task in "Dashboard" "Morning Scan" "Apply-Liveness" "Prefilter" \
            "Daily Digest" "Cadence Alert" "Evening Scan" \
            "Gmail Sync" "Health Check"; do
  schtasks /change /tn "Career-Ops $task" /disable
done
```

Re-enable later by swapping `/disable` → `/enable` in the same loop.

### 4c. Unregister a task permanently

```bash
schtasks /delete /tn "Career-Ops Evening Scan" /f
# Re-register later by running the matching register-*.ps1 script:
powershell -ExecutionPolicy Bypass -File scripts/register-evening-scan-task.ps1
```

### 4d. Stop notifications only (keep automation)

Edit `config/profile.yml` and set `notifications.enabled: false`, or remove the channel key for Pushover / WhatsApp.

### 4e. Kill a stuck background process

```bash
# List Node processes
powershell "Get-Process node | Format-Table Id, ProcessName, StartTime"
# Kill by PID
powershell "Stop-Process -Id <PID>"
```

Portal scanner processes sometimes hang on MCP profile locks — see [`RUNBOOK-linkedin-mcp.md`](RUNBOOK-linkedin-mcp.md) for symptom triage.

---

## 5. Day-to-day operating commands

Keep these memorized. Everything else is lookup.

```bash
# Morning health check
pnpm run verify:all

# Evaluate a new URL / JD (in Claude Code chat)
/career-ops
[paste URL]

# Package a GO-scored report into submit-ready bundle
node scripts/package-from-report.mjs --report-num <N>

# After you physically submit
node scripts/log-response.mjs --app-id <N> --event submitted

# After a recruiter replies
node scripts/log-response.mjs --app-id <N> --event recruiter_reply --notes "wants Tues call"

# Regenerate dashboard manually
node scripts/generate-dashboard.mjs

# See what changed in the events log today
cat data/events/$(date +%Y-%m-%d).jsonl | tail -20

# Refresh everything (pipeline, CV sync, index, dashboard, events validation, tests, cron status)
pnpm run verify:all
```

---

## 6. Best practices (learned the hard way)

### Do
- **Run `verify:all` before committing** — it catches 95% of state-drift issues in <10s
- **Log every submit** — otherwise dashboards lie to you
- **Keep applications.md locally-curated** — it's gitignored for a reason (personal tracker, not code)
- **Use `/career-ops` skill for deep evals** — the A–F rubric is calibrated to your target archetypes
- **Review `packages/<N>/warnings.jsonl`** before submitting — non-fatal issues flagged per stage
- **DOCX → PDF for visual CVs** — `scripts/cv-docx-to-pdf.mjs` is the trusted path; `cv-template.html` is broken (known memory)

### Don't
- **Don't commit `data/applications.md`** — it's gitignored to keep personal state off GitHub
- **Don't trust auto-promoted `Evaluated` cards as application-ready** — they've only seen a title+snippet score, not the full rubric. Run `/career-ops` first.
- **Don't skip hooks (`--no-verify`) on commits** — pre-commit runs secrets-check + dashboard regen; if it fails, investigate
- **Don't submit without reviewing `packages/<N>/cover-letter.md`** — AI-drafted, Matt-reviewed is the invariant
- **Don't re-run `promote-prefilter` with low `--min`** — auto-promoting weak cards pollutes the tracker
- **Don't mock the database in integration tests** — a past incident proved mock/prod divergence; use real fixtures

### Watch out for
- **MCP profile locks** (Playwright stale Chrome) — run `scripts/preflight-chrome-lock.mjs` if scans hang
- **OpenAI rate limits** — 429 errors on cover-letter generation; retry wrapper handles transients, but check quota if persistent
- **Windows newline conversion warnings** (`LF will be replaced by CRLF`) — cosmetic; safe to ignore in this repo
- **Multi-byte chars in events logs** — em dashes (`—`) are 3 bytes but 1 JS char; any tail-by-byte-offset helper must read as Buffer, not utf8 string

---

## 7. Mental model: the tracker is the source of truth

Everything hangs off `data/applications.md`. Status values are canonical (see [`templates/states.yml`](../templates/states.yml)):

```
Evaluated → GO / Conditional GO / SKIP / Deferred
GO → Ready to Submit (via package-from-report.mjs)
Ready to Submit → In Progress → Applied (via your submit + log-response)
Applied → Responded → Contact → Interview → Offer / Rejected
```

Two rules:
1. **Never edit applications.md to ADD new rows** — use TSV in `batch/tracker-additions/` + `merge-tracker.mjs`
2. **Yes, edit applications.md to UPDATE status of existing rows** — `log-response.mjs` handles most cases

---

## 8. Troubleshooting jump-table

| Symptom | First thing to try |
|---|---|
| "Dashboard hasn't updated" | `node scripts/generate-dashboard.mjs` manually; if works, check Task Scheduler |
| "verify:all says N cron tasks failed" | `cat data/events/$(date +%Y-%m-%d).jsonl | grep task.failed` for root cause |
| "Dashboard shows stale GO counts" | You didn't log a submit; `node scripts/log-response.mjs --app-id N --event submitted` |
| "Too many low-score evals" | Tighten `portals.yml` `title_filter`; raise `promote-prefilter --min=4.5` |
| "Scan hangs on LinkedIn" | See [`RUNBOOK-linkedin-mcp.md`](RUNBOOK-linkedin-mcp.md) |
| "Cover-letter generation failing" | Check OpenAI quota; re-run with `--force` to bypass lint |
| "ATS gate blocked my package" | Read `packages/<N>/ats-score.json` top-missing keywords; inject into CV variant |
| "Gmail sync isn't finding replies" | Re-bootstrap OAuth per [`GMAIL_SYNC_SETUP.md`](GMAIL_SYNC_SETUP.md) |

Full incident runbook at [`INCIDENT-RUNBOOK.md`](INCIDENT-RUNBOOK.md).

---

## 9. Where everything lives

| What | Where |
|---|---|
| Canonical CV | `cv.md` |
| Your profile (SSOT) | `config/profile.yml` |
| Portal + company config | `portals.yml` |
| Applications tracker (gitignored) | `data/applications.md` |
| Raw pipeline inbox | `data/pipeline.md` |
| Evaluation reports | `reports/<N>-<slug>-<date>.md` |
| Packaged submissions | `packages/<N>/` (gitignored) |
| Per-application CV variants | `output/cv-variants/` (gitignored) |
| Cover letters | `output/cover-letters/` (gitignored) |
| Event telemetry | `data/events/*.jsonl` (gitignored) |
| All scripts | `scripts/*.mjs` (113 scripts) |
| Skill modes | `modes/*.md` (consumed by `/career-ops`) |
| Interview stories | `interview-prep/story-bank.md` |
| Company research dossiers | `data/company-intel/*.md` |

---

## 10. If the system goes silent for a week

Runbook for a cold restart (e.g., after vacation, machine reboot, long gap):

```bash
# 1. System health
pnpm run verify:all

# 2. Scheduled tasks still registered + enabled?
schtasks /query /fo LIST | grep -i "Career-Ops" | grep -i TaskName
# Re-register any missing via scripts/register-*-task.ps1

# 3. Catch the tracker up on anything stale
node scripts/check-cadence.mjs
node scripts/check-apply-queue-liveness.mjs   # dead listings

# 4. Review the current queue
grep -E "\| (GO|Conditional GO|Ready to Submit|In Progress) \|" data/applications.md

# 5. Open the dashboard
start dashboard.html
```

If `verify:all` fails after a gap, start at [`INCIDENT-RUNBOOK.md`](INCIDENT-RUNBOOK.md).

---

## 11. Related skills (Claude Code commands)

Invoke via `/<name>` in chat:

- `/career-ops` — full evaluator + command menu (main entry)
- `/career-ops scan` — kick a portal scan now
- `/career-ops batch` — process multiple URLs in parallel
- `/career-ops offer` — compare a job offer
- `/career-ops contact` — LinkedIn warm-intro path
- `/career-ops research` — deep company research
- `/career-ops apply` — form-fill + review

Full mode reference: [`USER-MANUAL.md`](USER-MANUAL.md#3-mode-reference).

---

**This file is the front door. If you only ever read one doc, read this one — then follow the link for whatever you're trying to do.**
