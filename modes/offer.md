# Mode: offer — Complete A-F Evaluation

When the candidate pastes an offer (text or URL), ALWAYS deliver all 6 blocks:

## Step 0 — Archetype Detection

Classify the offer into one of the 6 archetypes (see `_shared.md`). If hybrid, indicate the 2 closest. This determines:
- Which proof points to prioritize in Block B
- How to rewrite the summary in Block E
- Which STAR stories to prepare in Block F

## Block A — Role Summary

Table with:
- Detected archetype
- Domain (data/automation/BI/ERP/AI/ops-tech)
- Function (build/consult/manage/deploy)
- Seniority
- Remote (full/hybrid/onsite)
- Team size (if mentioned)
- **Semantic Match:** {score}% — run `node scripts/match-jd.mjs --jd=<jd_file>` (run `node scripts/embed-profile.mjs` first if embeddings are missing); format as `{overall}% overall | best archetype: {name} at {score}%`
- TL;DR in 1 sentence

## Block B — CV Match

Read `cv.md`. Create a table mapping each JD requirement to exact lines from the CV.

**Adapted by archetype:**
- If Operational Data Architect → prioritize ERP→BI→AI pipeline proof points, Paradigm API, Inventory Health Index
- If AI Automation / Workflow Engineer → prioritize n8n automation, Jarvis Trader system, zero-handoff architecture
- If BI & Analytics Lead → prioritize Power BI dashboards, Pretium risk dashboards, FirstEnergy analytics
- If Business Systems / ERP Specialist → prioritize ERP integrations, barcode scanning system, ops-to-tech translation
- If Applied AI / Solutions Architect → prioritize system design, Jarvis Trader architecture, enterprise-ready integrations
- If Operations Technology Leader → prioritize COO build story, cross-functional delivery, change management at scale

**ATS Match:** Run `node scripts/ats-score.mjs --cv=cv.md --jd=<jd_file>` and include the percentage score. List the top 5 missing keywords with a one-line suggestion for each (which CV section to inject it into, or a reformulation of existing language).

**Gaps section** with mitigation strategy for each gap. For each gap:
1. Is it a hard blocker or a nice-to-have?
2. Can the candidate demonstrate adjacent experience?
3. Is there a portfolio project that covers this gap?
4. Concrete mitigation plan (phrase for cover letter, quick project, etc.)

## Block C — Level and Strategy

1. **Detected level** in the JD vs **candidate's natural level for that archetype**
2. **"Sell senior without lying" plan**: specific phrases adapted to the archetype, concrete achievements to highlight, how to position the COO/builder experience as an advantage
3. **"If they downlevel me" plan**: accept if comp is fair, negotiate 6-month review, clear promotion criteria

## Block D — Comp and Demand

**Cache check first:** Before running live web searches, check if `data/company-intel/{slug}.md` exists (slug = company name lowercased with hyphens). If it exists and `last_updated` is within 30 days, use the cached Glassdoor, funding, headcount, and compensation data from that file. If the file is missing or stale, run `node scripts/company-intel.mjs --company={name}` to generate the template, then supplement with live WebSearch to fill placeholders.

Use WebSearch for:
- Current salaries for the role (Glassdoor, Levels.fyi, Blind)
- Company's compensation reputation
- Demand trend for the role

Table with data and cited sources. If no data available, say so rather than inventing.

## Block E — Personalization Plan

| # | Section | Current state | Proposed change | Why |
|---|---------|---------------|-----------------|-----|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 CV changes + Top 5 LinkedIn changes to maximize match.

## Block F — Interview Plan

6-10 STAR+R stories mapped to JD requirements (STAR + **Reflection**):

| # | JD Requirement | STAR+R Story | S | T | A | R | Reflection |
|---|----------------|--------------|---|---|---|---|------------|

The **Reflection** column captures what was learned or what would be done differently. This signals seniority — junior candidates describe what happened, senior candidates extract lessons.

**Story Bank:** If `interview-prep/story-bank.md` exists, check if any of these stories are already there. If not, append new ones. Over time this builds a reusable bank of 5-10 master stories that can be adapted to any interview question.

**Selected and framed by archetype:**
- Operational Data Architect → emphasize pipeline design, data modeling, production systems
- AI Automation / Workflow Engineer → emphasize n8n workflows, LLM integration, reliability, zero-handoff systems
- BI & Analytics Lead → emphasize insights delivered, dashboards built, decisions enabled
- Business Systems / ERP Specialist → emphasize integration complexity, operational continuity, bridging ops and tech
- Applied AI / Solutions Architect → emphasize system design, architecture decisions, enterprise-readiness
- Operations Technology Leader → emphasize change management, cross-functional delivery, scale

Include also:
- 1 recommended case study (which project to present and how)
- Red flag questions and how to answer them (e.g., "Why did you leave FirstEnergy?", "You were a COO — why do you want an IC role?", "You don't have a CS degree")

---

## Post-Evaluation

**ALWAYS** after generating blocks A-F:

### 1. Save report .md

Save complete evaluation to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = next sequential number (3 digits, zero-padded)
- `{company-slug}` = company name in lowercase, no spaces (use hyphens)
- `{YYYY-MM-DD}` = current date

**Report format:**

```markdown
# Evaluation: {Company} — {Role}

**Date:** {YYYY-MM-DD}
**Archetype:** {detected}
**Score:** {X/5}
**URL:** {job posting URL}
**PDF:** {path or pending}

---

## A) Role Summary
(full block A content)

## B) CV Match
(full block B content)

## C) Level Strategy
(full block C content)

## D) Comp & Demand
(full block D content)

## E) Personalization Plan
(full block E content)

## F) Interview Plan
(full block F content)

## G) Draft Application Answers
(only if score >= 4.5 — draft answers for the application form)

---

## Extracted Keywords
(list of 15-20 JD keywords for ATS optimization)
```

### 2. Register in tracker

**ALWAYS** register in `data/applications.md`:
- Next sequential number
- Current date
- Company
- Role
- Score: match average (1-5)
- Status: `Evaluated`
- PDF: (or checkmark if auto-pipeline generated PDF)
- Report: relative link to the report .md (e.g., `[001](reports/001-company-2026-01-01.md)`)

**Tracker format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report |
```
