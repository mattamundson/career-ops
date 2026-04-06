# Career-Ops

**AI-powered job search pipeline built on Claude Code.**

> Customized for Matthew M. Amundson — Operational Data Architect · AI Automation Leader · BI & Analytics

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
./career-dashboard
```

Features: 6 filter tabs, 4 sort modes, grouped/flat view, lazy-loaded previews, inline status changes.

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
│   └── pipeline.md          ← URL inbox
├── reports/                 ← Evaluation reports
├── output/                  ← Generated PDFs
├── batch/                   ← Batch processing
├── dashboard/               ← Go TUI dashboard
└── fonts/                   ← Self-hosted fonts
```

## Integrity Commands

```bash
pnpm run verify      # Health check
pnpm run normalize   # Fix status spelling
pnpm run dedup       # Remove duplicate entries
pnpm run merge       # Merge tracker additions from batch runs
```

## Credits

Based on [santifer/career-ops](https://github.com/santifer/career-ops) by Santiago Fernández de Valderrama.
Adapted and customized for Matthew M. Amundson.
