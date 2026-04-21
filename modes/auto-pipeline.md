# Mode: auto-pipeline — Full Automatic Pipeline

**Canonical rules:** Tracker statuses = [`templates/states.yml`](../templates/states.yml). New rows = TSV in `batch/tracker-additions/` then `merge-tracker.mjs` only. Reports need `**URL:**` in the header. **Never** final-submit to employer ATS without explicit human approval.

When the user pastes a JD (text or URL) without an explicit sub-command, run the FULL pipeline in sequence:

## Step 0 — Extract JD

If the input is a **URL** (not pasted JD text), use this strategy to extract the content:

**Priority order:**

1. **Playwright (preferred):** Most job portals (Lever, Ashby, Greenhouse, Workday) are SPAs. Use `browser_navigate` + `browser_snapshot` to render and read the JD.
2. **WebFetch (fallback):** For static pages (ZipRecruiter, WeLoveProduct, company career pages).
3. **WebSearch (last resort):** Search for the role title + company on secondary portals that index the JD in static HTML.

**If no method works:** Ask the candidate to paste the JD manually or share a screenshot.

**If the input is JD text** (not a URL): use directly, no fetch needed.

## Step 1 — Prefilter Check + A-F Evaluation

**Before running the full A-F evaluation**, check for an existing prefilter result:

1. Build the expected filename: `data/prefilter-results/{company-slug}-{title-slug}.md`
   - `company-slug` = company name lowercased, spaces → hyphens, no special characters
   - `title-slug` = role title lowercased, same rules
2. If the file exists:
   - Read it and check the `**status:**` field and `**Recommendation:**` field
   - If `status: skip` or `Recommendation: SKIP` → **stop**. Inform the candidate this role was pre-screened as SKIP with the recorded score/rationale. Ask before proceeding.
   - If `status: maybe` or `Recommendation: MAYBE` → **note this** in the report header but continue with full A-F evaluation
   - If `status: evaluate` or `Recommendation: EVALUATE` → continue directly to A-F (no need to re-run prefilter)
   - If `status: pending` → the prefilter template exists but was not scored. Run `prefilter` mode first (Blocks A + simplified B), update the file's status field, then decide based on the score whether to continue with full A-F.
3. If no prefilter file exists → proceed directly with full A-F evaluation (no prefilter gate required for ad-hoc URLs).

Run the full A-F evaluation exactly as in the `offer` mode (read `modes/offer.md` for all A-F blocks).

## Step 2 — Save Report .md
Save the complete evaluation to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` (see format in `modes/offer.md`).

## Step 3 — Generate PDF
Run the full `pdf` pipeline (read `modes/pdf.md`).

## Step 4 — Draft Application Answers (only if score >= 4.5)

If the final score is >= 4.5, generate draft answers for the application form:

1. **Extract form questions**: Use Playwright to navigate the form and take a snapshot. If questions can't be extracted, use the generic questions below.
2. **Generate answers** following the tone guidelines below.
3. **Save in the report** as section `## G) Draft Application Answers`.

### Generic Questions (use if form questions can't be extracted)

- Why are you interested in this role?
- Why do you want to work at [Company]?
- Tell us about a relevant project or achievement
- What makes you a good fit for this position?
- How did you hear about this role?

### Tone for Form Answers

**Position: "I'm choosing you."** The candidate has options and is choosing this company for concrete reasons.

**Tone rules:**
- **Confident without arrogance**: "I've spent years building production data pipelines and AI automation — your role is where I want to apply that experience next"
- **Selective without arrogance**: "I've been intentional about finding a team where I can contribute meaningfully from day one"
- **Specific and concrete**: Always reference something REAL from the JD or company, and something REAL from the candidate's experience
- **Direct, no fluff**: 2-4 sentences per answer. No "I'm passionate about..." or "I would love the opportunity to..."
- **The hook is proof, not assertion**: Instead of "I'm great at X", say "I built X that does Y"

**Framework per question:**
- **Why this role?** → "Your [specific thing] maps directly to [specific thing I built]."
- **Why this company?** → Mention something concrete about the company. "I've been using [product] for [time/purpose]."
- **Relevant experience?** → A quantified proof point. "Built [X] that [metric]."
- **Good fit?** → "I sit at the intersection of [A] and [B], which is exactly where this role lives."
- **How did you hear?** → Honest: "Found through [portal/scan], evaluated against my criteria, and it scored highest."

**Proof points to draw from (read actual metrics from cv.md + article-digest.md):**
- GMS: Paradigm ERP API → Power BI → AI alerts (zero manual handoffs)
- Inventory Health Index: domain-specific consumption model with live reorder triggers
- Barcode scanning: Android + Node.js + Zebra + ERP lifecycle tracking
- n8n automation: cross-system closed-loop operational monitoring
- Career-Ops: multi-source intake, profile-aware scoring, ATS CV generation, recruiter sync
- Pretium: $25B+ distressed debt analysis, risk dashboards
- FirstEnergy: enterprise analytics at Fortune 200 utility scale
- COO exit story: "Built the entire operational tech stack as COO. Now targeting orgs where I can apply that systems thinking at scale."

**Language**: Always in the language of the JD (EN default).

## Step 5 — Update Tracker
Register in `data/applications.md` with all columns including Report and PDF as checkmarks.

## Step 6 — Warm Intros (only if score >= 3.5)

If the final score is >= 3.5, surface 1st/2nd-degree LinkedIn contacts at the target company. Warm intros convert 5-10× colder applications — skipping this step on strong-fit roles leaves the highest-ROI behavior on the table.

Run:
```bash
node scripts/linkedin-warm-intros.mjs --report=reports/{###}-{company-slug}-{YYYY-MM-DD}.md --company="{Company}" --score={score}
```

Behavior:
- The script queries the LinkedIn MCP for people at the target company and appends a `## Warm intros` section to the report (idempotent — re-runs replace the section).
- If LinkedIn MCP isn't authed or the expected tool isn't exposed, the script writes an "MCP unavailable" note plus a manual fallback recipe — never blocks the pipeline.
- Skips silently when score < 3.5.

Then prompt the candidate: "Want me to draft outreach to any of them via `/contact`?" — do NOT send without explicit approval per the CLAUDE.md ethical-use rule.

**If any step fails**, continue with the remaining steps and mark the failed step as pending in the tracker.

---
Inspired by the upstream repository: https://github.com/santifer/career-ops
