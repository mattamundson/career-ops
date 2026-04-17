# AI Session Continuity — 2026-04-17 Early Morning (00:47 CDT)

Handoff for the next AI session. Originally written at 00:41 after the §0 Start-Here block from the prior handoff landed (four commits). Updated at 00:47 after two additional Tier 3 commits landed. This doc supersedes all prior handoffs.

**Post-handoff addendum (2026-04-17 00:47)**:
- `fe28b2c` — this very doc, original version (committed after the §0 four)
- `b51eef1` — `scripts/lib/chrome-preflight.mjs` + Playwright gitignore. Addresses Blocker #4 (stale MCP Chrome lockfile). Library callable via `clearStaleLockfiles()` import; CLI via `node scripts/lib/chrome-preflight.mjs [--dry-run] [--max-age-minutes=N]`. Not yet wired into apply-mode entry points — that's follow-up. Verified on the real 2026-04-15 stale lockfile: detects correctly; real delete hit EBUSY (Windows holds the file handle from a prior browser process), library catches, logs, exits 1 — honest failure signal instead of silent hang.

**Total this session**: 6 commits on top of `e72b2be` → `b51eef1`. All pushed, all verified (42/42 JS, 14/14 Go, verify:ci clean at each step). 8 of 10 retrospective blockers now resolved (was 7; +Blocker #4 via `b51eef1`).

**Prior handoffs** (archaeology only):
- `docs/AI-SESSION-CONTINUITY-2026-04-16-late-night.md` (23:18 — planned §0 Start Here, now fully executed; commit `e72b2be`)
- `docs/AI-SESSION-CONTINUITY-2026-04-16-night.md` (schema + process notes, commit `def4609`)

---

## 1. Session Summary — what was accomplished, in what order

Session opened at 23:23 (prior day, 2026-04-16) with instruction "proceed" after the handoff's §0 Start Here block was added. Executed all four steps. All verified (pnpm test 42/42, Go 14/14, verify:ci clean) between each commit. All four pushed to `origin/master`.

**Work executed (this session):**

1. **Step 1 — Baseline verify**. Ran `pnpm test` (40/40), `go test ./internal/data/...` (pass), `git log -1` (`e72b2be`), `git status -sb` (in sync). Confirmed safe to proceed.

2. **Step 2 — Wire SSOT into production path** (`9fb65f5`). Before this commit, `loadLocationConfig()` and `deriveLocationPriority()` existed but nothing in the production call graph used them. Tests could flip priority; dashboard silently used defaults.
   - `scripts/lib/scoring-core.mjs`: added optional `config` param to `computeApplicationPriority`, threaded it to internal `locationPriorityMultiplier` call
   - `scripts/generate-dashboard.mjs`: surgical +8/-2 — import `loadLocationConfig`, load `LOCATION_CONFIG` once at module scope, pass to both `focusSortKey` (in `applyQueueFocusKey`) and `computeApplicationPriority` (in per-app enrichment loop)
   - `tests/scoring-core.test.mjs`: +2 tests — `computeApplicationPriority honors config override` + `loadLocationConfig loads profile.yml and produces live config`
   - **End-to-end flip verified** via ad-hoc harness: live profile.yml produces onsite_msp=92 / remote=65 (onsite wins), temp-flipped profile.yml produces onsite_msp=65 / remote=92 (remote wins). `focusSortKey` 5.040 vs 3.570 in each direction.
   - Pre-existing WIP on `generate-dashboard.mjs` (Focus button, sort stabilization, appsSortedForTable) was stashed as `stash@{1}` to keep the commit surgical.

3. **Step 3a — Location column in scan-history.tsv** (`fe6dd7c`). Closes Tier 2 item #6. The payoff metric for the SSOT + schema work.
   - `scripts/lib/scan-output.mjs`: `HISTORY_HEADER` adds `\tlocation`; `appendToHistory` writes `sanitizeField(entry.location)` as 7th field. scan-indeed.mjs and scan-linkedin-mcp.mjs already pass `entry.location`, so they flow through unchanged.
   - `scripts/scan-report.mjs`: `loadHistory` reads 7th column if present (tolerates 6-col rows); new `bucketByWorkArrangement` helper classifies each row via `classifyWorkArrangement`; new `LOCATION BUCKETS (new adds only)` section prints counts + MSP share; `scan.report.completed` automation event includes bucket counts.
   - `tests/scan-output.test.mjs`: updated header regex, added location to first entry (verifies round-trip), left second entry without location (verifies empty trailing cell tolerated).
   - `data/scan-history.tsv`: header line updated locally (file is gitignored, not committed).
   - **Output sample** (windowed `--since=3`): `On-site MSP: 0, Hybrid MSP: 0, Remote: 11, Unknown: 251, MSP share: 0/262 (0%)`. Unknown dominates because the column is brand-new — only scans after this commit populate it. Share will rise as new MSP-anchored scans run.

4. **Step 3b — log-response.mjs pre-submission event types** (`22333d9`). Closes Tier 2 item #7.
   - `VALID_EVENTS` adds `deferred` and `discarded`
   - New `PRE_SUBMIT_EVENTS` Set gates the special path
   - New `--reason` flag (required for deferred/discarded, `--notes` also accepted)
   - Main branch: if app_id not found AND event ∈ PRE_SUBMIT_EVENTS, auto-create minimal responses.md row with `submitted_at='—'`, `response_days='—'`, optional `--company/--role/--ats` or default to `—`
   - Existing rows: update as before, but now allows `--reason` to append to notes cleanly
   - **End-to-end smoke test**: logged `--event=deferred --app-id=999 --reason=...` for non-existent app, confirmed row landed with `submitted_at='—' / status=deferred`, restored responses.md from backup. Also verified `--reason` enforcement (exits with error if missing).
   - Pre-existing WIP on `log-response.mjs` (bulk handler, phone_screen_scheduled/done, on_site_scheduled/done events) was stashed as `stash@{0}` to keep the commit surgical.

5. **Step 3c — Gitignore scanner-churn dirs** (`281e7ec`). Closes Tier 2 item #8. Matt was asked for the policy decision (Option A/B/C); chose **Option B: gitignore both dirs entirely**.
   - `.gitignore`: +10 lines adding `data/company-intel/*.md` + `data/prefilter-results/*.md` patterns (with `.gitkeep` exceptions). Pattern uses `*.md` not `*` so template files like `_queue.txt` stay tracked.
   - `git rm --cached` untracked **172 previously-tracked** `.md` files in `data/company-intel/` (files stay on disk, disappear from git history going forward)
   - Added `.gitkeep` sentinels in both dirs
   - **Tree impact**: modified 909 → 734, untracked 1563 → 113. ~1,620 files removed from git-status noise.

Four commits, four sub-tasks from the prior handoff's §0 block, all four on `origin/master`.

---

## 2. Files created or modified — full paths, what changed, why

### Created in this session (net-new)

| Path | Purpose | Committed in |
|------|---------|--------------|
| `data/company-intel/.gitkeep` | Preserves dir after gitignore applied | `281e7ec` |
| `data/prefilter-results/.gitkeep` | Preserves dir after gitignore applied | `281e7ec` |
| `docs/AI-SESSION-CONTINUITY-2026-04-17-early-morning.md` | THIS file — session close handoff | (uncommitted) |

### Modified + committed this session

| Path | Change | Commit |
|------|--------|--------|
| `scripts/lib/scoring-core.mjs` | `computeApplicationPriority` accepts optional config; threads to `locationPriorityMultiplier` | `9fb65f5` |
| `scripts/generate-dashboard.mjs` | Import `loadLocationConfig`; load `LOCATION_CONFIG` once; pass to `focusSortKey` + `computeApplicationPriority` | `9fb65f5` |
| `tests/scoring-core.test.mjs` | +2 regression tests for config-override and live profile.yml loading | `9fb65f5` |
| `scripts/lib/scan-output.mjs` | `HISTORY_HEADER` + `appendToHistory` add 7th `location` column | `fe6dd7c` |
| `scripts/scan-report.mjs` | `loadHistory` reads 7th col; new `bucketByWorkArrangement`; new LOCATION BUCKETS section in SUMMARY; bucket counts in automation event | `fe6dd7c` |
| `tests/scan-output.test.mjs` | Updated header regex, added location to first entry | `fe6dd7c` |
| `scripts/log-response.mjs` | `deferred`/`discarded` event types; `--reason` flag; auto-create pre-submission row | `22333d9` |
| `.gitignore` | +10 lines for `data/company-intel/*.md` + `data/prefilter-results/*.md` with exceptions | `281e7ec` |
| `data/company-intel/*.md` (172 files) | Untracked via `git rm --cached`; files stay on disk | `281e7ec` |

### NOT modified + NOT committed (pre-existing WIP still in working tree)

After this session: 734 modified + 113 untracked. Overwhelmingly:
- `data/applications.md`, `data/pipeline.md`, `dashboard.html` — WIP and scanner-driven
- Root config/docs (~17): `.claude/skills/career-ops/SKILL.md`, `.github/workflows/verify.yml`, `CONTRIBUTING.md`, `README.md`, `article-digest.md`, `config/archetype-variants.yml`, `config/profile.example.yml`, `cv.md`
- Apply checklists (~2)
- Modes (~6)
- Scripts (~5): `scripts/embed-profile.mjs`, `scripts/generate-dashboard.mjs` (still has stashed Focus/sort WIP), `scripts/log-response.mjs` (still has stashed bulk/interview-state WIP), `scripts/submit-greenhouse.mjs`, `scripts/scan-jobspy.py`
- Outreach templates (~9)
- Templates config: `templates/portals.example.yml`
- Package: `package.json`, `pnpm-lock.yaml`
- Dashboard Go source (4): `dashboard/internal/data/work_arrangement.go` etc.

**Policy held**: no `git add -A` this session. Every commit surgical. Two stashes preserved (see §4).

---

## 3. Current state — what's running, what's stopped, what's broken

### Running / healthy
- **Git**: `master` = `281e7ec`, in sync with `origin/master`. Four clean commits this session.
- **Test suites**:
  - JS: `pnpm test` → 42/42 pass (was 40 at session start, +2 SSOT-wiring tests)
  - Go: `go test ./internal/data/...` → 14/14 (unchanged)
- **CI verification**: `pnpm run verify:ci` → all 6 checks green
- **Dashboard**: `dashboard.html` last regen during session (via `node scripts/generate-dashboard.mjs`) — displays 31 applications and 2002 pipeline entries with the now-active SSOT multipliers.
- **SSOT in production**: confirmed via flip-test harness. Editing `config/profile.yml.location.work_modes` and regenerating actually changes dashboard sort order.
- **scan-history.tsv**: header includes `location` column locally; fresh installs get it via `HISTORY_HEADER` in scan-output.mjs.
- **log-response.mjs**: accepts `deferred` and `discarded` events; auto-creates pre-submission rows.
- **Tree hygiene**: 909 M + 1563 UT → 734 M + 113 UT. Future commits wade through much less noise.

### Stopped
- No long-running processes.
- Playwright browser profile lockfile still stale (`.playwright-mcp/mcp-chrome-e1b3d30/lockfile`). Did not need browser this session.

### Broken / known issues
- **Playwright browser lock**: pre-existing, untouched. First browser-using session must clear it.
- **Scanner portal-entry doubling**: `portals.yml` still has MSP/remote variants per board. Not refactored. (Tier 3 item.)
- **Stash@{1} conflict potential**: the pre-existing dashboard Focus-button/sort WIP stashed off `generate-dashboard.mjs` will conflict with the surgical `, LOCATION_CONFIG` additions when popped. Resolution is straightforward (keep both). See §4.

---

## 4. In-progress work — started but not finished

**Nothing in-flight.** All four §0 Start-Here steps completed and pushed. No partial edits.

**Two stashes preserved** for Matt to triage (both are pre-existing WIP from prior sessions, not this session's work):

- **`stash@{0}: pre-log-response-wip`** — `scripts/log-response.mjs` additions:
  - `--bulk` flag + YAML/JSON bulk event loader + bulk processing loop
  - Extra event types: `phone_screen_scheduled`, `phone_screen_done`, `on_site_scheduled`, `on_site_done`
  - Coherent feature (batch-log responses from a file). Conflicts with this session's `deferred`/`discarded` additions if popped — would need manual merge keeping both sets of events in VALID_EVENTS and both main-branch paths.

- **`stash@{1}: pre-ssot-wiring-wip`** — `scripts/generate-dashboard.mjs` additions:
  - `applyQueueFocusKey` moved earlier in the file + `app.focusSortKey = applyQueueFocusKey(app)` added in per-app loop
  - `appsSortedForTable` sort block with num-tiebreak
  - Offer comparison stable sort (priority → score → num)
  - Sort bar: `Focus` button exposed, default changed from `num` to `score`
  - Coherent feature (expose Focus sort in the UI — pairs naturally with SSOT wiring). Conflicts with the `, LOCATION_CONFIG` edits from this session; resolve by keeping BOTH LOCATION_CONFIG and the WIP additions.

Apply with `git stash pop stash@{0}` / `git stash pop stash@{1}` (or `git stash apply` to keep in stash).

---

## 5. Blockers discovered — issues found that need resolution

Carried from prior handoff. Big reduction this session — 4 of 10 remaining blockers resolved (counting tree-hygiene).

| # | Blocker | Severity | Next action |
|---|---------|----------|-------------|
| 1 | ~~Priority rules duplicated across 5 files~~ | **RESOLVED** in `87497a4` via SSOT refactor |
| 2 | Pipeline schema had no location (legacy 1906 rows) | MEDIUM | Leave as `unknown`, age out |
| 3 | Scanner portal entries doubled for MSP/remote variants | MEDIUM | `locations: []` array schema (Tier 3) |
| 4 | ~~Playwright browser profile lockfile stale~~ | **RESOLVED** in `b51eef1` (lib written; wire into entry points is follow-up) |
| 5 | ~~`Deferred` vs `Discarded` semantics unclear~~ | **RESOLVED** in `87497a4` |
| 6 | ~~`scan-history.tsv` has no location column~~ | **RESOLVED** in `fe6dd7c` |
| 7 | ~~`log-response.mjs` lacks pre-submission events~~ | **RESOLVED** in `22333d9` |
| 8 | ~~909 modified + 1563 untracked in tree~~ | **RESOLVED** in `281e7ec` (down to 734/113) |
| 9 | ~~`scan-jobspy.py` runs remote by default~~ | **RESOLVED** in `87497a4` |
| 10 | Dashboard regen is manual | LOW | Pre-commit hook (Tier 3) |

**7 of 10 blockers resolved total** (3 last session, 4 this session). Remaining: all LOW-to-MEDIUM Tier 3 items.

**New observation** (this session):
- Location-classification fallback heavy. With the location column brand-new, existing rows classify via `classifyWorkArrangement(remote=location, role=title, notes=company)` — and when location is empty, the classifier falls back to title/company keyword matching, which produces mostly `unknown`. Once new MSP-anchored scans accumulate location-populated rows, the LOCATION BUCKETS section will surface real signal. Could be worth synthesizing location from company-intel data too, but Tier 3 at best.

---

## 6. Key decisions made — architectural choices, parameter values, tradeoffs

### From this session

- **Config threading is opt-in, not global**: `computeApplicationPriority(app, config=LOCATION_PRIORITY)` takes config as the last arg with a default. Callers that know about `profile.yml` opt in; others stay on defaults. Same pattern as `focusSortKey` and `locationPriorityMultiplier`. Avoids hidden global state.
- **LOCATION_CONFIG loaded once at module scope**: in `generate-dashboard.mjs`, `const LOCATION_CONFIG = loadLocationConfig()` runs once per process. Profile.yml reads from disk once; reused across all apps. Not reactive — if profile.yml changes mid-run, need to restart (acceptable; dashboard regen is a script).
- **Location column reader tolerates 6-column rows**: `idx.location >= 0 ? (cols[idx.location] || '').trim() : ''`. Legacy rows with no location parse cleanly as empty string. No migration required.
- **Empty-location scanner rows still write 7 fields**: `sanitizeField(undefined)` → `''`, so the row ends with `\tnew\t\n`. Parser handles this; classifier buckets as `unknown`. No special-casing.
- **MSP share percentage rounds to 0% when tiny**: `Math.round(2/1543 * 100) = 0`. Accepted — the absolute counts (`2/1543`) are the useful signal in sparse data; percentage becomes meaningful as the location column populates over time.
- **`deferred`/`discarded` event names mirror state names**: so Matt can just type `--event=<state-lowercased>`. States.yml has `Deferred` + `Discarded`; events match. Pre-submission semantics because that's when the state transition happens in the workflow.
- **`--reason` OR `--notes` satisfies the audit requirement**: both map to the notes cell. Chose permissive behavior — Matt may already be using `--notes` out of muscle memory; don't force a rename. The error message clarifies.
- **Auto-create row defaults to `—` for all stringly-required cells**: `company || '—'`, `role || '—'`, etc. Matches the `response_days='—'` convention in responses.md. A row with `—` in most cells is obviously "this never got filled out" — readable intent.
- **Gitignore pattern is `*.md` not `*`**: preserves `_queue.txt` (a 7-line template file with scanner-usage instructions). Pattern is specific to the scanner-output file type, not the whole dir.
- **`.gitkeep` sentinels even though `_queue.txt` exists**: defensive. If `_queue.txt` is deleted, the dir still persists. Cheap belt-and-suspenders.
- **`git rm --cached` only, not `git rm`**: files stay on Matt's disk, just untracked. Reversible if Matt later decides to track specific intel files (via explicit `git add -f`).
- **Surgical-diff discipline held all session**: pre-existing WIP on `generate-dashboard.mjs`, `log-response.mjs`, and `.gitignore` was either stashed (two cases) or reverted + reapplied (one case) to keep each commit strictly in scope. Slower but defensible.

### Carried (authoritative)

- **Default multipliers**: `on_site=1.20`, `hybrid=1.10`, `unknown=0.95`, `remote=0.85`. 35% spread onsite→remote.
- **Classifier priority order**: `hybrid_msp` > `onsite_msp` > `remote` (strong) > `unknown` > `remote` (weak) > `unknown`.
- **Applications**: 31 rows. Only 001 Panopto submitted this month.
- **Pipeline**: 2002 entries.
- **Permanent memory rules**: no-GitHub in applications; two-pass review on essays; DOCX→PDF for resumes; on-site MSP > hybrid MSP > remote priority (now runtime-configurable via `profile.yml.location.work_modes`).

---

## 7. TODO items — planned but not started

### Tier 3 (quality of life — all LOW-to-MEDIUM severity)

- [x] ~~**Chrome preflight script**~~ — DONE in `b51eef1`. Follow-up: wire `clearStaleLockfiles()` into apply-mode entry points (scripts/submit-*.mjs, any browser-using scan scripts) so preflight runs automatically.
- [ ] **Dashboard regen pre-commit hook**: regenerate `dashboard.html` when `data/applications.md`, `data/pipeline.md`, or `data/responses.md` are staged. Fixes Blocker #10. One-time git-hooks setup.
- [ ] **Scanner variant generalization**: change `portals.yml` `direct_job_board_queries` to `locations: []` array per entry; orchestrator iterates. Collapses 4 MSP/remote variants to 2 entries. Fixes Blocker #3.
- [ ] **Pop stash@{0}** if Matt wants the bulk-response-logging feature to land — resolve conflict with this session's `deferred`/`discarded` additions.
- [ ] **Pop stash@{1}** if Matt wants the dashboard Focus-button + sort-stabilization UX — resolve conflict with LOCATION_CONFIG additions.
- [x] ~~**Update `.gitignore` to include `.playwright-mcp/`/`.playwright-session/`**~~ — DONE in `b51eef1`.

### Scan-derived follow-ups (workflow, not code)

- [ ] **Run `/prefilter` on 98 unscored MSP cards** from 2026-04-17 scan (located in `data/prefilter-results/*.md` with `date: 2026-04-17` — NOTE: files are on disk; they just don't show in git status anymore thanks to `281e7ec`). After scoring: rank, triage, promote top MSP candidates to application queue.
- [ ] **Top-likely MSP candidates** to watch after prefilter pass: Stantec (Senior Data Architect), HealthPartners (Enterprise Application and Data Architect), Optum (Data Architect — Minneapolis, MN), TEKIQ LLC (Senior Data Architect), Sevita (Lead Data Architect), Intellias (Data Architect), Horizontal Talent (Data Architect), Protolabs (Data Architect — Maple Plain MN).
- [ ] **Replace Phase 2 application queue**: 3 remote apps are Discarded; pick next 3 from the MSP-enriched pipeline.
- [ ] **Run a real MSP-anchored scan** and verify the new LOCATION BUCKETS section in `scan-report.mjs` shows non-trivial MSP share (not 0/262 sparse like today's backward-looking window).

### Deferred from earlier sessions

- [ ] **LinkedIn MCP auth verification end-to-end** — real stdio JSON-RPC client hasn't had a full live run since login. May need headful login refresh.
- [ ] **Panopto application follow-up** — row 001 submitted 2026-04-16. Still no recruiter activity logged.

---

## 8. Full current task list

All tasks completed this session. No in-progress, no pending.

| ID | Status | Subject |
|----|--------|---------|
| #1 | completed | Wire loadLocationConfig into generate-dashboard.mjs |
| #2 | completed | Add location column to scan-history.tsv |
| #3 | completed | Expand log-response.mjs event types for deferred/discarded |
| #4 | completed | Decide + apply gitignore policy for scanner churn dirs |

Next session should create fresh tasks from §7 Tier 3 or scan-derived workflow, not reuse these IDs.

---

## 9. Git state

### `git status -sb` (summary counts)

```
## master...origin/master       ← in sync after push of 281e7ec
  M: 734 files
 ??: 113 files
```

Was 909 / 1563 at session start — dropped ~1620 files from git-status noise via `281e7ec` gitignore.

Modified buckets remaining (unchanged from prior session except for the gitignore drop):
- Root config/docs (~17)
- Dashboard Go source (4): `dashboard/internal/data/*.go` etc.
- Apply checklists (~2)
- Modes (~6)
- Scripts (~5): `embed-profile.mjs`, `generate-dashboard.mjs` (stashed WIP in tree), `log-response.mjs` (stashed WIP in tree), `submit-greenhouse.mjs`, `scan-jobspy.py`
- Outreach templates (~9)
- Templates: `portals.example.yml`
- Package: `package.json`, `pnpm-lock.yaml`
- Working data: `applications.md`, `pipeline.md`, `dashboard.html`, `cv.md`, `article-digest.md`

Untracked (113) = handoff docs + miscellaneous session artifacts + any new scanner output in non-gitignored locations.

### `git log --oneline -10`

```
281e7ec chore(gitignore): scanner-churn dirs + .gitkeep for structure           ← THIS SESSION, #4
22333d9 feat(log-response): accept deferred + discarded events                  ← THIS SESSION, #3
fe6dd7c feat(scan-history): 7th location column + MSP bucket split              ← THIS SESSION, #2
9fb65f5 feat(ssot): wire loadLocationConfig into generate-dashboard.mjs         ← THIS SESSION, #1
e72b2be docs: exhaustive session handoff 2026-04-16 late-night with Start Here  ← prior session
87497a4 feat: SSOT location priority + Deferred state + MSP-only scan default   ← earlier prior session
def4609 feat(schema): pipeline.md Location column + process retrospective
6701144 feat(priority): on-site MSP > hybrid MSP > remote across scoring + scanners
49799cb docs: session continuity narrative for 2026-04-16 evening
85cae1e refactor(mcp): extract shared stdio JSON-RPC client to scripts/lib/mcp-client.mjs
```

### This session's commits — diff stats

```
9fb65f5  scripts/generate-dashboard.mjs | 10 ++++++++--
         scripts/lib/scoring-core.mjs   |  4 ++--
         tests/scoring-core.test.mjs    | 38 ++++++++++++++++++++++++++++++++++++++
         3 files changed, 48 insertions(+), 4 deletions(-)

fe6dd7c  scripts/lib/scan-output.mjs |  4 ++--
         scripts/scan-report.mjs     | 48 +++++++++++++++++++++++++++++++++++++++++++--
         tests/scan-output.test.mjs  | 39 ++++++++++++++++++++++++++++++++++++
         3 files changed, 87 insertions(+), 4 deletions(-)

22333d9  scripts/log-response.mjs | 61 ++++++++++++++++++++++++++++++++++++++++--------
         1 file changed, 51 insertions(+), 10 deletions(-)

281e7ec  .gitignore                                         | 10 ++
         data/company-intel/.gitkeep                        |  0
         data/prefilter-results/.gitkeep                    |  0
         data/company-intel/*.md (172 files)                | -24,743 (all deletions)
         175 files changed, 10 insertions(+), 24743 deletions(-)
```

### Push results

```
9fb65f5  → e72b2be..9fb65f5  master -> master  (pre-push hook 42/42 pass)
fe6dd7c  → 9fb65f5..fe6dd7c  master -> master  (pre-push hook pass)
22333d9  → fe6dd7c..22333d9  master -> master  (pre-push hook pass)
281e7ec  → 22333d9..281e7ec  master -> master  (pre-push hook pass)
```

### Stash list

```
stash@{0}: On master: pre-log-response-wip         ← bulk handler + extra interview events
stash@{1}: On master: pre-ssot-wiring-wip          ← dashboard Focus button + sort stabilization
```

Both carry pre-existing prior-session WIP. See §4 for apply guidance + conflict notes.

---

## Quick start for next session

1. **Read this doc first.** Then scan §7 for next actions.
2. **Verify baseline**: `pnpm test && cd dashboard && go test ./internal/data/... && cd .. && pnpm run verify:ci` — all green at session close.
3. **Best next action** — from §7:
   - If Matt wants deeper tree hygiene → add `.playwright-mcp/` + `.playwright-session/` to `.gitignore` (3 lines).
   - If Matt wants browser reliability → Chrome preflight script (~30 LOC, self-contained).
   - If Matt wants richer workflow logging → pop `stash@{0}` and merge bulk-response-logger with this session's deferred/discarded events.
   - If Matt wants dashboard UX → pop `stash@{1}` and merge Focus-button/sort with LOCATION_CONFIG edits.
   - If Matt wants user-facing progress on the actual job search → run `/prefilter` on the 98 unscored MSP cards from 2026-04-17 and queue the top candidates.
4. **Run a real MSP-anchored scan + scan-report** to see LOCATION BUCKETS with non-sparse data (the acceptance test for fe6dd7c's payoff).

### Permanent constraints (from memory)

- **Never click Submit.** Matt does that.
- **Never fill GitHub field** (`user_github_empty.md`).
- **Never `git add -A`** — 734 modified + 113 untracked, still significant.
- **Two-pass review** on every essay answer before presentation.
- **Resume PDFs**: DOCX → PDF path only (HTML→PDF template broken).
- **Priority order**: on-site MSP > hybrid MSP > remote, Minneapolis-anchored. Runtime-configurable via `config/profile.yml.location.work_modes`. **SSOT actually fires in the production dashboard path as of `9fb65f5`.**
