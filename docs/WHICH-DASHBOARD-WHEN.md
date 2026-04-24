# Which dashboard when

This fork has **two operator surfaces** for the same underlying data. Neither replaces Claude modes, scanners, or PDF generation—they **read local files** and summarize.

## Phase 0 — Product decision (locked for this repo)

| Surface | Primary use | Success criteria |
|---------|----------------|------------------|
| **HTML** (`dashboard.html`) | Browser overview: funnel health, scan rollups, filter health, operator health, pipeline volume, apply queue, comparisons | After `pnpm run verify:all` or `pnpm run dashboard`, you can answer in one screen: *Where is the funnel? What is stale? What did scans do? What is blocked?* |
| **HTML** (`review.html`) | **Apply review** cockpit: GO / Conditional GO / Ready to Submit only — copy prep/confirm/dispatch commands | When you are about to apply, use `pnpm run review:ui` (regenerated with `post-apply:refresh` and `smoke`) |
| **Go TUI** (`dashboard/career-dashboard`) | Fast terminal triage: filter tabs, sorts, inline **status** edits, report preview | You can change application status and skim reports without leaving the terminal. |

**Default stance:** **Both** — HTML for weekly/ops review and sharing a file; TUI for day-to-day status edits. If you later pick only one, update this section.

## When to use which

- **Use HTML** when you want a single file to scroll, search-in-page, or leave open on a second monitor; after integrity runs so it matches `applications.md` / index / latest scans.
- **Use TUI** when you are already in a terminal session and want keyboard-driven navigation and **status updates** written back to `data/applications.md`.
- **Regenerate HTML** after meaningful data changes if you rely on the browser file: `pnpm run dashboard` or `pnpm run verify:all` (regenerates index + dashboard as part of the gate).

## Weekly operator rhythm (recommended)

A lightweight default so the dual surfaces stay useful without scope creep:

1. **Once per week** (or before a big apply push): run `pnpm run verify:all`, open `dashboard.html`, skim funnel / operator health / scan rollups / stale signals.
2. **Day to day**: use the Go TUI for status edits and fast triage when you are already in a terminal.
3. **`data/responses.md`**: if you rely on response-funnel HTML blocks, keep this file current (Gmail sync or manual upkeep). If it stays sparse, expect quiet sections—see [DASHBOARD-HTML-PANELS.md](DASHBOARD-HTML-PANELS.md); that is data hygiene, not a generator bug.

## Refresh cadence

| Action | Command | Updates HTML? | Notes |
|--------|---------|-----------------|-------|
| Full integrity gate | `pnpm run verify:all` | Yes | Pipeline + CV sync + `data/index/applications.json` + `dashboard.html` + events JSONL validation |
| CI / hooks | `pnpm run verify:ci` | Yes | Same as above but missing `reports/*.md` are warnings only |
| Dashboard only | `pnpm run dashboard` | Yes | Runs `generate-dashboard.mjs` (optional `--open`) |
| Review UI only | `pnpm run review:ui` | Yes (writes `review.html`) | Does not regen the main dashboard; run `dashboard` or `post-apply:refresh` for both |
| TUI | `cd dashboard && ./career-dashboard -path ..` | No | Reads data live from disk each run |

## What dashboards do **not** show

- Full **mode** prompts (`modes/*.md`) — negotiation scripts, STAR bank authoring, archetype philosophy.
- **Live** job board scraping — URLs in pipeline/history are whatever scanners already wrote.
- **Automatic** application submit — human gate remains; see `CLAUDE.md` and apply runbooks.

## Related docs

- [SYSTEM-STATUS.md](SYSTEM-STATUS.md) — one-page capability index  
- [DASHBOARD-HTML-PANELS.md](DASHBOARD-HTML-PANELS.md) — HTML panel inventory vs data sources  
- [DASHBOARD-TUI-UPSTREAM-PARITY.md](DASHBOARD-TUI-UPSTREAM-PARITY.md) — optional diff vs [santifer/career-ops](https://github.com/santifer/career-ops)  
- [UPSTREAM-DRIFT.md](UPSTREAM-DRIFT.md) — optional ongoing sync discipline  
- [MAINTENANCE-RITUALS.md](MAINTENANCE-RITUALS.md) — hooks, events log, pruning  

Upstream reference: the public [santifer/career-ops README](https://github.com/santifer/career-ops) emphasizes the **TUI** as the in-repo dashboard story; this fork adds the **HTML** layer as a first-class operator view.
