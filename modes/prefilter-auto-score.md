# Mode: prefilter-auto-score — LLM-assisted quick triage at scan time

Run at scan time to auto-score freshly-generated prefilter templates before Matt reviews. The goal is to land 60%+ of cards with a sane Quick Score + Recommendation so Matt only adjudicates edge cases. Cards where the LLM can't justify a call stay at `status: pending` for manual review.

---

## What this mode does

- Called by `scripts/prefilter-pipeline.mjs --auto-score`
- Input: one prefilter card (company, title, URL, optional company intel) + cv.md + archetype list
- Output: the same block as `modes/prefilter.md` but without requiring the full JD text

## What this mode does NOT do

- Fetch the JD URL (scanner-time scoring only)
- Run comp research, STAR matching, or cover-letter prep
- Replace manual prefilter for high-stakes or ambiguous cards

---

## Inputs

- `company` — full company name (as written in pipeline.md)
- `title` — job title
- `url` — listing URL
- `intel` — optional company intel block if already loaded from `data/company-intel/{slug}.md`
- `cv.md` — source of truth for candidate experience
- Archetype list from `modes/_shared.md`

---

## Scoring rubric

Match the 1–5 scale from `modes/prefilter.md`:

| Score | Meaning |
|-------|---------|
| 5/5 | Title + company + intel strongly signal all 5 canonical requirements match |
| 4/5 | Strong match on title + archetype; likely to fit on JD inspection |
| 3/5 | Archetype plausible; likely fit but can't confirm without JD |
| 2/5 | Partial archetype match or seniority mismatch signaled in title |
| 1/5 | Title/company clearly off-archetype (e.g. "Junior Sales Engineer") |

Half-points allowed (e.g., 3.5/5).

**Work-mode bias (NON-NEGOTIABLE):** If listing signals on-site Minneapolis/MSP, add +0.5 to score (subject to 5/5 cap). If hybrid MSP, +0.25. If remote-only, no boost. Per `feedback_work_mode_priority.md` memory.

## Recommendation mapping

| Score | Recommendation |
|-------|----------------|
| >= 3.5 | EVALUATE |
| 2.5 – 3.4 | MAYBE |
| < 2.5 | SKIP |

**If signal is too thin to call** (e.g., title is ambiguous like "Senior Consultant" with no intel), respond with `Recommendation: UNCLEAR` and the runner will leave `status: pending` for manual review. Do NOT guess.

---

## Output format

Respond with ONLY a JSON object (no prose, no code fence):

```json
{
  "score": 3.5,
  "archetype": "Operational Data Architect",
  "matches": ["..", "..", ".."],
  "gaps": ["..", "..", ".."],
  "recommendation": "EVALUATE"
}
```

Rules:
- `score` ∈ [1.0, 5.0], half-points allowed
- `archetype` must be one of the 6 archetypes in `modes/_shared.md`
- `matches` / `gaps` each exactly 3 entries, short phrases (≤ 80 chars)
- `recommendation` ∈ {"EVALUATE", "MAYBE", "SKIP", "UNCLEAR"}

---

## Prompt template

```
You are Matt Amundson's AI pre-filter. Score a job listing on a 1-5 scale using only the listing metadata + his CV. You are NOT fetching the URL. You are triaging quickly.

Matt's profile:
- Operational data architect + AI automation leader
- Minneapolis-based, on-site MSP > hybrid MSP > remote (strict preference)
- Target archetypes: Operational Data Architect, AI Automation / Workflow Engineer, BI & Analytics Lead, Business Systems / ERP Specialist, Applied AI / Solutions Architect, Operations Technology Leader

CV (canonical):
{cv_text}

Listing:
- Company: {company}
- Title: {title}
- URL: {url}
{intel_block}

Output ONLY the JSON object described in the spec. No markdown. No prose.
```

---

## Guardrails the runner enforces

- Rate limit: 200ms between calls
- Cap: 50 cards per run (override with `--max=N`)
- If API key missing: warn once, no-op (template stays pending)
- If parse fails or `recommendation: "UNCLEAR"`: write `auto_scored: attempted`, leave status `pending`
- If score is valid: write `auto_scored: true`, update all five card fields, set `status` to `evaluate`/`maybe`/`skip`
