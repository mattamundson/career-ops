# Maintenance rituals

Operational defaults for keeping career-ops honest: tracker, inbox, queue, and automation outputs stay aligned.

## After editing tracker, CV, or pipeline data

```bash
pnpm run verify:all
```

(`verify:all` also runs `scripts/validate-automation-events.mjs` on `data/events/*.jsonl`. Missing local `reports/*.md` are warnings because reports are gitignored on many machines. To check events only: `pnpm run validate:events`. Advanced: set `CAREER_OPS_EVENTS_DIR` to an absolute path to validate that directory instead — must exist.)

When you specifically want to require every linked report file to exist locally, use:

```bash
pnpm run verify:all:strict
```

(`verify:ci` remains the hook/CI spelling for the same report-tolerant full gate.)

To turn missing-report warnings into a concise checklist:

```bash
pnpm run reports:audit
pnpm run reports:audit:write
```

The write form creates local `data/report-link-audit.md` (gitignored) with the affected tracker rows and missing paths.

Operator snapshot: [SYSTEM-STATUS.md](SYSTEM-STATUS.md). HTML vs TUI and refresh cadence: [WHICH-DASHBOARD-WHEN.md](WHICH-DASHBOARD-WHEN.md).

## After batch evaluations (tracker)

Per `CLAUDE.md` pipeline rules:

1. Merge TSV additions only: `node merge-tracker.mjs` (or `pnpm run merge`).
2. Integrity: `pnpm run verify:all` (or `pnpm run verify:all:strict` when local `reports/*.md` must be present).
3. **Do not** add duplicate company+role rows in `data/applications.md`—update existing entries for status/notes changes.

## Post-scan console report

```bash
node scripts/scan-report.mjs --since=7
```

Prints summary counts, **SOURCE STATUS** (portal rollups with policy labels), top title matches (employer `company` unchanged), tracked-company “no new” section (from `portals.yml` only), and errors split by **source** vs **tracked company**.

## After bulk URL imports or portal scans

Run inbox hygiene in order (dry-run first):

```bash
pnpm run pipeline:hygiene
pnpm run pipeline:hygiene:apply
```

That runs `pipeline:dedupe` then `pipeline:prune-tracked` with the same `--apply` semantics. See [PIPELINE-TRIAGE.md](PIPELINE-TRIAGE.md).

## Intake intelligence report (no writes)

```bash
pnpm run dedupe:intake
```

Refreshes `data/dedupe-intake-report.md`: duplicate job keys in pipeline + raw, URLs already in tracker reports, prefilter `**url:**` overlaps with tracker keys (first 600 files, alphabetical), plus the legacy company-token heuristic.

## Apply queue vs tracker

Weekly (or before a big apply session):

```bash
pnpm run apply-queue:audit
```

Writes `data/apply-queue-audit.md`: orphans, status drift, stale “ship” labels.

If the audit reports drift > 0, run the autofix to rewrite the `[NNN — Status]` bracket
labels in `data/apply-queue.md` to match the tracker (creates `apply-queue.md.bak`):

```bash
pnpm run apply-queue:audit:apply
```

Section bodies are untouched — only the bracket label after the title is updated.
Manual review still required for stale "ship" sections (tracker terminal but queue still listed).

## Stale job URLs (network)

Spot-check or monthly pass on the top of the inbox:

```bash
pnpm run pipeline:liveness -- --limit=25
```

Full run (slower, many HEAD requests):

```bash
pnpm run pipeline:liveness
```

Optional: `node scripts/check-liveness.mjs --prune` removes dead lines from `data/pipeline.md` (use with care).

## Promoting high-score prefilter results (weekly)

When prefilter runs produce a score ≥ 4.0 with `Recommendation: EVALUATE`, promote them into the tracker without hand-crafting TSVs:

```bash
node scripts/promote-prefilter.mjs --dry-run   # show what would promote
node scripts/promote-prefilter.mjs             # write TSV additions + mark prefilter files
node merge-tracker.mjs                         # merge into applications.md
```

The script skips prefilter files already marked `**promoted:** YYYY-MM-DD` and fuzzy-matches company+role against `applications.md` to avoid duplicating truncated entries. Emits `automation.promote_prefilter.completed` to `data/events/`.

Recommended cadence: run weekly alongside `scripts/check-liveness.mjs` so the inbox stays fresh and promising prefilters don't sit on the shelf.

## Git hooks (local)

- **pre-commit:** `pnpm run secrets:check` (blocks committing tracked `.env`).
- **pre-push:** `pnpm run verify:ci` then `pnpm run test:scoring`.

Install hooks after `pnpm install` (the `prepare` script runs `husky`). If hooks do not run, execute `pnpm exec husky` once from the repo root.

## Backup files

`pnpm run pipeline:dedupe -- --apply` and `pnpm run pipeline:prune-tracked -- --apply` write `*.bak` next to modified markdown. These are **gitignored**; keep or delete locally. Prune details append to `data/pipeline-prune-log.md` (commit if you want an audit trail).

## Manual data snapshot (local)

For a point-in-time copy of the main tracker, queue, and config (never secrets):

```bash
pnpm run backup:data
```

Writes `backups/backup-<iso-timestamp>/` with a `manifest.json` (paths listed in `scripts/backup-career-data.mjs`). The `backups/` tree is **gitignored**. Use `--dest relative/path` to choose the folder. Does not read or copy `.env`.

## Nightly backup (scheduled)

`scripts/cron-backup.mjs` runs `backup-career-data.mjs` under `runCronTask` (with `task.*` events for Operator Health). One-off: `pnpm run cron:backup`.

**Windows Task Scheduler:** register the nightly backup task with:

```bash
pnpm run tasks:register-backup
```

This imports `scripts/backup-task.xml`, which runs `run-nightly-backup.bat` nightly at 9:30 PM local time. Log file: `data/backup-scheduler.log` (**gitignored**, like other scheduler logs).

The dashboard scheduler should run the full refresh path (index + `dashboard.html` + `review.html`) rather than dashboard-only generation:

```bash
pnpm run tasks:register-dashboard
```

For quick task diagnosis after a warning in `verify:all` / `verify:ci`:

```bash
pnpm run tasks:inspect
pnpm run tasks:inspect -- --task="Career-Ops Dashboard" --hours=48
```

If the dashboard task repeatedly exits `267014`, export a patched XML that raises
the execution timeout from the old 2-minute setting to 10 minutes and routes the
task to `post-apply-refresh.mjs`:

```bash
pnpm run tasks:remediate
```

Review the generated XML under `output/scheduled-task-fixes/`, then re-register
only when you are ready:

```bash
pnpm run tasks:remediate -- --apply
```

## Automation event log (`data/events/`)

Scans, dashboard regen, application-index rebuilds, and post-scan reports append **JSON lines** to `data/events/YYYY-MM-DD.jsonl` via `scripts/lib/automation-events.mjs`. The static dashboard **Operator health** panel reads the latest tail.

- **Local only:** `data/events/*.jsonl` is gitignored (machine-specific trail, like tracker noise).
- **Inspect:** open the latest file in an editor, or regenerate the dashboard after a scan.

Event types you should see after normal use include `scanner.run.completed`, `dashboard.generated`, `scan.report.completed`, `application.index.rebuilt`, and Gmail/submit events from their respective scripts.

**Retention (optional):** remove dated files older than 90 days (dry-run first):

```bash
pnpm run events:prune
pnpm run events:prune:apply
# custom window:
node scripts/prune-automation-events.mjs --days=30 --apply
```

Only `YYYY-MM-DD.jsonl` names are eligible; other files in `data/events/` are left alone.

## Apply-run artifacts (`data/apply-runs/`)

Preview removal of bundles/confirm JSON older than 60 days (by newest nested file mtime):

```bash
pnpm run apply-runs:prune
pnpm run apply-runs:prune:apply
```

Scheduled `cron-prefilter` uses a **single-instance lock** under `data/.locks/` so two runs cannot overlap; stale locks (dead pid, unreadable file, or age over three hours) are taken over automatically.

## CI

GitHub Actions workflow `.github/workflows/verify.yml` copies `config/profile.example.yml` to `config/profile.yml`, then runs `verify:ci` and Node tests; a parallel job runs `go vet ./...` and `go test ./...` in `dashboard/`. Adjust branch names if your default branch is not `main` / `master`.
