# Career-Ops

**AI-powered job search pipeline built on Claude Code.**

> Customized for Matthew M. Amundson — Operational Data Architect · AI Automation Leader · BI & Analytics

> **New here or returning after a gap?** Read [`docs/OPERATOR-GUIDE.md`](docs/OPERATOR-GUIDE.md) first — single-page entry point covering what's running, how to pause it, and where everything lives.

[![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/code)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org)
[![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)](https://go.dev)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=flat&logo=pnpm&logoColor=white)](https://pnpm.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What Is This

Career-Ops turns Claude Code into a full job search command center. Paste a job description, get a structured A-F evaluation against your CV, an ATS-optimized PDF, and a tracker entry — all in one command.

- **Evaluates offers** with a structured A-F scoring system (6 blocks: role summary, CV match, level strategy, comp research, personalization plan, interview STAR stories)
- **Generates tailored PDFs** — ATS-optimized CVs with keyword injection, Space Grotesk + DM Sans design
- **Scans portals** automatically (Greenhouse, Ashby, Lever, direct company career pages)
- **Processes in batch** — evaluate 10+ offers in parallel with sub-agents
- **Tracks everything** in a single source of truth with integrity checks

Based on [santifer/career-ops](https://github.com/santifer/career-ops) — adapted for data/analytics/AI automation roles.

## Target Archetypes

| Role | What I bring |
|------|-------------|
| **Operational Data Architect** | ERP → BI → AI pipelines, semantic models, production intelligence |
| **AI Automation / Workflow Engineer** | n8n, LLM-enabled workflows, agentic systems, closed-loop automation |
| **BI & Analytics Lead** | Power BI mastery, DAX, enterprise reporting across 6+ companies |
| **Business Systems / ERP Specialist** | Ops-to-tech translation, ERP integrations, end-to-end system design |
| **Applied AI / Solutions Architect** | System design, AI architecture, enterprise-ready solutions |
| **Operations Technology Leader** | COO-level tech execution, cross-functional delivery, real production proof |

## Quick Start

```bash
# 1. Install dependencies
pnpm install
npx playwright install chromium   # Required for PDF generation

# 2. Configure (already done — profile.yml and cv.md are pre-populated)
# Edit config/profile.yml if needed
# Edit cv.md if your CV changes

# 3. Open Claude Code
claude   # Open in this directory

# 4. Start using
/career-ops              # Show all commands
/career-ops {paste JD}   # Auto-pipeline: evaluate + PDF + track
/career-ops scan         # Scan configured portals for new offers
```

## Usage

```
/career-ops                → Show all available commands
/career-ops {paste a JD}   → Full auto-pipeline (evaluate + PDF + tracker)
/career-ops scan           → Scan portals for new offers
/career-ops pdf            → Generate ATS-optimized CV
/career-ops batch          → Batch evaluate multiple offers
/career-ops tracker        → View application status
/career-ops apply          → Fill application forms with AI
/career-ops pipeline       → Process pending URLs
/career-ops contact        → LinkedIn outreach message
/career-ops research       → Deep company research
/career-ops training       → Evaluate a course/cert
/career-ops project        → Evaluate a portfolio project
```

## How It Works

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Detects: Operational Data Architect / AI Automation /
│  Detection       │           BI Lead / Business Systems / Solutions Architect /
└────────┬─────────┘           Operations Tech Leader
         │
┌────────▼─────────┐
│  A-F Evaluation  │  Match, gaps, comp research, level strategy, STAR stories
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf   .md
```

## Dashboard TUI

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard -path ..
```

The `-path` argument is the **career-ops repo root** (parent of `dashboard/`). Features: 6 filter tabs, 5 sort modes (default **focus** = score with Minneapolis-area work-mode bias: hybrid / on-site / MSP-local above same-score fully remote; cycle with `s` for raw score), grouped/flat view, lazy-loaded previews, inline status changes. When `data/events/*.jsonl` exists, the header shows the latest **`scanner.run.completed`** summary line.

### Static HTML dashboard (alternative)

**Which surface when:** [`docs/WHICH-DASHBOARD-WHEN.md`](docs/WHICH-DASHBOARD-WHEN.md) — HTML vs TUI, refresh commands, non-goals. Panel vs data inventory: [`docs/DASHBOARD-HTML-PANELS.md`](docs/DASHBOARD-HTML-PANELS.md).

For a self-contained browser view (no TUI), generate from the repo root:

```bash
pnpm run dashboard
# or: node scripts/generate-dashboard.mjs --open
```

Writes `dashboard.html` at the repo root. Parses `data/applications.md` and `data/pipeline.md` the same way as automation scripts. Includes **Operator health** (stale in-flight applications, recent automation events from `data/events/`, last scanner summary). Status vocabulary is documented in [`docs/STATUS-MODEL.md`](docs/STATUS-MODEL.md). Event log behavior: [`docs/MAINTENANCE-RITUALS.md`](docs/MAINTENANCE-RITUALS.md#automation-event-log-dataevents).

## Project Structure

```
career-ops/
├── cv.md                    ← Canonical CV (source of truth)
├── config/profile.yml       ← Candidate profile and targets
├── portals.yml              ← Companies and search queries
├── modes/                   ← 14 skill modes
│   ├── _shared.md           ← Archetypes, framing, comp intelligence
│   ├── auto-pipeline.md     ← Full pipeline orchestration
│   ├── offer.md             ← A-F evaluation
│   └── ...
├── templates/
│   ├── cv-template.html     ← PDF template (Space Grotesk + DM Sans)
│   └── states.yml           ← Canonical application states
├── data/
│   ├── applications.md      ← Application tracker
│   ├── pipeline.md          ← URL inbox
│   └── events/              ← Local JSONL automation trail (gitignored *.jsonl)
├── reports/                 ← Evaluation reports
├── output/                  ← Generated PDFs
├── batch/                   ← Batch processing
├── dashboard/               ← Go TUI dashboard
└── fonts/                   ← Self-hosted fonts
```

## Integrity Commands

```bash
pnpm run verify      # Tracker + TSV hygiene; missing local reports are warnings
pnpm run verify:all  # verify + CV sync + application index + dashboard.html
pnpm run verify:ci   # same report-tolerant gate for CI / hooks
pnpm run verify:strict      # require all linked report files to exist locally
pnpm run verify:all:strict  # full gate + strict report-link check
pnpm run normalize   # Fix status spelling
pnpm run dedup       # Remove duplicate entries
pnpm run merge       # Merge tracker additions from batch runs
pnpm run dedupe:intake  # data/dedupe-intake-report.md (dup keys + tracker overlaps + prefilter)
pnpm run pipeline:hygiene          # dry-run: dedupe then prune-tracked
pnpm run pipeline:hygiene:apply    # apply both (writes .bak; see docs/MAINTENANCE-RITUALS.md)
pnpm run pipeline:dedupe -- --apply  # collapse duplicate job keys in pipeline*.md
pnpm run pipeline:prune-tracked -- --apply  # drop lines already in tracker reports
pnpm run apply-queue:audit  # apply-queue.md vs applications.md → data/apply-queue-audit.md
pnpm run pipeline:liveness -- --limit=25  # HEAD-check first N pipeline URLs
pnpm run events:prune   # dry-run: drop old data/events/*.jsonl (see MAINTENANCE-RITUALS)
pnpm run secrets:check  # Fail if .env is tracked by git
pnpm run preflight:gmail-sync
pnpm run preflight:cadence-alert
pnpm run preflight:scanner
```

Rituals and hooks: [docs/MAINTENANCE-RITUALS.md](docs/MAINTENANCE-RITUALS.md). **Job source truth:** [docs/SUPPORTED-JOB-SOURCES.md](docs/SUPPORTED-JOB-SOURCES.md). **One-page status:** [docs/SYSTEM-STATUS.md](docs/SYSTEM-STATUS.md).

After you apply to an employer: [docs/APPLICATION-RUNBOOK.md](docs/APPLICATION-RUNBOOK.md). Copy [`.env.example`](.env.example) to `.env` for optional automation.

## Gmail Recruiter Sync

The recruiter-inbox bridge lives in `scripts/gmail-recruiter-sync.mjs`.

It pulls recruiter emails from Gmail, classifies them into response events, tries to match them to existing rows in `data/applications.md`, updates `data/responses.md`, and writes unmatched items to `data/outreach/gmail-sync-review-YYYY-MM-DD.md`.

Detailed setup guide: [docs/GMAIL_SYNC_SETUP.md](docs/GMAIL_SYNC_SETUP.md)

Setup:

```bash
cp scripts/gmail-recruiter-sync.example.env .env
# Fill in:
# - GOOGLE_CLIENT_ID
# - GOOGLE_CLIENT_SECRET
# - GOOGLE_REFRESH_TOKEN
# Optional:
# - GMAIL_RECRUITER_QUERY=label:Recruiting newer_than:14d
# - GMAIL_RECRUITER_MAX=25
```

Run:

```bash
pnpm run gmail-sync:dry   # Inspect matches without writing files
pnpm run gmail-sync       # Apply updates to applications.md + responses.md
```

Scheduler:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-gmail-sync-task.ps1
```

The Gmail task registration script now refuses to install if the required OAuth keys are missing.

## Captcha Escalation

The Playwright ATS submitters now emit a captcha escalation when an actual captcha is detected in the page.

- A screenshot and incident report are written to `data/outreach/`
- The matching application note is annotated when `--app-id` is provided
- If `OPENCLAW_WHATSAPP_TO` is set, the system tries WhatsApp first
- Otherwise it falls back to a local Windows alert dialog

This currently covers the shared pause step used by `submit-icims.mjs` and `submit-workday.mjs`.

## Cadence Alerts

Stale follow-up alerts can now be run directly from the package scripts:

```bash
pnpm run cadence-alert
```

The notifier script loads `.env` automatically, so `OPENCLAW_WHATSAPP_TO` can live there instead of only in the interactive shell.

Scheduler:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-cadence-alert-task.ps1
```

The cadence registration script prints its preflight state before installing, so notification fallback behavior is visible up front.

## Credits

Based on [santifer/career-ops](https://github.com/santifer/career-ops) by Santiago Fernández de Valderrama.
Adapted and customized for Matthew M. Amundson.
