# Career-Ops — AI Job Search Pipeline

## What is career-ops

AI-powered job search automation built on Claude Code: pipeline tracking, offer evaluation, ATS-optimized CV generation, portal scanning, batch processing.

Built and customized for Matthew M. Amundson — operational data architect and AI automation leader targeting data, analytics, and AI automation roles across the US (remote preferred, Minneapolis-based).

**The system is designed to be customized by you (Claude).** If the archetypes don't match a new target, scoring weights feel off, or you want to add companies — just ask. You can edit any file in this system.

### Main Files

| File | Function |
|------|----------|
| `cv.md` | Canonical CV — always read before evaluating |
| `article-digest.md` | Proof-point digest — compact metrics per project (companion to cv.md) |
| `config/profile.yml` | Candidate identity, targets, narrative |
| `data/applications.md` | Application tracker |
| `data/pipeline.md` | Inbox of pending URLs |
| `data/scan-history.tsv` | Scanner dedup history |
| `data/events/*.jsonl` | Append-only automation telemetry (scanner, dashboard, index, reports; local / gitignored) |
| `portals.yml` | Query and company config (`job_board_queries` = optional Firecrawl board search when `FIRECRAWL_API_KEY` is set; see `modes/scan.md`) |
| `templates/cv-template.html` | HTML template for CVs |
| `generate-pdf.mjs` | Playwright: HTML to PDF |
| `cv-sync-check.mjs` | CV/profile synchronization check — run to verify consistency |
| `scripts/ats-preflight.mjs` | ATS: `ats-score` → `--write-json`, then `ats-gate` → `--score-file` (one command before PDF) |
| `scripts/prep-queue.mjs` | Phase A batch: GO / Conditional GO → `package-from-report` (+ optional liveness); `pnpm run prep-queue` |
| `scripts/apply-review-batch.mjs` | Phase B': sequence `apply-review --prepare` or `--confirm` for an ID list; `pnpm run apply-review:batch` |
| `scripts/post-apply-refresh.mjs` | Rebuild `data/index` + `dashboard.html`; runs automatically after `apply-review --confirm` (use `--no-refresh` to skip); or `pnpm run post-apply:refresh` / `:open` |
| `scripts/smoke.mjs` | Fast check: `verify-pipeline` + `build:index` + `dashboard` — `pnpm run smoke` (full suite: `pnpm run verify:ci`) |
| `scripts/weekly-scorecard.mjs` | Roadmap scorecard: metrics from `applications.md` + `responses.md`; `pnpm run scorecard:week` |
| `dashboard/` | Go TUI pipeline tracker (`career-dashboard.exe -path .`; rebuild from `dashboard/` after Go changes) |
| `docs/career-search-roadmap-2026.md` | Goals, phase timelines, weekly scorecard — planning layer on top of daily ops |
| `docs/WHICH-DASHBOARD-WHEN.md` | HTML `dashboard.html` vs Go TUI: when to use each, refresh cadence, explicit non-goals |
| `docs/RUNBOOK-linkedin-mcp.md` | Operational response for LinkedIn MCP scan failures (symptom triage, fix recipes) |
| `docs/ARCHITECTURE-scan-pipeline.md` | Scan pipeline architecture: sources, orchestration, event flow, partial_success propagation |
| `docs/POLICY-mcp-dependencies.md` | Version pinning and auth-state backup policy for MCP integrations |
| `interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`) |

### First Run — Onboarding (IMPORTANT)

**Before doing ANYTHING else, check if the system is set up.** Run these checks silently every time a session starts:

1. Does `cv.md` exist?
2. Does `config/profile.yml` exist?
3. Does `portals.yml` exist?

**If ANY of these is missing, enter onboarding mode.** Guide the user step by step:

#### Step 1: CV (required)
If `cv.md` is missing, ask:
> "I don't have your CV yet. You can either:
> 1. Paste your CV here and I'll convert it to markdown
> 2. Paste your LinkedIn URL and I'll extract the key info
> 3. Tell me about your experience and I'll draft a CV for you
>
> Which do you prefer?"

#### Step 2: Profile (required)
If `config/profile.yml` is missing, copy from `config/profile.example.yml` and fill in from the user.

#### Step 3: Portals (recommended)
If `portals.yml` is missing, copy from `templates/portals.example.yml`.

#### Step 4: Tracker
If `data/applications.md` doesn't exist, create it:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

#### Step 5: Ready
Once all files exist, confirm:
> "You're all set! You can now:
> - Paste a job URL to evaluate it
> - Run `/career-ops scan` to search portals
> - Run `/career-ops` to see all commands"

### Personalization

**Common customization requests:**
- "Change the archetypes to [different roles]" → edit `modes/_shared.md`
- "Add these companies to my portals" → edit `portals.yml`
- "Update my profile" → edit `config/profile.yml`
- "Change the CV template design" → edit `templates/cv-template.html`
- "Adjust the scoring weights" → edit `modes/_shared.md` and `batch/batch-prompt.md`

### Skill Modes

| If the user... | Mode |
|----------------|------|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) |
| Asks to evaluate offer | `offer` (also: `oferta`) |
| Asks to compare offers | `compare` (also: `ofertas`) |
| Wants LinkedIn outreach | `contact` (also: `contacto`) |
| Asks for company research | `research` (also: `deep` — alias, same mode) |
| Wants to generate CV/PDF | `pdf` |
| Evaluates a course/cert | `training` |
| Evaluates portfolio project | `project` |
| Asks about application status | `tracker` |
| Fills out application form | `apply` |
| Searches for new offers | `scan` |
| Processes pending URLs | `pipeline` |
| Batch processes offers | `batch` |

### CV Source of Truth

- `cv.md` in project root is the canonical CV
- **NEVER hardcode metrics** — read them from `cv.md` and `config/profile.yml` at evaluation time

---

## Ethical Use — CRITICAL

**This system is designed for quality, not quantity.**

- **NEVER submit an application without the user reviewing it first.** Fill forms, draft answers, generate PDFs — but always STOP before clicking Submit/Send/Apply. The user makes the final call.
- **Discourage low-fit applications.** If a score is below 3.0/5, explicitly tell the user this is a weak match and recommend skipping unless they have a specific reason.
- **Quality over speed.** A well-targeted application to 5 companies beats a generic blast to 50.
- **Respect recruiters' time.** Only send what's worth reading.
- **Weekly scorecard (roadmap).** Suggest `pnpm run scorecard:week` if helpful; the human completes the template and any notes. **Do not** add committed “finished” scorecard files to the repo or fill the ritual end-to-end on their behalf unless they explicitly ask (see `docs/career-search-roadmap-2026.md` §4).

---

## Offer Verification — MANDATORY

**NEVER trust WebSearch/WebFetch to verify if an offer is still active.** ALWAYS use Playwright:
1. `browser_navigate` to the URL
2. `browser_snapshot` to read content
3. Only footer/navbar without JD = closed. Title + description + Apply = active.

---

## Stack and Conventions

- Node.js (mjs modules), Go (TUI dashboard), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data), Shell (batch runner)
- Scripts in `.mjs`, configuration in YAML
- Output in `output/` (gitignored), Reports in `reports/`
- JDs in `jds/` (referenced as `local:jds/{file}` in pipeline.md)
- Batch in `batch/` (gitignored except scripts and prompt)
- Report numbering: sequential 3-digit zero-padded, max existing + 1
- **RULE: After each batch of evaluations, run `node merge-tracker.mjs`** to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.

### TSV Format for Tracker Additions

Write one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT — status BEFORE score):**
1. `num` — sequential number (integer)
2. `date` — YYYY-MM-DD
3. `company` — short company name
4. `role` — job title
5. `status` — canonical status (e.g., `Evaluated`)
6. `score` — format `X.X/5` (e.g., `4.2/5`)
7. `pdf` — `✅` or `❌`
8. `report` — markdown link `[num](reports/...)`
9. `notes` — one-line summary

### Pipeline Integrity

1. **NEVER edit applications.md to ADD new entries** — Write TSV in `batch/tracker-additions/` and `merge-tracker.mjs` handles the merge.
2. **YES you can edit applications.md to UPDATE status/notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `pnpm run verify:all` (alias: `pnpm run check`) or `pnpm run verify:ci` when `reports/*.md` are absent — `verify:all` runs 7 steps including **unit tests** + **recent cron-task failure surface** (last 24h, warn-only; `--strict-cron` to fail); `verify:ci` skips unit tests (CI runs `pnpm test` separately). Includes automation-events JSONL validation. Daily user routine: [`docs/DAILY-USAGE.md`](docs/DAILY-USAGE.md). Rituals: [`docs/MAINTENANCE-RITUALS.md`](docs/MAINTENANCE-RITUALS.md). Optional: `pnpm run events:prune` / `events:prune:apply` trims old `data/events/*.jsonl`.
6. Normalize statuses: `node normalize-statuses.mjs`
7. Dedup: `node dedup-tracker.mjs`

### Canonical States (applications.md)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `GO` | Strong fit — queue for application (use notes for salary/remote context) |
| `Conditional GO` | Good fit — resolve blockers in notes before applying |
| `Ready to Submit` | PDF/answers ready — you are doing final review before send |
| `In Progress` | ATS flow started (partial submit, captcha, multi-step form) |
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company responded (recruiter screen, initial outreach) |
| `Contact` | Active contact with recruiter/hiring manager before formal process |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Discarded permanently — not coming back (offer closed, hard disqualifier) |
| `Deferred` | Paused for priority/strategy reasons — revive if priority reverses |
| `SKIP` | Doesn't fit, don't apply |

**RULES:**
- No markdown bold (`**`) in status field
- No dates in status field (use the date column)
- No extra text (use the notes column)

---
Inspired by the upstream repository: https://github.com/santifer/career-ops
