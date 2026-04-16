# Current system status (operator snapshot)

Single-page view of what this repo **actually does today**, without chat context. For source-level truth see **[SUPPORTED-JOB-SOURCES.md](SUPPORTED-JOB-SOURCES.md)**. For **HTML vs Go TUI**, refresh cadence, and what dashboards omit, see **[WHICH-DASHBOARD-WHEN.md](WHICH-DASHBOARD-WHEN.md)**.

## What runs in production use

| Capability | Entry | Notes |
|------------|--------|--------|
| Full scan + pipeline write | `node scripts/auto-scan.mjs` | Greenhouse / Ashby / Lever / Workday / iCIMS / Workable / SmartRecruiters paths from `portals.yml`; title filter; dedupe vs history + pipeline + applications. |
| JobSpy (Indeed, LinkedIn, etc.) | `scripts/scan-jobspy.py` | Optional Python dependency; invoked from `auto-scan.mjs` when not `--greenhouse-only`. |
| Direct boards | `auto-scan.mjs` `--direct-only` | **We Work Remotely** is the validated RSS path. Others exist as scripts but are **stub / blocked / deferred** per supported matrix. |
| Post-scan report | `node scripts/scan-report.mjs --since=7` | Summary, **SOURCE STATUS** rollups, tracked-company “no new”, errors split by source vs company. |
| HTML dashboard | `pnpm run dashboard` / `generate-dashboard.mjs` | Applications, pipeline, scan source tables, board policy badges, **Operator health** (stale touchpoints, recent `data/events` tail, last scanner run), filter health (keywords + **source rollup** when JSON includes it). **Priority** column boosts hybrid / on-site / MSP-local JD wording vs fully remote at similar scores (see `scripts/lib/scoring-core.mjs`); high remote scores still rank high. Emits `dashboard.generated` to `data/events/`. |
| Go TUI dashboard | `dashboard/career-dashboard.exe -path ..` | Same repo root; default **focus** sort (score × location bias) matches HTML apply-queue ordering; press `s` to cycle pure score. Pipeline header shows **last `scanner.run.completed`** when `data/events/*.jsonl` is present. |
| Integrity | `pnpm run verify:all` / `pnpm run verify:ci` | Tracker, CV sync, index, dashboard regen, **`data/events/*.jsonl` parse check** (`validate-automation-events.mjs`). |
| Event log retention | `pnpm run events:prune` / `events:prune:apply` | Optional: delete dated `data/events/YYYY-MM-DD.jsonl` older than `--days` (default 90). See [MAINTENANCE-RITUALS.md](MAINTENANCE-RITUALS.md). |

## Data contracts (do not break casually)

- `data/scan-history.tsv` — `url`, `first_seen`, `portal`, `title`, `company`, `status`
- `data/pipeline.md` — `- [ ] url | Company | Title` under `## Pending`
- `data/applications.md` — tracker table; report links; canonical statuses in `templates/states.yml`
- `data/events/*.jsonl` — append-only automation log (local / gitignored); dashboard **Operator health** reads the tail

## Automation hooks (optional)

- Gmail sync, cadence alert, scanner preflight — see `package.json` `preflight:*` and `docs/GMAIL_SYNC_SETUP.md`.
- Git hooks — `docs/MAINTENANCE-RITUALS.md` (pre-push runs `verify:ci` + tests).
- GitHub Actions — `.github/workflows/verify.yml`: **Node** job (`verify:ci` + `test:scoring`) and **Go** job (`go vet ./...` + `go test ./...` in `dashboard/`).

## Honest gaps (not bugs)

- **Dice / Wellfound / SimplyHired** etc. are not first-class until implemented and validated; see matrix.
- **Reports** may be gitignored locally; CI uses `verify:ci` / `--skip-missing-reports` where appropriate.

Last aligned with reporting changes: portal display + policy labels via `scripts/lib/source-labels.mjs`.
