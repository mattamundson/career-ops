# Career-Ops User Manual

AI-powered job search pipeline built on Claude Code. Covers evaluation, PDF generation, portal scanning, application tracking, and interview prep.

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Daily Workflow](#2-daily-workflow)
3. [Mode Reference](#3-mode-reference)
4. [Pipeline Flow](#4-pipeline-flow)
5. [A-F Evaluation Blocks](#5-a-f-evaluation-blocks)
6. [Portal Scanning](#6-portal-scanning)
7. [PDF Generation](#7-pdf-generation)
8. [Tracker Management](#8-tracker-management)
9. [Dashboard](#9-dashboard)
10. [Configuration](#10-configuration)
11. [Batch Processing](#11-batch-processing)
12. [Interview Prep](#12-interview-prep)
13. [Troubleshooting](#13-troubleshooting)
14. [Architecture](#14-architecture)

---

## 1. Quick Start

### Prerequisites

- Claude Code with Playwright MCP enabled
- Node.js (pnpm preferred)
- Go (for the TUI dashboard binary)

### Install

```bash
cd C:\Users\mattm\career-ops
pnpm install
```

### Required Files (Onboarding)

Career-ops checks for three files at session start. If any are missing, it enters onboarding mode automatically.

| File | Purpose | What happens if missing |
|------|---------|------------------------|
| `cv.md` | Canonical CV — source of truth | Prompted to paste CV, LinkedIn URL, or describe experience |
| `config/profile.yml` | Candidate identity and targets | Copied from `config/profile.example.yml` and filled in |
| `portals.yml` | Portal and company scan config | Copied from `templates/portals.example.yml` |

If `data/applications.md` does not exist, it is created automatically with the correct headers.

### First Run

Once setup is complete, confirm readiness:

```
/career-ops
```

This shows all available commands. Then evaluate your first job:

```
/career-ops
[paste job URL or JD text]
```

The full pipeline runs automatically: extract JD → evaluate A-F → save report → generate PDF → update tracker.

### CV Sync Check

Before the first evaluation of any session, run:

```bash
node cv-sync-check.mjs
```

Or run the full ritual: `pnpm run verify:all` (includes CV sync, tracker verify, index rebuild, and `dashboard.html`). This verifies `cv.md` and `config/profile.yml` are consistent. If warnings appear, resolve them before proceeding.

After submitting to an employer, update the tracker per [`docs/APPLICATION-RUNBOOK.md`](APPLICATION-RUNBOOK.md).

---

## 2. Daily Workflow

### Morning Routine

1. Open Claude Code in `C:\Users\mattm\career-ops`
2. Run the sync check: `node cv-sync-check.mjs`
3. Check what is in the pipeline inbox: review `data/pipeline.md` for `- [ ]` items
4. Run portal scan to discover new offers:
   ```
   /career-ops scan
   ```
5. Process accumulated pipeline items:
   ```
   /career-ops pipeline
   ```
6. Review the tracker summary:
   ```
   /career-ops tracker
   ```
7. After any batch of evaluations, merge tracker additions:
   ```bash
   node merge-tracker.mjs
   ```

### As Offers Come In (Ad Hoc)

- Paste a URL or JD text directly — no command needed. The auto-pipeline runs.
- If you find something interesting while browsing, add it to `data/pipeline.md` as `- [ ] {url}` and process it later.
- For offers behind a login wall, save the JD text to `jds/{company}-{role}.md` and add `local:jds/{company}-{role}.md` to pipeline.md.

### Weekly

- Run `node verify-pipeline.mjs` to catch any integrity issues
- Run `node normalize-statuses.mjs` to canonicalize any status typos
- Review `interview-prep/story-bank.md` and prepare the highest-probability stories

---

## 3. Mode Reference

Career-ops has 14 modes. They are triggered either by the type of input you provide or by explicit sub-commands.

### Mode Trigger Map

| If you... | Mode triggered |
|-----------|---------------|
| Paste a JD URL or job description text | `auto-pipeline` |
| Say "evaluate offer" or "oferta" | `offer` |
| Say "compare offers" or "ofertas" | `compare` |
| Say "LinkedIn outreach" or "contacto" | `contact` |
| Say "deep research" or "deep" | `research` |
| Say "generate PDF" or "generate CV" | `pdf` |
| Ask about a course or certification | `training` |
| Ask about a portfolio project | `project` |
| Ask about application status | `tracker` |
| Say "fill application" or "apply" | `apply` |
| Say "scan portals" | `scan` |
| Say "process pipeline" | `pipeline` |
| Say "batch process" | `batch` |

---

### auto-pipeline

**What it does:** Full end-to-end pipeline. Extract JD → evaluate → save report → generate PDF → update tracker. This is the default when you paste a URL or JD text.

**Trigger:** Paste any URL or JD text without a sub-command.

**Steps:**
1. Extract JD (Playwright preferred, WebFetch fallback, WebSearch last resort)
2. Run full A-F evaluation
3. Save `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`
4. Generate PDF to `output/cv-matt-{company}-{YYYY-MM-DD}.pdf`
5. If score >= 4.5, generate Section G (draft application answers)
6. Write TSV to `batch/tracker-additions/`
7. Run `node merge-tracker.mjs`

**Example:**
```
https://jobs.lever.co/acme/abc123
```
No command needed. Paste the URL and the pipeline runs.

---

### offer

**What it does:** Full A-F evaluation of a single offer. Identical to auto-pipeline steps 1-2, but stops after saving the report (no PDF unless explicitly requested).

**Trigger:** `/career-ops offer` or say "evaluate this offer"

**Input:** URL, pasted JD text, or both.

**Output:**
- Blocks A through F in the conversation
- Saved report at `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`
- TSV written to `batch/tracker-additions/`

**Example:**
```
/career-ops offer
[paste job description text]
```

---

### compare

**What it does:** Weighted scoring matrix across multiple offers. Ranks them and recommends which to prioritize.

**Trigger:** `/career-ops compare` or say "compare these offers"

**Input:** Two or more offers — can be URLs, pasted text, or references to existing report numbers.

**Scoring dimensions (10 total):**

| Dimension | Weight |
|-----------|--------|
| North Star Alignment | 25% |
| CV Match | 15% |
| Seniority (senior+) | 15% |
| Estimated Comp | 10% |
| Growth Trajectory | 10% |
| Remote Quality | 5% |
| Company Reputation | 5% |
| Tech Stack Modernity | 5% |
| Speed to Offer | 5% |
| Cultural Signals | 5% |

**Output:** Ranked table with weighted totals and a recommendation.

**Example:**
```
/career-ops compare
Offer 1: report #012
Offer 2: [paste JD]
Offer 3: https://boards.greenhouse.io/company/jobs/456
```

---

### contact

**What it does:** Generates a targeted LinkedIn outreach message (300-character limit) for the hiring manager, recruiter, or a team peer at the target company.

**Trigger:** `/career-ops contact` or say "LinkedIn outreach"

**Input:** Company name and role (or URL to the evaluated offer).

**Output:**
- Primary target identified (name, title, LinkedIn search strategy)
- Primary message — 3-sentence framework, ready to paste
- 2-3 alternative targets with justification

**The 3-sentence framework:**
- Sentence 1: Something specific about the company or their data/AI challenge
- Sentence 2: Your biggest quantifiable achievement relevant to that role
- Sentence 3: Low-pressure ask ("15-min chat about [topic]")

**Rules:**
- No corporate-speak
- No "I'm passionate about..."
- Never share phone number
- Maximum 300 characters

**Example:**
```
/career-ops contact
Company: Acme Corp, role: Senior Data Architect (report #007)
```

---

### research

**What it does:** Generates a structured deep-research prompt covering 6 axes. Paste the output into Perplexity, Claude, or ChatGPT for comprehensive company intelligence before an interview.

**Trigger:** `/career-ops research` or `/career-ops deep`

**Input:** Company name and role title.

**Output:** A ready-to-paste research prompt covering:
1. Data/AI strategy — their stack, engineering blog, conference talks
2. Recent moves — hires, acquisitions, product launches, funding
3. Engineering culture — deploy cadence, languages, remote policy, Glassdoor/Blind
4. Likely challenges — scaling problems, data debt signs, day-1 situation
5. Interview intelligence — common questions, values emphasized, candidate reports
6. Positioning — your best story for this specific company

**Example:**
```
/career-ops research
Snowflake — Senior Data Architect
```

---

### pdf

**What it does:** Generates an ATS-optimized, personalized PDF CV for a specific offer.

**Trigger:** `/career-ops pdf` or say "generate PDF"

**Input:** JD text or URL (the offer to tailor the CV for).

**Output:** `output/cv-matt-{company}-{YYYY-MM-DD}.pdf`

Full details in Section 7 of this manual.

**Example:**
```
/career-ops pdf
[paste JD or URL]
```

---

### training

**What it does:** Evaluates whether a course, certification, or training program is worth your time given your target roles.

**Trigger:** `/career-ops training` or say "should I take this course"

**Input:** Course/cert name, provider, estimated time commitment.

**Evaluation dimensions:**

| Dimension | What it evaluates |
|-----------|------------------|
| North Star Alignment | Does it move toward your target archetypes? |
| Recruiter Signal | What do hiring managers see when this appears on a CV? |
| Time and Effort | Weeks × hours/week |
| Opportunity Cost | What you cannot do during that time |
| Risks | Outdated content, weak brand, too basic |
| Portfolio Deliverable | Does it produce a demonstrable artifact? |

**Verdicts:**
- `DO IT` — with 4-12 week plan and weekly deliverables
- `DON'T DO IT` — with a better alternative
- `DO WITH TIMEBOX (max X weeks)` — condensed plan, essentials only

**Example:**
```
/career-ops training
Coursera: "Data Engineering with dbt" — 6 weeks, ~5 hrs/week
```

---

### project

**What it does:** Evaluates whether a portfolio project is worth building, given your target roles.

**Trigger:** `/career-ops project` or say "evaluate this project idea"

**Input:** Project description (idea, stack, estimated effort).

**Scoring dimensions:**

| Dimension | Weight |
|-----------|--------|
| Signal for target roles | 25% |
| Uniqueness | 20% |
| Demo-ability | 20% |
| Metrics Potential | 15% |
| Time to MVP | 10% |
| STAR Story Potential | 10% |

**Verdicts:**
- `BUILD` — with weekly milestones (Week 1: MVP + core metric, Week 2: polish + interview pack)
- `SKIP` — why and what to build instead
- `PIVOT TO [alternative]` — more impactful variant

**Example:**
```
/career-ops project
Build a Power BI semantic model connected to a public dataset (Northwind),
deploy on Azure, write a blog post about it. Maybe 2-3 weeks.
```

---

### tracker

**What it does:** Displays the application tracker with statistics.

**Trigger:** `/career-ops tracker` or ask "what's the status of my applications"

**Input:** None required. Optionally ask to update a specific status.

**Output:**
- Full `data/applications.md` table
- Statistics: total applications, by status, average score, % with PDF, % with report

**To update a status:**
```
/career-ops tracker
Update #007 to Applied
```

**Status lifecycle:** `Evaluated` → `Applied` → `Responded` / `Contact` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

---

### apply

**What it does:** Interactive mode for filling out application forms. Reads the form on screen, loads the prior evaluation report, and generates ready-to-paste answers for each question.

**Trigger:** `/career-ops apply` or say "help me fill this out"

**Best experience:** With Playwright visible (Chrome CDP at port 9222).

**Without Playwright:** Share a screenshot of the form or paste the questions manually.

**Workflow:**
1. Detect active Chrome tab — extracts company + role
2. Search `reports/` for a matching evaluation
3. Load Section G (draft answers) if it exists
4. Warn if the role on screen differs from the evaluated one
5. Identify all form fields: text, dropdowns, Yes/No, salary, upload
6. Generate answers using proof points from Block B and STAR stories from Block F
7. Display formatted output ready for copy-paste

**After submitting:** Confirm submission to update tracker from `Evaluated` to `Applied`.

---

### scan

**What it does:** Scans configured job portals and tracked companies for new offers. Adds new matches to `data/pipeline.md` for later evaluation.

**Trigger:** `/career-ops scan`

**Full details in Section 6 of this manual.**

---

### pipeline

**What it does:** Processes all pending URLs in `data/pipeline.md`. Each item runs the full auto-pipeline.

**Trigger:** `/career-ops pipeline`

**Input:** `data/pipeline.md` (read automatically). No user input needed.

**Output:**
- Reports saved to `reports/`
- PDFs saved to `output/` (for scores >= 3.0)
- Tracker additions in `batch/tracker-additions/`
- Summary table at the end

**If 3+ pending items:** Parallel agents are launched automatically to maximize speed.

**Add items to pipeline manually:**
```markdown
# data/pipeline.md

## Pending
- [ ] https://jobs.lever.co/acme/abc123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Acme | Senior Data Architect
- [ ] local:jds/acme-data-architect.md | Acme | Senior Data Architect
```

---

### batch

**What it does:** Bulk evaluation of many offers. Two modes: Conductor (navigates portals in Chrome in real time) and Standalone (processes a pre-collected URL list via shell script).

**Trigger:** `/career-ops batch`

**Full details in Section 11 of this manual.**

---

## 4. Pipeline Flow

The standard flow from discovery to tracker:

```
1. DISCOVER      Scan portals → pipeline.md (or paste directly)
       ↓
2. EXTRACT       Playwright → WebFetch → WebSearch (JD text)
       ↓
3. EVALUATE      A-F Evaluation (offer mode)
       ↓
4. REPORT        reports/{###}-{company}-{date}.md saved
       ↓
5. PDF           output/cv-matt-{company}-{date}.pdf generated
       ↓
6. ANSWERS       Section G drafted (if score >= 4.5)
       ↓
7. TRACKER       TSV written → merge-tracker.mjs → applications.md
       ↓
8. APPLY         apply mode fills the form → status → Applied
       ↓
9. FOLLOW-UP     contact mode → LinkedIn outreach
       ↓
10. INTERVIEW    research mode → deep prep prompt
```

### JD Extraction Priority

For any URL input:

1. **Playwright** (preferred) — handles SPAs (Lever, Ashby, Greenhouse, Workday)
2. **WebFetch** (fallback) — for static pages
3. **WebSearch** (last resort) — searches secondary portals that index the JD
4. **Manual** — if all three fail, asked to paste or screenshot

### Score Thresholds

| Score | Action |
|-------|--------|
| >= 4.5 | Full pipeline + Section G draft answers |
| >= 3.0 | Full pipeline including PDF |
| < 3.0 | Report and tracker only, no PDF |
| < 3.0 | Explicitly flagged as weak match — candidate advised to skip |

---

## 5. A-F Evaluation Blocks

Every offer evaluation produces six blocks. All are saved to the report `.md` file.

### Block A — Role Summary

A table classifying the offer:

| Field | Example |
|-------|---------|
| Archetype | AI Automation / Workflow Engineer |
| Domain | automation |
| Function | build |
| Seniority | Senior |
| Remote | full remote |
| Team size | 8-person data platform team |
| TL;DR | "Build and maintain n8n-based automation pipelines..." |

The archetype classification drives everything else — which proof points to highlight, how to write the summary, which STAR stories to prepare.

### Block B — CV Match

A table mapping each JD requirement to exact lines from `cv.md`.

- For each match: the JD requirement, the matching CV line, and the strength of the match
- Gaps section: is each gap a hard blocker or nice-to-have? Adjacent experience? Portfolio project that covers it? Concrete mitigation plan

**Proof point prioritization by archetype:**

| Archetype | Primary proof points |
|-----------|---------------------|
| Operational Data Architect | GMS Paradigm ERP API → Power BI → AI alerts; Inventory Health Index |
| AI Automation / Workflow Engineer | n8n automation, Career-Ops command center, zero-handoff architecture |
| BI & Analytics Lead | Power BI dashboards, Pretium risk dashboards, FirstEnergy analytics |
| Business Systems / ERP Specialist | ERP integrations, barcode scanning, ops-to-tech translation |
| Applied AI / Solutions Architect | Career-Ops layered decision pipeline, system design |
| Operations Technology Leader | COO tech stack build, cross-functional delivery, change management |

### Block C — Level and Strategy

1. Detected level in the JD versus the candidate's natural level for that archetype
2. "Sell senior without lying" plan — specific phrases, which COO/builder achievements to highlight
3. "If they downlevel me" plan — accept if comp is fair, negotiate 6-month review with clear promotion criteria

### Block D — Comp and Demand

Live market data from Glassdoor, Levels.fyi, and Blind. Table with:
- Current salary ranges for the role and location
- Company's compensation reputation
- Demand trend
- Cited sources

**Reference ranges (2026, Minneapolis/Remote):**

| Archetype | Remote | Minneapolis |
|-----------|--------|-------------|
| Operational Data Architect | $120K–$160K | $100K–$140K |
| AI Automation / Workflow Engineer | $130K–$170K | $110K–$150K |
| BI & Analytics Lead | $110K–$150K | $95K–$135K |
| Business Systems / ERP Specialist | $110K–$150K | $95K–$130K |
| Applied AI / Solutions Architect | $140K–$180K | $120K–$160K |
| Operations Technology Leader | $150K–$200K | $130K–$175K |

### Block E — Personalization Plan

Top 5 CV changes and top 5 LinkedIn changes to maximize match for this specific offer.

Format:

| # | Section | Current state | Proposed change | Why |
|---|---------|---------------|-----------------|-----|
| 1 | Summary | Generic summary | Inject "data pipeline architecture" and "semantic layer" | Exact JD vocabulary for ATS |

### Block F — Interview Plan

6-10 STAR+R stories mapped to JD requirements.

| Column | Content |
|--------|---------|
| JD Requirement | Exact language from the JD |
| STAR+R Story | Name of the story |
| S | Situation |
| T | Task |
| A | Action |
| R | Result (quantified) |
| Reflection | What was learned / what you would do differently |

The Reflection column signals seniority. Junior candidates describe what happened; senior candidates extract lessons.

Also includes:
- 1 recommended case study — which project to present and how
- Red flag questions with ready answers: "Why leave a COO role?", "You don't have a CS degree", "Why IC after being COO?"

### Section G — Draft Application Answers (score >= 4.5 only)

Ready-to-paste answers for each form question. Tone: "I'm choosing you." Confident, specific, proof-over-assertion.

Framework per question:
- Why this role? → "Your [specific thing] maps directly to [specific thing I built]."
- Why this company? → Concrete detail about the company.
- Relevant experience? → Quantified proof point.
- Good fit? → "I sit at the intersection of [A] and [B], which is exactly where this role lives."

---

## 6. Portal Scanning

### Overview

The scan mode discovers new offers across tracked companies and broad portal searches, then adds them to `data/pipeline.md`. It uses three levels of discovery, all additive.

### Level 1 — Direct Playwright (Primary)

Navigates directly to each company's careers page in real time. Most reliable because:
- Sees live pages, not cached results
- Works with SPAs (Ashby, Lever, Workday, Greenhouse)
- Detects new offers immediately

Every company in `tracked_companies` must have a `careers_url`. Known platform patterns:

| Platform | URL pattern |
|----------|-------------|
| Ashby | `https://jobs.ashbyhq.com/{slug}` |
| Greenhouse | `https://job-boards.greenhouse.io/{slug}` |
| Lever | `https://jobs.lever.co/{slug}` |
| Custom | Company's own careers page |

If a `careers_url` is missing or returns 404, the system finds and saves the correct URL automatically.

### Level 2 — Greenhouse API (Complementary)

For companies on Greenhouse, the JSON API at `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs` returns clean structured data. Faster than Playwright but Greenhouse-only.

### Level 3 — WebSearch Queries (Broad Discovery)

`search_queries` in `portals.yml` use `site:` filters to cover entire portals (all Ashby jobs, all Greenhouse jobs, etc.). Useful for finding companies not yet in `tracked_companies`. Results may be slightly stale.

### Title Filtering

Every candidate offer is filtered against `portals.yml`:

```yaml
title_filter:
  positive:         # At least 1 must match
    - "data architect"
    - "ai automation"
    - "business intelligence"
    # ... 20+ terms
  negative:         # 0 must match
    - "junior"
    - "intern"
    - "entry level"
  seniority_boost:  # Prioritize but not required
    - "senior"
    - "lead"
    - "principal"
```

### Deduplication

New offers are checked against three sources:
1. `data/scan-history.tsv` — exact URL already seen (with status `skipped_dup`)
2. `data/applications.md` — company + role already evaluated
3. `data/pipeline.md` — URL already in the pending queue

### Scan History

`data/scan-history.tsv` records every URL seen:

```
url	first_seen	portal	title	company	status
https://...	2026-02-10	Ashby -- Data Arch	Data Architect	Acme	added
https://...	2026-02-10	Greenhouse -- BI	Junior BI Dev	BigCo	skipped_title
```

Statuses: `added`, `skipped_title`, `skipped_dup`

### Scan Output

```
Portal Scan — 2026-04-07
━━━━━━━━━━━━━━━━━━━━━━━━━━
Queries executed: 12
Offers found: 47 total
Filtered by title: 8 relevant
Duplicates: 3 (already evaluated or in pipeline)
New added to pipeline.md: 5

  + Snowflake | Senior Data Engineer | Ashby -- Data Arch
  + dbt Labs | Analytics Engineer Lead | Greenhouse -- BI
  ...

→ Run /career-ops pipeline to evaluate the new offers.
```

### portals.yml Maintenance

- Always save `careers_url` when adding a company
- Disable noisy queries with `enabled: false`
- Verify `careers_url` periodically — companies change ATS platforms

---

## 7. PDF Generation

### Full Pipeline

When `/career-ops pdf` runs (or is triggered automatically by auto-pipeline):

1. Read `cv.md` as source of truth
2. Extract 15-20 keywords from the JD
3. Detect JD language → CV language (EN default)
4. Detect company location → paper format: US/Canada = letter, rest of world = A4
5. Detect role archetype → adapt framing
6. Rewrite Professional Summary with JD keywords + exit narrative bridge
7. Select top 3-4 most relevant projects
8. Reorder experience bullets by relevance
9. Build competency grid from JD requirements (6-8 phrases)
10. Inject keywords naturally into existing achievements (never inventing)
11. Generate complete HTML from `templates/cv-template.html`
12. Write HTML to `/tmp/cv-matt-{company}.html`
13. Execute: `node generate-pdf.mjs /tmp/cv-matt-{company}.html output/cv-matt-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}`
14. Report: PDF path, page count, keyword coverage percentage

### ATS Rules

- Single-column layout — no sidebars or parallel columns
- Standard section headers: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- No text in images or SVGs
- UTF-8 selectable text (not rasterized)
- No nested tables
- JD keywords distributed: top 5 in Summary, first bullet of each role, Skills section

### Section Order (6-second recruiter scan)

1. Header (large name, gradient line, contact, portfolio link)
2. Professional Summary (3-4 lines, keyword-dense)
3. Core Competencies (6-8 keyword phrases in flex-grid)
4. Work Experience (reverse chronological)
5. Projects (top 3-4 most relevant)
6. Education and Certifications
7. Skills (languages and technical)

### Design

| Element | Spec |
|---------|------|
| Heading font | Space Grotesk 600-700 |
| Body font | DM Sans 400-500 |
| Fonts | Self-hosted in `fonts/` |
| Header gradient | `linear-gradient(to right, hsl(187,74%,32%), hsl(270,70%,45%))` |
| Section headers | Space Grotesk 13px, uppercase, letter-spacing 0.05em, cyan |
| Body | DM Sans 11px, line-height 1.5 |
| Company names | Accent purple `hsl(270,70%,45%)` |
| Margins | 0.6in |
| Background | Pure white |

### Keyword Injection (Ethical)

Only real experience is reformulated — nothing is invented.

- JD says "data pipeline architecture" + CV says "ERP to BI workflows" → rewrite as "data pipeline architecture and ERP-to-BI integration"
- JD says "Power BI semantic modeling" + CV says "Power BI dashboards" → rewrite as "Power BI semantic model design and dashboard delivery"
- JD says "stakeholder management" + CV says "partnered with teams" → rewrite as "stakeholder management across engineering, operations, and business units"

### HTML Template Placeholders

The template at `templates/cv-template.html` uses `{{...}}` placeholders:

| Placeholder | Source |
|-------------|--------|
| `{{NAME}}` | `config/profile.yml` → `candidate.full_name` |
| `{{EMAIL}}` | `config/profile.yml` → `candidate.email` |
| `{{LINKEDIN_URL}}` | `config/profile.yml` → `candidate.linkedin` |
| `{{PORTFOLIO_URL}}` | `config/profile.yml` → `candidate.portfolio_url` |
| `{{LOCATION}}` | `config/profile.yml` → `candidate.location` |
| `{{SUMMARY_TEXT}}` | Personalized summary with JD keywords injected |
| `{{COMPETENCIES}}` | `<span class="competency-tag">...</span>` × 6-8 |
| `{{EXPERIENCE}}` | HTML for each role with reordered bullets |
| `{{PROJECTS}}` | HTML for top 3-4 projects |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) or `210mm` (A4) |

### Cover Letters

If the application form has a cover letter option, one is always generated. Same visual design as the CV. Content maps JD quotes to proof points with links to relevant case studies. Maximum 1 page.

---

## 8. Tracker Management

### File Location

`data/applications.md`

### Format

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 001 | 2026-04-01 | Snowflake | Senior Data Architect | 4.2/5 | Applied | ✅ | [001](reports/001-snowflake-2026-04-01.md) | Strong match, applied |
```

### Status Lifecycle

Pre-submit (human gate — see **`docs/STATUS-MODEL.md`** for full definitions):

```
… → GO / Conditional GO → Ready to Submit → In Progress → Applied
  ↘ SKIP                    ↘ Discarded / Rejected
```

Post-submit:

```
Applied → Responded → Interview → Offer
       ↘ Contact              ↘ Rejected / Discarded
```

| Status | When to use |
|--------|-------------|
| `GO` | Strong fit — queue for application. |
| `Conditional GO` | Good fit — resolve blockers in **Notes** before applying. |
| `Ready to Submit` | Materials ready — you still perform final review and employer submit. |
| `In Progress` | ATS flow started (partial form, captcha, etc.). |
| `Evaluated` | Report completed, pending application decision |
| `Applied` | Application submitted |
| `Responded` | Company reached out (inbound — recruiter screen) |
| `Contact` | You reached out proactively (outbound — LinkedIn message) |
| `Interview` | In the interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Dropped by candidate or offer closed |
| `SKIP` | Doesn't fit — do not apply |

### Status Rules

- No markdown bold (`**`) in the status field
- No dates in the status field (use the date column)
- No extra text in the status field (use the notes column)

### TSV Add Flow (IMPORTANT)

**Never directly add new rows to `applications.md`.** The correct flow is:

1. Each evaluation writes one TSV file to `batch/tracker-additions/{num}-{company-slug}.tsv`
2. Run `node merge-tracker.mjs` to merge all additions into `applications.md`

TSV format (9 tab-separated columns, status BEFORE score):

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/...)\t{note}
```

Example:
```
007	2026-04-07	Snowflake	Senior Data Architect	Evaluated	4.2/5	✅	[007](reports/007-snowflake-2026-04-07.md)	Strong pipeline + BI match
```

**You CAN directly edit `applications.md` to update the status or notes of an existing row.**

### Maintenance Scripts

| Script | Purpose |
|--------|---------|
| `node merge-tracker.mjs` | Merge `batch/tracker-additions/*.tsv` into `applications.md` |
| `node verify-pipeline.mjs` | Health check — reports missing fields, broken links, orphaned files |
| `node normalize-statuses.mjs` | Fix status typos to canonical values |
| `node dedup-tracker.mjs` | Remove duplicate entries (same company + role) |
| `node cv-sync-check.mjs` | Verify `cv.md` and `profile.yml` are consistent |

### Report Naming Convention

```
reports/{###}-{company-slug}-{YYYY-MM-DD}.md

Examples:
  reports/001-snowflake-2026-04-07.md
  reports/042-dbt-labs-2026-04-15.md
```

- `{###}` — 3-digit zero-padded, sequential (max existing + 1)
- `{company-slug}` — lowercase, hyphens for spaces
- `{YYYY-MM-DD}` — date of evaluation

### Report Header Format

Every report MUST include `**URL:**` between Score and PDF:

```markdown
# Evaluation: {Company} — {Role}

**Date:** 2026-04-07
**Archetype:** AI Automation / Workflow Engineer
**Score:** 4.2/5
**URL:** https://jobs.lever.co/company/abc123
**PDF:** output/cv-matt-company-2026-04-07.pdf
```

---

## 9. Dashboard

### Starting the Dashboard

```bash
cd C:\Users\mattm\career-ops
career-dashboard.exe -path .
```

The TUI reads `data/applications.md` and displays a live pipeline view.

### HTML Operator Views

```bash
pnpm run dashboard        # writes dashboard.html
pnpm run review:ui        # writes review.html (apply-review cockpit)
pnpm run review:ui:open   # generate + open review.html
```

- `dashboard.html` = broad operator surface (pipeline, outcomes, health, rollups)
- `review.html` = narrow apply surface (GO / Conditional GO / Ready to Submit)
- `pnpm run post-apply:refresh` regenerates index + both HTML files

### What It Shows

- Full application list with status, score, and PDF indicator
- Statistics: totals by status, average score, coverage percentages
- Color-coded status indicators

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `↑` / `↓` | Navigate rows |
| `Enter` | Open report in default viewer |
| `r` | Refresh data |

---

## 10. Configuration

### config/profile.yml

Single source of truth for personal data. Read by every mode.

Key sections:

```yaml
candidate:
  full_name: "Matthew M. Amundson"
  email: "MattMAmundson@gmail.com"
  location: "Minneapolis, MN"
  linkedin: "linkedin.com/in/mmamundson"
  portfolio_url: ""           # Add live demo URL here

target_roles:
  primary:
    - "AI Automation Engineer"
    - "Operational Data Architect"
    - "BI & Analytics Lead"

compensation:
  target_range: "$130K-180K"
  minimum: "$110K"
  location_flexibility: "Remote preferred, hybrid Minneapolis acceptable"

location:
  timezone: "CT"
  visa_status: "No sponsorship needed"
```

**To update:** Edit `config/profile.yml` directly. Changes take effect immediately on the next evaluation.

### portals.yml

Controls which companies to scan and which roles to include.

Key sections:

```yaml
title_filter:
  positive: [...]     # At least 1 must appear in job title
  negative: [...]     # 0 must appear (filters out junior/intern roles)
  seniority_boost: [] # Prioritize but not required

tracked_companies:
  - name: "Snowflake"
    careers_url: "https://careers.snowflake.com/us/en/search-results"
    enabled: true

search_queries:
  - name: "Ashby -- Data Arch"
    query: 'site:ashbyhq.com "data architect" OR "analytics engineer"'
    enabled: true
```

**To add a company:**
```yaml
tracked_companies:
  - name: "New Company"
    careers_url: "https://jobs.lever.co/newcompany"
    enabled: true
```

**To disable a noisy query:** Set `enabled: false`.

### templates/states.yml

Canonical status values. Do not add custom statuses — use only what is defined here. Run `node normalize-statuses.mjs` to fix any nonstandard values in the tracker.

### cv.md

The canonical CV. All proof points, metrics, and achievements must live here. Never hardcode metrics in the mode files or evaluations — always read from `cv.md` and `article-digest.md`.

Rules:
- Do not modify `cv.md` during evaluations
- When updating your CV, update `cv.md` and then run `node cv-sync-check.mjs`

### article-digest.md (optional)

Compact proof-point digest with precise metrics per project. If it exists, it takes precedence over `cv.md` for article and project metrics (cv.md may have older numbers).

---

## 11. Batch Processing

Two modes: Conductor (Chrome-assisted) and Standalone (script-based).

### Mode A: Conductor (--chrome)

Best when you have a portal open in Chrome and want to process many offers from it in one pass.

```bash
claude --chrome --dangerously-skip-permissions
```

The conductor:
1. Reads `batch/batch-state.tsv` to know what is already processed
2. Navigates the portal in Chrome
3. Extracts URLs from the DOM → appends to `batch/batch-input.tsv`
4. For each pending URL: clicks the offer, reads the JD from DOM, spawns a `claude -p` worker
5. Each worker produces: report `.md`, PDF, tracker TSV
6. Handles pagination automatically
7. Merges tracker additions at the end

Workers run with clean 200K token contexts. The conductor only orchestrates.

### Mode B: Standalone Script

For processing a pre-collected list of URLs without Chrome.

```bash
# Add URLs to batch/batch-input.tsv first
# Format: id\turl\tsource\tnotes

./batch/batch-runner.sh --parallel 3
```

Options:

| Flag | Effect |
|------|--------|
| `--dry-run` | List pending without executing |
| `--retry-failed` | Only retry failed offers |
| `--start-from N` | Start from offer ID N |
| `--parallel N` | N concurrent workers |
| `--max-retries N` | Attempts per offer (default: 2) |

Monitor progress:
```bash
tail -f batch/logs/*.log
```

After completion:
```bash
node merge-tracker.mjs
```

### batch-state.tsv

Tracks progress across runs. If the batch dies, re-running it picks up where it left off.

```
id	url	status	started_at	completed_at	report_num	score	error	retries
1	https://...	completed	2026-04-07	2026-04-07	007	4.2	-	0
2	https://...	failed	2026-04-07	-	-	-	Parse error	1
3	https://...	pending	-	-	-	-	-	0
```

### Error Handling

| Error | Recovery |
|-------|----------|
| Inaccessible URL | Worker marks `failed`, conductor continues |
| JD behind login | Conductor tries DOM read; if fails → `failed` |
| Worker crashes | Conductor marks `failed`, continues. Retry with `--retry-failed` |
| Conductor dies | Re-run reads state, skips completed |
| PDF generation fails | Report `.md` is saved; PDF remains pending |

---

## 12. Interview Prep

### Story Bank

`interview-prep/story-bank.md` accumulates STAR+R stories across all evaluations.

Every time Block F is generated for an offer, new stories are appended to the bank. Over time this builds a pool of 5-10 master stories that can be adapted to any interview question.

**Story format:**

```markdown
## [Story Name]

**Applicable archetypes:** AI Automation, Operational Data Architect
**JD keywords it covers:** data pipeline, automation, zero manual handoffs

| S | T | A | R | Reflection |
|---|---|---|---|------------|
| ... | ... | ... | ... | ... |
```

### STAR+R Framework

Standard STAR stories plus a Reflection column:

| Component | What to cover |
|-----------|--------------|
| S (Situation) | Context — what was the environment and constraints |
| T (Task) | Your specific responsibility |
| A (Action) | What you did, and why those specific choices |
| R (Result) | Quantified outcome |
| Reflection | What you learned / what you would do differently |

The Reflection is what separates senior from junior answers. It shows you extract lessons, not just execute tasks.

### Core Proof Points

These appear across all archetypes. Read actual metrics from `cv.md` and `article-digest.md` before using.

| Project | What it demonstrates |
|---------|---------------------|
| GMS Operational Intelligence Pipeline | End-to-end data pipeline, ERP→BI→AI, zero manual handoffs |
| Inventory Health Index | Domain-specific modeling, consumption patterns, live triggers |
| Barcode Scanning System | Full-stack hardware+software integration, ERP lifecycle |
| n8n Automation | Cross-system monitoring, closed-loop architecture |
| Career-Ops Command Center | Production automation system, layered decision pipeline, observability |
| Pretium Analytics | Enterprise-scale BI, $25B+ distressed debt analysis |
| FirstEnergy | Fortune 200 analytics at utility scale |

### Red Flag Questions

Common red flag questions and ready frameworks:

**"Why did you leave a COO role to become an individual contributor?"**
> "I built the stack. Now I want to go deeper on the technical side at organizations with more scale and more interesting data problems."

**"You were a COO — why do you want an IC role?"**
> "I've been the buyer of these solutions. I know exactly what good looks like and what breaks in production. That perspective is rare on the IC side."

**"You don't have a CS degree."**
> Reference production systems built and deployed. Career-Ops, the GMS pipeline, and the n8n automation are not academic projects.

**"Geographic discount" (paying Minneapolis rates for remote work):**
> "The roles I'm competitive for are output-based, not location-based. My track record doesn't change based on postal code."

### Research Prep (research mode)

Before any interview, run `/career-ops research` to generate a structured prompt. Paste it into Perplexity or Claude for deep company intelligence covering their data strategy, recent moves, engineering culture, and how to position your story for their specific situation.

---

## 13. Troubleshooting

### "The offer URL is not accessible"

Playwright is the primary extractor. If it fails:
1. Try WebFetch as fallback
2. Try WebSearch to find a cached version
3. If the page requires login (LinkedIn, some company portals): save the JD text manually to `jds/{company}-{role}.md` and add `local:jds/{company}-{role}.md` to `pipeline.md`

### "PDF generation failed"

1. Check that `fonts/` directory exists and contains Space Grotesk and DM Sans
2. Check that `generate-pdf.mjs` is accessible: `node generate-pdf.mjs --help`
3. Check that Playwright is installed: `pnpm playwright install chromium`
4. The report `.md` is always saved regardless — PDF can be regenerated later with `/career-ops pdf`

### "Tracker has duplicate entries"

Run:
```bash
node dedup-tracker.mjs
```

Rule: if the same company + role appears more than once, only the most recent entry is kept.

### "Status values are nonstandard"

Run:
```bash
node normalize-statuses.mjs
```

This maps common variants (`evaluated`, `EVALUATED`, `Evaluate`) to the canonical `Evaluated`.

### "cv.md and profile.yml are out of sync"

Run:
```bash
node cv-sync-check.mjs
```

Review the warnings and update the lagging file. The most common cause is updating one without updating the other.

### "Scan found nothing new"

- Check `portals.yml` — are the target companies set to `enabled: true`?
- Check `title_filter.positive` — does it cover the role titles you expect?
- Check that `careers_url` values are current — companies change their ATS platform
- Run a manual Level 3 search: paste a `search_queries` query directly into WebSearch

### "Merge tracker is not picking up new TSVs"

Check `batch/tracker-additions/` — are the TSV files present?

TSV files must be in the correct format: 9 columns, tab-separated, status before score. Run:
```bash
node verify-pipeline.mjs
```

This reports any malformed TSV files.

### "Playwright launches two browsers and breaks"

The Playwright MCP uses a single shared browser instance. **Never run two Playwright operations in parallel.** All Playwright usage is sequential.

### "LinkedIn Easy Apply script can't find the button"

Use a **LinkedIn jobs view URL** (`https://www.linkedin.com/jobs/view/...`), not a company profile or search results page.

If the button is still missing:
- run in visible mode (`--live`, no `--headless`) and log in first
- confirm the posting actually supports Easy Apply
- check `docs/tos-risk-register.md` guardrails and disable flags (`CAREER_OPS_LINKEDIN_EASYAPPLY`, `CAREER_OPS_AUTOAPPLY_DISABLED`)

### "The offer score seems too low / too high"

Scoring weights are in `modes/_shared.md`. To adjust:
- North Star Alignment weight
- The 6 archetypes and their thematic axes
- Remote scoring rules (hybrid outside commute range defaults to 3.0, not 1.0)

Ask Claude to edit `modes/_shared.md` and `batch/batch-prompt.md` to match new preferences.

---

## 14. Architecture

### File Tree

```
C:\Users\mattm\career-ops\
│
├── CLAUDE.md                    # System configuration for Claude Code
├── cv.md                        # Canonical CV (source of truth)
├── article-digest.md            # Proof-point digest with precise metrics
├── portals.yml                  # Portal scan and company configuration
├── generate-pdf.mjs             # Playwright: HTML → PDF
├── merge-tracker.mjs            # Merge TSV additions → applications.md
├── verify-pipeline.mjs          # Pipeline health check
├── normalize-statuses.mjs       # Canonicalize status values
├── dedup-tracker.mjs            # Remove duplicate tracker entries
├── cv-sync-check.mjs            # CV / profile sync verification
│
├── config/
│   ├── profile.yml              # Candidate identity, targets, narrative, comp
│   └── profile.example.yml     # Template for new users
│
├── modes/
│   ├── _shared.md               # Shared context: archetypes, comp ranges, rules
│   ├── auto-pipeline.md         # Full automatic pipeline
│   ├── offer.md                 # A-F evaluation
│   ├── scan.md                  # Portal scanner
│   ├── pdf.md                   # ATS PDF generation
│   ├── contact.md               # LinkedIn outreach
│   ├── compare.md               # Multi-offer comparison
│   ├── apply.md                 # Live application assistant
│   ├── batch.md                 # Bulk processing
│   ├── pipeline.md              # URL inbox processor
│   ├── tracker.md               # Tracker display and updates
│   ├── training.md              # Course/cert evaluation
│   ├── project.md               # Portfolio project evaluation
│   └── research.md              # Deep research prompt generator
│
├── templates/
│   ├── cv-template.html         # HTML template with {{...}} placeholders
│   ├── portals.example.yml     # Template for new portals config
│   └── states.yml              # Canonical status definitions
│
├── fonts/
│   ├── SpaceGrotesk-*.woff2    # Heading font (self-hosted)
│   └── DMSans-*.woff2          # Body font (self-hosted)
│
├── data/
│   ├── applications.md          # Application tracker (never add rows manually)
│   ├── pipeline.md              # URL inbox — pending and processed
│   └── scan-history.tsv         # Dedup history for scanner
│
├── reports/                     # Evaluation reports
│   └── {###}-{company}-{date}.md
│
├── output/                      # Generated PDFs (gitignored)
│   └── cv-matt-{company}-{date}.pdf
│
├── jds/                         # Local JD copies (for login-walled offers)
│   └── {company}-{role}.md
│
├── interview-prep/
│   └── story-bank.md            # Accumulated STAR+R stories
│
├── batch/
│   ├── batch-input.tsv          # URL list for standalone batch
│   ├── batch-state.tsv          # Progress tracking (gitignored)
│   ├── batch-runner.sh          # Standalone orchestrator
│   ├── batch-prompt.md          # System prompt for worker agents
│   ├── logs/                    # Per-offer logs (gitignored)
│   └── tracker-additions/       # TSV files pending merge (gitignored)
│
├── dashboard/
│   └── career-dashboard.exe     # Go TUI binary
│
└── docs/
    └── USER-MANUAL.md           # This file
```

### Data Flow

```
portals.yml
     ↓
scan mode → scan-history.tsv
     ↓
pipeline.md (Pending)
     ↓
pipeline / auto-pipeline mode
     ↓
  ┌──────────────┐
  │ Playwright   │ ← JD extraction
  │ WebFetch     │
  │ WebSearch    │
  └──────────────┘
     ↓
A-F Evaluation (offer mode)
     ↓
  ┌────────────────────────────────────┐
  │ reports/{###}-{company}-{date}.md  │
  └────────────────────────────────────┘
     ↓
pdf mode → output/cv-matt-{company}-{date}.pdf
     ↓
batch/tracker-additions/{num}-{company}.tsv
     ↓
node merge-tracker.mjs
     ↓
data/applications.md
     ↓
dashboard (career-dashboard.exe)
```

### Key Principles

1. **cv.md is never modified by the system.** Only the user updates it. The system reads it.
2. **applications.md is only updated via TSV + merge-tracker.** Never add rows manually.
3. **One Playwright at a time.** The MCP shares a single browser instance.
4. **Every evaluated offer gets a tracker entry.** No exceptions.
5. **Reports always include `**URL:**`.** Between Score and PDF in the header.
6. **Never submit on behalf of the user.** Generate, draft, and prepare — then stop. The user clicks Apply.
7. **Never invent metrics.** Read from `cv.md` and `article-digest.md` every time.
8. **Verify offer is still active with Playwright before applying.** WebSearch results can be stale.

---
Inspired by the upstream repository: https://github.com/santifer/career-ops
