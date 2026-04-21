# Mode: pdf — ATS-Optimized PDF Generation

## Primary path (DOCX) — use this by default

The HTML template pipeline described below has known issues producing empty
sections and stale content. The trustworthy path tailors Matt's professionally
designed master DOCX (`output/Matt_Amundson_TOP_2026.docx`) via python-docx
and converts to PDF via docx2pdf (Word COM automation, Windows).

**Quick use:**
```bash
node scripts/cv-docx-to-pdf.mjs \
  --headline "Data Architect | Snowflake · dbt · Airflow" \
  --summary  "Data & analytics leader with 10+ years..." \
  --out output/cv-acme-data-architect
```

**From a report's YAML frontmatter** (when `cv_headline` + `cv_summary` are set
in the report file):
```bash
node scripts/cv-docx-to-pdf.mjs --from-report reports/NNN-acme-2026-04-21.md --out output/cv-acme
```

Both `.docx` and `.pdf` are produced. Only paragraphs 1 (headline) and 4
(summary) are rewritten; all experience/skills formatting comes from the
master and stays pristine.

**When to fall back to the HTML path:** archetype-variant CVs (different
structural emphasis) still use `scripts/generate-variant.mjs` → `generate-pdf.mjs`.
Those live at `config/archetype-variants.yml`; see step 6 below.

---

## Full pipeline (HTML path — legacy / archetype-variants only)

1. Read `cv.md` as source of truth
2. Ask the user for the JD if not in context (text or URL)
3. Extract 15-20 keywords from the JD
4. Detect JD language → CV language (EN default)
5. Detect company location → paper format:
   - US/Canada → `letter`
   - Rest of world → `a4`
6. Detect role archetype → adapt framing
   - Classify the JD into one of the known archetypes (see `config/archetype-variants.yml`)
   - If `config/archetype-variants.yml` exists and confidence is high (clear primary archetype), auto-select the matching variant slug
   - Use `generate-pdf.mjs --variant={slug}` instead of the generic CV template
   - Fallback to generic CV if: (a) `archetype-variants.yml` does not exist, (b) confidence is low / JD spans multiple archetypes equally, or (c) variant HTML generation fails
   - Known slugs: `operational-data-architect` | `ai-automation-workflow-engineer` | `bi-analytics-lead` | `business-systems-erp-specialist` | `applied-ai-solutions-architect` | `operations-technology-leader`
6b. **ATS pre-flight GATE (hard block):** Run `node scripts/ats-gate.mjs --cv=cv.md --jd=<jd_file> [--company=X --role=Y]`. Exit code is authoritative:
   - **exit 0 (PASSED)** — proceed to PDF generation.
   - **exit 1 (BLOCKED)** — score below threshold (default 60%). STOP. The gate prints the top 3 missing keywords. Either (a) revise the CV to cover them and re-run, or (b) re-run with `--force` if the user has explicitly accepted the low score. Never proceed silently.

   Every invocation emits an `automation.ats_gate.*` event to `data/events/`. The advisory `ats-score.mjs` script remains available for detailed scoring reports, but `ats-gate.mjs` is the required gate for pipeline flows.
7. Rewrite Professional Summary injecting JD keywords + exit narrative bridge ("Built the entire operational tech stack as COO. Now applying that systems thinking to [JD domain] at scale.")
8. Select top 3-4 most relevant projects for the offer
9. Reorder experience bullets by relevance to JD
10. Build competency grid from JD requirements (6-8 keyword phrases)
11. Inject keywords naturally into existing achievements (NEVER invent)
12. Generate complete HTML from template + personalized content
13. Write HTML to `/tmp/cv-matt-{company}.html`
14. Execute: `node generate-pdf.mjs /tmp/cv-matt-{company}.html output/cv-matt-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}`
15. Report: PDF path, page count, % keyword coverage

## ATS Rules (clean parsing)

- Single-column layout (no sidebars, no parallel columns)
- Standard headers: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- No text in images/SVGs
- No critical info in PDF headers/footers (ATS ignores them)
- UTF-8, selectable text (not rasterized)
- No nested tables
- JD keywords distributed: Summary (top 5), first bullet of each role, Skills section

## PDF Design

- **Fonts**: Space Grotesk (headings, 600-700) + DM Sans (body, 400-500)
- **Fonts self-hosted**: `fonts/`
- **Header**: name in Space Grotesk 24px bold + gradient line `linear-gradient(to right, hsl(187,74%,32%), hsl(270,70%,45%))` 2px + contact row
- **Section headers**: Space Grotesk 13px, uppercase, letter-spacing 0.05em, cyan primary color
- **Body**: DM Sans 11px, line-height 1.5
- **Company names**: accent purple `hsl(270,70%,45%)`
- **Margins**: 0.6in
- **Background**: pure white

## Section Order (optimized for "6-second recruiter scan")

1. Header (large name, gradient, contact, portfolio link)
2. Professional Summary (3-4 lines, keyword-dense)
3. Core Competencies (6-8 keyword phrases in flex-grid)
4. Work Experience (reverse chronological)
5. Projects (top 3-4 most relevant)
6. Education & Certifications
7. Skills (languages + technical)

## Keyword Injection Strategy (ethical, truth-based)

Examples of legitimate reformulation:
- JD says "data pipeline architecture" and CV says "ERP to BI workflows" → change to "data pipeline architecture and ERP-to-BI integration"
- JD says "Power BI semantic modeling" and CV says "Power BI dashboards" → change to "Power BI semantic model design and dashboard delivery"
- JD says "stakeholder management" and CV says "partnered with teams" → change to "stakeholder management across engineering, operations, and business units"

**NEVER add skills the candidate doesn't have. Only reformulate real experience with the exact JD vocabulary.**

## HTML Template

Use the template in `templates/cv-template.html`. Replace `{{...}}` placeholders with personalized content:

| Placeholder | Content |
|-------------|---------|
| `{{LANG}}` | `en` |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) or `210mm` (A4) |
| `{{NAME}}` | (from profile.yml) |
| `{{EMAIL}}` | (from profile.yml) |
| `{{LINKEDIN_URL}}` | [from profile.yml] |
| `{{LINKEDIN_DISPLAY}}` | [from profile.yml] |
| `{{PORTFOLIO_URL}}` | [from profile.yml] |
| `{{PORTFOLIO_DISPLAY}}` | [from profile.yml] |
| `{{LOCATION}}` | [from profile.yml] |
| `{{SECTION_SUMMARY}}` | Professional Summary |
| `{{SUMMARY_TEXT}}` | Personalized summary with keywords |
| `{{SECTION_COMPETENCIES}}` | Core Competencies |
| `{{COMPETENCIES}}` | `<span class="competency-tag">keyword</span>` × 6-8 |
| `{{SECTION_EXPERIENCE}}` | Work Experience |
| `{{EXPERIENCE}}` | HTML for each role with reordered bullets |
| `{{SECTION_PROJECTS}}` | Projects |
| `{{PROJECTS}}` | HTML for top 3-4 projects |
| `{{SECTION_EDUCATION}}` | Education |
| `{{EDUCATION}}` | HTML for education |
| `{{SECTION_CERTIFICATIONS}}` | Certifications |
| `{{CERTIFICATIONS}}` | HTML for certifications |
| `{{SECTION_SKILLS}}` | Skills |
| `{{SKILLS}}` | HTML for skills |

## Post-generation

Update tracker if the offer is already registered: change PDF from pending to checkmark.
