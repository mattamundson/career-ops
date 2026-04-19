---
date: 2026-04-19
author: JARVIS (session-driven roadmap)
status: draft — for Matt's review
purpose: Map everything career-ops needs to (a) be daily-usable, (b) update autonomously every day, (c) optionally auto-apply
---

# Career-Ops Completion Roadmap

> Three goals, in order of value-delivered:
>
> 1. **Daily-use ready** — Matt opens the dashboard each morning, knows exactly what to do, acts, and the system records the result.
> 2. **Autonomous daily refresh** — dashboard, scans, brain, and tracker all update on a cron with zero human touch. Matt only acts on the *output*.
> 3. **Autonomous applying (stretch)** — system drafts + submits applications inside guardrails, surfaces only edge cases for Matt.

---

## Executive Summary — the 5 things blocking goal #1 today

| # | Blocker | Why it matters | Fix size |
|---|---|---|---|
| 1 | **Scheduled tasks not actually registered on this machine** (scripts exist; `schtasks /query "Career-*"` returns nothing) | Without these, "autonomous daily refresh" doesn't exist — every refresh is manual | S — run the 6 register-*.ps1 scripts as admin |
| 2 | **108 untracked files in the working tree** (scripts, tests, data, docs accumulated over 2 weeks) | Repo state ≠ origin. New session can't reproduce. Hooks don't enforce. Risk of losing work or shipping half-features. | M — triage and commit in 4–6 themed batches |
| 3 | **No "morning briefing" view** — dashboard is a snapshot, not a daily inbox | Daily-use means Matt should be able to answer "what do I do today?" in 30 seconds. Today the dashboard requires interpretation. | S — add a `morning-briefing.mjs` that emits Top-N actions to dashboard header + optional console |
| 4 | **No alert/notification when something needs Matt's attention** (recruiter reply, expiring posting, stuck application) | Even with daily refresh, if Matt has to *open* the dashboard to discover urgency, he won't | M — add a notification channel (Windows toast, email, or push) gated on event types |
| 5 | **Ethical-submit gate is correct but not productized** — the runbook explicitly says "you click Submit"; there's no UX that makes the human-in-the-loop fast | Goal #3 (autonomous apply) requires this UX before any automation can be trusted | M — `apply-review.mjs` queue: pre-filled forms + one-click confirm |

---

## Phase 1 — Daily-Use Ready

> Goal: Matt sits down with coffee, opens one URL or runs one command, sees exactly what to do, and the system makes acting on it frictionless.

### 1A. Hard blockers (must-have)

| Item | What | Why | File / Owner |
|---|---|---|---|
| **Morning briefing view** | New panel at top of `dashboard.html`: "Top 5 actions today" with one-click links (apply, follow-up, log response). Generated from priority score × urgency × stale-cadence. | The dashboard currently shows everything; daily-use needs a distilled "do these now" list | `scripts/generate-dashboard.mjs` + new `scripts/morning-briefing.mjs` |
| **Stale-application alerts surfaced inline** | Existing `data/stale-alert-*.md` reports are written but not surfaced. Render them into the dashboard. | Stale apps are leaky-bucket revenue | `scripts/generate-dashboard.mjs` panel addition |
| **Recruiter-reply inbox** | Surface unread Gmail recruiter messages mapped to applications, with one-click "Acknowledge / Schedule / Decline" | Currently `gmail-recruiter-sync.mjs` exists but output isn't visible in dashboard | `scripts/gmail-recruiter-sync.mjs` + dashboard panel |
| **One-command "log response"** | A single command (or dashboard button) that logs status changes (Applied → Responded → Interview → etc.) | Today this is `node scripts/log-response.mjs --app-id N --event X --date YYYY-MM-DD` — too much typing for daily use | Wrap in `pnpm run respond` with prompts, or dashboard form action |
| **Status-change confirmation** | When Matt logs "applied", system auto-runs `verify:all` and confirms tracker is consistent | Catches the "did I update the right row?" class of bugs | Hook on `log-response.mjs` exit |

### 1B. Polish (nice-to-have for daily-use)

- **Persistent "today's queue" markdown** at `data/today.md` — auto-regenerated, tells Matt the 5 actions in plain text
- **Dashboard refresh indicator** — show timestamp of last successful refresh + next scheduled refresh
- **Mobile-friendly dashboard** (basic responsive CSS) — Matt can check from phone over coffee
- **Keyboard shortcuts in Go TUI** — `a` = mark applied, `r` = log reply, `s` = skip, `o` = open URL
- **Search box in dashboard** — filter applications/pipeline by company, role, status, score

---

## Phase 2 — Autonomous Daily Refresh

> Goal: Matt does *nothing* for the system to stay current. Dashboard, scans, brain, tracker, alerts all update on cron. Matt only consumes output.

### 2A. Hard blockers

| Item | What | Current state | Fix |
|---|---|---|---|
| **Register all scheduled tasks** | Run all 6 `scripts/register-*.ps1` as admin: dashboard (1h), evening-scan (6 PM), gmail-sync, cadence-alert, prefilter, scan | XML/scripts written but `schtasks /query` confirms NONE are registered on this machine | One-time admin shell run. Document in SETUP.md. Verify with `schtasks /query /tn "Career-Ops*"` |
| **Brain reindex on cron** | New scheduled task: `bun run vendor/gbrain/src/cli.ts ingest && embed` after each evening scan completes | Embedding is currently manual (per handoff: 2,171 chunks done once) | New `scripts/register-brain-refresh-task.ps1`. Trigger after evening-scan finishes (chained task). |
| **Failure detection** | Each cron task emits to `data/events/*.jsonl` with `status: "failed"` on error; verify-all flags these | Tasks may silently fail (no surfacing) | Wrap each task entry-point in try/catch → emit `{type, status, error, timestamp}` event. Add `verify-all` check that no `failed` events in last 24h. |
| **Self-healing for known errors** | OpenAI 429 → exponential backoff retry. Playwright timeout → retry once. Pre-push hook fail → emit event, don't crash cron. | Per handoff, OpenAI 429 was hit; bash tail trap also caused issues | Add retry wrapper at `scripts/lib/retry.mjs` and use across scan/embed/submit. |
| **Notification on attention-needed events** | Windows toast / email / Pushover when: recruiter replied, application gone stale > 14 days, scan returned new high-score match (≥ 4.0), task failed | None today | Pick one channel (recommend Pushover for cross-device); wrap as `scripts/lib/notify.mjs`; call from event emitters |
| **Daily summary email** | 8 AM ET email: yesterday's events, today's top 5 actions, anything urgent | None today | New `scripts/daily-digest.mjs`, scheduled task at 7:55 AM CT, sends via Gmail OAuth (already wired) |

### 2B. Reliability infrastructure

- **Lock files / single-instance guards** for each scheduled task (prevent double-runs if a long task overlaps the next trigger)
- **Disk-space monitor** — `data/events`, `data/apply-runs`, `data/brain-staging-*` will grow. Add `events:prune` (already exists) to monthly cron + add equivalents for apply-runs, brain-staging.
- **Network failure resilience** — scans should not crash on transient DNS/timeout; record skip event and continue
- **Time-zone correctness** — confirm all "daily at 6 PM" tasks use Central Time consistently (mixing UTC and local in cron config has caused real production bugs)
- **State backup** — nightly snapshot of `data/applications.md`, `data/pipeline.md`, brain DB to a separate location (OneDrive, S3, or just `~/career-ops-backup/YYYY-MM-DD.tar.gz`)

### 2C. Observability

- **Health endpoint** — `scripts/health-check.mjs` that exits non-zero when: any task hasn't run in 26h, brain coverage < 95%, applications.md has parse errors, > 10 stale applications
- **Cron run log** — `data/events/cron.jsonl` aggregating all task-start, task-complete, task-failed events for one-glance review
- **Dashboard "last refresh" badge** — timestamp + green/yellow/red based on freshness of: dashboard, last scan, last brain ingest, last gmail sync

---

## Phase 3 — Autonomous Applying (stretch)

> Goal: Matt approves a "GO" application; the system handles the rest. Forms filled, PDF chosen, cover letter drafted, submitted, tracker updated, follow-up scheduled.
>
> **Critical**: per `CLAUDE.md` and `APPLICATION-RUNBOOK.md`, the system never clicks final Submit without explicit human authorization on each application. "Autonomous" here means **everything up to the submit click**, plus optional one-click batch confirm.

### 3A. Hard blockers (do not bypass)

| Item | What | Why this gate exists |
|---|---|---|
| **Per-application explicit consent** | Even in "autonomous" mode, each submission requires Matt's explicit click/keystroke (or signed approval) on a review screen showing the exact form data | Ethical use rule + ATS terms of service + reputation risk |
| **No mass-blast guard** | Hard limit: max 5 applications per day in autonomous mode, max 20 per week | Quality-over-quantity is the core principle |
| **Score floor** | Refuse to even queue auto-apply for score < 3.5 | Same |
| **Resume + cover letter version pinning** | Each auto-applied submission stores exact PDF hash + cover letter text in `data/apply-runs/` for audit | Traceability when recruiter asks "what version did I receive?" |

### 3B. Apply review queue (the productized human-in-the-loop)

| Item | What | Existing primitives |
|---|---|---|
| **`apply-review.mjs` UX** | Single-page review for each pending application: form preview, resume choice, cover letter, score, evaluation report link, one-click confirm | `submit-dispatch.mjs` exists; `submit-greenhouse.mjs`, `submit-workday.mjs`, `submit-icims.mjs`, `submit-universal-playwright.mjs` exist; need orchestration layer |
| **Pre-fill verification** | Before showing review screen, headlessly load the application page, fill all fields, render to screenshot. Matt approves the screenshot. | Playwright already wired |
| **Diff against past submissions** | When auto-filling, flag any field that differs from prior submissions to similar role/company (catches form-field drift) | New |
| **Resume-tailoring step** | For each application, generate a tailored resume (`generate-resume.mjs` or DOCX template fill) emphasizing JD-aligned bullets, then human-confirm before submit | Brain semantic search makes JD→bullet matching feasible |
| **Cover letter draft from evaluation** | Each evaluation in `reports/` already has a JD+CV match analysis. Auto-extract into a 3-paragraph cover letter; Matt edits before submit. | Reports exist; need extractor |

### 3C. ATS-specific autonomy (per submitter)

For each ATS, "autonomous" means: form fully pre-filled, screenshot rendered, Matt clicks one button to submit.

| ATS | Submitter | Status |
|---|---|---|
| Greenhouse | `submit-greenhouse.mjs` | Exists; needs end-to-end test on a real Greenhouse posting + screenshot review step |
| Workday | `submit-workday.mjs` | Exists; Workday is notoriously hostile to automation — needs careful ToS review and per-tenant testing |
| iCIMS | `submit-icims.mjs` | Exists; same caveats |
| Lever | `scripts/submit-lever.mjs` | NOT YET — common ATS, build it |
| Ashby | `scripts/submit-ashby.mjs` | NOT YET — common at startups |
| SmartRecruiters | `scripts/submit-smartrecruiters.mjs` | NOT YET |
| LinkedIn Easy Apply | `scripts/submit-linkedin.mjs` | NOT YET — high-value, ToS-sensitive |
| "Universal" Playwright fallback | `submit-universal-playwright.mjs` | Exists; treat as last-resort, flag for manual review |

### 3D. Post-submit autonomy

- **Auto-log submission event** (already wired via `submit-dispatch.mjs` → `data/apply-runs/`)
- **Auto-update tracker** (`data/applications.md` Status → `Applied`, date column updated)
- **Auto-schedule follow-up** (calendar event 7 days out for "follow up if no response")
- **Auto-detect responses** (gmail-sync → match to app_id → emit `recruiter_reply` event)
- **Auto-prep for phone screen** when `phone_screen` event detected (compile JD + CV + company brief into single page)

### 3E. Ethical / legal guardrails (non-negotiable)

- **Robots.txt and ToS check per portal** (some boards explicitly prohibit automation; respect that or risk account ban)
- **Rate limiting per domain** — never more than 1 submit per portal per 5 minutes
- **Captcha = human** — any captcha triggers immediate hand-off to Matt
- **Audit log** — every auto-action recorded with timestamp, decision rationale, data used (resume version, cover letter, form values)
- **Kill switch** — single env var `CAREER_OPS_AUTOAPPLY_DISABLED=1` halts all automation
- **Identity verification** — system never represents Matt as having qualifications he doesn't have (verified against `cv.md` source of truth)

---

## Cross-Cutting Work

### CC1. Repo hygiene (blocks everything)

- **Triage 108 untracked files** in 4–6 themed commits:
  1. `feat(scripts):` — all new automation scripts (scan-*, submit-*, prune-*, register-*)
  2. `feat(data):` — events/, apply-runs/, brain-staging-* (decide: gitignore or commit?)
  3. `feat(dashboard):` — Go module additions (automation_events.go + test)
  4. `docs:` — APPLICATION-RUNBOOK, PIPELINE-TRIAGE, STATUS-MODEL, MAINTENANCE-RITUALS, GMAIL_SYNC_SETUP, etc.
  5. `chore(outreach):` — data/outreach/*.md (decide: commit or gitignore as personal drafts?)
  6. `test:` — tests/event-log-prune.test.mjs, prune-pipeline-tracked.test.mjs, scan-window.test.mjs
- **Resolve `dashboard.html` LF/CRLF churn** — add to `.gitattributes` so it stops appearing as modified
- **Add `.env.example`** to repo (already untracked — commit it)

### CC2. Documentation gaps

- **`docs/DAILY-USAGE.md`** — "How Matt uses career-ops every morning" (referenced from CLAUDE.md)
- **`docs/AUTONOMY-LEVELS.md`** — defines L0 (manual), L1 (autonomous refresh), L2 (autonomous draft + human submit), L3 (full auto-apply with consent gates)
- **`docs/INCIDENT-RUNBOOK.md`** — what to do when: cron task failed, dashboard won't generate, scan returns 0 results, brain coverage drops, etc.
- **Update `CLAUDE.md`** — current state describes the system as ad-hoc; add "operating modes" and standing autonomy expectations

### CC3. Quality / testing

- **End-to-end smoke test** — single command (`pnpm run smoke`) that simulates: scan finds new job → prefilter scores it → evaluation written → tracker updated → dashboard regenerated → brain ingested → search returns it. This is the regression net for autonomy.
- **Submitter integration tests** — each ATS submitter tested against a known-good test posting (or a saved HTML fixture)
- **Coverage for `scripts/lib/`** — most logic lives in shared libs; current test coverage is partial

### CC4. Performance

- **Brain query latency** — measure and tune; if MCP responses > 500 ms, dashboard can't embed live brain queries
- **Dashboard generation time** — currently regenerates from full applications.md + pipeline.md every hour. With 2,000+ pipeline items, this could exceed the 2-min cron timeout. Profile and optimize.
- **Scan total runtime** — evening-scan has 30-min timeout; with full source list, it's tight. Parallelize portal scans where ToS allows.

### CC5. Identity / branding

- **Decide on the public-facing identity question** — `MEMORY.md` notes "GitHub profile is empty"; some auto-apply ATSs request GitHub URL. Either populate the GitHub or have submitters omit the field.
- **Consistent email signature** in cover letters and recruiter replies
- **LinkedIn premium / boosted profile** — if auto-apply is targeting MSP roles, recruiters will check LinkedIn

---

## Recommended Sequencing

> Each phase is a **week of focused work** (or 2–3 days at full effort). Numbers reference items above.

### Week 1 — Foundation (unblocks everything)
1. **CC1.1**: Triage and commit the 108 untracked files (Day 1 — half day)
2. **2A.1**: Register all 6 scheduled tasks as admin (Day 1 — 30 min)
3. **2A.3**: Wrap every task in event-emitting try/catch (Day 2)
4. **2A.4**: Retry wrapper for known transient errors (Day 2)
5. **CC2.1**: Write `docs/DAILY-USAGE.md` (Day 3 — half day)

**Exit criteria**: System runs autonomously for 5 consecutive days with zero manual intervention. All failures surface in `data/events/`. Matt can read `docs/DAILY-USAGE.md` and use the dashboard the next morning.

### Week 2 — Daily-use polish
1. **1A.1**: Morning-briefing view in dashboard (Day 1)
2. **1A.2**: Stale-alert panel surfaced (Day 1)
3. **1A.3**: Recruiter-reply inbox panel (Day 2)
4. **1A.4 + 1A.5**: One-command response logging + verify hook (Day 3)
5. **2A.5**: Notification channel (Pushover or Windows toast) (Day 4)
6. **2A.6**: Daily summary email at 7:55 AM (Day 4)
7. **2C**: Health endpoint + cron run log + freshness badge (Day 5)

**Exit criteria**: Matt opens dashboard, sees 5 actions, takes them, and the system records and verifies each. Zero terminal commands needed for routine use.

### Week 3 — Auto-apply foundation (L2: draft + human submit)
1. **3A.1–3A.4**: Codify guardrails in `scripts/lib/auto-apply-guards.mjs` (Day 1)
2. **3B.1–3B.2**: `apply-review.mjs` UX — pre-fill + screenshot + one-click confirm (Day 2–3)
3. **3B.4**: Resume-tailoring step (Day 4)
4. **3B.5**: Cover-letter draft from evaluation (Day 4)
5. **3C**: End-to-end test of Greenhouse submitter with full review flow (Day 5)

**Exit criteria**: Matt approves a `GO` application; system fills the form, renders screenshot, Matt clicks confirm, system submits and updates tracker. One full real-world cycle.

### Week 4+ — Auto-apply expansion (L3: opt-in batch confirm + new ATSs)
1. Build remaining ATS submitters: Lever, Ashby, SmartRecruiters (Day 1–3)
2. Implement batch-confirm UX (review 5 pending apps, single approval) (Day 4)
3. Post-submit autonomy: follow-up scheduling, response detection, phone-screen prep (Day 5)
4. Audit log + kill switch + ToS compliance review (ongoing)

**Exit criteria**: System processes a week of `GO` applications with single weekly review session from Matt.

---

## Out-of-scope explicit non-goals

- **Auto-applying without per-application confirmation** — never, per `CLAUDE.md` ethical use rule
- **Auto-creating LinkedIn connections at scale** — risks LinkedIn account ban
- **Generating fake metrics or qualifications** — `cv.md` is source of truth
- **Replacing the Go TUI** — HTML dashboard and Go TUI serve different uses (see `docs/WHICH-DASHBOARD-WHEN.md`)
- **Migrating off Windows Task Scheduler** — works fine; no need for systemd/launchd parity

---

## Open decisions for Matt

1. **Notification channel**: Pushover ($5 one-time, cross-device) vs Windows toast (free, desktop-only) vs daily email digest only?
2. **Backup destination**: OneDrive (already on machine) vs S3 vs simple local rotated tarballs?
3. **Auto-apply scope**: Should L3 (batch confirm) ever be enabled, or hard-cap at L2 (one-by-one human confirm)?
4. **`data/outreach/*.md`**: Commit (auditable) or gitignore (personal drafts)?
5. **`data/apply-runs/`**: Commit (auditable submission record) or gitignore (contains identifiable data)?
6. **GitHub profile**: Populate with public projects (visible to recruiters) or keep empty and have submitters omit?

---

*Generated 2026-04-19 from session-driven survey of `scripts/`, `docs/`, scheduled-task scripts, and the 2026-04-18-night handoff. For source-level current state see `docs/SYSTEM-STATUS.md` and `docs/SUPPORTED-JOB-SOURCES.md`.*
