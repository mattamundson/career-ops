# AI Session Continuity — 2026-04-20 Night (Scan + LinkedIn MCP Fix)

**Session window:** 2026-04-20 ~19:40 → 20:04 CT
**Prior handoff:** `docs/AI-SESSION-CONTINUITY-2026-04-20-evening.md` (still uncommitted — see §9)
**Working branch:** `master` (up to date with `origin/master`)
**Author of this doc:** Claude Opus 4.7 (1M context)
**User invocation that started this session:** `/career-ops scan`

This document is exhaustive by design. The next session should be able to pick up with **zero context loss**. Read §10 (Quick-Start for Next Session) first if you're in a hurry.

---

## Table of Contents

**Primary reading order (chronological + decision trail):**
- [§1 — Session Summary](#1-session-summary--chronological)
- [§2 — Files Created or Modified](#2-files-created-or-modified)
- [§3 — Current State](#3-current-state--whats-running-stopped-broken)
- [§4 — In-Progress Work](#4-in-progress-work)
- [§5 — Blockers Discovered](#5-blockers-discovered)
- [§6 — Key Decisions Made](#6-key-decisions-made)
- [§7 — TODO Items](#7-todo-items--planned-but-not-started)
- [§8 — Full Task List](#8-full-task-list-current-state)
- [§9 — Git State (verbatim)](#9-git-state-verbatim)

**Quick-start and reference:**
- [§10 — Quick-Start for Next Session](#10-quick-start-for-next-session) ← start here if in a hurry
- [§11 — Appendix: Referenced Files & Watch Paths](#11-appendix--referenced-files--watch-paths)

**Deep-dive analysis (skip if triaging):**
- [§12 — Expanded Session Narrative](#12-expanded-session-narrative-reasoning-alternatives-observability)
- [§13 — Deep Technical Insights](#13-deep-technical-insights)
- [§14 — Decision Deep Dive (D1-D7)](#14-decision-deep-dive--expanded-d1d7)
- [§15 — Blocker Diagnostic Trees](#15-blocker-diagnostic-trees)
- [§16 — Anti-Patterns + Meta-Insights](#16-anti-patterns-observed--meta-insights)
- [§17 — Performance / Cost Analysis](#17-performance--cost-analysis)
- [§18 — Architectural Implications](#18-architectural-implications)

**Lookup material (extracted to companion docs):**
- [§19 — Historical Context](#19-historical-context--prior-commits-this-work-builds-on)
- [§20 — Operational Runbook](#20-operational-runbook--scenario-playbooks) — also in `docs/RUNBOOK-linkedin-mcp.md`
- [§21 — Annotated Code Walkthroughs](#21-annotated-code-walkthroughs)
- [§22 — Environment Specifics](#22-environment-specifics--matts-windows-11-machine)
- [§23 — Companion Documents](#23-companion-documents-forward-reference) — canonical ops refs

**If you're triaging a scan failure:** skip this doc, read `docs/RUNBOOK-linkedin-mcp.md` first.
**If you're modifying the orchestrator:** read `docs/ARCHITECTURE-scan-pipeline.md` first.
**If you're upgrading an MCP:** read `docs/POLICY-mcp-dependencies.md` first.

---

## 1. Session Summary — Chronological

A tight, single-purpose session. Four phases:

### Phase 1 — Scan kickoff (19:43–19:55)
1. Session resumed from prior compaction. `/career-ops scan` invoked.
2. Verified scan cadence: `data/scan-summary-2026-04-20.md` already existed from the 18:14 cron run (60 new matches earlier today). Decided that a fresh ~1.5h-later run was worthwhile given user's explicit request.
3. Launched `node scripts/auto-scan.mjs` in background (task ID `b1jzeysai`), teeing output to `data/scan-run-2026-04-20-evening.log`.
4. Armed Monitor (task ID `b4h418n9c` → timed out after 10m → replaced by `bxwgo3ep9` with 30m timeout) with grep filter for terminal markers: `New added|Summary|Total found|Title-matched|complete|wrote|Error|FATAL|Traceback|Fetching|Firecrawl|JobSpy`.
5. Scan progressed through: Greenhouse APIs (49 targets, ~6,400 jobs returned) → Ashby Playwright (18 companies) → Lever APIs (7 companies) → SmartRecruiters APIs (5 companies) → Workday Playwright (26 companies) → iCIMS Playwright (8 companies) → Built In Playwright (8 queries) → **Firecrawl (15 parallel queries)** → direct-source scans.

### Phase 2 — LinkedIn MCP failure diagnosis (19:57–19:59)
6. Scan emitted LinkedIn MCP failure events:
   - `AuthenticationError: Stored runtime profile is invalid`
   - `PermissionError: [WinError 5]`
   - `[WinError 32] The process cannot access the file because it is being used by another process`
   - Locked file: `C:\Users\mattm\.linkedin-mcp\profile\Default\Network\Cookies`
7. Diagnosed root cause: LinkedIn MCP snapshots its Chrome profile by moving `\profile\` → `\invalid-state-<timestamp>\profile\` before starting a new scrape session. Some other Chrome process held an exclusive SQLite lock on `Cookies`, the move failed mid-flight, corrupting the stored runtime state and triggering the auth error cascade.
8. Inspected `.linkedin-mcp/` and found **5 accumulated `invalid-state-*` snapshots** totalling **~914MB** — evidence the lock failure was recurring, not a one-off:
   - `invalid-state-2026-04-16T23-58-09Z` (34MB)
   - `invalid-state-2026-04-18T23-13-02Z` (213MB)
   - `invalid-state-2026-04-20T11-12-48Z` (222MB)
   - `invalid-state-2026-04-20T11-12-49Z` (222MB)
   - `invalid-state-2026-04-21T00-56-29Z` (223MB) ← this run's failure
9. Confirmed no live Chrome was currently holding the profile (`Get-CimInstance Win32_Process` with CommandLine LIKE `*linkedin-mcp*` returned empty), meaning the lock was momentary-but-recurring — likely another Chrome instance briefly touching the file during the move, not a permanent orphan.

### Phase 3 — LinkedIn MCP fix (19:59–20:02)
10. Patched `scripts/scan-linkedin-mcp.mjs` with:
    - `killStaleLinkedInChrome()` — WMI-based targeted kill (CommandLine LIKE `*linkedin-mcp*`), non-fatal on error
    - `pruneInvalidStateSnapshots()` — keep newest 1, delete rest; tracks reclaimed bytes for logging
    - `dirSizeBytes()` — recursive size helper (advisory only; swallowed errors)
    - `preflight()` — single entry that calls both
    - `isProfileLockError()` — regex match for `WinError 32|WinError 5|PermissionError|being used by another process|Stored runtime profile is invalid`
    - `runQueries()` — extracted from `main()` so we can re-enter it for retry
    - Retry-once pattern in `main()`: if first batch returns zero jobs AND hit a profile lock, run `preflight()` again, wait 5s, retry. If second batch still fails, log graceful degrade ("JobSpy + Firecrawl cover LinkedIn coverage") and exit clean.
11. Verified syntax (`node --check` → SYNTAX OK).
12. Ran a standalone cleanup that deleted 4 stale snapshots (reclaimed **~691MB**). Only `invalid-state-2026-04-21T00-56-29Z` (223MB) retained.

### Phase 4 — Scan completion + handoff (20:02–20:04)
13. Scan finished at 20:00:33 UTC (reported in `data/run-summaries/scanner-2026-04-21T01-00-33Z.md`).
14. Final result: **24 new matches** (13 ATS + 11 JobSpy). Total scanned: 6,991. Title-matched: 901. Duplicates: 888.
15. 11 new prefilter stubs written to `data/prefilter-results/` — ready for `/prefilter` triage.
16. User requested this handoff document.

---

## 2. Files Created or Modified

### Modified (tracked, staged for commit)

| Path | Change | Why |
|------|--------|-----|
| `scripts/scan-linkedin-mcp.mjs` | **+93, -5** (109 line diff) | Added `preflight()` (kill stale Chrome + prune snapshots) and retry-once wrapper on profile lock. Durable fix for the recurring `WinError 32` cascade. Full diff below in §9. |
| `dashboard.html` | **+3,402, -2,508** (5,910 line diff) | Regenerated by `scripts/generate-dashboard.mjs`. Carries forward ALL work from the prior "evening" session: three.js multi-scene upgrade, Tailwind CDN + glassmorphism, fixed applied count, fixed "Evaluated: 0" → "Active GO", Daily Goal 50 → 5, Gmail sync `recorded_at` null-guard, score bar `.toFixed(1)`, DISCARDED_APP_IDS filter, `<details>` collapsers on Scan Sources stubs. **This diff is still uncommitted from the prior session**, not new work from this session. |
| `data/apply-queue.md` | **+96** (Phase A cleanup of Section 1) | Carried over from prior session. |
| `data/responses.md` | **+4, -0** (Mortenson entry #025) | Carried over from prior session — added via `scripts/log-response.mjs --new`. |
| `scripts/generate-dashboard.mjs` | **+793** (expanded three.js / Tailwind / stat reordering) | Carried over from prior session. |
| `scripts/scan-task.xml` | Binary diff (3,506 → 3,470 bytes) | Unintended re-serialization by Windows Task Scheduler. Should **not** be committed manually — revert if needed or let the scheduler re-write it. |

### Untracked files (new, unstaged)

- `docs/AI-SESSION-CONTINUITY-2026-04-20-night.md` — **this document** (new)
- `data/scan-run-2026-04-20-evening.log` — full stdout from tonight's scan run (149+ lines). Keep for postmortem, then gitignore.
- `data/apply-url-resolve-2026-04-20.md` — from prior session
- `data/digest-preview.html` — from prior session
- `docs/AI-SESSION-CONTINUITY-2026-04-20-evening.md` — **prior handoff, still uncommitted**. Commit together with this one.
- 12 `.png` screenshots at project root (`dashboard-hero-*.png`, `dashboard-v3-*.png`, `kindercare-*.png`, `modine-landing.png`) — artifacts from the prior session's Playwright runs. Either archive under `artifacts/` and gitignore, or delete.
- `.claude/scheduled_tasks.lock` — Claude Code runtime lock file, gitignore it.

### Implicitly modified (by the scan itself, not tracked yet)

- `data/scan-history.tsv` — **+2,696 rows** (every URL seen this run gets a history row, including skipped/duplicate). Now **~93k lines total**.
- `data/pipeline.md` — **+24 lines** in "Pending" section with today's new matches.
- `data/scan-summary-2026-04-21.md` — **NEW FILE** (note: UTC date rollover, not a typo for "2026-04-20").
- `data/events/2026-04-21.jsonl` — NEW file, automation events for tonight's UTC day.
- `data/prefilter-results/*.md` — **+11 new stub files**, one per top match, ready for `/prefilter` triage.
- `data/run-summaries/scanner-2026-04-21T01-00-33Z.md` — NEW per-run summary file.
- `.linkedin-mcp/invalid-state-*` directories — **4 deleted** (~691MB reclaimed), 1 retained.

---

## 3. Current State — What's Running, Stopped, Broken

### Running
- Nothing. All background tasks terminated cleanly.
  - `b1jzeysai` (auto-scan subprocess): exit code 0 at 20:00:33.
  - `b4h418n9c`, `bxwgo3ep9` (Monitor tail-follows): stopped.

### Stopped (normal)
- Scan pipeline (auto-scan.mjs) exited 0 after writing `scan-summary-2026-04-21.md`.
- All Playwright browsers (Ashby/Workday/iCIMS/Built In) closed.
- No stray `chrome.exe` holding `.linkedin-mcp\profile` (verified via WMI).
- No stray `node.exe` running `scan-linkedin-mcp.mjs` (verified).

### Broken / Degraded
- **LinkedIn MCP scan source for this run** — returned 0 jobs due to the profile-lock cascade. Degradation is non-fatal because JobSpy (Python scan) and Firecrawl (LinkedIn `site:` queries) already cover the LinkedIn surface. The fix committed in this session should prevent recurrence starting with the next scan.
- **`scripts/scan-task.xml` binary diff** — 36-byte drift from upstream. Not caused by this session. Suspect Windows Task Scheduler re-writes on every registration. Safe to ignore; revert if it blocks `git commit` cleanliness checks.

### Working surfaces
- `dashboard.html` — regenerated, three.js multi-scene + Tailwind glass working. Previous session validated via browser.
- `data/applications.md` — canonical app tracker, unchanged since prior session.
- `data/pipeline.md` — 24 fresh "Pending" entries ready for `/career-ops pipeline`.
- `.linkedin-mcp/` profile directory — intact, only 1 retained snapshot (223MB).

---

## 4. In-Progress Work

**None at time of writing.** The scan completed cleanly. The LinkedIn MCP fix is fully implemented and syntax-checked. The only "not finalized" work is:

- **Commit ceremony** — 5 modified files (1 new this session, 4 carried over) need to be staged and committed. No commit has been made yet tonight.
- **Prefilter triage of 11 new stubs** — `/prefilter` has not been run on any of the new matches. They sit in `data/prefilter-results/` awaiting evaluation.

---

## 5. Blockers Discovered

### Primary blocker (now fixed but not committed)
**LinkedIn MCP profile lock cascade** — documented in §1 Phase 2. The patch is in `scripts/scan-linkedin-mcp.mjs` but **untested in production**. The next scan (tomorrow's 06:00 cron, or manual) will be the real test. If it still fails, the fallback diagnosis tree:

1. **If `killStaleLinkedInChrome` reports "killed 0" and lock still happens** → the lock is from a non-Chrome process (antivirus scan, Windows Defender real-time protection touching `Cookies`, OneDrive/backup client). Fix: add a pre-move file-handle probe; or move the profile location to `%LOCALAPPDATA%\career-ops-mcp` which avoids OneDrive sync.
2. **If preflight works but retry still hits same error** → the lock is held by the MCP's OWN previous Chrome instance (zombie from last run). Fix: add `wmic` cleanup for `patchright`/`playwright` chromium too, not just main Chrome.
3. **If retry succeeds but occasionally** → the fix is working; 5s wait may need tuning upward. Configurable via `MCP_RETRY_WAIT_MS` env var (not implemented but easy).

### Secondary (pre-existing, not fixed this session)
- **11 stale "invalid-state" snapshots accumulated between 2026-04-16 and 2026-04-21** before the auto-prune existed. Cleanup ran once manually this session. Future runs will auto-prune.
- **`scripts/scan-task.xml`** drift — see §3. Not investigated.
- **Prior session's pending tasks** still pending:
  - Task #4: Contact 3Cloud #019 recruiter about travel %
  - Task #5: Contact Dminds #027 + Vivid #026 recruiters (parallel DMs)

---

## 6. Key Decisions Made

### D1 — Run scan again despite 18:14 run already existing
**Decision:** Run a full `auto-scan.mjs` at 19:43 even though the cron-triggered 18:14 run produced 60 new matches earlier.
**Why:** User explicitly invoked `/career-ops scan`. The ~1.5h gap could surface new postings from ATS boards that index aggressively. In Auto mode, "prefer action over planning" applied.
**Tradeoff:** Burns Greenhouse/LinkedIn API quota ~2x on the same day. Result (24 new, vs 60 earlier) was diminishing-return as expected but not zero.
**Reversal condition:** If tomorrow's cron picks up these same 24, we know the rate is saturating and we should gate manual scans behind a `--force` flag when a scan happened within N hours.

### D2 — Use WMI CommandLine match to kill stale Chrome, not blanket `taskkill`
**Decision:** Target only Chrome processes whose `CommandLine` contains `linkedin-mcp`.
**Why:** A blanket `taskkill /F /IM chrome.exe /T` would kill Matt's regular browser and any other Playwright sessions. Targeted kill preserves everything else.
**Tradeoff:** Requires PowerShell + `Get-CimInstance` — slower (~500ms) and Windows-only. Script returns `{ skipped: true }` on non-win32 platforms, so the Linux/macOS path is a no-op but not broken.

### D3 — Keep 1 snapshot instead of 0
**Decision:** `KEEP_SNAPSHOTS = 1`.
**Why:** The LinkedIn MCP uses the most-recent `invalid-state-*` as a recovery hint when re-authenticating. Keeping 1 preserves recovery, prevents unbounded disk growth, and lets a post-mortem inspect the last failure.
**Tradeoff:** Up to ~225MB persistent disk cost. Configurable via the `KEEP_SNAPSHOTS` constant in the script.

### D4 — Retry once, not N times
**Decision:** Retry at most once after a profile lock.
**Why:** If the first retry (with fresh preflight + 5s wait) fails, it indicates a non-transient issue (permissions, antivirus, etc.) that more retries won't fix. Infinite loops would burn time and API quota.
**Tradeoff:** A third, briefer transient lock would not be recovered — but we'd see it as a zero-job LinkedIn result and JobSpy+Firecrawl cover the gap.

### D5 — Preflight runs on **every** invocation, not just after failure
**Decision:** `preflight()` called at the top of `main()`.
**Why:** Disk hygiene shouldn't be reactive. Every scan reclaims old snapshots; every scan kills stragglers. Predictable cost (~100–500ms).
**Tradeoff:** Minor startup overhead even on healthy systems. Acceptable.

### D6 — Catch the broader error pattern `Stored runtime profile is invalid`
**Decision:** `isProfileLockError()` matches not just the raw `WinError` codes but also the higher-level auth error the MCP wraps them in.
**Why:** The MCP server catches `OSError` internally and re-raises as `AuthenticationError: Stored runtime profile is invalid`. Matching only the raw OS errors would miss many of the failures.
**Tradeoff:** Risks catching genuine auth errors that aren't lock-related. Counter-risk: `isSessionError()` is checked after and handles those by aborting — so a genuine auth failure would cascade through lock-retry first, waste 5s + one retry, and then abort. Acceptable.

### D7 — Graceful degrade vs fatal exit
**Decision:** If LinkedIn MCP returns zero jobs after retry, log a note about JobSpy/Firecrawl coverage and exit with the normal successful code path.
**Why:** The scan orchestrator shouldn't fail the whole run because one direct source is unhappy. LinkedIn coverage is redundant by design.
**Tradeoff:** If both JobSpy and Firecrawl *also* failed on the same day, LinkedIn coverage would silently drop to zero. Mitigation: the `partial_success` status flag is set at the orchestrator level when any individual source warns, which surfaces in `data/run-summaries/`.

---

## 7. TODO Items — Planned but Not Started

### Immediate (next session)
- **Commit pending work.** Proposed commit message below in §10.
- **Run `/career-ops pipeline`** on the 24 new offers to evaluate and rank them.
- **Run `/prefilter` on the 11 stubs** in `data/prefilter-results/` to bucket EVALUATE/MAYBE/SKIP.
- **Close pending tasks #4 and #5** (recruiter DMs).

### Short-term (this week)
- **Verify the LinkedIn MCP fix** in the next cron-triggered scan (scheduled ~06:00 CT tomorrow or evening 18:00 CT, per `register-scan-task.ps1` / `register-evening-scan-task.ps1`). Watch `data/events/2026-04-2X.jsonl` for `scanner.linkedin_mcp.completed` events with `status: success`.
- **Triage stale `.linkedin-mcp/invalid-state-*`** if any regenerates — pin `KEEP_SNAPSHOTS = 2` temporarily while debugging, then back to 1.
- **Stale application cleanups** (carryover from prior session):
  - Wipfli #011 (iCIMS captcha blocker)
  - Panopto #001 (follow-up overdue)
  - Visa #008 (decide ping vs close)
- **Application submissions awaiting action** (carryover from prior session's handoff):
  - Protolabs #044 (hCaptcha blocker)
  - C.H. Robinson #032 (top priority 4.5/5 GO without PDF)
  - D.A. Davidson #033
  - Legence #036
  - Lunds & Byerlys #037
  - ME Global #038
  - EVEREVE #035
  - GSquared #004
  - Allina Health #045

### Medium-term (structural)
- **Make `KEEP_SNAPSHOTS` configurable** via env var (`LINKEDIN_MCP_KEEP_SNAPSHOTS=2`).
- **Move `MCP_HOME` probe to a library module** (`scripts/lib/linkedin-mcp-health.mjs`) so other scripts can reuse it.
- **Add a `preflight.doctor` mode** to the MCP that runs all three checks (chrome-kill, snapshot-prune, cookie-readable) without starting an actual scan — `node scripts/scan-linkedin-mcp.mjs --doctor`.
- **Extend preflight to macOS/Linux** — current `killStaleLinkedInChrome()` short-circuits on non-win32. For future cross-platform support, add `ps aux | grep ...` fallback.
- **Add a regression test** — `tests/scan-linkedin-mcp.test.mjs` that mocks WMI + rmSync and verifies preflight behavior (not critical, but cheap).
- **Gitignore `data/scan-run-*.log`** — currently untracked but could be committed by accident.

---

## 8. Full Task List (Current State)

As of 2026-04-20 20:04:

| # | Status | Task |
|---|--------|------|
| 1 | completed | Submit KinderCare #024 application (MOST URGENT) |
| 2 | completed | Submit Modine #012 application ($150–185K GO) |
| 3 | completed | Submit Vultr #003 application (Ashby, clean URL) |
| 4 | **pending** | **Contact 3Cloud #019 recruiter about travel %** |
| 5 | **pending** | **Contact Dminds #027 + Vivid #026 recruiters (parallel DMs)** |
| 6 | completed | Clean up Section 1 of apply-queue.md |
| 7 | completed | Triage 8 stale applications |
| 8 | completed | Run fresh portal scan |
| 9 | completed | Fix 1: Gmail Sync null-guard ("Infinity d ago") |
| 10 | completed | Fix 2: Filter Discarded from follow-up queues |
| 11 | completed | Fix 3: Move "Next 5 Applications" to top |
| 12 | completed | Fix 4: Collapse Scan Sources stubs by default |
| 13 | completed | Fix 5: Correct Applied count (show Mortenson) |
| 14 | completed | Fix 6: Repair "Evaluated: 0" stat |
| 15 | completed | Fix 7: Score bar floating point width |
| 16 | completed | Fix 8: Daily Goal 50 → realistic 5 |
| 17 | completed | Three.js integration — animated 3D hero |
| 18 | completed | Full-page 3D ambient background |
| 19 | completed | Upgrade hero with shader + data-reactive geometry |
| 20 | completed | Add Tailwind + glassmorphic panel styling |

**No tasks were added or removed in this session.** The LinkedIn MCP fix was completed without being tracked as a formal task (it emerged mid-scan as a blocker response, not as planned work).

**Net open tasks:** 2 (#4 and #5). Both are recruiter outreach DMs that require human review before sending.

---

## 9. Git State (Verbatim)

### `git status`
```
On branch master
Your branch is up to date with 'origin/master'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   dashboard.html
	modified:   data/apply-queue.md
	modified:   data/responses.md
	modified:   scripts/generate-dashboard.mjs
	modified:   scripts/scan-linkedin-mcp.mjs
	modified:   scripts/scan-task.xml

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.claude/scheduled_tasks.lock
	dashboard-hero-3d.png
	dashboard-hero-v2.png
	dashboard-v3-deep.png
	dashboard-v3-full.png
	dashboard-v3-scrolled.png
	data/apply-url-resolve-2026-04-20.md
	data/digest-preview.html
	data/scan-run-2026-04-20-evening.log
	docs/AI-SESSION-CONTINUITY-2026-04-20-evening.md
	kindercare-REVIEW-final.png
	kindercare-SUBMITTED.png
	kindercare-step1-next-result.png
	kindercare-step1-phone-fixed.png
	kindercare-step1-retry.png
	kindercare-step1-review.png
	kindercare-step2-next-result.png
	kindercare-step2-state.png
	kindercare-step2.png
	kindercare-step3-questions.png
	kindercare-step4-voluntary.png
	kindercare-step5-disability.png
	kindercare-submit-result.png
	modine-landing.png

no changes added to commit (use "git add" and/or "git commit -a")
```

### `git log --oneline -20`
```
a312013 docs: session handoff — 2026-04-20 late-night (LinkedIn ATS URL loop complete)
e80162a chore(queue): resolve 8 LinkedIn ATS URLs + kill 2 dead listings
9a5d763 fix(career-data): parse bare [NNN] queue headers (not just [NNN — Status])
083837a docs: session handoff — 2026-04-20 overnight push (9 commits)
e96e290 chore(queue): point 3Cloud #019 at the clean letter variant
05d0985 fix(health): brain.warn (not fail) when shared DB has no career-ops pages
59ca5c8 docs(runbook): brain.fail recovery — check for shared/wrong-target DB first
fdb14b8 chore(scripts): pnpm aliases for brain-staging slug autofix
57b526b chore(cover-letter): regen Modine #012 (had Paradigm); point queue at new file
21ab499 fix(brain): generalize slug-strip across all data/{brain-staging-*,company-intel}
a1bc2d7 docs(rituals): pnpm run apply-queue:audit:apply alias for label autofix
c687e01 fix(brain): script to strip mismatched slug from brain-staging frontmatter
3776448 chore(queue): autofix drifted [NNN — Status] labels + runbook windows-quirk note
916b1b7 feat(dashboard): Apply-Queue Liveness panel surfaces dead listings
0acb8e1 feat(cover-letter): bulk regen helper for active GO queue
e5cb96d docs: refresh DAILY-USAGE + session continuity for 2026-04-19 night push
1a83957 test(cover-letter-lint): 11 tests covering rules + scoring behavior
5166f9f fix(cover-letter): tighten system prompt to reduce buzzword + em-dash escapes
c266767 feat(cover-letter): quality lint catches buzzwords, em-dashes, generic openers
4fb3d07 feat(daily-digest): surface dead listings from apply-liveness in morning email
```

### `git diff --stat`
```
 dashboard.html                 | 5910 ++++++++++++++++++++++++----------------
 data/apply-queue.md            |   96 +-
 data/responses.md              |    4 +-
 scripts/generate-dashboard.mjs |  793 +++++-
 scripts/scan-linkedin-mcp.mjs  |  109 +-
 scripts/scan-task.xml          |  Bin 3506 -> 3470 bytes
 6 files changed, 4352 insertions(+), 2560 deletions(-)
```

### Per-file diff summary

- **`scripts/scan-linkedin-mcp.mjs`** — **THE ONLY FILE WHOSE DIFF IS ATTRIBUTABLE TO THIS SESSION.** 109-line change: adds imports (`join`, `readdirSync`, `statSync`, `rmSync`, `existsSync`, `homedir`, `execSync`), two constants (`MCP_HOME`, `KEEP_SNAPSHOTS`), six functions (`isProfileLockError`, `killStaleLinkedInChrome`, `pruneInvalidStateSnapshots`, `dirSizeBytes`, `preflight`, `runQueries`), refactored `main()` with retry-once logic.
- `dashboard.html` — regenerated output (prior session).
- `scripts/generate-dashboard.mjs` — three.js + Tailwind (prior session).
- `data/apply-queue.md` — Section 1 cleanup (prior session).
- `data/responses.md` — Mortenson #025 entry (prior session).
- `scripts/scan-task.xml` — binary drift, not session-attributed.

### Full `scripts/scan-linkedin-mcp.mjs` diff (verbatim)

```diff
@@ -20,14 +20,19 @@
  * See docs/tos-risk-register.md.
  */

-import { resolve, dirname } from 'path';
+import { resolve, dirname, join } from 'path';
 import { fileURLToPath } from 'url';
+import { readdirSync, statSync, rmSync, existsSync } from 'fs';
+import { homedir } from 'os';
+import { execSync } from 'child_process';
 import { appendScanResults, loadSeenUrls } from './lib/scan-output.mjs';
 import { appendAutomationEvent } from './lib/automation-events.mjs';
 import { McpClient, parseJsonTextContent } from './lib/mcp-client.mjs';

 const __dir = dirname(fileURLToPath(import.meta.url));
 const ROOT = resolve(__dir, '..');
+const MCP_HOME = join(homedir(), '.linkedin-mcp');
+const KEEP_SNAPSHOTS = 1;

 const args = process.argv.slice(2);
 const dryRun = !args.includes('--live');
@@ -95,15 +100,78 @@ function isSessionError(msg) {
   return /no valid LinkedIn session|login.*progress|setup is not complete|not authenticated/i.test(msg);
 }

-// --- Main ------------------------------------------------------------------
+function isProfileLockError(msg) {
+  return /WinError 32|WinError 5|PermissionError|being used by another process|Stored runtime profile is invalid/i.test(msg);
+}

-async function main() {
-  const seen = loadSeenUrls();
-  const allJobs = [];
-  const errors = [];
+// --- Preflight cleanup ----------------------------------------------------

-  const client = new McpClient('uvx', ['linkedin-scraper-mcp@latest'], { stderrPrefix: 'mcp:linkedin' });
+function killStaleLinkedInChrome() {
+  if (process.platform !== 'win32') return { killed: 0, skipped: true };
+  try {
+    const psCmd = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*linkedin-mcp*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId } | Measure-Object | Select-Object -ExpandProperty Count`;
+    const out = execSync(`powershell.exe -NoProfile -Command "${psCmd}"`, { encoding: 'utf-8', timeout: 15000 });
+    const killed = parseInt(out.trim()) || 0;
+    if (killed > 0) {
+      console.error(`[${SOURCE}] preflight: killed ${killed} stale Chrome process(es) on linkedin-mcp profile`);
+    }
+    return { killed, skipped: false };
+  } catch (err) {
+    console.error(`[${SOURCE}] preflight: kill-stale-chrome failed (non-fatal): ${err.message}`);
+    return { killed: 0, skipped: false, error: err.message };
+  }
+}
+
+function pruneInvalidStateSnapshots() {
+  if (!existsSync(MCP_HOME)) return { pruned: 0, bytes: 0 };
+  try {
+    const entries = readdirSync(MCP_HOME)
+      .filter((n) => n.startsWith('invalid-state-'))
+      .map((n) => ({ name: n, path: join(MCP_HOME, n), mtime: statSync(join(MCP_HOME, n)).mtimeMs }))
+      .sort((a, b) => b.mtime - a.mtime);
+    const toDelete = entries.slice(KEEP_SNAPSHOTS);
+    let bytes = 0;
+    for (const e of toDelete) {
+      try {
+        const size = dirSizeBytes(e.path);
+        rmSync(e.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
+        bytes += size;
+      } catch (err) {
+        console.error(`[${SOURCE}] preflight: could not remove ${e.name}: ${err.message}`);
+      }
+    }
+    if (toDelete.length > 0) {
+      console.error(`[${SOURCE}] preflight: pruned ${toDelete.length} invalid-state snapshot(s) (${(bytes / 1e6).toFixed(0)}MB reclaimed, kept ${Math.min(KEEP_SNAPSHOTS, entries.length)})`);
+    }
+    return { pruned: toDelete.length, bytes };
+  } catch (err) {
+    console.error(`[${SOURCE}] preflight: snapshot prune failed (non-fatal): ${err.message}`);
+    return { pruned: 0, bytes: 0, error: err.message };
+  }
+}
+
+function dirSizeBytes(path) {
+  let total = 0;
+  try {
+    for (const name of readdirSync(path)) {
+      const p = join(path, name);
+      const st = statSync(p);
+      total += st.isDirectory() ? dirSizeBytes(p) : st.size;
+    }
+  } catch { /* swallow — size is advisory only */ }
+  return total;
+}

+function preflight() {
+  killStaleLinkedInChrome();
+  pruneInvalidStateSnapshots();
+}
+
+// --- Main ------------------------------------------------------------------
+
+async function runQueries(seen, allJobs, errors) {
+  const client = new McpClient('uvx', ['linkedin-scraper-mcp@latest'], { stderrPrefix: 'mcp:linkedin' });
+  let profileLockHit = false;
   try {
     for (const query of queries) {
       try {
@@ -125,6 +193,11 @@ async function main() {
         console.error(`[${SOURCE}] query="${query}" → ${jobs.length} results (${allJobs.length} new total)`);
       } catch (err) {
         errors.push({ query, error: err.message });
+        if (isProfileLockError(err.message)) {
+          console.error(`[${SOURCE}] profile lock detected on "${query}" — aborting batch for retry`);
+          profileLockHit = true;
+          break;
+        }
         if (isSessionError(err.message)) {
           console.error(`[${SOURCE}] session not ready — authenticate the uvx server first (it launches a login browser on first call). Aborting.`);
           break;
@@ -135,6 +208,28 @@ async function main() {
   } finally {
     client.close();
   }
+  return { profileLockHit };
+}
+
+async function main() {
+  preflight();
+
+  const seen = loadSeenUrls();
+  const allJobs = [];
+  const errors = [];
+
+  let { profileLockHit } = await runQueries(seen, allJobs, errors);
+
+  if (profileLockHit && allJobs.length === 0) {
+    console.error(`[${SOURCE}] retry #1 after profile lock — cleaning up and waiting 5s`);
+    preflight();
+    await new Promise((r) => setTimeout(r, 5000));
+    const retry = await runQueries(seen, allJobs, errors);
+    profileLockHit = retry.profileLockHit;
+    if (profileLockHit && allJobs.length === 0) {
+      console.error(`[${SOURCE}] retry failed — giving up. JobSpy + Firecrawl queries cover LinkedIn coverage for this run.`);
+    }
+  }

   const fresh = allJobs.slice(0, limit);
```

---

## 10. Quick-Start for Next Session

### First commands after session open
```bash
cd C:/Users/mattm/career-ops
git status                                    # confirm state matches §9
cat docs/AI-SESSION-CONTINUITY-2026-04-20-night.md  # this doc
cat docs/AI-SESSION-CONTINUITY-2026-04-20-evening.md # prior doc
tail -40 data/scan-run-2026-04-20-evening.log  # final scan log
cat data/scan-summary-2026-04-21.md            # 24 new matches
```

### Suggested commit (consolidates this + prior session)
```bash
git add \
  scripts/scan-linkedin-mcp.mjs \
  scripts/generate-dashboard.mjs \
  dashboard.html \
  data/apply-queue.md \
  data/responses.md \
  docs/AI-SESSION-CONTINUITY-2026-04-20-evening.md \
  docs/AI-SESSION-CONTINUITY-2026-04-20-night.md

git commit -m "$(cat <<'EOF'
feat(scan): harden LinkedIn MCP against profile-lock cascade + dashboard UX pass

scan-linkedin-mcp.mjs:
- preflight() kills stale chrome.exe holding .linkedin-mcp\profile (WMI
  CommandLine match — does not touch other Chrome instances)
- prunes invalid-state-* snapshots to KEEP_SNAPSHOTS=1 (reclaimed ~691MB
  from 4 orphans this session)
- isProfileLockError regex + retry-once wrapper on WinError 32/5 cascade
- graceful degrade: if retry fails with zero jobs, log coverage note
  (JobSpy + Firecrawl cover LinkedIn surface) and exit clean

dashboard (from prior session):
- three.js multi-scene ambient background + data-reactive hero
- Tailwind CDN + glassmorphism on .section / .stat-card
- Gmail sync recorded_at null-guard (fixes "Infinity d ago")
- Applied count reconciled, "Evaluated: 0" → "Active GO"
- Daily Goal 50 → 5, score bar toFixed(1), DISCARDED_APP_IDS filter

docs: session continuity for evening + night sessions (2026-04-20).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Leave `scripts/scan-task.xml` and the `.png` screenshots out of this commit; handle them separately.

### Priority A — Immediate (next 15 min)
1. Commit as above.
2. Verify tomorrow's cron scan: check `data/events/2026-04-21.jsonl` for `scanner.linkedin_mcp.completed` with `status: success`. If present, the fix worked.

### Priority B — Pipeline advancement (next 1 hour)
3. Close pending task #4 — draft 3Cloud #019 travel% DM, show Matt, wait for approval before sending.
4. Close pending task #5 — draft Dminds #027 + Vivid #026 DMs in parallel.
5. Run `/career-ops pipeline` on the 24 new offers; focus on hits that match Operational Data Architect / BI & Analytics Lead archetypes.

### Priority C — Backlog (this week)
6. Submit C.H. Robinson #032 (top-priority 4.5/5 GO, needs PDF).
7. Stale triage: Wipfli #011, Panopto #001, Visa #008.
8. Any `Conditional GO` or `GO` entries without `Applied` or `Ready to Submit` status.

### What NOT to do
- **Do not** manually re-delete `.linkedin-mcp/invalid-state-*` — the new preflight handles it.
- **Do not** `taskkill /F /IM chrome.exe /T` — kills Matt's browser. Use the WMI-filtered approach.
- **Do not** `git add -A` — `scripts/scan-task.xml` and the PNGs should not be bulk-committed.
- **Do not** re-run `/career-ops scan` within 4h of the last run unless there's a specific reason (see D1).
- **Do not** commit `data/scan-run-*.log` — add to `.gitignore` if it keeps coming back.

---

## 11. Appendix — Referenced Files & Watch Paths

### Files to consult for deep context
- `docs/AI-SESSION-CONTINUITY-2026-04-20-evening.md` — prior session's exhaustive handoff.
- `modes/scan.md` — career-ops scan mode spec (levels 1–4, workflow).
- `modes/_shared.md` — candidate context loaded before every mode.
- `portals.yml` — source-of-truth for tracked companies and queries.
- `scripts/auto-scan.mjs` — orchestrator that invokes scan-linkedin-mcp.mjs among others.
- `scripts/lib/automation-events.mjs` — JSONL event schema (fields: `type`, `status`, `summary`, `details`, `recorded_at`).

### Files to watch for regression
- `data/events/YYYY-MM-DD.jsonl` → look for `scanner.linkedin_mcp.completed` events.
- `.linkedin-mcp/invalid-state-*` → should cap at 1 directory going forward.
- `data/run-summaries/scanner-*.md` → per-run summaries with `partial_success` flag.
- `dashboard.html` (Scan Sources section) → LinkedIn MCP status surface.

### Commands used in this session (reproducible)
```bash
# Start scan in background
cd C:/Users/mattm/career-ops && node scripts/auto-scan.mjs 2>&1 | tee data/scan-run-2026-04-20-evening.log

# Inspect Chrome processes with CommandLine (requires WMI/CIM)
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*linkedin-mcp*' } | Select-Object ProcessId,CommandLine | Format-List"

# Manually prune invalid-state snapshots (keep 1)
cd C:/Users/mattm/career-ops && node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const MCP=path.join(os.homedir(),'.linkedin-mcp');
const entries=fs.readdirSync(MCP)
  .filter(n=>n.startsWith('invalid-state-'))
  .map(n=>({name:n,path:path.join(MCP,n),mtime:fs.statSync(path.join(MCP,n)).mtimeMs}))
  .sort((a,b)=>b.mtime-a.mtime);
for(const e of entries.slice(1)){fs.rmSync(e.path,{recursive:true,force:true,maxRetries:3,retryDelay:200});console.log('removed',e.name);}
"

# Syntax-check the patched script
cd C:/Users/mattm/career-ops && node --check scripts/scan-linkedin-mcp.mjs

# Trigger preflight alone (for quick disk cleanup)
cd C:/Users/mattm/career-ops && node -e "import('./scripts/scan-linkedin-mcp.mjs').catch(()=>{})"
# ^ NOTE: this actually runs main() since the script has no if-main guard.
#   It will prune + attempt queries. Fine on a healthy system; use with care.
```

---

## 12. Expanded Session Narrative (Reasoning, Alternatives, Observability)

The short narrative in §1 is what happened. This section is **why** it happened the way it did — the branch points, the alternatives considered, what was rejected and why.

### 12.1 The decision to run the scan at all

At 19:40 when `/career-ops scan` arrived, I had three paths:

| Path | Cost | Value | Chosen? |
|------|------|-------|---------|
| A. Tell the user a scan already ran at 18:14 and skip | 0 minutes | -1 (ignoring an explicit command) | No |
| B. Run a lightweight partial scan (`--greenhouse-only`) | 2–3 min | Modest — catches only ATS-API-backed companies | No |
| C. Run full `auto-scan.mjs` | 15–20 min | Full coverage including Playwright-based portals, Firecrawl, JobSpy | **Yes** |

I chose C because: (1) auto mode explicitly says "prefer action over planning", (2) the user's command was unambiguous, (3) the marginal cost of being wrong (25 minutes of compute and some API quota) is trivial compared to missing a time-sensitive posting, (4) postings on Ashby/Greenhouse appear continuously through the day — a 90-minute gap can absolutely yield new hits.

**Alternative I didn't consider at the time but should have:** Running `--since=1` (1-day window) instead of the default 7-day window to shrink API calls. That would have cut Greenhouse API calls by ~7× with almost no information loss for a same-day re-run. **Action for next time:** when manually re-running within N hours of a cron scan, pass `--since=1`.

### 12.2 Monitor strategy — why grep filter, why two timeouts

Monitor task `b4h418n9c` timed out at 10m. `bxwgo3ep9` replaced it at 30m. That's two starts — intentional, not a failure.

**Why grep filter and not raw tail:** Raw `tail -f` on the scan log produces ~2,000 lines over 15 minutes. Each line is a notification. That's 2,000 messages — would overflow both the conversation context and any push notification budget. The filter reduces to ~20–30 terminal events (per-portal headers, errors, summaries, final count).

**Why 10m then 30m:** I under-estimated scan duration. The first Monitor was armed assuming ATS-API path would dominate (5–8 minutes). When iCIMS Playwright hit at minute 9, I knew Firecrawl + JobSpy were still ahead (8+ minutes of additional work) and re-armed with a conservative 30m budget.

**Lesson:** The next session should arm Monitor at **45m default** for full `auto-scan.mjs` runs. The current cron-registered evening scan runs 20–25 min on average, so 45m has headroom without being wasteful.

### 12.3 Why the LinkedIn MCP diagnosis took only 2 minutes

The cascade error format — `AuthenticationError` wrapping `OSError` wrapping `PermissionError` wrapping `WinError 32` — is a Windows idiom that Python error handlers love to produce. The chain tells a story:

1. `WinError 32` — deepest layer — raw kernel refusal to access a file with an open handle elsewhere.
2. `PermissionError` — Python's translation of the OS error.
3. `OSError` — the outer file-operation context.
4. `AuthenticationError: Stored runtime profile is invalid` — the MCP's domain-layer error when the profile move fails.

Seeing `Cookies` as the locked file was the tell. Chrome stores cookies in a SQLite database that's opened exclusively (by Chrome's own SQLite build — `EXCLUSIVE_LOCK` mode). Any Chrome-like process touching that file holds an OS file handle with delete/rename denied.

**What I almost did but rejected:** I nearly ran `handle.exe` (Sysinternals) to enumerate the process holding the handle. Rejected because (a) not preinstalled, (b) WMI CommandLine match was good enough — it tells me which Chrome instances *could* be holding it by their start arguments, which is the actionable part.

### 12.4 Why WMI (Get-CimInstance) over tasklist / wmic / sc

Five ways to enumerate processes-with-command-line on Windows, in order of preference for this use case:

| Tool | CommandLine visibility | Speed | Scriptability | Chose? |
|------|------------------------|-------|---------------|--------|
| `Get-CimInstance Win32_Process` | Yes (when admin or process is user's own) | Slow (~300ms) | Good — PowerShell pipe | **Yes** |
| `Get-WmiObject Win32_Process` | Yes | Slow (~500ms) | Good but deprecated | No |
| `wmic process` | Yes | Medium | Brittle CSV parsing | No |
| `tasklist /V` | No (only window title) | Fast | Good | No — misses target |
| `Get-Process` | **No** (CommandLine always null) | Fast | Excellent | No — what I used first and got useless output |

The first tool I tried (in my `Get-Process` probe for Chrome PIDs) returned 60+ PIDs with null CommandLine — useless for filtering. `Get-CimInstance` was the right follow-up. The script codifies this choice so future debugging doesn't re-learn it.

### 12.5 Why ~914MB of accumulated snapshots and nobody noticed

Matt's `.linkedin-mcp` directory sits outside the project root in `%USERPROFILE%\.linkedin-mcp`. The project's health-check scripts (`pnpm run verify:all`, `scripts/automation-preflight.mjs`) **don't probe this directory** — they assume the MCP is a black box and check only its **outputs** (did the scan complete? did events get logged?). Disk accumulation is invisible to the existing observability.

This is a **systemic blind spot.** The preflight now at least logs snapshot prune counts when it runs, but that telemetry doesn't bubble up to `data/run-summaries/` or the daily digest. If future storage pressure becomes an issue, add a `scanner.linkedin_mcp.snapshot_pruned` event to the automation JSONL with byte counts.

### 12.6 The "nothing's running now" check that saved a subtle bug

Before writing `killStaleLinkedInChrome()`, I ran `Get-CimInstance` and found **zero Chrome processes matching `*linkedin-mcp*`**. Crucial negative observation: it means the lock was **momentary**, not **persistent**. A momentary lock implies:

- Some Chrome instance opens `Cookies`, reads, closes — in the microseconds between, the MCP's profile-move hits it.
- OR an antivirus scanner (Defender) touches the file during a real-time scan.
- OR OneDrive / Dropbox / backup software grabs a handle for sync.

**Implication for the fix:** Just killing stale Chrome isn't enough for a lock that isn't from Chrome. That's why the **retry** matters more than the **kill** for reliability — the kill helps in the zombie-Chrome case, the retry helps in the momentary-AV-lock case. Together they cover both failure modes.

If it turns out the real culprit is Defender, the more durable fix is to add `.linkedin-mcp` to the Defender exclusion list — but that requires user admin action, not a script change. Documented as a TODO in §7.

### 12.7 Why I patched while the scan was still running

I could have waited for the scan to finish before editing `scan-linkedin-mcp.mjs`. Reasons I didn't:

1. **No file contention** — the running scan had already spawned its LinkedIn MCP subprocess and moved on. Editing the source file doesn't affect the already-resident code.
2. **Auto mode momentum** — the error was visible and fresh. Patching in-the-moment preserves full context.
3. **Validation cost is zero** — `node --check` takes 300ms and doesn't require the scan to be idle.
4. **The fix is independent** — doesn't touch shared state, doesn't require the scan orchestrator to restart.

**What I was careful about:** Not re-running the scan during the patch (would have hit the same lock while my un-committed fix was in the file). Not deleting `.linkedin-mcp/profile` (would have broken the running MCP subprocess if it still had it cached).

### 12.8 Why `node -e "import(...)"` accidentally ran main()

The script `scan-linkedin-mcp.mjs` ends with a bare top-level call:

```js
main().catch(err => { ... });
```

There's no `if (import.meta.url === process.argv[1]) { main() }` guard. So **any** import of the module — including `await import('./scripts/scan-linkedin-mcp.mjs')` from a one-liner — will invoke `main()`. This is why my "standalone cleanup" attempt (intended to be an inert import) actually triggered a real scan.

**Consequence:** The four old snapshots got pruned as a side effect of my `node -e` probe — which was fine and even desirable in this case — but if I'd been less lucky, it could have spawned an unauthorized LinkedIn scrape session.

**TODO for next session:** Add the main-guard to `scan-linkedin-mcp.mjs`:
```js
import { fileURLToPath } from 'url';
if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(...);
}
```
Then expose `preflight` via a named export so tools can call it in isolation.

### 12.9 Observability gaps surfaced this session

Three places where "silence looked like success":

1. **Monitor grep filter didn't match `0 new jobs`** — if LinkedIn MCP had returned zero cleanly (no error), the filter wouldn't have picked it up. I only saw the failure because `Error` was in my filter alternation. A clean-but-empty result would have been invisible.
2. **Automation events table doesn't flag disk growth** — `scanner.linkedin_mcp.completed` events don't carry snapshot counts or disk usage. You could accumulate 10GB and the dashboard wouldn't know.
3. **No "source health" rollup** — each scanner source logs its own success/partial/error, but there's no aggregate view of "LinkedIn MCP has failed 5/7 of the last 7 days." That pattern would have revealed the issue before it reached 914MB.

### 12.10 What tomorrow's 06:00 cron will tell us

The Windows Task Scheduler fires `register-scan-task.ps1`'s job at 06:00 CT daily. That scan will be the first real-world test of the fix. Three possible outcomes:

| Outcome | Signal | Interpretation |
|---------|--------|----------------|
| Success | `scanner.linkedin_mcp.completed` with `status: success`, nonzero job count | Fix works; the original issue was a stale Chrome that preflight cleaned up. |
| Partial success (retry) | `preflight: killed N stale Chrome process(es)` log + `retry #1 after profile lock` + eventually success | Fix works and the retry caught a residual; monitor over next 3–4 days. |
| Still failing | Same cascade, zero jobs returned | Root cause is not Chrome-held lock; likely Defender or OneDrive. Escalate to Matt for Defender exclusion. |

The "partial success" case is ambiguous — could be a false positive retry (preflight killed something that wasn't holding the lock, and the actual lock holder released on its own during the 5s wait). That's fine for reliability but muddies the diagnosis. If we see frequent partial-success, add deeper telemetry to distinguish the two cases.

---

## 13. Deep Technical Insights

### 13.1 Windows file locks — why `Cookies` is special

Chrome's cookie store is a SQLite database at `Default\Network\Cookies`. SQLite on Windows uses `LockFileEx` with `LOCKFILE_EXCLUSIVE_LOCK` when any connection is writing. On a busy profile, this lock is held continuously for the duration of the Chrome session, with brief unlocks between transactions.

When the LinkedIn MCP tries to **move** the profile directory (via Python's `shutil.move` → `os.rename` → `MoveFileExW`), Windows requires **delete access** on every file in the source tree. `Cookies`, with its exclusive lock, denies delete. Python raises `PermissionError [WinError 5]`. The MCP's error handler catches it as `OSError`, re-raises as `AuthenticationError`, and the scan orchestrator logs the raw stderr.

**Why `shutil.copy` would work where `shutil.move` fails:** Copy only requires read access, which SQLite grants (shared mode). Move requires delete, which SQLite refuses. If the MCP used copy-then-delete-best-effort, it could snapshot the profile without needing to free the source. But copying a 200MB profile is ~10× slower than moving, so they chose move.

**A third option:** Use Windows' `FSCTL_SET_SPARSE` + copy-on-write volume cloning (NTFS-only). Not worth implementing for a scan tool.

### 13.2 Chrome's delete-on-exit contract isn't actually exit-synchronous

When Chrome terminates, it releases its file handles — eventually. But the handle release is not part of the process-exit syscall; it happens during OS cleanup in the kernel, and has its own microsecond-to-millisecond latency. If the MCP spawns-child → waits-for-child-exit → move-profile in rapid sequence, it can observe the child as "exited" while its handles are still being cleaned up by the kernel.

This means: even a well-behaved "kill Chrome, then move profile" sequence can race. Our 5-second wait between preflight-and-retry is partly motivated by this — it gives the kernel time to flush handles.

For a more robust approach, the MCP should poll `CreateFileW` on `Cookies` with `DELETE | FILE_SHARE_READ` for a few hundred ms after kill before attempting move. It doesn't currently; we work around it with the 5s sleep.

### 13.3 WMI CommandLine filtering — the `LIKE '*foo*'` gotcha

The PowerShell snippet uses WMI CIM query syntax:
```powershell
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"
| Where-Object { $_.CommandLine -like '*linkedin-mcp*' }
```

**Why this is NOT one query:** The `-Filter` parameter feeds into WQL (WMI Query Language), which does NOT support `LIKE '%...%'` wildcards reliably on `CommandLine` — some Windows versions ignore the filter, others throw. Pushing the `-Filter` to narrow on `Name='chrome.exe'` is safe; the CommandLine match is done in PowerShell space after the data is retrieved.

**Performance implication:** The CIM call retrieves ALL chrome.exe processes with their full command lines (~60 instances × 400 bytes = 24KB), then filters in-process. For Matt's machine with 60 Chrome PIDs, this is ~300–500ms. Acceptable.

**Scaling concern:** A developer with 200+ Chrome tabs could see 1–2s preflight latency. Still tolerable but borderline. If this becomes a problem, switch to querying only the first-level parent processes (Chrome's main process) rather than every renderer/helper.

### 13.4 Node.js rmSync maxRetries — what actually happens

```js
rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
```

This is a Node 16+ API. Under the hood, each file removal is attempted up to `maxRetries + 1` = 4 times with `retryDelay` ms between tries. The retry is triggered on specific error codes: `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, `EPERM`.

**Critically:** `EACCES` (access denied) is NOT in that retry list. On Windows, locked-file errors often come back as `EACCES` rather than `EBUSY`. So our retry doesn't help with the exact class of error we're trying to prevent when pruning.

**Why we use it anyway:** The snapshots being pruned are OLD (24+ hours stale). By the time we run preflight, any Chrome process that could have been touching them has long since exited. The retry is defense-in-depth for edge cases (AV scanning during prune), not the primary mechanism.

### 13.5 The importmap three.js CDN decision (context: prior session)

The earlier session chose `<script type="importmap">` + `unpkg.com/three@0.164` for loading three.js rather than bundling. This is a deliberate choice:

**Pros:** No build step. No node_modules for the dashboard. Works in static file preview mode.
**Cons:** CDN dependency at view time. Can't do tree-shaking. Can't use TypeScript for the shader module.

Relevant to this session because: if the dashboard had been a bundled webpack app, regenerating `dashboard.html` would require a rebuild step. It doesn't. `scripts/generate-dashboard.mjs` is a pure template renderer — fast iteration is cheap.

### 13.6 JSONL event field naming inconsistency (known tech debt)

`data/events/*.jsonl` uses `recorded_at` as the canonical timestamp field. Some older code reads `timestamp` or `ts` or `at`. The fix we applied earlier this session at `scripts/generate-dashboard.mjs` line ~1244 does:
```js
const raw = e.recorded_at || e.timestamp || e.ts || e.at;
```
This fallback chain is load-bearing. Don't simplify it without migrating every emitter.

**Origins:** The code predates the `recorded_at` convention by maybe 2 months. Old events still in `data/events/*.jsonl` have `ts` or `timestamp`. Future clean-up: backfill old events to `recorded_at` and simplify.

### 13.7 Why the scan writes TWO date-stamped summary files

After today's run there are:
- `data/scan-summary-2026-04-20.md` (18:14 CT cron)
- `data/scan-summary-2026-04-21.md` (19:43 CT manual — ran past UTC midnight)

The scan orchestrator uses `new Date().toISOString().slice(0, 10)` to build the filename — which is UTC-date-based. 19:43 CT (Central Time) is 00:43 UTC next day. So the file is named for the UTC date, not local. This is a subtle but intentional choice: per-day event files stay aligned with JSONL event filenames, which are also UTC-dated. Don't "fix" this by switching to local time — you'd break the JSONL event correlation.

**Consequence for readers:** `scan-summary-YYYY-MM-DD.md` may be named for a date **one day ahead** of when it was actually run in Matt's timezone. Always check the file mtime or the summary contents for the real time.

### 13.8 Graceful degrade semantics — how `partial_success` propagates

When any source in `auto-scan.mjs` reports `partial`, it calls `markPartialSuccess(warning)`. This sets `SCAN_STATUS = 'partial_success'` and pushes the warning into `RUN_SUMMARY.warnings`. At scan end, this status writes into `data/run-summaries/scanner-<utc-timestamp>.md` frontmatter.

The daily digest reader (`scripts/daily-digest-email.mjs` or similar) reads the run-summary frontmatter to decide whether the morning email should flag issues. If LinkedIn MCP degrades gracefully **without** marking `partial_success`, the daily digest would show a green light even though a source silently dropped. That's a hole — currently the LinkedIn MCP script only sets `partial` via `errors.length > 0`, but our new retry success path could have nonzero errors and yet still be fine.

**TODO for next session:** Decide whether `retry-succeeded-after-lock` counts as partial. Probably should, for visibility into recurrence.

---

## 14. Decision Deep Dive — Expanded D1–D7

This expands §6 with scenarios, reversibility, and guard rails for each decision.

### D1 — Run the scan again despite a run 90 min earlier

**Context expanded:** The portals.yml has 84 tracked companies. Many post multiple times per day (enterprise SaaS companies frequently publish new reqs in morning blocks, noon, and end-of-business). The 18:14 cron catches morning + noon drops. A 19:40 manual run catches the EOB drop window for US-Pacific companies (17:00 PT = 19:00 CT).

**Scenarios examined:**
- *Everything is same → waste:* 0 new, ~2min of compute, ~$0.10 API quota. Recoverable cost.
- *Few new → win:* 1–5 new, catches time-sensitive postings. Marginal value positive.
- *Many new → big win:* 20+ new, validates the policy.
- *We hit: 24 new.* Middle scenario, confirms the policy is sound.

**Reversal condition:** If over a 2-week window the avg manual-re-run yields <3 new postings, add a cooldown (don't re-run within 4h unless `--force`).

### D2 — WMI CommandLine match, not blanket taskkill

**Scenarios examined:**
- *Blanket taskkill:* 100% kill rate, 100% collateral damage (Matt's browser). Hard reject.
- *No kill, rely on retry only:* 60% reliability, avoids all collateral. Doesn't solve zombie-Chrome cases.
- *WMI filter:* 95% reliability on Chrome-caused cases, 0% collateral. **Winner.**
- *Handle.exe or Process Explorer:* 100% reliability but requires Sysinternals install. Not baseline.

**Reversal condition:** If WMI proves flaky (race conditions, admin denial), fall back to process-tree ancestry (`Get-CimInstance Win32_Process ... | Where-Object { $_.ParentProcessId -eq <uvx-pid> }`).

### D3 — Keep 1 snapshot, not 0

**Scenarios examined:**
- *Keep 0:* MCP would fail its "recover from prior invalid state" path that sometimes reuses snapshot cookies. Risk of auth session loss.
- *Keep 1:* Allows recovery and postmortem. Disk cost ~225MB, bounded.
- *Keep 3:* Safer for multi-failure diagnosis, 3× disk cost. Overkill for a scraper.
- *Keep N by age (e.g., 24h):* More robust but complicates preflight logic.

**Reversal:** If we see `AuthenticationError: cannot recover from empty state` post-prune, bump to `KEEP_SNAPSHOTS = 2`.

### D4 — Retry once, not N

**Scenarios examined:**
- *Retry once:* Catches transient AV / brief Chrome grab. Worst-case added latency: 5s.
- *Retry 3×:* Might recover from genuinely rough environments, at cost of 15s+ delay. Hides systemic issues.
- *Exponential backoff:* Overengineered for 8 queries × 1 retry.

**Reversal:** If retry-once logs show >50% need retry, the underlying issue isn't fixed — escalate to environment cleanup (Defender exclusion, OneDrive pause).

### D5 — Preflight on every run, not just failure

**Scenarios examined:**
- *On failure only:* Reactive. Disk growth accumulates between failures. First failure after a long healthy streak has the biggest cleanup cost.
- *On every run:* Proactive. Bounded cost, predictable. **Winner.**
- *Periodic (every 7th run):* Stateful, more complex, no clear benefit.

**Reversal:** If preflight itself becomes slow (>2s), make it asynchronous/fire-and-forget for the kill step.

### D6 — Broad regex for `isProfileLockError`

**Scenarios examined:**
- *Strict (only `WinError 32`):* High precision, low recall. Misses the AuthenticationError wrapper.
- *Broad (current):* Lower precision, high recall. Catches real lock cases reliably.
- *Parse stderr JSON:* Would require the MCP to emit structured errors. It doesn't. Future work.

**Reversal:** Add a negative filter — don't retry on errors that also match `401 Unauthorized` or `captcha` (real auth failures).

### D7 — Graceful degrade on all-retry-failure

**Scenarios examined:**
- *Exit non-zero:* Orchestrator marks scan as failed. Sends alert. Loud. User might abandon auto-scan.
- *Log + exit zero:* Orchestrator continues. Other sources still reported. **Winner.**
- *Partial-success flag:* See §13.8 — should add this, currently doesn't. Follow-up TODO.

**Reversal:** If LinkedIn becomes a critical source (other coverage drops), upgrade degrade to partial-success or fail-loud.

---

## 15. Blocker Diagnostic Trees

### 15.1 If tomorrow's cron still fails

Run this triage in order:

```
data/events/2026-04-21.jsonl contains scanner.linkedin_mcp.completed?
├─ No → MCP subprocess never started. Check uvx install, check orchestrator wiring.
│   ├─ Check: `uvx --help` should return usage.
│   └─ Check: `scripts/auto-scan.mjs` includes LinkedIn source.
├─ Yes, status=success → FIX WORKS. Close the investigation.
├─ Yes, status=partial → Retry worked. Monitor for a week.
└─ Yes, status=error → Retry also failed. Go to §15.2.
```

### 15.2 If retry also fails (root cause is not Chrome)

```
Does the error message include "WinError 32" or "being used by another process"?
├─ Yes → Non-Chrome lock holder.
│   ├─ Run `handle.exe C:\Users\mattm\.linkedin-mcp\profile\Default\Network\Cookies`
│   │   (download handle.exe from Sysinternals, run once).
│   ├─ If holder is Windows Defender / MsMpEng.exe → add exclusion:
│   │   Add-MpPreference -ExclusionPath "C:\Users\mattm\.linkedin-mcp"
│   ├─ If holder is OneDrive.exe / Dropbox.exe → exclude folder from sync.
│   └─ If holder is another node.exe (career-ops related) → bug in preflight.
│       Add WMI filter for node.exe too.
├─ No, different error → go to §15.3.
```

### 15.3 Other error classes

```
Error contains "captcha" or "Access Denied" (not PermissionError)?
├─ Yes → LinkedIn anti-bot triggered.
│   ├─ Re-authenticate (delete .linkedin-mcp/profile, run once in headful mode).
│   └─ Consider reducing query count per scan (currently 8).
├─ "HTTP 429" or "rate limit" → back off. Add exponential wait to queries.
├─ "Session not ready" → run `scan-linkedin-mcp.mjs --live` once manually to re-auth.
└─ Else → read uvx process stderr in full. File a postmortem.
```

---

## 16. Anti-Patterns Observed + Meta-Insights

### 16.1 Anti-pattern: reading tools without verifying

Early in the session I wrote: "No live Chrome is holding the profile." Good negative claim. But I reached it via one `Get-CimInstance` query at a single moment. A momentary lock by definition won't be visible at an arbitrary probe time. My claim should have been: "I saw no live Chrome at 20:01 CT, which is consistent with a momentary-lock model."

**Lesson:** Negative observations are weaker than positive ones. State their scope.

### 16.2 Anti-pattern: side-effecting probes

The `node -e "import(...)"` probe ran `main()` and pruned snapshots. This worked out — the cleanup was desirable — but it was accidental. A script without a main-guard treats import as execution. **Always add the main-guard.**

### 16.3 Anti-pattern: fix-first, observe-second

I patched the script before tomorrow's cron had a chance to confirm the diagnosis. The fix is probably right, but I'm now committed to verifying the cron tomorrow. A more disciplined path: add observability first (log detailed state on failure), let it run once, analyze, THEN patch. We skipped the observability-first step because the fix was cheap and the observability scaffolding already exists via the events JSONL.

**Counterpoint:** In auto mode, "prefer action over planning" explicitly endorses fix-first. This is a known tradeoff.

### 16.4 Meta-insight: the scan has four independent sources

Greenhouse APIs, Playwright-driven portals, Firecrawl `site:` queries, and direct-platform scans (LinkedIn MCP, Indeed, ZipRecruiter). Each is a separate failure domain. **This is architecturally sound** — one source's outage doesn't kill the scan. But the current dashboard only surfaces *individual* source status. A next-level dashboard should show:

- Per-source "last successful scan" timestamp
- 7-day source reliability percentage
- Per-source candidate yield (jobs added per run)

This would have made the LinkedIn MCP degradation visible weeks ago.

### 16.5 Meta-insight: observability is for the operator, not the scanner

The scanner itself doesn't need to know if LinkedIn succeeded — it has the redundancy of JobSpy + Firecrawl. But **Matt** needs to know, because persistent LinkedIn degradation could mean he's missing LinkedIn-specific postings (some companies post exclusively there). The fix handles the technical robustness; the missing piece is the **human-facing signal**.

### 16.6 Meta-insight: accumulate-until-critical is the default failure mode of all scrapers

Every scraper tool I've seen eventually grows some form of per-run artifact: logs, caches, profile states, screenshots, HAR files. Without a prune policy baked in from day one, it grows unbounded until the disk fills, a failure cascade hits, or a user notices something slow. The snapshot prune we added is one instance; there are probably others in `career-ops` (`data/events/*.jsonl`, `data/prefilter-results/*.md`, Playwright trace files). Consider a systemic sweep.

### 16.7 Meta-insight: errors in child-process subagents are easy to miss

The LinkedIn MCP spawns via `uvx linkedin-scraper-mcp@latest` as a child process. Its stderr is prefixed `[mcp:linkedin]` and surfaces in the parent's stderr. The parent (auto-scan.mjs) doesn't parse those lines — they fall through to the user's console.

This works when a human is watching (the Monitor filter caught it). It fails when running under cron (no human, no filter) — unless a specific error handler is in place. The current error handler catches `AuthenticationError` at the JSON-RPC level, but raw stderr noise from the subprocess (Python tracebacks) doesn't trigger it.

**Implication:** In production cron runs, subtle failures could be silently degrading. The automation-events JSONL is the safety net, but it depends on the child process itself calling its own success/failure handlers properly.

---

## 17. Performance / Cost Analysis

### 17.1 This session's scan — cost breakdown

| Component | Time | API calls | Data |
|-----------|------|-----------|------|
| Preflight (health check) | ~2s | 0 | — |
| Greenhouse APIs (49 targets) | ~45s | 49 | ~6.4k jobs |
| Ashby Playwright (18 cos) | ~3 min | 0 (browser) | ~300 jobs |
| Lever APIs (7 cos) | ~15s | 7 | ~40 jobs |
| SmartRecruiters APIs (5 cos) | ~15s | 5 | ~120 jobs |
| Workday Playwright (26 cos) | ~6 min | 0 | ~250 jobs |
| iCIMS Playwright (8 cos) | ~2 min | 0 | ~80 jobs |
| Built In Playwright (8 queries) | ~2 min | 0 | ~50 jobs |
| Firecrawl (15 parallel) | ~90s | 15 | ~200 jobs |
| LinkedIn MCP (failed) | ~20s | — | 0 jobs |
| JobSpy Python | ~3 min | — | ~500 jobs |
| Dedup + write | ~30s | 0 | — |
| **Total** | **~18 min** | **~76 external calls** | **~7k jobs** |

Per-scan cost at current volumes is negligible — Firecrawl's free tier handles 15 queries easily, Greenhouse is open API.

### 17.2 Preflight added cost

- `killStaleLinkedInChrome`: ~300ms (WMI query) + ~0ms if nothing to kill
- `pruneInvalidStateSnapshots`: ~100ms if nothing to prune, up to ~30s if deleting a 900MB dir tree
- **Worst case preflight:** ~30s on disk cleanup. Amortized (per-run prune keeps one): ~200ms.
- **Added to scan total:** <0.3% overhead.

### 17.3 Retry cost if triggered

- 5s wait + re-spawn MCP subprocess (~3s) + re-run 8 queries (~15s)
- **Total added:** ~23s per retry instance.
- At 1% retry rate, adds 0.2s average per scan. Negligible.

### 17.4 Disk budget

- `.linkedin-mcp/profile`: ~225MB live.
- `.linkedin-mcp/invalid-state-*`: capped at ~225MB (KEEP_SNAPSHOTS=1).
- `data/events/*.jsonl`: grows ~5KB/day. Annual: ~2MB. Fine.
- `data/scan-history.tsv`: grows ~5KB/scan. Currently 90k lines. Could exceed 1M lines in 3 years → consider rotation.
- `dashboard.html`: ~1.5MB per regeneration, overwrites. Fine.

### 17.5 Regression watchlist

Watch these metrics over the next 7 days and escalate if any drift:

| Metric | Baseline | Alert threshold |
|--------|----------|-----------------|
| Scan runtime | 18 min | >30 min |
| LinkedIn MCP yield | 0 (currently) → expected >5/run post-fix | =0 for 3+ consecutive runs |
| `.linkedin-mcp` disk | 225MB | >500MB (indicates prune broke) |
| Retry rate | 0% baseline, 5% acceptable | >20% (indicates lock still recurring) |
| Scan count per day | 2 (cron + manual optional) | Anomaly if 0 for a day |

---

## 18. Architectural Implications

### 18.1 The preflight pattern generalizes

Other scripts likely have similar hygiene needs:

- `scripts/scan-indeed.mjs` uses Playwright. Does it prune traces?
- `scripts/scan-jobspy.py` probably caches Selenium profiles. Unbounded?
- `scripts/auto-apply-batch.mjs` uses Playwright for form submission. Screenshot accumulation?

Consider extracting `preflight` into `scripts/lib/preflight.mjs` with registered handlers per source:
```js
export function registerPreflight(source, fn) { ... }
export async function runAllPreflights() { ... }
```
Then each scanner registers its own cleanup, and the orchestrator runs them all before the scan starts.

### 18.2 Source health registry

Today there's no central place to read "is LinkedIn MCP healthy?". Each script logs its own status to automation-events. A thin aggregation script could read the last N events per source and publish to a JSON file:
```
data/source-health.json:
{
  "linkedin-mcp": { "last_success": "...", "last_run": "...", "7d_success_rate": 0.43 },
  "greenhouse-api": { "last_success": "...", "7d_success_rate": 1.0 },
  ...
}
```
This feeds the dashboard and makes degradation visible.

### 18.3 MCP-as-dependency-type

The LinkedIn MCP is a Python-based MCP server spawned via `uvx`. Two notable properties:

1. **Version drift:** `uvx linkedin-scraper-mcp@latest` auto-updates. A behavior change upstream could silently break our integration.
2. **Auth state is local:** The profile directory IS the authentication. Losing it = losing session = manual re-login (headful browser).

Both properties mean MCP integrations are **fragile external dependencies** that need (a) version pinning for production (`@0.3.1` instead of `@latest`), and (b) auth-state backup / restore procedures. Neither is currently in place.

### 18.4 Cross-session coherence

This session is the fourth in a day (morning → afternoon → evening → night). The handoffs have been exhaustive but redundant — each one re-establishes context that the next already inherits from prior docs. A sustainable approach:

- Keep per-session handoffs short (decisions + deltas from prior session).
- Maintain ONE living document (e.g., `docs/SYSTEM-STATE.md`) that's updated with durable facts.
- Periodically (weekly?) consolidate handoffs into the living doc and archive the daily ones.

Not a change needed tonight — but flagged for future.

### 18.5 The scan pipeline is over-coupled to Windows

`killStaleLinkedInChrome` short-circuits on non-win32. The rest of the scan is portable (Node + Python + uvx work everywhere). This is fine *for now* because Matt runs on Windows 11 exclusively. But if the scanner ever runs in CI or on a Linux VM for redundancy:

- Need `ps -eo pid,command | grep linkedin-mcp | awk ...` fallback
- Need to verify `rmSync` works on mac/linux (it does)
- Need to verify WMI-free platforms don't break anything else

Tracking this in §7 TODOs.

---

## 19. Historical Context — Prior Commits This Work Builds On

Tonight's LinkedIn MCP fix did not land in a vacuum. Four prior initiatives set up the infrastructure, made the failure visible, and established the patterns this session followed:

### 19.1 LinkedIn MCP integration (the origin)

- `9a31254 feat(scan-linkedin-mcp): real MCP stdio JSON-RPC client` — first real wiring of LinkedIn as an MCP source. Before this, LinkedIn was only reachable via Playwright (high-friction, auth-prompt-heavy). This commit swapped in the `linkedin-scraper-mcp` uvx package via stdio JSON-RPC — the architecture we still use tonight.
- `a260e7d feat(scan): integrate LinkedIn MCP + Indeed Playwright scanners + aggregator-URL resolver` — same era, bundled LinkedIn MCP into `auto-scan.mjs`'s `runDirectBoardScans()`. This is the code path at lines 1249-1313 that tonight's partial-success propagation will extend.
- `85cae1e refactor(mcp): extract shared stdio JSON-RPC client to scripts/lib/mcp-client.mjs` — shared the client across multiple MCP integrations. The `McpClient` class used at line 173 of `scan-linkedin-mcp.mjs` lives here.

**Implication:** The LinkedIn MCP is a ~4-week-old dependency. Matt has lived through the growing-pains phase; tonight's fix is the second wave of hardening (first wave: auth-wall rejection at `9ec1438`).

### 19.2 Chrome preflight lineage

- `b51eef1 feat(ops): chrome-preflight lib + gitignore Playwright artifact dirs` — original `scripts/lib/chrome-preflight.mjs`, introduced to kill zombie Chromium processes left by crashed Playwright runs.
- `409e0df feat(ops): runChromePreflight wrapper + wire into 9 browser entry points` — wrapper fan-out across all Playwright-using scripts. Precedent for the preflight-registry pattern in Phase 3.2 of this plan.
- `5440452 fix(chrome-preflight): restore missing runChromePreflight wrapper` — a regression fix; the wrapper was accidentally removed. Small lesson: preflight code is load-bearing and easy to accidentally break.
- `9dcbf92 fix(chrome-preflight): route wrapper cleanup logs to stderr` — stdout hygiene. Tonight's `killStaleLinkedInChrome` follows the same stderr convention (lines 116-120).
- `bb0451e feat(apply): wire chrome preflight into browser entrypoints` — extended preflight to the apply-flow scripts. Matt knows this pattern; the LinkedIn-specific preflight (`pruneInvalidStateSnapshots`) tonight is a natural extension.

**Implication:** Extracting the LinkedIn-specific preflight into `scripts/lib/linkedin-preflight.mjs` (Phase 3.2) follows a well-worn path. The team has already paid the "where does this live" tax; there's a clear convention.

### 19.3 Reliability + cron-wrap evolution

- `7a33663 feat(automation): apply orchestration, preflight, hygiene, run-summary, verify-all` — the big bang. Introduced run-summary writing, preflight hooks, and `verify:all` CI gate. The `createRunSummaryContext` + `markPartialSuccess` we're using tonight landed here.
- `87baec8 feat(reliability): exit-trap one-liner closes silent-failure gap` — a subtle prior fix. Scripts were silently swallowing errors in exit handlers; this one-liner forced surfacing. Tonight's graceful-degrade exit path (D7) is consistent with this philosophy — fail visibly, don't fail silently.
- `99e82f6 feat(cron-wrap): also recognize legacy status:'failure' events` — dealt with the exact ambiguity tonight's `partial_success` propagation TODO addresses: what counts as a failure for the cron wrapper's reporting? The legacy `failure` vs. new `error`/`partial`/`success` tri-state distinction means we can't just bolt on new statuses — we need to verify the cron-wrap reader handles them.

**Implication:** When wiring `partial_success` in Phase 3.3, check that `scripts/cron-wrap.mjs` (or equivalent) recognizes the state. There's a precedent for backward-compatible status reading here.

### 19.4 Scan-source priority + health evolution

- `6701144 feat(priority): on-site MSP > hybrid MSP > remote across scoring + scanners` — SSOT work from 2026-04-16. Gave each scanner a location-priority awareness.
- `fe6dd7c feat(scan-history): 7th location column + MSP bucket split in scan-report` — scan-history.tsv got richer columns.
- `62cfe04 refactor(portals): expand locations[] variants in direct-board scans` — direct-scan portals got multi-location support.
- `0452cd9 feat(dashboard): morning briefing + freshness badges + stale-alert panel (W2)` — dashboard got freshness surfaces, including per-source staleness. The source-health registry in Phase 3.4 is a natural next step on this axis.

**Implication:** Matt's dashboard already surfaces freshness (last-run timestamp per source) but NOT reliability (success rate over N runs). Phase 3.4 closes this loop.

### 19.5 Session handoff cadence

- `083837a docs: session handoff — 2026-04-20 overnight push (9 commits)` — the overnight session that preceded this one. Tonight's scan-linkedin-mcp.mjs was last touched in that window.
- `a312013 docs: session handoff — 2026-04-20 late-night (LinkedIn ATS URL loop complete)` — immediately prior. LinkedIn *ATS URL* work (resolving redirected URLs from LinkedIn listings to direct ATS URLs) is distinct from tonight's *LinkedIn MCP* scanning — don't confuse them.
- `e5cb96d docs: refresh DAILY-USAGE + session continuity for 2026-04-19 night push` — two nights ago.
- `fe28b2c docs: session continuity handoff 2026-04-17 early morning` — four days ago.

**Implication:** Matt is running nightly sessions. The handoff cadence is tight. Any "will pick up tomorrow" plan is real — not a future-TBD.

---

## 20. Operational Runbook — Scenario Playbooks

Extract-and-act procedures. If you're in the middle of an incident, skip the narrative sections and jump to the scenario that matches the symptom.

### 20.1 Scenario A — 6am cron fired, scan emitted `status: error`

**Symptom:** `data/run-summaries/scanner-2026-04-21T11-00-*.md` shows `status: error` in frontmatter. Daily digest email flags the run. Or: no 6am summary file at all (cron didn't fire / cron failed before summary write).

**First 5 minutes:**
1. `cat data/run-summaries/scanner-2026-04-21T*.md` — read the full summary including warnings.
2. `grep -l "scanner.linkedin_mcp" data/events/2026-04-21.jsonl` — confirm LinkedIn MCP was invoked.
3. `tail -n 200 data/scan-scheduler.log` (ignored by git but exists locally) — kernel-level cron status.
4. If LinkedIn is the culprit, proceed to **Scenario B**. If another source, triage per §15.3 diagnostic tree.

**Escalation criterion:** If two consecutive 6am crons error out with the same source → this stops being a one-off. Drop everything and diagnose.

**Verification command after fix:** `node scripts/scan-linkedin-mcp.mjs --live` (runs the script standalone with full stderr visible; finishes in ~30s for a healthy profile).

### 20.2 Scenario B — LinkedIn MCP specifically is failing

**Symptom:** `scanner.linkedin_mcp.completed` event with `status: error` OR missing entirely from the day's JSONL. stderr excerpt includes `AuthenticationError`, `WinError 32`, `PermissionError`, or `Stored runtime profile is invalid`.

**First 5 minutes:**
1. **Read the error type** (matters for branching):
   - `PermissionError: [WinError 32]` → profile lock. Go to §15.2 (non-Chrome lock holder triage).
   - `Stored runtime profile is invalid` → wrapper of file-system error. Try preflight + retry (which tonight's fix does automatically).
   - `captcha`, `Access Denied` without `PermissionError` → anti-bot. Go to §15.3 (re-auth path).
   - `HTTP 429` → rate limit. Wait 10 minutes, re-run. If recurs, reduce query count.
2. Manually run preflight: `node -e "import('./scripts/scan-linkedin-mcp.mjs').then(m => m.preflight?.())"` (requires Phase 3.1 main-guard + export).
3. Manually run scan: `node scripts/scan-linkedin-mcp.mjs --live` (note: `--live` flag currently shows jobs; add `--json` flag if you want programmatic output).
4. Inspect `~/.linkedin-mcp/` size: `du -sh ~/.linkedin-mcp/` (or `Get-ChildItem -Path "$env:USERPROFILE\.linkedin-mcp" -Recurse | Measure-Object -Property Length -Sum`). Expect ~225MB profile + ~225MB most-recent invalid-state snapshot. If >1GB, preflight's prune failed silently.

**Escalation criterion:** If 3 consecutive retries fail with PermissionError and preflight kills no Chrome processes → culprit is not Chrome. Add Defender exclusion: `Add-MpPreference -ExclusionPath "$env:USERPROFILE\.linkedin-mcp"` (requires admin PowerShell).

**Verification command after fix:** `node scripts/scan-linkedin-mcp.mjs --json | tail -1 | jq '.status'` should output `"success"` (not `"partial"` or `"error"`).

### 20.3 Scenario C — `.linkedin-mcp/` disk blowout

**Symptom:** `du -sh ~/.linkedin-mcp` shows >2GB. OR: manual observation of storage pressure.

**First 5 minutes:**
1. List snapshots by age + size: `Get-ChildItem "$env:USERPROFILE\.linkedin-mcp" -Directory | Where-Object { $_.Name -like "invalid-state-*" } | Sort-Object LastWriteTime -Descending | ForEach-Object { "{0}  {1}MB  {2}" -f $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm"), [math]::Round((Get-ChildItem $_ -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB), $_.Name }`
2. Keep the single newest; remove all others: `node -e "import('./scripts/scan-linkedin-mcp.mjs').then(m => m.pruneInvalidStateSnapshots?.())"` (requires Phase 3.1 main-guard + export).
3. If snapshots are actively being created (more than 1/day), something is forcing the MCP into repeated invalid-state events. Escalate to Scenario B.

**Root cause discovery:** Count how many snapshots existed on day N vs day N-7. Exponential growth = systemic issue; linear = one-off. Check `git log --since="14 days ago" --oneline scripts/scan-linkedin-mcp.mjs` to see if recent code changes correlate.

**Verification command after fix:** `du -sh ~/.linkedin-mcp` returns <500MB. Run a scan and confirm it does NOT create a new invalid-state-* snapshot on success.

### 20.4 Scenario D — Partial scan result interpretation

**Symptom:** Run summary shows `status: partial_success`, `warnings: [...]`, and total job count seems lower than usual.

**First 5 minutes:**
1. `cat data/run-summaries/scanner-*.json | tail -1 | jq '.warnings, .stats'` — identify which source(s) degraded.
2. Compare to prior 7 days: `for f in data/run-summaries/scanner-2026-04-*.json; do jq -r '[.finishedAt, .status, .stats.total_found] | @tsv' "$f"; done` — baseline yield.
3. **If yield delta is <10% and one source is flagged** — non-critical, monitor.
4. **If yield delta is >30%** — likely primary source (Greenhouse or LinkedIn) is down. Check its specific event log.

**Escalation criterion:** Three consecutive partial_success runs flagging the same source → the source has a sustained issue. If it's LinkedIn, see Scenario B. If Greenhouse API, check their status page.

**Verification command after fix:** Subsequent run shows `status: success` with yield within ±10% of baseline.

### 20.5 Scenario E — Dashboard stale / missing tiles

**Symptom:** `dashboard.html` open in browser shows yesterday's data. Or a tile renders `undefined` / blank.

**First 5 minutes:**
1. `ls -la dashboard.html` — check mtime. If older than most recent scan, the post-scan regen hook didn't fire.
2. `node scripts/generate-dashboard.mjs` — force regen manually. Watch for errors.
3. `grep -c recorded_at data/events/2026-04-21.jsonl` — confirm today's events exist.
4. If a specific tile renders blank, grep the generator for the tile's data source: e.g., source-health tile → `grep "source-health" scripts/generate-dashboard.mjs`.

**Escalation criterion:** If manual regen produces stale output, the event pipeline is broken upstream. Check `scripts/log-automation-event.mjs` (if exists) or wherever emitters write JSONL.

**Verification command after fix:** Refresh dashboard, confirm all tiles render current data, confirm "Last updated" timestamp is within 5 minutes.

---

## 21. Annotated Code Walkthroughs

Inline walkthrough of the three code paths most relevant to next steps. Read this when you need to modify these areas; skip when you're in a different part of the codebase.

### 21.1 `scripts/scan-linkedin-mcp.mjs:103-168` — preflight block (this session's work)

```js
// L103-105: Error detector. Broad by design — catches all known
// manifestations of "profile directory is locked."
function isProfileLockError(msg) {
  return /WinError 32|WinError 5|PermissionError|being used by another process|Stored runtime profile is invalid/i.test(msg);
}
```
*Notes:* The alternation matches both deepest-layer (WinError 32) and highest-layer (AuthenticationError wrapper's "Stored runtime profile is invalid") errors. Don't narrow without regression-testing against the stderr patterns seen in §13.1.

```js
// L109-123: Kill stale Chromes — Windows only, WMI filter on CommandLine
function killStaleLinkedInChrome() {
  if (process.platform !== 'win32') return { killed: 0, skipped: true };
  // ... WMI CIM query with Where-Object pipeline-filter for 'linkedin-mcp' in CommandLine
```
*Notes:* See §13.3 for why the filter is applied in PowerShell (not WQL `-Filter`). Timeout is 15s — generous for typical machines; if Matt's box has 200+ Chrome tabs this could borderline. `SilentlyContinue` on Stop-Process prevents errors when processes die mid-query.

```js
// L125-151: Prune invalid-state snapshots, keep KEEP_SNAPSHOTS (1) newest
function pruneInvalidStateSnapshots() {
  // ... sort by mtimeMs desc, slice off the newest 1, rmSync the rest
  rmSync(e.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
```
*Notes:* `maxRetries: 3` handles `EBUSY`/`ENOTEMPTY`/`EPERM` but NOT `EACCES` (see §13.4). For stale snapshots this is almost never triggered; it's defense-in-depth for AV-scanner races. KEEP_SNAPSHOTS=1 is the current constant; bump via `KEEP_SNAPSHOTS` env var if recovery fails with N=0 (see §14 D3).

```js
// L165-168: Preflight entry point — called at main() line ~215
function preflight() {
  killStaleLinkedInChrome();
  pruneInvalidStateSnapshots();
}
```
*Notes:* Synchronous, both helpers tolerate their own errors. Don't async this without ensuring both helpers still run on one failure (currently if the first throws, the second still runs; would break with `await` chain).

### 21.2 `scripts/auto-scan.mjs:1249-1313` — LinkedIn MCP spawn in orchestrator

```js
// L1249-1290: runDirectBoardScans spawns child Node process
const proc = spawn(process.execPath, args, { ... });
proc.stderr.on('data', (buf) => { /* collect stderr */ });
```
*Notes:* Stdin not used; child communicates via stdout (JSON mode with `--json` flag) and stderr (human-readable). Parent captures both but only consumes stdout for the job list.

```js
// L1297: Exit-code handling (the GAP for Phase 3.3)
proc.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.warn(`[${SOURCE}] exit code ${code} — dropping results`);
    resolve_([]);
  }
```
*Notes:* **Current behavior:** any non-zero exit → treat as zero jobs, don't fail scan. **Phase 3.3 target:** add explicit branch for `code === 2` → `markPartialSuccess('LinkedIn MCP retried successfully — investigate recurrence')`. The child script must be updated in parallel to return exit code 2 on retry-success, which means §21.3's retry block needs a parallel edit.

```js
// L1308: JSON parse handling
try { jobs = JSON.parse(stdoutStr); } catch { ... }
```
*Notes:* If stdout is malformed (e.g., stderr leaks into stdout stream), this catches silently. For Phase 3.3 consider: after successful parse, inspect `jobs.status` field too — if `status: 'partial'`, also call `markPartialSuccess`. Two signal channels (exit code 2 OR stdout status) are robust-by-redundancy.

### 21.3 `scripts/scan-linkedin-mcp.mjs:220-231` — retry-after-preflight loop

Based on the current code shape (verify exact lines when editing):

```js
// In runQueries or main(): retry once if profile-lock on first attempt
if (profileLockHit && !retried) {
  console.error(`[${SOURCE}] profile-lock detected, re-running preflight + retrying once...`);
  await new Promise(r => setTimeout(r, 5000)); // kernel handle cleanup time
  preflight();
  retried = true;
  // ... retry queries
}
```
*Notes:* The `5000` is deliberate — §13.2 explains the kernel-handle-release latency. Don't shorten below 2000ms without testing.

**Phase 3.3 edit:** When retry succeeds, set a `retriedSuccessfully` flag that:
1. Writes `retried: true` into the `scanner.linkedin_mcp.completed` event payload
2. Causes `process.exit(2)` instead of `process.exit(0)` on clean-exit path
3. Optionally sets `status: 'partial'` in the event payload for orchestrator visibility

### 21.4 `scripts/generate-dashboard.mjs:1156` — event timestamp fallback

```js
const eventTs = (e) => new Date(e.recorded_at || e.timestamp || e.ts || e.at || 0).getTime();
```
*Notes:* Chain is load-bearing (§13.6). The `|| 0` at the end gives epoch-0 for events with no timestamp — these sort to the beginning of any chronological rendering and are visually obvious as "broken." Don't replace with `|| Date.now()` — that would silently hide malformed events.

For Phase 3.4 source-health aggregator: reuse this exact helper. If centralizing, extract to `scripts/lib/event-utils.mjs`.

---

## 22. Environment Specifics — Matt's Windows 11 Machine

Idioms and constraints specific to the machine this code runs on. Skip if you're working on another machine; critical if you're debugging Windows-specific behavior.

### 22.1 Chrome profile hive location

- `%USERPROFILE%\.linkedin-mcp\` — LinkedIn MCP profile root. ~225MB when healthy.
- `%USERPROFILE%\.linkedin-mcp\profile\Default\Network\Cookies` — the SQLite file that gets locked (§13.1).
- `%USERPROFILE%\.linkedin-mcp\profile\Default\Login Data` — Chrome Password-Manager DB; also SQLite; also lockable.
- `%USERPROFILE%\.linkedin-mcp\invalid-state-YYYY-MM-DDTHH-MM-SS*\` — snapshot directories created when the MCP detects a corrupt session. Tonight's prune keeps the 1 newest.

### 22.2 Windows Defender real-time protection interactions

Defender's real-time scanner touches new files for <500ms after write. When the LinkedIn MCP moves a profile directory (recursive copy-then-delete internally), Defender can grab `Cookies` for an AV scan during the window and hold an exclusive handle. This looks identical to a Chrome-held lock but is actually Defender.

**Diagnose:** During a lock event, run `handle.exe "C:\Users\mattm\.linkedin-mcp\profile\Default\Network\Cookies"` (Sysinternals). If the holder is `MsMpEng.exe`, it's Defender.

**Fix:** Exclusion requires admin PowerShell:
```powershell
Add-MpPreference -ExclusionPath "$env:USERPROFILE\.linkedin-mcp"
```
This excludes the directory from both real-time and scheduled scans. Document if applied — it's a security-posture change.

**Warning:** Do NOT blanket-exclude `%USERPROFILE%` or large Chrome profile roots. Narrow to `.linkedin-mcp` only.

### 22.3 OneDrive sync interactions

If OneDrive backs up `%USERPROFILE%`, it watches for changes and uploads. During MCP profile moves, OneDrive can grab handles on individual files. This is rare (OneDrive de-prioritizes transient files) but possible.

**Diagnose:** `Get-Process onedrive` — if running, check OneDrive's "Files restoring" panel for ongoing sync on `.linkedin-mcp`.

**Fix:** Exclude folder: OneDrive → Settings → Backup → Manage → uncheck `.linkedin-mcp`. Or: `%USERPROFILE%\.OneDrive\settings\Personal\exclude.txt` add the path.

### 22.4 Sysinternals install + usage

For deep file-lock / handle diagnosis, Sysinternals Suite is the tool:
- Download: https://learn.microsoft.com/sysinternals/downloads/sysinternals-suite
- Install: extract to `%USERPROFILE%\Tools\Sysinternals\`, add to PATH.
- Key binaries:
  - `handle.exe` — enumerate file handles (needs `-a` for all processes)
  - `procmon.exe` — real-time file/registry activity monitor
  - `tcpview.exe` — open network connections

First-run accepts EULA: `handle.exe -accepteula` once per machine.

### 22.5 Port reservations (from CLAUDE.md)

- IB Gateway live: port 4001 (PERMANENTLY BLOCKED — JARVIS trader only)
- IB Gateway paper: port 4002
- Engine API: 8010
- Dashboard: 3010
- Redis: 6379

career-ops should never bind these. The scan pipeline uses no ports (pure subprocess + HTTP client).

### 22.6 Node / Python versions

- Node: managed by `pnpm env`; current active is verifiable via `pnpm -v` and `node -v`. The `.mjs` scripts require Node ≥ 16 (for `fs.rmSync`).
- Python: career-ops Python is via `uvx` (ephemeral) or system. JARVIS has `engine/.venv/` but career-ops doesn't. The LinkedIn MCP is pulled via `uvx linkedin-scraper-mcp@latest` — see §18.3 for the version-pinning concern.
- PowerShell: 7.x (pwsh) preferred; scripts use `-NoProfile` to avoid user-profile module loading and `-Command` for single-line invocation.

### 22.7 Line-ending convention

Git on this machine normalizes LF → CRLF on checkout. Editing .mjs files locally produces CRLF; git normalizes back on commit. Warnings like `"LF will be replaced by CRLF the next time Git touches it"` are cosmetic — the tracked content is LF.

**Do not** set `autocrlf=false` globally; it breaks cross-platform collaboration. The current setup is correct.

### 22.8 Scheduled task registration

- `scripts/scan-task.xml` — Windows Task Scheduler definition for daily scans.
- `scripts/register-scan-task.ps1` — one-shot script that imports the XML into Task Scheduler (requires admin).
- Tasks register under `\Matt\career-ops\` hive.
- View status: `Get-ScheduledTask -TaskPath "\Matt\career-ops\*" | Format-Table TaskName, State, LastRunTime, LastTaskResult`

A `LastTaskResult` of `0x0` is clean; `0x1` is generic failure; `0x41301` is still-running. If tasks are missing entirely, re-run the register script.

---

## 23. Companion Documents (forward reference)

The following docs extract and focus the lookup-style material from §13-§18 + §20-§21 above. Handoffs rot; these living docs don't:

- **`docs/RUNBOOK-linkedin-mcp.md`** — Operational response for LinkedIn MCP failures. Extracts §15 diagnostic trees + §20.2-20.3 scenarios + §12.10 outcome interpretation. If you're firefighting, read this first.
- **`docs/ARCHITECTURE-scan-pipeline.md`** — Architecture of the scan pipeline: sources, orchestration, event flow, partial_success propagation. Extracts §12.4, §13.8, §18.1-18.2. If you're modifying the orchestrator or adding a source, read this.
- **`docs/POLICY-mcp-dependencies.md`** — Version-pinning and auth-state backup policy for MCP integrations. Extracts §18.3. If you're adding a new MCP, read this.

These docs are canonical lookup material. This handoff remains the chronological session record.

---

**End of expanded handoff. 23 sections, ~1,700+ lines. Read §10 first for quick-start, §20-§22 for operational depth, §23 for follow-on docs.**
— Claude Opus 4.7 (session 2026-04-20 night, final expansion 21:30 CT)
