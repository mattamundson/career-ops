# Implementation Plan — Top 10 ROI Items (2026-04-17 12:53 CDT)

**Premise.** With the four Tier-3 follow-ups shipped (commits 9683213..9dcbf92), the next working session should compound on the apply-throughput + match-quality axes, not polish plumbing. These ten are ranked by (job-search impact) ÷ (build effort), MSP-first bias applied.

**Ordering rule.** Do not start task N+1 before task N's validation gate passes — same discipline as the prior plan. Tier A items are load-bearing; Tier B items can be reordered if a dependency surfaces.

**Constraints carried forward:**
- `data/prefilter-results/*.md`, `data/company-intel/*.md`, `data/applications.md`, `data/pipeline.md`, `data/scan-history.tsv` are gitignored — local only.
- MSP priority stays on-site > hybrid > remote (feedback_work_mode_priority.md).
- No submitter fires without human confirmation (CLAUDE.md ethical-use rule).
- 53/53 unit tests + verify:ci green at each validation gate.

---

## Tier A — Load-bearing (ship in order)

### Task 1 — Company-intel consumption in prefilter + evaluate (M)

**Problem.** `scripts/prefilter-pipeline.mjs` *generates* company-intel templates (172+ local `.md` files at `data/company-intel/`), but no mode reads them back at scoring time. Matt's prefilter agents re-research companies from scratch when the intel already exists on disk.

**Goal.** When a JD's company has an existing `data/company-intel/{slug}.md`, include its content as context in the prefilter scoring block and in `modes/evaluate.md` offer evaluation.

**Approach.**
- Add `loadCompanyIntel(slug)` helper in `scripts/lib/career-data.mjs` — returns file contents or null.
- Update `scripts/prefilter-pipeline.mjs` to inject intel into the template under a new `## Company Intel (from data/company-intel/)` block when present.
- Update `modes/prefilter.md` + `modes/evaluate.md` instructions: "If the JD template includes a Company Intel block, use it as authoritative context before the JD itself."
- Do **not** auto-summarize or truncate — intel files are already hand-curated.

**Validation gate.**
- Pick 3 existing intel files; regenerate their prefilter templates; confirm intel content is inlined.
- Pick one with no intel; confirm the template skips the block cleanly.
- `pnpm test` green.
- Commit: `feat(prefilter): inline company-intel content when available`.

**Files.** `scripts/lib/career-data.mjs`, `scripts/prefilter-pipeline.mjs`, `modes/prefilter.md`, `modes/evaluate.md`.

**Why it matters.** Match-quality ceiling lift. Matt has done the research once — re-reading 172 hand-written notes is a better signal than any LLM JD summary.

---

### Task 2 — Response-outcome feedback loop (M)

**Problem.** `response-classifier.mjs` + `log-response.mjs` track inbound replies and pre-submission decisions (`deferred`, `discarded` — shipped in 22333d9). Outcomes never flow back into `computeApplicationPriority`. The scorer doesn't know a company ghosts 100% of the time.

**Goal.** Derive a per-company + per-portal signal from `data/responses.md` + `data/applications.md` and apply it as a small multiplier in `computeApplicationPriority`. Reject-rate → downweight; response-rate → upweight. Cap the swing at ±15% so early noise doesn't dominate.

**Approach.**
- New `scripts/lib/outcome-signal.mjs`: reads `responses.md` + `applications.md`, groups by company slug and portal, emits `{ companyMultiplier, portalMultiplier, confidence }` per (company, portal) with confidence based on sample size.
- Wire into `computeApplicationPriority` as an optional `outcomeSignal` param — defaults to `1.0` when absent, preserving backward compat.
- Dashboard surfaces the multiplier in the app row's hover / detail view so Matt can see *why* a card sorted up or down.
- Tests: baseline signal = 1.0 when no data; rejection-heavy company gets ≤1.0; offer/interview company gets ≥1.0; confidence gate blocks signal at <3 samples.

**Validation gate.**
- `pnpm test` green (new tests pass + existing 53 stay passing).
- Ad-hoc: compute signal for top 5 most-applied companies; sanity-check direction.
- Commit: `feat(scoring): outcome-based multiplier in application priority`.

**Files.** `scripts/lib/outcome-signal.mjs` (new), `scripts/lib/scoring-core.mjs`, `tests/scoring-core.test.mjs`, `scripts/generate-dashboard.mjs`.

**Why it matters.** Learning loop. Every apply teaches. Without this, the scorer is frozen at its initial design.

---

### Task 3 — Bulk response-logging unstash + ship (S)

**Problem.** `stash@{0}` (`pre-log-response-wip`) holds a bulk-entry handler + additional event types (`phone_screen_scheduled/done`, `on_site_scheduled/done`). Current flow requires one CLI invocation per response. When recruiters batch-reply (common Monday morning), logging takes 5–10× longer than it should.

**Goal.** Pop the stash, resolve conflicts against the already-shipped `deferred`/`discarded` work in 22333d9, land as one commit.

**Approach.**
- `git stash show -p stash@{0}` first to read it; compare against `scripts/log-response.mjs` HEAD.
- Merge bulk handler + new event types. Ensure no duplicate `VALID_EVENTS` entries. Re-run log-response tests + verify:ci.
- Document new events in `docs/STATUS-MODEL.md` (add rows under a "pre-submission / interview milestones" section).

**Validation gate.**
- `pnpm test` green.
- Smoke test: log 3 responses via new bulk syntax; confirm rows land correctly.
- Commit: `feat(log-response): bulk entries + phone-screen/on-site event types`.

**Files.** `scripts/log-response.mjs`, `docs/STATUS-MODEL.md`, possibly `tests/log-response.*` if they exist.

**Why it matters.** Apply capacity. Faster inbound logging → faster cadence-alert runs → faster follow-up drafting. Compounds across every response cycle.

---

### Task 4 — Freshness / deadline urgency in prioritization (S)

**Problem.** `computeApplicationPriority` decays by posting age (`-0.08 * ageDays`) but has no signal for "this JD closes in N days." High-signal cue Matt currently reads manually when visible on the listing. Highly urgent in low-supply MSP segments.

**Goal.** Extend the priority formula with a deadline-urgency bonus when the scraper surfaced a close date. No change when missing.

**Approach.**
- Extract close-date from scanner output when available (Indeed / LinkedIn sometimes expose it). New field on pipeline rows: `close_date`.
- `computeApplicationPriority` gains an `urgencyMultiplier(closeDate, now)` — 1.0 when >14 days out or missing; 1.10 at 7 days; 1.25 at 2 days.
- Back-compat: defaults to 1.0 when field absent, so 1906 legacy rows are unaffected.

**Validation gate.**
- New tests for each urgency band.
- Dashboard spot-check: confirm a hand-edited row with `close_date: today+3` sorts up vs a neighbor at same fit.
- Commit: `feat(scoring): deadline-urgency multiplier when close_date present`.

**Files.** `scripts/lib/scoring-core.mjs`, `tests/scoring-core.test.mjs`, scanner output types (where rows get written).

**Why it matters.** Timing. Applying to a closing-soon MSP role on day 12 of a 14-day window beats applying on day 19 of a reopened listing.

---

### Task 5 — Follow-up nudge generator (M)

**Problem.** Dashboard highlights "Pending Response (>7 days)" but Matt still drafts each follow-up from scratch. Cadence alert exists (`pnpm cadence-alert`) but doesn't produce draft copy.

**Goal.** For each app older than 7 days with no response, generate a short, personalized follow-up draft under `data/outreach/followup-{app-id}-{YYYY-MM-DD}.md` — ready for Matt's review. Never send; stop at draft.

**Approach.**
- New `scripts/generate-followups.mjs`. Reads `applications.md` + `responses.md`; filters pending >7 days + <30 days (don't nag stone-cold apps).
- Template pulls role + company + the original outreach (if any) at `data/outreach/{company-slug}-*.md` and references one specific JD hook from the JD file.
- Output path matches existing outreach pattern so it shows up in dashboard.
- CLI: `--dry-run` (default, prints count), `--write` to actually create files.

**Validation gate.**
- Run `--dry-run` today — confirm expected count matches manual `pending >7 days` query.
- Run `--write` and spot-check 2 drafts.
- Commit: `feat(outreach): generate follow-up drafts for stale pending apps`.

**Files.** `scripts/generate-followups.mjs` (new), possibly new `modes/followup.md` for the drafting prompt.

**Why it matters.** Conversion. Follow-ups recover ~15–25% of no-responses in well-run job searches. The marginal cost should be near-zero.

---

### Task 6 — Gmail sync liveness verification (S)

**Problem.** `scripts/register-gmail-sync-task.ps1` defines a 30-min interval Windows task, but we cannot confirm it is actually running. If it's not running, every response Matt cites as "I haven't heard back" may be wrong — the inbox has moved, the log hasn't.

**Goal.** Add a preflight check that writes a heartbeat file each sync run, and a dashboard tile that goes red if the last heartbeat is >60 min old.

**Approach.**
- `scripts/gmail-recruiter-sync.mjs` appends a line to `data/events/gmail-sync.jsonl` (already gitignored via the events/ pattern) on every run regardless of message count.
- New dashboard check in `scripts/generate-dashboard.mjs`: read last gmail-sync event; render an "Inbox sync" tile with green <60m, yellow <4h, red >4h or missing.
- `README.md` + `docs/GMAIL_SYNC_SETUP.md`: add "verify the tile is green" as a daily ritual.

**Validation gate.**
- Manual run of `pnpm gmail-sync:dry`; confirm heartbeat line lands.
- Check dashboard renders tile; force a stale heartbeat via touch to confirm red state.
- Commit: `feat(dashboard): gmail-sync liveness tile + heartbeat event`.

**Files.** `scripts/gmail-recruiter-sync.mjs`, `scripts/generate-dashboard.mjs`, `docs/GMAIL_SYNC_SETUP.md`, `README.md`.

**Why it matters.** Data hygiene. A stale inbox = stale dashboard = bad decisions. Trust in the system drops fast when signal lags reality.

---

## Tier B — High value, parallelizable

### Task 7 — LinkedIn warm-intro surfacer (M)

**Problem.** `mcp__linkedin__get_sidebar_profiles` + `search_people` available but unused in evaluate flow. For each GO / Conditional-GO app, we should surface: "who in your 1st/2nd-degree network works at this company?" That's the warm-intro vector.

**Goal.** When an eval lands at ≥3.5/5, auto-query LinkedIn MCP for up to 5 relevant 1st/2nd-degree contacts at that company and append them to the evaluation report as a "Warm intros" section.

**Approach.**
- New `scripts/linkedin-warm-intros.mjs` — wrapper around `mcp__linkedin__search_people` with `company` + `network_depth ≤ 2` filter.
- Evaluation flow: after report write, if score ≥3.5, invoke + append section. Skip cleanly if MCP session isn't authed (no hard failure).
- Dry-run mode prints the queries without hitting LinkedIn.

**Validation gate.**
- Run against 5 ≥3.5 apps; confirm section appended.
- `modes/evaluate.md` updated to mention the new section.
- Commit: `feat(evaluate): surface LinkedIn warm intros for strong-fit apps`.

**Files.** `scripts/linkedin-warm-intros.mjs` (new), `modes/evaluate.md`, auto-pipeline entry.

**Why it matters.** Warm intros convert 5–10× colder apps. This is Matt's single highest-ROI behavior change.

---

### Task 8 — Apply-queue "next 5" surfacing (S)

**Problem.** Dashboard shows priority-sorted lists; Matt still mentally picks which 5 to apply to next. Explicit "next 5 actions" card saves the cognitive step and anchors daily cadence.

**Goal.** Dashboard top-section block: "Next 5 applications to send" — highest-priority GO / Conditional-GO rows that aren't `Applied` / `Submitted` / `Discarded`.

**Approach.**
- `scripts/generate-dashboard.mjs`: compute top 5 by priority × urgency × outcome-signal (post-Task 2/4). Render as its own card at the top.
- No new config — purely derived.

**Validation gate.**
- Manual dashboard rebuild; confirm card shows 5 rows with correct sort.
- Eyeball at least 1 row where location + score + freshness agree with human read.
- Commit: `feat(dashboard): next-5-applications action card`.

**Files.** `scripts/generate-dashboard.mjs`, `dashboard.html` (regenerated).

**Why it matters.** Decision hygiene. Makes the system's recommendation explicit; Matt overrides or commits in 10 seconds instead of 2 minutes.

---

### Task 9 — Auto-score on prefilter generation (S)

**Problem.** Prefilter cards land with `Quick Score: _/5 —` placeholder. Every new scan needs a manual agent pass to score. We've shipped the MSP priority rule and the archetypes — an LLM pass at generation time could land 60% of cards pre-scored, letting Matt only adjudicate edge cases.

**Goal.** `scripts/prefilter-pipeline.mjs --auto-score` flag: for each generated template, call an LLM (Claude / OpenAI — whichever key is present) with the JD + cv.md + archetype list, fill Quick Score + top-3 matches/gaps, stamp `auto_scored: true` in frontmatter so human review can filter.

**Approach.**
- Key detection: prefer `ANTHROPIC_API_KEY`, fall back to `OPENAI_API_KEY`. Warn + no-op when neither.
- Agent prompt file: `modes/prefilter-auto-score.md` (mirrors `modes/prefilter.md` rubric).
- Rate-limit: sleep 200ms between templates; cap at 50/run unless `--max=N` passed.
- Validation: the `Recommendation` line must be one of `EVALUATE | MAYBE | SKIP`; else the card stays at `status: pending` for manual review.

**Validation gate.**
- Run against 10 test templates; spot-check that auto-scores are sane vs `feedback_work_mode_priority.md` (MSP > hybrid > remote).
- No regression in manual-scoring path.
- Commit: `feat(prefilter): optional --auto-score pass at generation time`.

**Files.** `scripts/prefilter-pipeline.mjs`, `modes/prefilter-auto-score.md` (new).

**Why it matters.** Throughput. Last session we manually dispatched 10 parallel agents to score 98 cards. Doing it at scan time removes a ~45-minute session bottleneck.

---

### Task 10 — Un-stash SSOT wiring WIP (S)

**Problem.** `stash@{1}` (`pre-ssot-wiring-wip`) extends `LOCATION_CONFIG` wiring into `generate-dashboard.mjs` Focus button + sort stabilization. Shipped commits did part of this (`9fb65f5`). The stash likely has follow-through work that didn't land.

**Goal.** Inspect stash, cherry-pick the still-relevant hunks, drop what's obsolete, land as a small focused commit.

**Approach.**
- `git stash show -p stash@{1}` — read, don't pop.
- Diff against `generate-dashboard.mjs` HEAD. Identify hunks that are still NET NEW value vs. already landed.
- Apply only those hunks via `git apply` (not full pop). Run `pnpm test` + visual dashboard check.
- Drop stash only after commit + push succeeds.

**Validation gate.**
- Dashboard visual parity or improvement (no regression in existing cards).
- `pnpm test` + `pnpm run verify:ci` green.
- Commit: `feat(dashboard): complete SSOT location-config wiring`.

**Files.** `scripts/generate-dashboard.mjs`, `dashboard.html`.

**Why it matters.** Tree hygiene + feature completion. Stashes that sit past a week get confused with history; this clears one.

---

## Overall verification sequence

After Tier A (tasks 1–6) lands, run:
1. `pnpm test` — expect ≥ 58/58 (53 current + ~5 new).
2. `pnpm run verify:ci` — green.
3. `git log --oneline 9dcbf92..HEAD` — expect 6 new commits if Tier A shipped cleanly.
4. `git status` — pre-existing unrelated M/?? files are OK; only call out new additions.

Tier B (tasks 7–10) can be interleaved or deferred depending on session length.

## Risks + mitigations

- **Task 1 intel-content bloat**: some intel files are long; prefilter prompt size grows. If we hit context pressure, add a `## Summary` convention to intel files and include only that.
- **Task 2 small-N noise**: outcome signal can overfit on 2–3 data points. Confidence-gated to ≥3 samples + cap at ±15% swing.
- **Task 5 over-nagging**: draft-only stops real harm, but Matt may feel pressure to send. Keep output as local markdown, not email-ready HTML.
- **Task 7 LinkedIn rate limiting / auth**: MCP sessions time out. Skip cleanly, don't block eval flow.
- **Task 9 auto-score drift**: bad auto-scores mislead worse than no-score. Start with a manual-review flag on every run; only turn off after 100-card spot-check.

## Out of scope (deliberate)

- Wellfound / CareerBuilder / Glassdoor scraper rewrites — L effort each, payoff is portal breadth not apply quality. Defer until Tier A is shipped and a measurable throughput gap remains.
- iCIMS hCaptcha auto-solve — integration with a solver service introduces cost + TOS risk. Keep manual captcha pause.
- Resume-variant A/B testing — `resume-selector.mjs` is already wired (submit-dispatch.mjs:31); correlating variants to response rate needs more response data than we have (~30 apps minimum).
- Backfill of legacy pipeline rows missing `location` — PROCESS-IMPROVEMENTS accepts aging; not re-opening.

## Critical files reference

| File | Role | Tasks |
|------|------|-------|
| `scripts/prefilter-pipeline.mjs` | Prefilter generator | 1, 9 |
| `scripts/lib/career-data.mjs` | Shared data loader | 1 |
| `scripts/lib/scoring-core.mjs` | Priority formula | 2, 4 |
| `scripts/log-response.mjs` | Response ingest | 3 |
| `scripts/generate-dashboard.mjs` | Dashboard render | 2, 6, 8, 10 |
| `scripts/gmail-recruiter-sync.mjs` | Inbox sync | 6 |
| `scripts/generate-followups.mjs` | New | 5 |
| `scripts/linkedin-warm-intros.mjs` | New | 7 |
| `modes/prefilter.md`, `modes/evaluate.md` | Scoring rubrics | 1, 7 |
| `docs/STATUS-MODEL.md` | Canonical states | 3 |

---

*Authored 2026-04-17 12:53 CDT, follow-up to the 4-task Tier 3 plan at `C:\Users\mattm\.claude\plans\pushed-b51eef1-giggly-meadow.md`.*
