# AI Session Continuity — 2026-04-16 Night (22:53 CDT)

Exhaustive handoff for the next AI session. Written at session close after the MSP-priority pivot and schema-extension work. This document is the single source of truth for resuming — read before doing anything else.

Prior session handoff: `docs/AI-SESSION-CONTINUITY-2026-04-16-evening.md` (commit `49799cb`). This document supersedes it.

---

## 1. Session Summary — what was accomplished, in what order

The session opened mid-conversation after an auto-compaction. Plan mode had produced a plan at `C:\Users\mattm\.claude\plans\bash-cd-c-users-mattm-thinkorswim-jarvi-radiant-metcalfe.md` to submit three Phase 2 applications sequentially (Aledade → Rescale → Agility Robotics). Then the user pivoted mid-plan.

**User's governing instructions in order:**
1. (Prior session) "All jobs should be based on my resume, priority focused on those that are on-site, hybrid, then remote last - all based on Minneapolis, MN across all job websites - save this permanent memory" — priority pivot
2. (Prior session) "Proceed with what you recommend" — authorized config sweep
3. (Prior session) "Proceed" — authorized commit + push (`6701144`)
4. **(This session)** "proceed with all recommended next steps, skip the three applications and tell me how we can improve this process"
5. **(This session)** "git push" — authorized push of `def4609`

**Work executed in order (this session only):**

1. **Pipeline schema — added optional Location column** (Task #11). Updated 4 parsers/writers:
   - `scripts/lib/scan-output.mjs` — `appendToPipeline` now writes `| Location` as optional 4th column when `entry.location` is present.
   - `scripts/prefilter-pipeline.mjs` — parse regex extended from 3-group to 4-group with optional location.
   - `scripts/scan-report.mjs` — `loadPipelinePending` regex updated to 4-group.
   - `scripts/scan-jobspy.py` — `_pipeline_row` helper appends location (pipes replaced with `/`, newlines stripped).
2. **Parser sweep** — verified schema-agnostic parsers don't need changes: `scripts/dedupe-pipeline-md.mjs` (URL-only regex), `scripts/prune-pipeline-tracked.mjs` (URL-only), `scripts/dedupe-intake-vs-tracker.mjs` (parses applications.md not pipeline.md).
3. **Legacy scanners identified** — `scan-otta.mjs`, `scan-keyvalues.mjs`, `scan-hired.mjs` write a DIFFERENT markdown-link format `- [title](url) — loc (source)` bypassing the `- [ ]` checkbox schema. Orthogonal to this work; noted but not touched.
4. **Tests + verify** — `pnpm test` (37/37 pass), `pnpm run verify:ci` (pipeline clean, CV sync OK, 31 apps / 1906 → 2002 pipeline items, dashboard regen, events JSONL OK).
5. **Broader MSP scan** (Task #12). Ran `python scripts/scan-jobspy.py --skip-remote --results=30`. 96 new MSP-anchored entries added to `data/pipeline.md` with Location column populated. 98 prefilter cards generated.
6. **Dashboard regeneration** (Task #13). `node scripts/generate-dashboard.mjs` → `dashboard.html` shows 31 apps / 2002 pipeline items.
7. **Process improvements** (Task #14). Wrote `docs/PROCESS-IMPROVEMENTS-2026-04-16.md` — 10 findings ranked by payoff-to-effort.
8. **Commit + push**. Commit `def4609` on master, pushed to `origin/master`.

---

## 2. Files created or modified — full paths, what changed, why

### Created in this session (net-new)

| Path | Purpose |
|------|---------|
| `docs/PROCESS-IMPROVEMENTS-2026-04-16.md` | 10 ranked process findings from the MSP pivot session |
| `docs/AI-SESSION-CONTINUITY-2026-04-16-night.md` | THIS file — session close handoff |

### Modified + committed in `def4609` (this session)

| Path | Change | Why |
|------|--------|-----|
| `scripts/lib/scan-output.mjs` | `appendToPipeline` appends `\| Location` when `entry.location` present (line ~44-50) | Lets new scanner output flow location info into pipeline.md so MSP classifier can see geography |
| `scripts/prefilter-pipeline.mjs` | Parse regex widened to 4 capture groups: `^-\s+\[\s\]\s+(url)\s*\|\s*(company)\s*\|\s*(title)\s*(?:\|\s*(location))?$`. `entries.push({...location})` | Read location from enriched schema without breaking 1906 legacy 3-col rows |
| `scripts/scan-report.mjs` | `loadPipelinePending` regex updated to match 4 groups with optional location (line 204) | Same as above |
| `scripts/scan-jobspy.py` | Added `_pipeline_row(e)` helper; loop writes `row = f"- [ ] {url} \| {company} \| {title}"` + optional `\| {location}` | New JobSpy entries get Location column (all 96 new rows carry "Minneapolis, MN" etc.) |

### Modified but NOT committed (part of the 911-modified working tree)

These were already dirty at session start — left untouched to avoid mixing user WIP into my commits:
- `data/applications.md` — rows 017/023/025 flipped GO → Discarded in a prior session
- `data/pipeline.md` — prior session already has 96 new entries written (now 2002 total rows)
- `data/scan-history.tsv` — prior session scanner output
- `dashboard.html` — regen in this session (+4023/-1732 lines), but also contains prior-session changes
- `data/company-intel/*.md` (~500 files) — background scanner churn from before session
- `data/prefilter-results/*.md` (~400 files) — new prefilter cards from scan + prior session
- ~15 other root config/docs files

### Untracked (NOT added)

1,562 untracked paths — mostly `data/company-intel/*.md` and `data/prefilter-results/*.md` from background scanners.

---

## 3. Current state — what's running, what's stopped, what's broken

### Running / healthy
- **Git**: clean commit graph, `master` = `def4609`, pushed to `origin/master` (matches).
- **Test suite**: `pnpm test` 37/37 pass.
- **Pipeline health**: `pnpm run verify:ci` green across all 6 checks.
- **Dashboard**: `dashboard.html` freshly regenerated; 31 apps, 2002 pipeline items.
- **Scanners**: JobSpy (Python), Indeed (Playwright), LinkedIn MCP (stdio JSON-RPC), direct board scanners — all operational.

### Stopped
- No long-running processes.
- Playwright MCP browser profile locked on first session start (see §5).

### Broken / known issues
- **Playwright browser lock**: `...mcp-chrome-e1b3d30/lockfile` is 0-byte and stale (from 2026-04-15). Any `browser_navigate` call in next session will fail until removed. Workaround: delete the lockfile OR use `--isolated`. Not fixed this session because config work didn't need browser.
- **log-response.mjs gaps**: rejects `discarded` as event type; applications never submitted can't be logged. See process notes #7.
- **states.yml ambiguity**: `Deferred` vs `Discarded` not distinguished. See process notes #5.
- **TSV missing location**: `data/scan-history.tsv` has no location column; MSP concentration metrics unanswerable from history alone.

---

## 4. In-progress work — started but not finished

**Nothing.** All tasks #10-#14 marked completed. Commit landed clean on origin.

---

## 5. Blockers discovered — issues found that need resolution

Each is documented in detail in `docs/PROCESS-IMPROVEMENTS-2026-04-16.md`. Summary with severity:

| # | Blocker | Severity | Next action |
|---|---------|----------|-------------|
| 1 | Priority rules duplicated across 5 files (no single source of truth) | HIGH — the original cause of the MSP pivot's complexity | Centralize in `profile.yml.location.work_modes`; derive multipliers at runtime |
| 2 | Pipeline schema had no location (now fixed going forward, not backfilled) | MEDIUM | Leave 1906 legacy rows as `unknown`; let them age out |
| 3 | Scanner portal entries doubled for MSP/remote variants | MEDIUM | Change `direct_job_board_queries` schema to `locations: []` array |
| 4 | Playwright browser profile lockfile stale | LOW but annoying | Add `scripts/lib/chrome-preflight.mjs` to remove lockfiles older than 1hr |
| 5 | `Deferred` vs `Discarded` semantics unclear in states.yml | LOW | Add `Deferred` state with explicit "revive if priority reverses" semantics |
| 6 | `scan-history.tsv` has no location column | MEDIUM | Add 7th column + update scan-report.mjs to split SUMMARY by bucket |
| 7 | `log-response.mjs` lacks pre-submission events | LOW | Add `cancelled_pre_submit` event type |
| 8 | 911 modified + 1562 untracked in tree — commits are fragile | HIGH cumulative | Decide gitignore policy for `data/company-intel/` + `data/prefilter-results/` |
| 9 | `scan-jobspy.py` runs remote pass by default | LOW | Flip to `--skip-remote` default; add `--include-remote` flag |
| 10 | Dashboard regen is manual | LOW | Add git pre-commit hook |

**Ranking by payoff-to-effort**: #1 > #9 > #5 > #7 > #6 > #2 (done) > #8 > #10 > #4 > #3.

---

## 6. Key decisions made — architectural choices, parameter values, tradeoffs

### From this session

- **Schema extension is optional, not required.** The Location column is a 4th pipe-delimited field appended only when present. Legacy 3-column rows remain readable. No migration of the 1906 existing rows — rationale: cheaper to let them age out than backfill with 1906 WebFetches against partly-dead URLs.
- **Regex strategy**: `(?:\|\s*(.+?)\s*)?$` rather than an eager `(.+)`, to avoid swallowing Location into Title on 3-col rows.
- **Commit scope discipline**: only committed the 4 scripts + 1 doc + 1 new lib file I touched. Did NOT sweep the 911 pre-existing modified files. Rationale: those are background scanner output + prior WIP from earlier sessions; including them dilutes the schema-change commit.
- **Process doc placement**: `docs/PROCESS-IMPROVEMENTS-2026-04-16.md` (not in a new `docs/retrospectives/` dir) — matches existing convention where `docs/` is flat.
- **Task 13 scope limited**: "regenerate dashboard + commit follow-ups" was interpreted as regen + commit THIS session's work, not attempt to commit the 911-file WIP tree. Rationale: user's prior "never `git add -A`" rule in CLAUDE.md.

### Carried from prior session (still authoritative)

- **MSP priority multipliers**: 1.20 (onsite_msp), 1.10 (hybrid_msp), 0.95 (unknown), 0.85 (remote). 35% spread onsite→remote.
- **Classifier priority order** (scoring-core.mjs):
  ```
  if (mspLocal && hasHybrid) return 'hybrid_msp';
  if (mspLocal) return 'onsite_msp';
  if (strongRemote) return 'remote';
  if (hasHybrid || hasOnsite) return 'unknown';  // non-MSP physical → unreachable
  if (weakRemote) return 'remote';
  return 'unknown';
  ```
- **Three remote apps** (017 Rescale, 023 Aledade, 025 Agility): marked `Discarded` with note "DISCARDED 2026-04-16 — remote conflicts with new on-site-MSP-first priority". PDFs retained in `output/cover-letters/` for revival if priority reverses.
- **JobSpy two-pass**: MSP first (`location="Minneapolis, MN"`, `is_remote=False`), remote second. Skippable via `--skip-remote` / `--skip-msp`.
- **Gitignored personal data**: `config/profile.yml` + `portals.yml` are local-only; templates live in `config/profile.example.yml` + `templates/portals.example.yml`.

---

## 7. TODO items — planned but not started

From the process-improvements doc. Ordered by payoff rank.

### Tier 1 (do next — turn priority shifts into 5-minute edits)

- [ ] **Single source of truth**: Refactor `scoring-core.mjs` + `work_arrangement.go` to read `work_modes` array from `profile.yml` and derive multipliers. Remove hardcoded constants. Add test: flipping `work_modes` order flips priority.
- [ ] **`--skip-remote` default**: Change `scan-jobspy.py` default to MSP-only. Add `--include-remote` explicit flag. One-line change in argument parsing.
- [ ] **Add `Deferred` state** to `templates/states.yml` with semantics "priority blocked, revive if priority reverses". Document delta from `Discarded` in the table.

### Tier 2 (next sprint)

- [ ] **`cancelled_pre_submit` event** in `log-response.mjs`. Accept rows not yet in responses.md. Mandatory reason field.
- [ ] **Location column in scan-history.tsv**: append 7th column, update `scan-output.mjs#appendToHistory`, update `scan-report.mjs` to split SUMMARY by MSP/hybrid-MSP/remote/unknown buckets.
- [ ] **Gitignore policy**: decide on `data/company-intel/*.md` + `data/prefilter-results/*.md`. Either (a) commit skeleton, gitignore content, or (b) gitignore entirely. Commit the decision.

### Tier 3 (quality of life)

- [ ] **Chrome preflight**: `scripts/lib/chrome-preflight.mjs` to remove stale lockfiles. Call from apply-mode entry points.
- [ ] **Dashboard regen pre-commit hook**: regenerate `dashboard.html` when `data/applications.md`, `data/pipeline.md`, or `data/responses.md` are staged.
- [ ] **Scanner variant generalization**: change `direct_job_board_queries` to `locations: []` array to collapse the 4 MSP/remote variants back to 2 entries.

### Scan-derived follow-ups (from the 96 new MSP entries)

- [ ] **Run `/prefilter` on new MSP cards** (98 created 2026-04-17, unscored). Located in `data/prefilter-results/` — filter for date `2026-04-17`.
- [ ] **Evaluate top MSP candidates** once scored: likely hits include Stantec (Senior Data Architect), HealthPartners (Enterprise Application and Data Architect), Optum (Data Architect — Minneapolis, MN), TEKIQ LLC (Senior Data Architect), Sevita (Lead Data Architect), Intellias (Data Architect), Horizontal Talent (Data Architect), Protolabs (Data Architect — Maple Plain MN).
- [ ] **Phase 2 application queue re-ranking** — the 3 remote apps are now Discarded; identify next 3 Phase 2 candidates from the MSP-enriched pipeline.

### Deferred from prior sessions (still open)

- [ ] **LinkedIn MCP auth verification**: next full MCP scan run would validate the real stdio JSON-RPC client (commit `9a31254`) end-to-end. May need headful login refresh.
- [ ] **Panopto application follow-up**: row 001 was the only submission this month. Track recruiter response — no activity logged yet.

---

## 8. Full current task list

All tasks completed as of session close. None in-progress. None pending.

| ID | Status | Subject |
|----|--------|---------|
| #4 | completed | Split onsite from hybrid in scoring-core + Go twin |
| #5 | completed | Update profile.yml work-mode priority language |
| #6 | completed | Update scanner defaults to Minneapolis-anchored |
| #7 | completed | Update portals.yml with MSP-anchored queries |
| #8 | completed | Update modes/scan.md + prefilter-pipeline.mjs |
| #9 | completed | Verify + regenerate dashboard + rescan |
| #10 | completed | Mark 3 remote apps as Discarded in tracker |
| #11 | completed | Pipeline schema: add Location column |
| #12 | completed | Broader MSP scan (all 5 JobSpy boards) |
| #13 | completed | Regenerate dashboard + commit follow-ups |
| #14 | completed | Write process improvement notes |

Next session should create new tasks from the TODO list in §7 rather than reusing these IDs.

---

## 9. Git state

### `git status -sb` (summary)

```
## master...origin/master      ← in sync with origin after push of def4609
  M: 911 files
 ??: 1562 files (untracked)
```

Detailed modified files fall into these buckets:
- **Root config/docs** (~17): `.claude/skills/career-ops/SKILL.md`, `.github/workflows/verify.yml`, `.gitignore`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `article-digest.md`, `cv.md`, `dashboard.html`, `config/archetype-variants.yml`, `config/profile.example.yml`
- **Dashboard Go source** (1): `dashboard/internal/ui/screens/pipeline.go`
- **Apply checklists** (~2): `data/apply-checklist-2026-04-{09,10}.md`
- **Company intel** (~500): `data/company-intel/*.md` — background scanner output
- **Prefilter results** (~400): `data/prefilter-results/*.md` — mixed prior + today's 98 new cards
- **Modes** (~6): `modes/*.md` header/footer tweaks (minor)
- **Scripts** (~5): `scripts/embed-profile.mjs`, `scripts/generate-dashboard.mjs`, `scripts/log-response.mjs`, `scripts/submit-greenhouse.mjs`
- **Outreach templates** (~9): `templates/outreach/*/variant-*.md`
- **Templates config**: `templates/portals.example.yml`
- **Package**: `package.json` (+9 lines), `pnpm-lock.yaml` (+11)

Untracked files (1562) are overwhelmingly `data/company-intel/*.md` + `data/prefilter-results/*.md` + session handoff markdowns.

### `git log --oneline -20`

```
def4609 feat(schema): pipeline.md Location column + process retrospective    ← THIS SESSION (pushed)
6701144 feat(priority): on-site MSP > hybrid MSP > remote across scoring + scanners    ← prior session
49799cb docs: session continuity narrative for 2026-04-16 evening
85cae1e refactor(mcp): extract shared stdio JSON-RPC client to scripts/lib/mcp-client.mjs
9a31254 feat(scan-linkedin-mcp): real MCP stdio JSON-RPC client
9ec1438 fix(resolver): reject LinkedIn/Indeed auth-wall redirects instead of overwriting
1a8cf02 feat(scan): subset filter for direct scanners + env-var since-days + Firecrawl limit clamp
a260e7d feat(scan): integrate LinkedIn MCP + Indeed Playwright scanners + aggregator-URL resolver
a769d46 docs+ci: land operator surfaces and verify workflow
732c43d docs: AI session continuity narrative for 2026-04-12
8079ec4 docs: exhaustive session handoff 2026-04-12 with git artifacts
6e515c8 docs: note work-mode sort bias in profile example compensation copy
d782e91 feat: prioritize hybrid and MSP-local roles over remote in sorts
18bbe58 check
64ff445 commit all
5e11fe7 feat(submit-v14): profile-fields loader + Greenhouse batch submitter
71ec7b0 feat(scan-v14): add iCIMS, Workable, BuiltIn fetchers + WorkDay crash safety wrap
82cef5c feat(dashboard-v14): response tracker with daily goal, funnel, follow-up queue, channel performance
462c452 feat(intel): Agility Robotics comprehensive intel with verified Greenhouse API path
4707fd3 docs(status): add discovery findings to 2026-04-10 report
```

### `git diff --stat` (summary)

```
911 files changed, 7266 insertions(+), 2261 deletions(-)
```

The diff is dominated by `dashboard.html` (+4023/-1732 lines — from 1906→2002 pipeline rows rendered) and the `data/company-intel/` + `data/prefilter-results/` churn. The critical portion — scripts/modes/config — is relatively small:

```
 config/archetype-variants.yml                 |  53 +-
 config/profile.example.yml                    |   2 +-
 scripts/embed-profile.mjs                     |   4 +-
 scripts/generate-dashboard.mjs                | 59 +-
 scripts/log-response.mjs                      | 90 +-
 scripts/submit-greenhouse.mjs                 | 334 +-
 package.json                                  |   9 +-
 pnpm-lock.yaml                                |  11 +
 templates/portals.example.yml                 |   9 +
 (outreach variants + mode headers, ~3 lines each)
```

### `git push` result

```
To https://github.com/mattamundson/career-ops.git
   6701144..def4609  master -> master
```

Pre-push hook ran full test suite: 37/37 pass.

### Commit message for `def4609`

```
feat(schema): pipeline.md Location column + process retrospective

- scripts/lib/scan-output.mjs: appendToPipeline now writes "| Location"
  as optional 4th column when entry.location is present; legacy 3-col
  rows remain readable
- scripts/prefilter-pipeline.mjs: parse regex extended to 4 groups
  (url, company, title, optional location)
- scripts/scan-report.mjs: same 4-group regex in loadPipelinePending
- scripts/scan-jobspy.py: _pipeline_row helper appends location
  (pipes replaced with "/", newlines stripped)
- docs/PROCESS-IMPROVEMENTS-2026-04-16.md: 10 findings from the MSP
  priority pivot session, ranked by payoff-to-effort — top 3 would
  turn the next priority shift into a 5-minute edit

Verified: pnpm test (37/37 pass), pnpm run verify:ci (pipeline clean,
1906 → 2002 entries, dashboard regenerated).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Quick start for next session

1. **Read this doc first.** Then `docs/PROCESS-IMPROVEMENTS-2026-04-16.md`.
2. **Clear stale Chrome lock** if any browser work is planned: `rm ~/.cache/ms-playwright/mcp-chrome-e1b3d30/lockfile` (Unix path; Windows equivalent needed).
3. **Check pipeline health**: `pnpm run verify:ci` — should be green.
4. **List new MSP prefilter cards**: `node scripts/prefilter-pipeline.mjs --list | grep '2026-04-17'` — 98 unscored cards ready for `/prefilter` pass.
5. **Start with Tier 1 TODO** (#1 or #9) — highest payoff-to-effort.

### Critical constraints (permanent — from memory)

- **Never click Submit.** Matt does that.
- **Never fill GitHub field.** Matt's github.com/mattamundson is empty.
- **Never `git add -A`.** 911 modified + 1562 untracked in tree.
- **Two-pass review** on every essay answer before presenting.
- **Resume PDFs**: use DOCX→PDF path, not HTML-to-PDF (broken).
- **Priority**: on-site MSP > hybrid MSP > remote. Minneapolis-anchored.
