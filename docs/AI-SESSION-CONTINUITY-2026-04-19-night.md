# Session Continuity — 2026-04-19 Night Push

> Resume point for the next AI session. This document is the state-of-the-world after a 2-hour push focused on Week-3 auto-apply foundations, observability gaps surfaced by a real V4C.ai smoke test, and cover-letter quality enforcement. The prior session's handoff is `AI-SESSION-CONTINUITY-2026-04-18-night.md`; this one supersedes it.

## What shipped this session (8 commits)

| Commit | Subject |
|---|---|
| `2e0fb3a` | feat(dispatch): fall back to universal-playwright when per-ATS submitter missing |
| `069af04` | feat(apply-review): real prepare rehearsal — fill form + screenshot in dry-run |
| `8b177df` | feat(apply-liveness): probe GO queue URLs for closed listings |
| `72f3476` | feat: incident runbook + apply-liveness cron + URL classifier in queue |
| `cd62883` | feat(resolve-apply-urls): scaffold URL resolver (limited efficacy) |
| `4fb3d07` | feat(daily-digest): surface dead listings from apply-liveness in morning email |
| `c266767` | feat(cover-letter): quality lint catches buzzwords, em-dashes, generic openers |
| `5166f9f` | fix(cover-letter): tighten system prompt to reduce buzzword + em-dash escapes |
| `1a83957` | test(cover-letter-lint): 11 tests covering rules + scoring behavior |

End-state test suite: **85 / 85 passing**. Health check: should be 7 pass · 2 warn · 0 fail (was end-state of prior session).

## Real bug caught this session

**V4C.ai #015 was "GO" but the listing was closed.** The apply-review smoke test ran prepare, dispatched to submit-universal-playwright (workable fallback path), and produced a screenshot showing Workable had bounced to the careers landing page — "this job is no longer available". A 30-second liveness pass would have caught this; manual prep would not. That signal drove the apply-liveness work below.

V4C #015 manually updated to Discarded (in `data/applications.md`, gitignored). Status note explains the discovery.

## New observability + automation this session

### `scripts/check-apply-queue-liveness.mjs` + cron

Two-tier detection. Cheap HEAD/GET pass catches hard-fail hosts (404, 410, server-rendered "expired"). `--render` mode launches headless Playwright for SPA hosts (Workable, Lever, Ashby, Greenhouse, SmartRecruiters), waits 2.5s for content, looks for soft-closed signals + presence of an Apply button. Slower but catches V4C-style "200 + JS-renders dead".

Wired:
- `pnpm run apply-liveness` — cheap pass
- `pnpm run apply-liveness:render` — full render
- Windows scheduled task `Career-Ops Apply Liveness` — daily 6:00 AM CT, runs `--render`
- Daily digest now reads `data/apply-liveness-YYYY-MM-DD.md` and surfaces dead listings as a top-level section

### `scripts/lib/cover-letter-lint.mjs` + integration

Rules engine that catches AI-generator slop before it lands in `output/cover-letters/`:
- Em-dashes (warning, error in `--strict`)
- Buzzwords (errors): passionate, synergy, results-driven, paradigm, robust solution, ecosystem, leverage(verb), seamless, world-class, best-in-class, thought leader, move the needle, perfect fit, etc.
- Generic openers: "I am writing to apply for…", "I am excited to apply…"
- Wrong paragraph count (warning if not 3)
- Missing concrete numbers (warning)
- Word count outside 200-400 (warning)

`generate-cover-letter.mjs` runs the lint after OpenAI returns and exits non-zero on errors (`--skip-lint` to override). End-to-end validation: V4C letter contained "Paradigm" + 6 em-dashes; the new pipeline catches them, blocks the write, and rerun yields a clean letter.

`scripts/lint-cover-letters.mjs` is the standalone tool: scans all letters in `output/cover-letters/`, supports `--strict`, `--min-score N`. First scan surfaced 13 of 14 letters with quality issues; 4 contained "Paradigm". 11 unit tests cover the rules engine.

### `docs/INCIDENT-RUNBOOK.md`

Per-task runbook. Each cron task → notification format → diagnostic command → recovery steps → manual fallback. Standing principle codified: notify is the canary; file artifacts are the source of truth; `pnpm run health:json` is authoritative.

### URL classifier in `apply-review`

Queue listing now shows kind for each app: `direct-ats` / `linkedin` / `indeed` / `company-site` / `none`. Footer summarizes counts. Surfaced the real bottleneck: of 21 queued GO/Conditional GO apps, **17 are LinkedIn-proxied, 3 are Indeed, 1 is direct-ATS** (Novellia/Ashby). Auto-preppable count = 1.

## Deferred / not solved

### LinkedIn → ATS URL resolution (task #38, marked completed-with-caveat)

Built `scripts/resolve-apply-urls.mjs` with three-tier strategy (DOM scrape → EasyApply detection → DDG/Bing search). DOM scrape works for some Indeed pages with embedded external links. **DDG and Bing both block headless traffic** — neither returned organic results in testing. LinkedIn unauthenticated views don't expose Apply CTAs.

Real fix paths (not done):
- Use authenticated LinkedIn session (ToS risk, account ban risk)
- Build `portals.yml`-based company → ATS pattern lookup
- Manual annotation: each report gets a `**Apply URL:**` field added by hand or by a one-time bulk script
- Improve scanner upstream to capture underlying ATS URL at intake time (would require scanner refactor)

The bottleneck remains: most LinkedIn-sourced apps are not auto-preppable today. apply-review --prepare works on the 1 direct-ATS app (Novellia/Ashby) and would work for any company-site URL via universal-playwright fallback.

### Brain reindex on cron

Attempted: `bun run vendor/gbrain/src/cli.ts sync --repo .` scans 3509 markdown files (whole repo including `data/brain-staging-applications/` which all skip with frontmatter slug mismatches). Killed — too broad, too slow. Brain DB is intact at 100% chunk coverage from prior session. Future work: focused delta-sync that walks only `reports/` and pushes new mtime > brain_last_sync.

## Known minor issues

- `data/brain-staging-applications/app-NNN.md` files have frontmatter `slug:` that mismatches their path, causing all to be skipped on full sync. Either remove the slug line or move the files. Not blocking — those files are not the canonical source for evaluation pages.
- `dashboard.html`, `data/responses.md`, `scripts/scan-task.xml` show as modified in git status but appear to be incidental cron-driven changes. Did not commit.
- Bun MCP server (gbrain) was killed when I taskkill'd bun.exe to stop the background sync. Brain MCP tools were unavailable for the rest of the session. Brain disk state is fine; restart needed for next session.

## Tomorrow's morning experience (what Matt will see)

1. **6:00 AM CT** — `Career-Ops Apply Liveness` task fires; renders `data/apply-liveness-2026-04-20.md`. Should re-probe the queue minus V4C (now Discarded) — expect 3 OK + 1 UNREACHABLE (Modine, HTTP 403 bot detection — not a real death).
2. **7:55 AM CT** — daily digest email. Now includes "Dead listings to discard" section if any. Footer links to `docs/INCIDENT-RUNBOOK.md` and `docs/RESPONSE-PLAYBOOK.md`.
3. **First touch** — `pnpm run apply-review` shows 21 candidates with URL kinds; only 1 (Novellia) is direct-ATS auto-preppable.

Two operational suggestions for Matt to consider next:
- Manually annotate 5-10 of the highest-score LinkedIn-sourced apps with `**Apply URL:**` lines pointing to the real ATS posting (e.g., `careers.{company}.com/job/...`). After that, apply-review can prep them automatically.
- The cover-letter lint will block re-generation of letters with "Paradigm" / "seamless" / 5+ em-dashes. If a regen blocks, just rerun (the model is non-deterministic and second tries usually pass).

## Suggested next-session priority order

1. **Bulk regenerate the 13 flagged cover letters** with the new prompt + lint. Most will need 1-2 retries per the model's non-determinism.
2. **Manual `**Apply URL:**` annotation pass** on top 10 GO apps — would unlock auto-prep for ~half the queue immediately.
3. **End-to-end `--confirm` smoke test** on Novellia (#018, the only direct-ATS app). Real authorization required from Matt; do NOT auto-submit.
4. **Brain delta-sync script** (focused, fast, walks only `reports/` — not whole repo). Restart brain MCP first.
5. **`docs/PIPELINE-TRIAGE.md` review** — there may be accumulated TODOs from prior sessions that this session didn't touch.

## Operational state at end of session

- HEAD: `1a83957` on `master`
- Untracked / modified (incidental, not committed):
  - `dashboard.html`, `data/responses.md`, `scripts/scan-task.xml` (cron-driven mods)
  - `data/digest-preview.html` (latest digest dry-run output)
  - `data/apply-url-resolve-2026-04-20.md` (resolver dry-run report, kept as artifact)
  - `.claude/scheduled_tasks.lock`
  - Many older session artifacts in `data/scan-summary-*.md`, `data/stale-alert-*.md`, etc. (left for prior session triage)
- Brain MCP: down (taskkill'd bun.exe earlier). Restart needed for next session.
- Scheduled tasks: dashboard hourly, daily-digest 7:55 CT, health-check 6h, gmail-sync, cadence-alert, apply-liveness 6 AM CT (NEW today).
