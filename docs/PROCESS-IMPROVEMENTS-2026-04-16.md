# Process Improvements — 2026-04-16

Written after the on-site-MSP-first pivot session. Each finding has a concrete next step, not just commentary. Intended to shorten the feedback loop the *next* time a priority constraint changes.

## 1. Priority rules drifted because there was no single source of truth

**What happened.** Work-mode priority lived implicitly in five places (scoring-core.mjs, work_arrangement.go, profile.yml narrative, portals.yml defaults, modes/scan.md). When Matt said "on-site MSP first," each place had to be touched by hand. One missed edit and the scanners would still favor remote — the priority would *look* applied in the dashboard while remote jobs kept flooding the pipeline from unchanged queries.

**Next step.** Make `config/profile.yml.location` the authoritative source. Every other file reads from it at runtime:
- `scoring-core.mjs` → load `work_modes` array and derive multipliers from ordering (first = 1.20, last = 0.85)
- `work_arrangement.go` → same, read from YAML at dashboard start
- Scanners → default location to `profile.yml.location.anchor_location`
- Remove hardcoded `1.20 / 1.10 / 0.95 / 0.85` constants from both classifiers

**Test.** Changing `work_modes: [remote, hybrid, on_site]` should flip priority order with zero other edits. Add a test that exercises this.

## 2. Pipeline schema had no location — MSP classification was blind

**What happened.** `pipeline.md` pending rows were `URL | Company | Title`. The classifier in `scoring-core.mjs` inspected only title text for geographic clues. Out of 1906 entries, maybe 4 had "Minneapolis" or "MN" in the title. The rest classified as `unknown` (not the scanner's fault — the signal was never written down).

**Fixed this session.** Schema extended to `URL | Company | Title [| Location]` (optional 4th column). Parsers updated: `scan-output.mjs`, `prefilter-pipeline.mjs`, `scan-report.mjs`, `scan-jobspy.py`. 96 new MSP entries now carry "Minneapolis, MN" or "Maple Plain, MN" etc. — classifier can actually see geography.

**Remaining gap.** The 1906 pre-existing entries still have no location. Two options:
- (a) Leave them as `unknown` and let them age out. Cheap.
- (b) Backfill with a one-shot WebFetch per URL. Expensive (1906 round trips), and many URLs are already dead.

Recommendation: **(a)** — don't backfill, let the window roll forward. New entries get location; old ones get scored on title keywords only, which was already the status quo.

## 3. Scanner variants got doubled instead of generalized

**What happened.** `portals.yml` now has `indeed-msp` (enabled) + `indeed-remote` (disabled) + `linkedin-mcp-msp` + `linkedin-mcp-remote`. When priority changes again (say Matt decides Milwaukee hybrid is fine), we'd add `-mkehyb` variants. The config file grows linearly with the number of priority modes.

**Next step.** Change `direct_job_board_queries` schema so each entry takes a `locations: []` array instead of a single `location:`. The orchestrator iterates locations per entry. Collapses the 4 variants back to 2 entries. Priority shifts become a one-line YAML edit instead of 4-6.

## 4. Playwright browser profile lock was deferred but still lurking

**What happened.** During session start, `browser_navigate` refused because `...mcp-chrome-e1b3d30/lockfile` was held. Investigation found a 0-byte lockfile from April 15. We bypassed it because the config sweep didn't need a browser.

**Next step.** Pre-flight script: before any MCP Chrome tool runs, check for a lockfile older than 1 hour and remove it (with logging). Put it in `scripts/lib/chrome-preflight.mjs` and call from apply-mode entry points. One-liner fix; current cost is "the next interactive apply session gets a mysterious block."

## 5. "Defer" and "Skip" meant different things to two sides of the conversation

**What happened.** When Matt pivoted priorities, Claude moved 3 remote apps to "deferred" (implicit: "pause, maybe revive later"). Matt then said explicitly "skip the three applications." Status moved from `GO` → `Discarded`. Two states existed; the first one had no canonical place in `templates/states.yml`.

**Next step.** Add a `Deferred` state to `templates/states.yml` with clear semantics ("priority blocked, revive if priority reverses"). Also document the difference from `Discarded` in the table. Ambiguity is the bug.

## 6. Scan-history TSV doesn't carry location either

**Observation.** `data/scan-history.tsv` has columns `url, first_seen, portal, title, company, status` — no location. The dashboard reports derive from it. MSP concentration metrics are unanswerable without location in history.

**Next step.** Append a 7th column (`location`) to the header + writer in `scan-output.mjs#appendToHistory`. Existing rows get an empty cell; readers tolerate it. Then `scan-report.mjs` can split SUMMARY into "MSP-bucket / hybrid-MSP / remote / unknown" counts — exactly what Matt needs to see whether the priority actually fired.

## 7. `log-response.mjs` rejects valid operational states

**What happened.** Tried to log `discarded` for a never-submitted app. Script rejected — valid events are submitted/withdrew/rejected/etc. Tried `withdrew`, also rejected because the app never appeared in responses.md. No path existed to log "priority reversal killed this queued app."

**Next step.** Add a `cancelled_pre_submit` event type. Accepts `app-id` rows that are not yet in responses.md. Reason field mandatory. Covers the whole class of "we decided not to send before sending."

## 8. `git status` at session start was 916 modified + 1,357 untracked

**Observation.** A session that should start with a clean slate starts 3 minutes in "assessing the tree." Almost all 916 files are company-intel markdown churn from background scanners. Every commit has to cherry-pick to avoid sweeping in noise.

**Next step.** Decide per-directory gitignore policy:
- `data/company-intel/*.md` — committed? gitignored? partial (tracked skeleton, gitignored content)? Pick one and commit a decision.
- `data/prefilter-results/` — same question.
- If committed: set up `scan-jobspy.py` and related scanners to auto-commit their output with a standard message, so the tree never accumulates.

Current state of 916 untracked files wastes 30s every session and makes targeted commits fragile.

## 9. The `--skip-remote` flag should be the default

**Observation.** We now run `python scripts/scan-jobspy.py --skip-remote --results=30` manually. Remote bucket is ranked last, so running it every time wastes LinkedIn / Indeed quota.

**Next step.** Flip the default: `scan-jobspy.py` runs MSP-only unless `--include-remote` is passed. One-line change. Saves roughly half the scan budget per run.

## 10. Dashboard regeneration is a manual ritual

**Observation.** After any data-file change, `dashboard.html` is stale until `node scripts/generate-dashboard.mjs` runs. No one remembers every time. Easy to ship PRs with stale dashboards.

**Next step.** Add a git pre-commit hook that regenerates `dashboard.html` when `data/applications.md`, `data/pipeline.md`, or `data/responses.md` are staged. One-time setup; zero future effort.

---

Ranked by payoff-to-effort: **#1** (single source of truth) > **#9** (default flip) > **#5** (Deferred state) > **#7** (cancelled_pre_submit event) > **#6** (location in TSV) > **#2** (location in schema — already done) > others.

The top three alone would have made this session's pivot a five-minute edit instead of an evening.
