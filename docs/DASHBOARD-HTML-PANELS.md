# HTML dashboard — panel inventory vs data

Source: [`scripts/generate-dashboard.mjs`](../scripts/generate-dashboard.mjs) → root `dashboard.html`.

Panels are **read-only** views over local files unless noted. Empty sections usually mean **missing or sparse data**, not a broken generator.

## Always rendered (may show zeros or placeholders)

| Section | Data inputs | Empty / quiet when |
|---------|-------------|---------------------|
| Stats row | `applications.md` (index), `pipeline.md`, liveness reports | Dead URLs = 0 if no liveness run |
| Operator health | `applications.md`, `data/events/*.jsonl` | No stale rows; no events file yet; no `scanner.run.completed` yet |
| Scan Sources | `data/scan-history.tsv` | No rows |
| Prefilter Queue | `data/prefilter-results/*.md` | No cards |
| Board Status | `scan-history.tsv` + [`source-labels.mjs`](../scripts/lib/source-labels.mjs) | Same as scan history |
| Applications table + tabs | Index / `applications.md` | No applications |
| Pipeline Inbox | `data/pipeline.md` | No pending lines |

## Conditional (hidden or stub unless data / subprocess succeeds)

| Section | Condition | Data / script dependency |
|---------|-----------|---------------------------|
| Rejection Insights | `rejectionInsights.sufficient === true` | `scripts/analyze-rejections.mjs --json --min-data=3` (exec during build) |
| Filter Health | `filterHealth` non-null | `scripts/tune-filters.mjs --json --days=30` (exec); needs scan history worth analyzing |
| Application Analytics | `apps.length >= 3` | `applications.md` + `scan-history.tsv` |
| Offer Comparison | ≥2 apps with `score >= 4.0` | Scored tracker rows |
| Application Timeline | ≥2 apps with `date` | Tracker dates |

## Response / Gmail–adjacent blocks

Driven by `data/responses.md` parsing in `generate-dashboard.mjs` (funnel, follow-up queue, channel performance, metrics, applied 30d, pending response, active conversations). If you do not run Gmail sync or maintain `responses.md`, these blocks show **zeros or placeholder** copy—expected.

## Apply Queue

Uses tracker + `output/` PDF heuristics + queue fields from the application index. Sparse if nothing is in “ready to submit” style states.

## Maintenance tips

- If a panel is always empty, either **feed the data** (e.g. run sync, fill responses) or treat it as **optional signal**—do not assume every install uses every path.
- Regenerate after data work: `pnpm run verify:all` or `pnpm run dashboard`.

## Tightening visibility (only after sustained “noise”)

If you **repeatedly** ignore a section (always empty, always misleading), prefer a small change in [`scripts/generate-dashboard.mjs`](../scripts/generate-dashboard.mjs): raise thresholds, gate on file presence, or omit the block. Avoid one-off hacks without a week or two of observation—dashboard scope should stay a **view** over artifacts, not a second product.

See also: [WHICH-DASHBOARD-WHEN.md](WHICH-DASHBOARD-WHEN.md).
