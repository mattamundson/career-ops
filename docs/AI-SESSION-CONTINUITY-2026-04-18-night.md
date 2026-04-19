---
date: 2026-04-18
time: 22:41 CDT
session_type: gbrain Phase-5 follow-through + OpenAI embeddings provisioning
prior_handoff: docs/AI-SESSION-CONTINUITY-2026-04-17-early-morning.md
branch: master
origin_status: all-pushed (no unpushed commits)
---

# Session Handoff — 2026-04-18 Night

Self-contained continuation document. The next AI session should be able to pick up from here without consulting any earlier conversation.

---

## 1. Session Summary

This was a follow-through session for gbrain (PGLite-backed knowledge brain, vendored at `vendor/gbrain/`). It closed out a 5-item recommendation list produced at the end of the prior session, plus one out-of-scope dashboard bug the user asked to resolve inline.

Execution order (strict sequential — user directive "do not proceed to the next task until the current task is validated and provide evidence of completion"):

1. **Evaluate 11 auto-promoted apps (#032–#042)** — shipped in prior session; inherited as already completed
2. **Type-separate evaluation vs. company pages in brain** — shipped in prior session; inherited as already completed
3. **Embed brain chunks via `text-embedding-3-small`** — DEFERRED at start of this session (no API key), then UNBLOCKED + COMPLETED once user added OpenAI credits
4. **Register brain as MCP server** — shipped at start of this session
5. **Track `.husky/pre-push`** — shipped at start of this session

Plus one inline fix:
6. **Dashboard showed 31 apps instead of 42** — root-caused (rows 032-042 had drifted below the footer in `data/applications.md`, which is gitignored). Moved rows back into contiguous table body; regenerated `dashboard.html`; pushed.

Plus one provisioning round-trip:
7. User added `OPENAI_API_KEY` to `.env` → first embed run failed with 429 "exceeded current quota" (no credits) → user added prepaid credits → second embed run succeeded, embedded all 2,171 chunks.

Outcome: all 5 recommendations complete, dashboard bug fixed, `origin/master` clean at `da14a49`.

---

## 2. Files Created or Modified

### 2.1 Committed this session (in origin/master)

| Commit | Files | Change |
|--------|-------|--------|
| `db95127` | `.mcp.json` | Added `brain` MCP server entry pointing at `bun run vendor/gbrain/src/cli.ts serve`. 30 tools exposed. |
| `dbc49b9` | `.husky/pre-push` | Tracked existing local file so verify:ci + pnpm test run on push across machines. |
| `da14a49` | `dashboard.html` | Regenerated after moving rows 032-042 back into the contiguous table in `data/applications.md` (that file is gitignored, so it can't appear in the commit — dashboard.html is the only tracked artifact that captures the fix). |

### 2.2 Modified but NOT committed (local-only)

| File | Tracked? | Change | Why |
|------|----------|--------|-----|
| `data/applications.md` | **gitignored** | Moved rows 032-042 from below the HTML comment + `---` + footer text back into the main table body (between rows 031 and 001). Rewrote the "REMOVED 2026-04-10" comment to note row numbers were later reused. | Fixes parser break in `parseApplicationsTracker`: its loop terminates at the first non-`\|` line, so rows below the comment were invisible to the dashboard, career-data index, and brain-sync validator. |

### 2.3 Not modified (untracked preexisting)

Over 100 untracked files exist in working tree — most are gitignored by design (reports, outreach, company-intel, prefilter-results, scan-summaries, stale-alerts, brain-staging dirs, data/events, data/index, data/apply-runs, data/run-summaries, career-dashboard.exe, vendor/). These are local artifacts and must remain local. See git status in §9.

### 2.4 OpenAI-backed side effect

`C:\Users\mattm\.gbrain\brain.pglite\` — PGLite database. Not a file in this repo; stored under user home. After this session: 711 pages, 2171 chunks, **2171 chunks embedded** (was 0), 42 links, 13 timeline entries. Embeddings use `text-embedding-3-small` (1536-dim).

### 2.5 Memory file added

| File | Type | Content |
|------|------|---------|
| `C:\Users\mattm\.claude\projects\C--Users-mattm-career-ops\memory\project_brain_mcp_registered.md` | project | Notes that `.mcp.json` registers the `brain` server, tools require Claude Code restart, and chunk embeddings now populated. |

MEMORY.md index entry added via Write tool in prior session — verify it still references `project_brain_mcp_registered.md` on next session start.

---

## 3. Current State

### 3.1 What's running

- **Nothing actively running.** No background bash tasks. No long-lived processes belonging to this session. All `bun` processes were killed (PIDs 21004, 25336 during diagnosis of the embed hang).
- **gbrain CLI** is usable on demand: `bun run vendor/gbrain/src/cli.ts <subcommand>`
- **Brain MCP server** is registered in `.mcp.json` but is NOT yet loaded in the current Claude Code session — it only loads on Claude Code restart in this project directory. `.claude/settings.local.json` has `enableAllProjectMcpServers=true`, so no manual approval prompt on restart.

### 3.2 What's stopped / complete

- All 5 recommendations: COMPLETE
- Dashboard bug: FIXED at `da14a49`
- OpenAI embeddings: POPULATED (2171/2171)
- verify:ci: GREEN (55/55 tests pass)
- `origin/master` is at `da14a49` — no unpushed commits

### 3.3 What's broken

- **Nothing is broken** at commit-level. `pnpm run verify:ci` passes; `pnpm test` passes (55/55).
- **One known non-blocker:** `dashboard.html` shows a working-tree diff because pre-commit regeneration ran after `git add` and produced different line endings (CRLF vs LF). Verified: only 3 lines changed (generated-at timestamps); content-equivalent. You can safely `git checkout dashboard.html` to discard the diff, or regenerate and commit if anything else triggers it. Not shipping-blocking.
- **One `.env` discrepancy:** user said they added `GOOGLE_CLIENT_SECRET` alongside `GOOGLE_CLIENT_ID` + `OPENAI_API_KEY`, but `grep -E "^[A-Z_]+=" .env` only returned `FIRECRAWL_API_KEY`, `GOOGLE_CLIENT_ID`, `OPENAI_API_KEY`. Either the variable is named differently (e.g., `GCLOUD_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`) or the line didn't save. Gmail sync is not in the current work queue, so this can wait — but if Gmail-related work starts, verify the secret is present first.

### 3.4 Uncommitted working-tree state

```
M dashboard.html                  (timestamp-only diff, safe to discard or recommit)
?? 100+ untracked files           (all gitignored by design)
```

See §9 for full `git status --short` output.

---

## 4. In-Progress Work

**None.** All five recommendations closed out. The TaskList reflects this:

- #11, #12, #14, #15: completed
- #13: completed (embeddings done)

If the next session wants a new scope, the user has historically asked "what are the recommendations" next — prepare a prioritized list from the "TODO items" section below.

---

## 5. Blockers Discovered (and their resolutions)

### 5.1 OpenAI 429 quota exceeded (RESOLVED)
- **Symptom:** First embed pass produced `0/711 pages, 0 chunks embedded` with every page logging `429 You exceeded your current quota`. `grep` on `.env` confirmed `OPENAI_API_KEY=[164 chars]` was present — so the key was valid, but the account had no credits.
- **Resolution:** User added prepaid credits at https://platform.openai.com/account/billing (session spent ~$0.02 on the final run).
- **Lesson:** New OpenAI projects start at $0 credit balance. "API key provisioned" ≠ "account funded." If any future session hits 429 quota error on this key, tell the user to top up credits before retrying.

### 5.2 Bash `run_in_background` vs `| tail -N` trap (RESOLVED by rerunning without tail)
- **Symptom:** First attempt ran `bun ... embed --all 2>&1 | tail -20` to a background task. Output file remained 0 bytes for 20 minutes even though the process was burning through pages (and hitting 429s). `| tail -20` buffers stdin until EOF, so nothing rendered until process exit.
- **Resolution:** Re-run without `| tail`: `bun run vendor/gbrain/src/cli.ts embed --all > /tmp/embed-run.log 2>&1` with `run_in_background: true`. This worked because the final run was fast (credits present) and finished before the timeout fired. Task completion notification arrived cleanly.
- **Lesson:** Never pipe long-running commands through `tail -N` when you need live progress. Redirect to a log file instead and read it periodically.

### 5.3 Dashboard showed 31 apps, applications.md had 42 (RESOLVED)
- **Root cause:** `parseApplicationsTracker` in `scripts/lib/career-data.mjs:25-47` iterates rows after the header and breaks on the first line that doesn't start with `\|`. Someone (merge-tracker.mjs or a manual edit during an earlier session) had appended rows 032-042 below an HTML comment + `---` + footer attribution text, so the loop saw only rows 001-031.
- **Resolution:** Moved the 11 rows back into the main table body between row 031 and row 001, pushed the HTML comment and footer to the actual bottom of the file. Verified parser now returns 42; dashboard regenerated to "42 applications over…"; committed `dashboard.html` as `da14a49`.
- **Lesson for future sessions:** `data/applications.md` is gitignored. If a user asks "why does the dashboard show the wrong number," run `node -e "import('./scripts/lib/career-data.mjs').then(m => { const s = m.buildApplicationIndex(process.cwd()); console.log(s.records.length); })"` to compare against raw row count `grep -c "^| [0-9]" data/applications.md`. If they diverge, inspect the file for lines that don't start with `\|` interleaved between data rows.
- **Optional hardening (not done):** Add a warning in `parseApplicationsTracker` when additional pipe-prefix rows are detected below the first non-pipe line. Would have caught this proactively. User was offered this; didn't take it.

---

## 6. Key Decisions Made

### 6.1 Embedding model: `text-embedding-3-small` (gbrain default)
- 1536 dims. ~$0.00002 / 1K tokens.
- Total spend for this session: ~$0.02 for 2171 chunks across ~1M tokens.
- Not re-evaluated against `text-embedding-3-large` — small was gbrain's built-in default and session time was limited. If semantic search quality later proves insufficient, `embed --all` can be re-run with a model override (check `vendor/gbrain/src/cli.ts embed --help` for flag — I did not explore this).

### 6.2 Brain MCP transport: `bun run ... serve` (stdio JSON-RPC)
- No HTTP server. No network surface. All comms over child stdin/stdout.
- Protocol: MCP 2024-11-05, initialize → notifications/initialized → tools/list → tool calls.
- 30 tools exposed. Verified via a pipe smoke test in the prior session (see commit db95127 message).

### 6.3 Rows 032-042 keep their original numbers
- After merge-tracker dedup skipped some updates (score-drop rule), I manually edited `data/applications.md` rather than re-running merge-tracker. The "REMOVED 2026-04-10" comment was reworded to note reuse.
- Alternative considered: renumber the newer batch to 037-047. Rejected because all reports, outreach files, and brain slugs already bind to 032-042.

### 6.4 `data/applications.md` stays gitignored
- Treats personal application state as local-only data. This is the existing convention per `.gitignore` and prior CLAUDE.md guidance.
- Downside: the 31→42 parser-break fix was client-only; nothing in-repo guards against a future recurrence. Documented here as a known fragility.

### 6.5 Sequential execution, not parallel
- User directive: "do not proceed to the next task until the current task is validated and provide evidence of completion."
- I did NOT spawn parallel agents this session despite standing orders. Respected the user's stricter sequential gate.

### 6.6 Deferred item during blocker
- When #3 hit the OpenAI 429, I did NOT block on it indefinitely. I set Task #13 back to `pending` with a clear description of what needed to happen, and proceeded to #4 and #5. When credits arrived, #13 was re-opened and finished. This is the recommended pattern for environmental blockers.

---

## 7. TODO Items (Planned but Not Started)

These are items surfaced earlier but not executed. None are urgent.

### 7.1 Optional hardening
- **`parseApplicationsTracker` warn-on-drift:** Detect pipe-prefix rows below the first non-pipe line inside the table body and surface a warning. Prevents silent re-recurrence of the 31-vs-42 bug. ~10 LOC.
- **Stale-index warning is already surfacing** in SessionStart hook (`Indexed: 73 pages | Actual: 362 files WARNING: STALE INDEX`). The second-brain vault has drifted. Running `/vault-ingest` or similar is the fix; out of scope for career-ops proper.

### 7.2 Gmail sync
- `.env` missing `GOOGLE_CLIENT_SECRET`. User said they added it; spot-check failed. If/when Gmail sync work resumes, verify `.env` has both client ID AND secret before running anything under `scripts/gmail-recruiter-sync.mjs`.

### 7.3 Post-restart MCP validation
- User said they'll restart Claude Code to activate the brain MCP tools. When that happens, the first thing a new session should do is:
  1. Call `tools/list` (or equivalent discovery) to confirm the 30 brain tools appear
  2. Run a `search` tool call with a known query to confirm it returns ranked results
  3. If missing: check `bun` on PATH, check `vendor/gbrain/src/cli.ts` exists, re-run stats.
- A failure here probably means the MCP server couldn't spawn; likely Bun path or gbrain deps.

### 7.4 Dream cycle / warm-intro counts / Phase 5 markdown retirement
- These were scoped out of the prior session and remain out of scope.
- Dream cycle: nightly scheduled brain hygiene (reflect, re-link). Not wired.
- Warm-intro counts: needs a person-graph substrate richer than the single `person: 1` we have today.
- Phase 5 markdown retirement: destructive; waits for N-day dual-write drift validation.

### 7.5 Known bug not fixed
- HTML comment drift could recur if merge-tracker.mjs again writes below the footer. Not observed this session post-fix. If you see `data/applications.md` diff where new rows land after `---`, re-run the manual fix and consider the hardening from §7.1.

---

## 8. Full TaskList

| ID | Status | Subject |
|----|--------|---------|
| 11 | completed | #1 Evaluate 11 auto-promoted apps (#032-#042) |
| 12 | completed | #2 Type-separate reports (evaluation) from intel (company) in brain |
| 13 | completed | #3 Embed brain chunks via text-embedding-3-small — 2,171 chunks embedded; semantic search verified |
| 14 | completed | #4 Register brain as MCP server |
| 15 | completed | #5 Track .husky/pre-push |

No pending or in_progress tasks. If the next session opens new work, create fresh task IDs — do not reuse 11-15.

---

## 9. Git State (raw output, captured 2026-04-18 22:41 CDT)

### 9.1 `git branch --show-current`
```
master
```

### 9.2 `git log --oneline -20`
```
da14a49 fix(dashboard): regen to 42 apps after applications.md table repair
dbc49b9 chore(hooks): track pre-push hook
db95127 feat(mcp): register brain as project MCP server
9990582 fix(ops): track verify support modules
293bfbf feat(brain): type-separate evaluation + company pages
2901cc4 chore(dashboard): regen after 11 evaluations (#032–#042)
0ed7b24 fix(imports+validate): restore career-data helper + brain-sync validator
a159aaf feat(brain): phase 4 — log-response mirrors events to brain timeline
755880a feat(dashboard): brain stats tile + BRAIN_DISABLE gate
8c4b7e6 feat(brain): phase 2 shadow import — applications + links
135835e docs: gbrain integration plan (5-phase reassessment)
4db1d03 feat(dashboard): gmail-sync liveness tile at top of layout
6b9bf80 feat(dashboard): Next 5 Applications action card
e5e4533 feat(scoring): urgency multiplier based on JD close date
b29b454 feat(log-response): bulk entries + phone-screen/on-site event variants
eed1147 docs: implementation plan — top 10 ROI items after Tier 3 close-out
9dcbf92 fix(chrome-preflight): route wrapper cleanup logs to stderr
18ca946 docs: post-plan addendum — 6 Tier-3 commits + 98-card prefilter scoring
62cfe04 refactor(portals): expand locations[] variants in direct-board scans
84ed325 chore(scripts): add top-level test alias so pnpm test resolves
```

### 9.3 `git log origin/master..HEAD --oneline`
```
(empty — no unpushed commits)
```

### 9.4 `git diff --stat` (working tree vs HEAD)
```
 dashboard.html | 6 +++---
 1 file changed, 3 insertions(+), 3 deletions(-)
```
(Timestamp-only diff from pre-commit regen with different line endings. Safe to discard.)

### 9.5 `git diff --stat --cached` (staged vs HEAD)
```
(empty — nothing staged)
```

### 9.6 `git status --short` — all 108 entries

```
 M dashboard.html
?? .env.example
?? "MS Certification Planner_04.11.2026.html"
?? MS_Cert_Tracker_Ultimate_v3.2.html
?? "Master Career-Ops Build.MD"
?? career-dashboard.exe
?? config/narrative-audit-2026-04-10.md
?? dashboard/internal/data/automation_events.go
?? dashboard/internal/data/automation_events_test.go
?? data/apply-queue-audit.md
?? data/apply-runs/
?? data/brain-staging-intel/
?? data/brain-staging-people/
?? data/brain-staging-reports/
?? data/dedupe-intake-report.md
?? data/events/
?? data/index/
?? data/liveness-2026-04-14.md
?? data/outreach/c-h-robinson-senior-business-intelligence-developer.md
?? data/outreach/d-a-davidson-companies-ai-automation-engineer.md
?? data/outreach/datasite-vp-enterprise-data-architect.md
?? data/outreach/evereve-analytics-engineer-headquarters-edina-mn.md
?? data/outreach/legence-power-bi-data-engineer.md
?? data/outreach/lunds-byerlys-data-architect.md
?? data/outreach/me-global-inc-dba-me-elecmetal-business-intelligence-developer.md
?? data/outreach/mortenson-senior-finance-bi-developer.md
?? data/outreach/optum-ai-ml-engineer-python-agentic-ai-remote-nationwide-or-hybrid-in-mn-dc.md
?? data/outreach/optum-data-architect-minneapolis-mn.md
?? data/outreach/sidmans-inc-data-architect-local-to-mn-only.md
?? data/pipeline-prune-log.md
?? data/pipeline-raw-intake.md
?? data/resume-diff-2026-04-10.md
?? data/run-summaries/
?? data/scan-expansion-2026-04-10.md
?? data/scan-summary-2026-04-12.md
?? data/scan-summary-2026-04-13.md
?? data/scan-summary-2026-04-14.md
?? data/scan-summary-2026-04-15.md
?? data/scan-summary-2026-04-16.md
?? data/scan-summary-2026-04-17.md
?? data/scan-summary-2026-04-18.md
?? data/stale-alert-2026-04-14.md
?? data/stale-alert-2026-04-17.md
?? data/stale-alert-2026-04-18.md
?? docs/AI-SESSION-CONTINUITY-2026-04-16-night.md
?? docs/APPLICATION-RUNBOOK.md
?? docs/DATA-COMMITS.md
?? docs/GMAIL_SYNC_SETUP.md
?? docs/PIPELINE-TRIAGE.md
?? docs/STATUS-MODEL.md
```

(Full list continues with ~60 more untracked files under `scripts/`, `scripts/lib/`, `tests/`, and other gitignored paths. Tail of the list:)

```
?? scripts/gmail-recruiter-sync.mjs
?? scripts/lib/event-log-prune.mjs
?? scripts/lib/indeed-jk.mjs
?? scripts/lib/job-url-keys.mjs
?? scripts/lib/response-classifier.mjs
?? scripts/lib/resume-selector.mjs
?? scripts/lib/semantic-match.mjs
?? scripts/lib/tracker-report-keys.mjs
?? scripts/load-env.mjs
?? scripts/pipeline-hygiene.mjs
?? scripts/prune-automation-events.mjs
?? scripts/prune-pipeline-tracked.mjs
?? scripts/register-cadence-alert-task.ps1
?? scripts/register-evening-scan-task.ps1
?? scripts/register-gmail-sync-task.ps1
?? scripts/run-summary.mjs
?? scripts/scan-builtin.mjs
?? scripts/scan-dice.mjs
?? scripts/scan-remoteok.mjs
?? scripts/scan-remotive.mjs
?? scripts/scan-simplyhired.mjs
?? scripts/scan-weworkremotely.mjs
?? scripts/submit-dispatch.mjs
?? scripts/submit-icims.mjs
?? scripts/submit-workday.mjs
?? scripts/sync-apply-queue-audit.mjs
?? scripts/verify-all.mjs
?? tests/event-log-prune.test.mjs
?? tests/prune-pipeline-tracked.test.mjs
?? tests/scan-window.test.mjs
```

**Interpretation:** ALL 107 untracked entries are intentionally gitignored. This repo treats the vast majority of scripts, test files, scan outputs, outreach drafts, and docs as local-only. Earlier commits `9990582` and `0ed7b24` selectively promoted the few support modules needed for verify:ci to pass. Do not bulk-`git add -A` — it would commit hundreds of intentionally-local files and likely leak personal data.

### 9.7 gbrain state (not in git — lives at `C:\Users\mattm\.gbrain\brain.pglite\`)
```
Pages:     711
Chunks:    2171
Embedded:  2171   (was 0 at start of session)
Links:     42
Tags:      0
Timeline:  13

By type:
  company: 624
  evaluation: 44
  application: 42
  person: 1
```

---

## 10. Quick Reference for Next Session

### 10.1 Immediately on session start
1. Read this document first (`docs/AI-SESSION-CONTINUITY-2026-04-18-night.md`).
2. If this is the first session after the user's Claude Code restart: verify brain MCP tools loaded (see §7.3).
3. Check `.env` still has `OPENAI_API_KEY` (required for `embed` on any newly-imported pages).
4. Check `git status --short` — expect ~1 file (`dashboard.html` timestamp drift) + 100+ untracked (gitignored). Anything else is new and needs triage.

### 10.2 Useful commands (tested this session)
```bash
# Brain stats
bun run vendor/gbrain/src/cli.ts stats

# Semantic search
bun run vendor/gbrain/src/cli.ts search "<query>" --limit 5

# Re-embed everything (cost ~$0.02)
bun run vendor/gbrain/src/cli.ts embed --all

# Re-embed only new/changed pages
bun run vendor/gbrain/src/cli.ts embed --stale

# Verify pipeline integrity (55/55 tests)
pnpm run verify:ci

# Regenerate dashboard.html
node scripts/generate-dashboard.mjs

# Validate parser sees all rows
node -e "import('./scripts/lib/career-data.mjs').then(m => { const s = m.buildApplicationIndex(process.cwd()); console.log('rows:', s.records.length); });"
```

### 10.3 What to NEVER do
- Never bulk-`git add -A` — leaks local-only data.
- Never edit `.env` without reading it first and preserving existing keys.
- Never re-run `embed --all` unnecessarily — costs per run and rebuilds every vector. Use `embed --stale` for incremental.
- Never move rows in `data/applications.md` below the `---` footer line; the parser will go blind to them.
- Never skip hooks (`--no-verify`) — pre-push is now tracked and covers the whole team.

### 10.4 Pending user callbacks
- User added credits and confirmed embed success.
- User will restart Claude Code to activate brain MCP tools (this session concluded before the restart — tools are registered in `.mcp.json` but not loaded in-session).
- Possible missing `.env` key: `GOOGLE_CLIENT_SECRET` (user said added; grep disagreed). Surface if Gmail work comes up.

---

*End of handoff.*
