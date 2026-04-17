# GBrain Integration Reassessment + Plan (2026-04-17 16:08 CDT)

**Supersedes:** `docs/IMPLEMENTATION-PLAN-2026-04-17-top10-roi.md` for any item that gbrain subsumes. Items not subsumed (scoring, CV gen, Go TUI, submitter scripts) stay in that plan.

## Premise

The prior 10-item plan was point-solutions (outcome loop, urgency multiplier, next-5 card, gmail heartbeat, follow-up drafts, warm-intro surfacer). Each rebuilds a small piece of infrastructure that **gbrain already provides as a first-class primitive**.

- Outcome timeline → gbrain `timeline_entries` (append-only evidence per page, built-in)
- Company/person graph → gbrain `links` + `traverse_graph` (directed edges, MCP-exposed)
- Hybrid retrieval → gbrain `query` (vector + keyword + RRF + intent classification)
- Recurring ingestion → gbrain cron contract (5-min staggered slots, quiet-hours gate, idempotency)
- Nightly consolidation → gbrain "dream cycle" (enrich-thin → fix-citations → memory-consolidate)
- Skill dispatch → gbrain `skills/RESOLVER.md` (thin harness, fat markdown)
- MCP facade → 30 tools defined once, exposed as CLI + MCP from a single operations table

**License**: MIT, copy-friendly, fork-friendly. No attribution gymnastics.

## What career-ops keeps (no gbrain equivalent)

- `scripts/lib/scoring-core.mjs` — `computeApplicationPriority` with location + urgency multipliers
- `scripts/auto-scan.mjs` — portal orchestrator (Indeed, LinkedIn MCP, direct boards)
- `generate-pdf.mjs` + `templates/cv-template.html` — CV rendering
- `dashboard/` — Go TUI
- `scripts/submit-*.mjs` — ATS submit automation
- All human-confirmation rules (no auto-submit; score-gated recommendations)

## What gbrain replaces or subsumes

| career-ops asset | gbrain replacement | Disposition |
|---|---|---|
| `data/applications.md` | pages `type=application` w/ timeline | Brain becomes authoritative after Phase 3 |
| `data/company-intel/*.md` | pages `type=company` + `enrich` skill | Brain replaces; intel dir retired |
| `data/responses.md` | timeline entries on application pages | Brain authoritative; `log-response.mjs` writes via MCP |
| `data/outreach/*.md` | pages `type=outreach` linked to person pages | Brain authoritative |
| `data/events/*.jsonl` | `ingest_log` table | Brain replaces |
| `reports/*.md` | pages `type=evaluation` linked to application | Brain replaces; files become generated view |
| `data/embeddings/profile-embeddings.json` | `content_chunks` table w/ HNSW | Brain replaces |
| `scripts/generate-followups.mjs` (planned) | dream-cycle job + `maintain` skill | Brain provides; no new code |
| LinkedIn warm-intro plan (Task 7) | `add_link` + `traverse_graph` | Brain provides |

## What gbrain brings that the prior plan didn't have

- **Graph-shaped memory** — person → works_at → company, application → at → company, person → introduced → person. Queries like "who at KinderCare do I know 2nd-degree?" become a single MCP call.
- **Compiled-truth + timeline split** — each page has the canonical state AND the append-only evidence that produced it. No more hand-reconciled markdown.
- **Dream cycle** — nightly entity sweep + citation fix + memory consolidate. Converts career-ops from manual hygiene to autonomous hygiene.
- **Hybrid search with HNSW + tsvector** — fast semantic retrieval across 610 intel files, 31 applications, 1906 pipeline entries from a single query.
- **Version snapshots** — `page_versions` captures every rewrite. Never lose "what did the scorecard look like before I revised it."

## Scope and phases

**Hard rule across all phases**: career-ops' existing markdown files stay on disk untouched through Phase 3. Brain shadows first; authority transfers only after validation gate passes at each phase.

### Phase 0 — Vendored reference + plan commit (this step, ~10 min)

- Clone gbrain into `vendor/gbrain/` (gitignored; local-only reference material)
- Commit this plan doc
- **Gate**: plan in tree. No runtime installed yet.

### Phase 1 — Runtime + empty brain (~20 min)

- Install Bun via its PowerShell installer (`%USERPROFILE%\.bun\bin\bun.exe` — user-scope, no admin)
- `bun install` gbrain deps inside `vendor/gbrain/`
- `gbrain init` creates `~/brain/` with PGLite DB
- `gbrain serve` smoke-test — MCP stdio responds to `list_tools`
- **Gate**: `bun --version` + `gbrain query "test"` both succeed. No career-ops data imported.

### Phase 2 — Shadow import (read-only) (~30 min)

- `gbrain migrate --from markdown --src C:\Users\mattm\career-ops\data\company-intel/` → 610 `type=company` pages
- `gbrain migrate --from markdown --src C:\Users\mattm\career-ops\reports/` → 31 `type=evaluation` pages
- Custom importer for `data/applications.md` (markdown table → 31 `type=application` pages with timeline reconstructed from `data/responses.md`)
- Add directed links: application → at → company, evaluation → for → application
- **Gate**: `gbrain query "kindercare"` returns the application + the evaluation + any intel. 6 spot-check queries against Matt's last-10 evaluations all resolve. Original career-ops files untouched.

### Phase 3 — Dashboard reads brain (~45 min)

- `scripts/generate-dashboard.mjs` gains a brain client (MCP stdio or direct PGLite read)
- "Next 5 Applications" card augments each row with: warm-intro count (`traverse_graph` from company), most-recent timeline event, intel freshness
- New dashboard section: "Graph highlights" — companies with the most warm-intro paths, person pages with the most activity
- **Gate**: dashboard renders with brain-sourced data; legacy card flow remains functional if `BRAIN_DISABLE=1`. Tests pass.

### Phase 4 — Brain becomes authoritative for outcomes (~60 min)

- `scripts/log-response.mjs` adds `--brain` flag: primary write is to brain timeline, responses.md becomes a generated view via `gbrain render`
- `scripts/auto-scan.mjs` ingests portal results directly into brain pipeline pages
- MCP tools for prefilter/evaluate so prefilter agents read + write brain directly
- Dream-cycle config: nightly at 2am CDT, enrich thin company pages (the 610 TODO-filled intel stubs), fix missing citations in reports
- **Gate**: 3 nights of dream-cycle runs in `data/events/` + visible timeline growth on ≥20 pages. Old responses.md still writeable as a manual fallback.

### Phase 5 — Retire redundancy (~30 min)

- Remove `data/company-intel/` (brain authoritative; gitignored anyway)
- Remove or archive `data/responses.md`, `data/applications.md`, `data/pipeline.md` as generated views only
- Scorer (`scoring-core.mjs`) reads from brain via MCP client
- `cv.md` + Matt's profile.yml ingested as `type=person` page for `mmamundson` — CV generator reads from brain
- **Gate**: `pnpm test` still green. End-to-end: paste a JD URL → full pipeline uses only brain. Legacy markdown files gone or archived.

## Installation reality on Windows 11

| Dependency | Install path | Risk |
|---|---|---|
| **Bun** | `powershell -c "irm bun.sh/install.ps1 \| iex"` — user-scope, `%USERPROFILE%\.bun` | Low. Uninstall = `rmdir %USERPROFILE%\.bun`. |
| **PGLite** | pure JS via `@electric-sql/pglite` | Zero. Works on Windows without a Postgres server. |
| **OpenAI API key** | `.env` — already in career-ops' loader | Low. Existing `loadProjectEnv()` handles it. |
| **ngrok** for remote MCP | `ngrok.exe` Windows binary | **Skip.** Career-ops is local-only. No remote MCP needed. |
| **Supabase $25/mo** | N/A | **Skip.** PGLite is sufficient. |
| **Crontab + quiet-hours bash gate** | bash-centric | **Adapt to Windows Task Scheduler.** Translate `scripts/quiet-hours-gate.sh` → PowerShell. career-ops already has `scripts/register-*-task.ps1` as template. |

## What we're NOT installing

- **Remote MCP / ngrok** — career-ops is one-user, one-machine. No Slack, no Discord, no external clients.
- **Publish skill** — sharing password-protected HTML pages is out of scope.
- **Supabase Pro** — PGLite covers the single-machine use case.
- **data-research YAML recipes** — career-ops' prefilter + evaluate modes already cover structured extraction.
- **Circleback meeting-ingestion** — Matt doesn't use Circleback.
- **Twilio voice-brain** — no voice flow needed.

## Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Bun install corrupts PATH / conflicts with Node | Low | Low | User-scope install; Node stays as-is; `bun` binary is standalone |
| PGLite DB corruption | Low | Medium | Commit DB file to local-only backup; rebuild from markdown source possible until Phase 5 |
| Migration loses data from `applications.md` | Medium | **High** | Phase 2 is read-only shadow. Original file untouched until Phase 5 gate passes. |
| Dream-cycle rewrites compiled_truth badly | Medium | Medium | `page_versions` captures every change. Revert via `revert_version` MCP tool. |
| Cron adaptation to Windows breaks schedule | Medium | Low | Fall back to manual `bun run` + `gbrain sync-brain` until Task Scheduler is verified. |
| Bun-only skills break on Node-based career-ops workflows | Low | Medium | career-ops keeps its Node scripts; brain is a sidecar, not a replacement. |
| Hybrid search embeddings cost (OpenAI) balloons | Low | Low | 610 intel + 31 apps + 2042 pipeline ≈ ~3k pages × 5 chunks × ~500 tokens = ~7.5M tokens; `text-embedding-3-small` = $0.02/M → **~$0.15 one-shot**. Ongoing incremental ≈ pennies. |

## Immediate next actions (executing now)

1. Clone gbrain → `vendor/gbrain/` (gitignored)
2. Commit this plan doc + add `vendor/` to `.gitignore`
3. Install Bun via PowerShell user-scope installer
4. `bun install` in `vendor/gbrain/`
5. `gbrain init` on a scratch path
6. Smoke-test `gbrain query` against an empty brain
7. Report back + pause before Phase 2 data migration

Phases 2–5 are staged but not auto-executed — each has a gate and a written validation check. Matt can interrupt at any phase boundary.
