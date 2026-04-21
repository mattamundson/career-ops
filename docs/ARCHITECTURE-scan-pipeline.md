# Architecture — Scan Pipeline

Audience: someone modifying the scan orchestrator, adding a source, or diagnosing pipeline-level issues. Skip if you're just running or monitoring the pipeline.

---

## 1. System-level view

```
                        ┌──────────────────────────┐
                        │   portals.yml (config)   │
                        │   — companies, queries,  │
                        │     locations, filters   │
                        └────────────┬─────────────┘
                                     │
                                     ▼
  ┌────────────────────────────────────────────────────────────┐
  │                   auto-scan.mjs  (orchestrator)            │
  │  • loadProjectEnv  • createRunSummaryContext                │
  │  • SCAN_STATUS tri-state: success / partial_success / error │
  │  • RUN_SUMMARY accumulator                                  │
  │                                                             │
  │  ┌─────────────┬─────────────┬─────────────┬────────────┐  │
  │  │ Direct APIs │ Playwright  │ MCPs        │ Firecrawl  │  │
  │  └──────┬──────┴──────┬──────┴──────┬──────┴──────┬─────┘  │
  │         │             │             │             │        │
  └─────────┼─────────────┼─────────────┼─────────────┼────────┘
            │             │             │             │
            ▼             ▼             ▼             ▼
   Greenhouse      Workday       LinkedIn       Firecrawl
   Lever           iCIMS         Indeed (Pw)    web search
   SmartRecruiters Ashby         JobSpy (Py)
   Built In

         │                   │                   │
         └─────┬─────────────┴─────────┬─────────┘
               │                       │
               ▼                       ▼
      scan-history.tsv       data/events/YYYY-MM-DD.jsonl
      (dedup + new matches)  (telemetry — 1 event per source)

               │                       │
               ▼                       ▼
        data/pipeline.md      data/run-summaries/scanner-*.json|md
        (queue of new URLs)   (status + stats + warnings)

               │                       │
               ▼                       ▼
        generate-dashboard.mjs consumes both + profile.yml + applications.md
               │
               ▼
          dashboard.html (freshness tiles, action cards)
```

---

## 2. Source failure-domain table

Each source has independent failure modes. No single source's outage kills the scan.

| Source | Transport | Failure modes | Typical reliability |
|--------|-----------|---------------|---------------------|
| Greenhouse APIs (49 targets) | HTTPS GET to `boards.greenhouse.io/v1/boards/:company/jobs` | Company removed board, API change | 99%+ |
| Lever APIs (7 cos) | HTTPS GET to `api.lever.co/v0/postings/:company` | Company switched ATS | 99%+ |
| SmartRecruiters APIs (5 cos) | HTTPS GET to posting API | Company switched ATS, API changes | 98% |
| Ashby (18 cos) | Playwright Chromium | Chromium crash, layout change, bot detection | 90% |
| Workday (26 cos) | Playwright Chromium + cookie preamble | Workday CDN throttle, SSO redirect | 85% |
| iCIMS (8 cos) | Playwright Chromium | CAPTCHA, layout change | 80% |
| Built In (8 queries) | Playwright | Rate limit, pagination break | 90% |
| Firecrawl search (15 queries) | Firecrawl API | API quota, search query timeout | 95% |
| LinkedIn MCP | uvx stdio JSON-RPC | Profile lock, session expired, anti-bot | **60-80%** |
| Indeed (Playwright) | Playwright | Bot detection, CAPTCHA | 70% |
| JobSpy (Python) | subprocess + multi-board scrape | Individual board failures, captcha | 80% |

**Implication:** LinkedIn MCP and iCIMS are the fragile sources. Design pipeline to tolerate their intermittent loss.

---

## 3. Source independence principle

A scan run is **partial_success** if any source fails. It is **error** only if the orchestrator itself fails. This design:

- Preserves yield from healthy sources even when others degrade.
- Surfaces degradation explicitly rather than silently hiding it.
- Allows the operator to triage one source at a time without blocking others.

**Anti-pattern to avoid:** letting a single failing source return an exception that unwinds the entire scan. Every source call in `runDirectBoardScans()`, `runRemoteBoardScans()`, etc., must be wrapped in try-catch-continue.

---

## 4. Event telemetry layer

Every source emits exactly one completion event per run:

```jsonl
{"recorded_at": "2026-04-21T11:00:42Z", "event": "scanner.linkedin_mcp.completed", "status": "success", "queries": 8, "newCount": 5, "totalFound": 47, "errors": [], "retried": false}
```

**Status tri-state:**
- `success` — all queries completed cleanly
- `partial` — at least one query errored but scan returned data
- `error` — source failed entirely, no data returned

**Phase 3.3 addition (pending):** `retried: true` field when the retry path fired. Orchestrator reads this to downgrade overall status to `partial_success`.

**Event → run-summary mapping:** The orchestrator reads the event (via `markPartialSuccess(warning)` call chain) at the end of each source's execution and rolls it up into `RUN_SUMMARY.warnings`. The final run-summary writes to `data/run-summaries/scanner-<ISO-timestamp>.{md,json}`.

---

## 5. Preflight hooks (generalization target — Phase 3.2)

**Current state:**
- `scripts/lib/chrome-preflight.mjs` exports `runChromePreflight(SOURCE)` — kills zombie Chromium from prior crashes. Called by 9 browser-using entry points.
- `scripts/scan-linkedin-mcp.mjs` has inline `preflight()` (lines 165-168) — kills LinkedIn-specific Chrome + prunes invalid-state snapshots.

**Target state (Phase 3.2):**
- `scripts/lib/preflight-registry.mjs` — thin dispatcher.
- `scripts/lib/linkedin-preflight.mjs` — extracted LinkedIn-specific preflight.
- Each scanner registers its own preflight: `registerPreflight('linkedin-mcp', linkedinPreflight)`.
- Orchestrator calls `runPreflight('linkedin-mcp')` before spawning.

**Why this is worth the refactor:**
- Keeps source-specific hygiene co-located with the source.
- Opens the door for the dashboard (or a new CLI) to invoke preflight without running a full scan.
- Surfaces which sources have hygiene needs vs. which don't — a proxy for fragility.

---

## 6. Partial-success propagation (Phase 3.3 target)

**Current gap:** `scan-linkedin-mcp.mjs` retries on profile-lock, and the retry can succeed. On retry-success, the exit code is 0 — indistinguishable from no-retry-needed. The orchestrator marks the scan `success` when in fact degradation occurred.

**Why that matters:** Repeated retry-success masks systemic issues. Matt's daily digest email reads run-summary status — green when it should be yellow.

**Target contract:**
```
Exit code 0 + stdout status 'success'  → normal success
Exit code 2 + stdout status 'partial'  → retry fired and succeeded
Exit code 1 + stdout status 'error'    → hard failure (existing behavior)
```

Orchestrator at `auto-scan.mjs:1297` reads exit code; when code === 2, calls `markPartialSuccess('LinkedIn MCP retried successfully — investigate recurrence')`.

**Double signal channel:** orchestrator also parses stdout JSON and checks `jobs.status` field. If either signal reports partial, trigger markPartialSuccess. Redundancy-by-design.

---

## 7. Source-health registry (Phase 3.4 target)

**Problem:** Dashboard shows freshness (last-run per source) but not reliability (success rate over N runs). Operator can't tell if a source is silently degrading.

**Solution:**

```
data/events/YYYY-MM-DD.jsonl   (one line per source-run)
             │
             ▼
scripts/aggregate-source-health.mjs  (runs post-scan)
             │
             ▼
data/source-health.json        (consolidated — one object)
{
  "generated_at": "2026-04-21T11:05:00Z",
  "window_days": 14,
  "sources": {
    "linkedin_mcp": {
      "last_run": "2026-04-21T11:00:42Z",
      "last_success": "2026-04-21T11:00:42Z",
      "last_failure": "2026-04-19T18:14:12Z",
      "runs_14d": 28,
      "success_14d": 18,
      "partial_14d": 8,
      "error_14d": 2,
      "success_rate_14d": 0.643,
      "avg_yield_14d": 4.2
    },
    "greenhouse": { ... },
    ...
  }
}
             │
             ▼
scripts/generate-dashboard.mjs  (reads source-health.json)
             │
             ▼
dashboard.html  (per-source reliability tile with sparkline)
```

**Rollup logic:**
- `last_run` — max(recorded_at) across all events with event name `scanner.<source>.*`
- `last_success` — max(recorded_at) where status === 'success'
- `last_failure` — max(recorded_at) where status === 'error'
- `success_rate_Nd` — count(status=success) / count(any) over N days
- `avg_yield_Nd` — mean(newCount) where status in {success, partial}

**Trigger cadence:** The aggregator runs at end of every scan (post-scan hook in `auto-scan.mjs`). Dashboard regen picks it up immediately.

---

## 8. Orchestrator file map

Key files, read in this order to understand the orchestration:

| Path | Role |
|------|------|
| `scripts/auto-scan.mjs` | Top-level orchestrator. Main at line ~1333, invoked at ~1969. |
| `scripts/auto-scan.mjs:42-47` | `RUN_SUMMARY`, `SCAN_STATUS`, `markPartialSuccess` — the state machine. |
| `scripts/auto-scan.mjs:1249-1313` | `runDirectBoardScans` — spawns LinkedIn/Indeed MCPs as child processes. |
| `scripts/scan-linkedin-mcp.mjs` | LinkedIn source. Main at 214, invoked at 261. |
| `scripts/scan-indeed.mjs` | Indeed source via Playwright. |
| `scripts/scan-jobspy.py` | JobSpy multi-board source. |
| `scripts/lib/mcp-client.mjs` | Shared stdio JSON-RPC client for MCP integrations. |
| `scripts/lib/chrome-preflight.mjs` | Shared Chromium cleanup. |
| `scripts/lib/run-summary.mjs` | `createRunSummaryContext`, `markPartialSuccess`. |
| `scripts/utils/automation-events.mjs` | `appendAutomationEvent` — writes to data/events/*.jsonl. |
| `scripts/generate-dashboard.mjs` | Dashboard renderer. Event read at 1156. |
| `scripts/cron-wrap.mjs` | Cron wrapper — reads events, emits daily digest. |

---

## 9. Adding a new source

Checklist for adding, say, a new ATS vendor:

1. Add queries to `portals.yml` under the relevant company.
2. Create `scripts/scan-<source>.mjs` following the shape of existing direct-API scanners (Greenhouse is the cleanest template).
3. Emit a `scanner.<source>.completed` event per run.
4. Wire into `auto-scan.mjs` — choose the right section (runDirectApiScans, runRemoteBoardScans, runDirectBoardScans for browser/MCP).
5. If browser-based, call `runChromePreflight(SOURCE)` at start.
6. If source-specific preflight is needed (like LinkedIn's snapshot prune), create `scripts/lib/<source>-preflight.mjs` and register (Phase 3.2).
7. Add to `scan-history.tsv` dedup — verify new URLs get deduplicated correctly.
8. Add to `CLAUDE.md` Main Files table if it grows non-trivial.
9. Monitor first 10 runs; compute baseline reliability.

---

## 10. Non-goals / what the pipeline intentionally does NOT do

- **Retry at the orchestrator level.** Individual sources retry; orchestrator trusts their outcome.
- **Persist scan state between runs.** Each run is idempotent modulo scan-history.tsv dedup.
- **Cache source responses.** Firecrawl has its own cache; LinkedIn MCP has its profile; no app-level cache.
- **Parallelize across sources beyond current structure.** Direct APIs run sequentially per batch; Playwright sources serialize to one browser at a time. Premature parallelism = lost debuggability.
- **Email-send from orchestrator.** Daily digest is separate (`scripts/daily-digest-email.mjs` via cron).

---

*See also: `docs/AI-SESSION-CONTINUITY-2026-04-20-night.md` §13-§18 for deeper theory; `docs/RUNBOOK-linkedin-mcp.md` for source-specific ops; `docs/POLICY-mcp-dependencies.md` for MCP management.*
