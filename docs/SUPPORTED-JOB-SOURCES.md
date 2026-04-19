# Supported job sources (operator truth)

This matrix is the **runtime policy** for scanners and how reports/dashboard label portals. It is intentionally narrower than “scripts that exist in `scripts/`.”

| Portal pattern | Display label | Policy | Notes |
|----------------|---------------|--------|--------|
| `jobspy/indeed`, `jobspy/linkedin`, `jobspy/glassdoor`, `jobspy/zip_recruiter`, … | Indeed, LinkedIn Jobs, … | **Active** | Written by `scan-jobspy.py` / JobSpy; employer stays in `company`. |
| `greenhouse/…`, `lever/…`, `ashby/…`, `smartrecruiters/…`, `workday/…`, `icims/…`, `workable/…` | `{Company} ({ATS})` | **Active** | Per-company ATS boards from `portals.yml`. |
| `builtin/…` | Built In — … | **Active** | Company column may be `BuiltIn`; jobs are still real employers in titles/links. |
| `firecrawl/…` | Firecrawl — … | **Active** | Query-driven discovery. |
| `direct/weworkremotely` | We Work Remotely | **Active** | Validated RSS direct path. |
| `direct/indeed`, `direct/linkedin-mcp` | Indeed / LinkedIn | **Active** | `scan-indeed.mjs` / `scan-linkedin-mcp.mjs` when enabled in `portals.yml`; same dedupe + title filter as other sources. |
| `direct/simplyhired` | SimplyHired | **Blocked** | Cloudflare / not reliable in this environment — keep disabled in automation. |
| `direct/wellfound` | Wellfound | **Deferred / manual** | Playwright stub; not first-class in auto-scan. |
| `direct/dice` | Dice | **Stub** | Roadmap; not production-ready until implemented and validated. |
| `direct/flexjobs` | FlexJobs | **Deferred / manual** | Paywall / policy risk. |
| `direct/remoteok`, `direct/remotive`, `direct/keyvalues` | … | **Stub** | Fetchers exist; not promoted until same validation bar as We Work Remotely. |

**Contracts (unchanged):**

- `data/scan-history.tsv` — `url`, `first_seen`, `portal`, `title`, `company`, `status`
- `data/pipeline.md` — `- [ ] url | Company | Title`

**Presentation rule:** Source identity comes from **`portal`**, not from overloading `company` for board names. Reports and the dashboard use `scripts/lib/source-labels.mjs` for labels and policy badges.
