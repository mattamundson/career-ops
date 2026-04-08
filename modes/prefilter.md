# Mode: prefilter — Lightweight Two-Tier Evaluation

Run this mode when you want a fast go/no-go decision before committing to a full A-F evaluation. Prefilter runs only Block A and a simplified Block B. It does NOT generate cover letters, comp research, STAR stories, or personalization plans.

---

## When to use prefilter

- Batch processing a large pipeline of URLs
- Quick triage before deciding which roles warrant a full evaluation
- When time is limited and you need a signal, not a full report

---

## Step 0 — Read sources of truth

Read `cv.md` (and `article-digest.md` if it exists) before scoring. Read `config/profile.yml` for candidate identity and targets. Do not skip this — the score depends on actual CV content.

---

## Block A — Role Summary (full, same as offer mode)

Table with:
- Detected archetype (from the 6 archetypes in `_shared.md`)
- Domain (data/automation/BI/ERP/AI/ops-tech)
- Function (build/consult/manage/deploy)
- Seniority
- Remote (full/hybrid/onsite)
- Team size (if mentioned)
- TL;DR in 1 sentence

---

## Block B — Simplified CV Match (top 5 requirements only)

Do NOT run the full gap analysis or ATS score. Instead:

1. Extract the **top 5 stated requirements** from the JD (the ones that would make or break fit)
2. For each, map to the single strongest matching line or proof point from `cv.md` / `article-digest.md`
3. Note if a requirement is unmet — one word is enough ("Missing", "Partial", or the matched proof)

No mitigation strategy. No ATS keyword list. No cover letter framing.

---

## Scoring

Score on a 1–5 scale based on the 5 requirements matched:

| Score | Meaning |
|-------|---------|
| 5/5 | All 5 requirements met with strong direct proof |
| 4/5 | 4 strong matches, 1 partial or missing |
| 3/5 | 3 solid matches, 2 partial/missing |
| 2/5 | 2 or fewer matches, significant gaps |
| 1/5 | Fundamental mismatch — wrong archetype, wrong level, wrong domain |

Half-points allowed (e.g., 3.5/5) when a requirement is partially met.

---

## Output Format

Deliver exactly this block — no additional prose:

```
**Archetype:** {classification}
**Quick Score:** {1-5}/5 — {one-line rationale}
**Top 3 Matches:**
- {proof point from CV}
- {proof point from CV}
- {proof point from CV}
**Top 3 Gaps:**
- {gap or "None" if score >= 4.5}
- {gap}
- {gap}
**Recommendation:** EVALUATE | MAYBE | SKIP
```

### Recommendation thresholds

| Score | Recommendation |
|-------|----------------|
| >= 3.5 | **EVALUATE** — proceed to full A-F evaluation (`offer` mode or `auto-pipeline`) |
| 2.5 – 3.4 | **MAYBE** — review manually; may be worth pursuing if a specific gap is addressable |
| < 2.5 | **SKIP** — move on; not worth full evaluation time |

---

## Post-Prefilter

**Do NOT:**
- Save a full report .md
- Update `data/applications.md` tracker
- Generate a PDF
- Run ATS scoring

**DO:**
- If result file exists at `data/prefilter-results/{company-slug}-{title-slug}.md`, update the `status` field from `pending` to `evaluate`, `maybe`, or `skip` and fill in the scored output
- If the recommendation is EVALUATE, inform the candidate and offer to run the full pipeline immediately

---

## Archetype Reference

See `_shared.md` for the full 6-archetype table. Quick reference:

| Archetype | Signal keywords |
|-----------|----------------|
| Operational Data Architect | ERP, data pipeline, semantic layer, data modeling |
| AI Automation / Workflow Engineer | n8n, LLM workflow, agents, automation, zero-handoff |
| BI & Analytics Lead | Power BI, DAX, SQL, dashboards, reporting |
| Business Systems / ERP Specialist | ERP, CRM, integrations, barcode, ops-to-tech |
| Applied AI / Solutions Architect | system design, LLM, enterprise AI, solutions architecture |
| Operations Technology Leader | COO, VP Ops, change management, cross-functional, transformation |
