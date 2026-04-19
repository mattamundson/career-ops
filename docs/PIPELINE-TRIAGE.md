# Pipeline inbox triage (`data/pipeline.md`)

The pipeline file is the **URL inbox** for roles to evaluate. When discovery outruns evaluation, use these rules so the inbox stays actionable.

## Principles

1. **Actionable first** — Keep roles you might evaluate in the next 1–2 weeks near the top (manual ordering is OK).
2. **Dedupe aggressively** — Same `gh_jid`, same Lever UUID, or same normalized URL → one checkbox only. Remove duplicates to `data/scan-history.tsv` or a dated archive note if you need an audit trail.
3. **Stale jobs** — If a URL returns 404 or “position closed,” move the line to a `## Processed (closed)` section or delete and note in scan history.
4. **Dedupe URLs mechanically** — After scans, run `pnpm run pipeline:dedupe` (dry-run) then `pnpm run pipeline:dedupe -- --apply` to collapse duplicate `gh_jid` / identical URLs inside `data/pipeline.md` and drop raw-intake lines that duplicate the main inbox. Creates `.bak` files when applying. Shortcut: `pnpm run pipeline:hygiene` then `pnpm run pipeline:hygiene:apply` (dedupe **and** prune-tracked in one go — see [MAINTENANCE-RITUALS.md](MAINTENANCE-RITUALS.md)).

5. **Prune against the tracker** — If the inbox still lists jobs you already evaluated (same Greenhouse id, LinkedIn id, Indeed `jk` (`indeed:`…), Lever UUID, or exact URL as the `**URL:**` stored in the linked `reports/*.md` row), run `pnpm run pipeline:prune-tracked` (dry-run), then `pnpm run pipeline:prune-tracked -- --apply`. This does **not** remove “same company, different requisition” unless the IDs or canonical URL match. Re-openings with a new `gh_jid` stay in the inbox. Details append to `data/pipeline-prune-log.md`.

6. **Bulk company dumps** — If one company (e.g. many MongoDB URLs) floods the list, either:
   - move the block to **[`data/pipeline-raw-intake.md`](../data/pipeline-raw-intake.md)** (MongoDB archive lives there as of 2026-04-12) and keep `pipeline.md` to a short “top N this week” list, or
   - keep one representative URL per family and link “see careers search” in Notes.

## Workflow

1. Pick **N** pending lines per session (suggested: 3–5).
2. Run auto-pipeline on each (paste URL or `/career-ops pipeline`).
3. After evaluation, move the URL to **`## Processed`** (or delete) so Pending does not grow without bound.
4. Optional: `node scripts/check-liveness.mjs` (if configured) for URL health on high-value rows.

## Relationship to other files

| File | Role |
|------|------|
| `data/applications.md` | Evaluated roles + current status |
| `data/prefilter-results/` | Machine-ranked JD text; not the same as “evaluated” |
| `batch/tracker-additions/*.tsv` | **Only** way to add new tracker rows (then `merge-tracker.mjs`) |

## SLA (suggested)

- **Pending** backlog: cap at what you can review in two weeks, or archive the rest.
- **GO** rows in tracker: touch at least one per business day until the queue is honest.
