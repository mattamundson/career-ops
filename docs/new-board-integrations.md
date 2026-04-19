# New Job Board Integrations v15 (2026-04-10)

## Overview
10 new job board scrapers were added for career-ops source expansion. Their maturity is mixed: some are functional standalone fetchers, some are Playwright stubs, and some should remain deferred until they are first-class in the main pipeline.

As of 2026-04-12:
- standalone direct-source scripts now write the canonical pipeline formats when run live
- promoted direct-source scripts can also expose structured results with `--json`
- `scripts/auto-scan.mjs` is the preferred owner of filtering, dedupe, `scan-history.tsv`, and `pipeline.md` writes for any source promoted to first-class status

### JobSpy (`scripts/scan-jobspy.py`) — boards actually scraped

Default `BOARDS` in code: `linkedin`, `indeed`, `glassdoor`, `zip_recruiter`, `google`.

**Wellfound is not in that list** and is **not** collected by JobSpy. Do not document or assume JobSpy coverage for Wellfound until `BOARDS` (or an equivalent supported path) includes it. Today Wellfound is **deferred / manual** per `docs/SUPPORTED-JOB-SOURCES.md` (optional: Firecrawl `site:wellfound.com` queries in `portals.yml` for discovery only).

### Common CLI Usage
```bash
# Dry-run (default, no writes)
node scripts/scan-{board}.mjs --query "data architect" --limit 50

# Structured dry-run for auto-scan integration
node scripts/scan-{board}.mjs --json --query "data architect" --limit 50

# Live write to pipeline
node scripts/scan-{board}.mjs --live --query "analytics engineer" --limit 100
```

### Common Output Format
TSV rows appended to `data/scan-history.tsv`:
```
url\tfirst_seen\tportal\ttitle\tcompany\tstatus
```

Markdown entries appended to `data/pipeline.md`:
```markdown
- [ ] url | Company | Title
```

---

## Board-by-Board Details

### 1. scan-remoteok.mjs ✅ **Functional API**
**Status**: Fully functional public API  
**Endpoint**: `GET https://remoteok.com/api`  
**Method**: JSON array (skip [0] = legal notice), tag+title filtering  
**Rate Limit**: Estimated 100 req/min (undocumented)  
**Example**:
```bash
node scripts/scan-remoteok.mjs --query "power bi" --limit 50
```
**Output**: `[url, title, company, posted_at, ...]` from API  
**Known Issues**: Tag filtering may miss title-only matches  

---

### 2. scan-remotive.mjs ✅ **Functional API**
**Status**: Fully functional public API  
**Endpoint**: `GET https://remotive.com/api/remote-jobs?search=<encoded_query>`  
**Method**: JSON `{jobs: [...]}` response  
**Rate Limit**: Estimated 50 req/min  
**Example**:
```bash
node scripts/scan-remotive.mjs --query "microsoft fabric" --limit 50
```
**Output**: Direct job title match from API  
**Known Issues**: Limited filtering beyond job title  

---

### 3. scan-weworkremotely.mjs ✅ **Functional RSS**
**Status**: Validated through `scripts/auto-scan.mjs` as a working direct-source path  
**Endpoint**: `GET https://weworkremotely.com/categories/remote-programming-jobs.rss`  
**Method**: Regex XML parsing (`<item>` tags), title search  
**Rate Limit**: RSS feed, minimal (cached by CDN)  
**Example**:
```bash
node scripts/scan-weworkremotely.mjs --query "reports developer"
```
**Output**: RSS `<title>`, `<link>`, `<pubDate>` fields  
**Known Issues**: RSS parsing via regex may miss malformed XML  
**Validation**:
```bash
node scripts/auto-scan.mjs --direct-only --dry-run --since=30
node scripts/auto-scan.mjs --direct-only --since=30
```

---

### 4. scan-hired.mjs ⚠ **Stub — Auth Required**
**Status**: NOT YET IMPLEMENTED (requires login)  
**Note**: Hired.com enforces session-based authentication. Public API not available.  
**Workaround**: Manual job submissions only, or contribute MCP-style CLI auth wrapper.  
**Example Output**:
```
[hired] ⚠ Hired.com requires authenticated session — see docs/new-board-integrations.md
```

---

### 5. scan-simplyhired.mjs ⚠ **Cloudflare-Blocked HTML Regex**
**Status**: Structured `--json` output added, but promotion remains disabled because both raw fetch and Playwright browser probes hit Cloudflare block pages in this environment  
**Endpoint**: `GET https://www.simplyhired.com/search?q=<encoded>&l=Remote`  
**Method**: Regex job card parsing (User-Agent header required)  
**Rate Limit**: ~30 req/min (bot detection)  
**Example**:
```bash
node scripts/scan-simplyhired.mjs --query "bi architect" --limit 50
```
**Output**: Extracted from HTML job cards via regex  
**Known Issues**: 
  - HTML structure changes break regex
  - Limited company name extraction
  - Cloudflare challenge currently blocks direct parsing in this environment
  - Playwright probe also returned `Attention Required! | Cloudflare` / `Sorry, you have been blocked`
  - Fallback if cheerio not installed

---

### 6. scan-keyvalues.mjs ✅ **Functional HTML Regex**
**Status**: Functional with regex parsing  
**Endpoint**: `GET https://www.keyvalues.com/jobs`  
**Method**: Regex HTML parsing for job links  
**Rate Limit**: ~50 req/min  
**Example**:
```bash
node scripts/scan-keyvalues.mjs --query "analytics engineer"
```
**Output**: Title/company from HTML job listings  
**Known Issues**: KeyValues focuses on culture fit — may have fewer data architect roles  

---

### 7. scan-dice.mjs 🎭 **Playwright Stub**
**Status**: Stub — Playwright required  
**Target**: `https://www.dice.com/jobs?q=<q>&location=Remote`  
**Method**: Headless browser (Playwright)  
**Installation**:
```bash
pnpm add -D playwright
```
**Example**:
```bash
node scripts/scan-dice.mjs --query "data architect" --live
```
**Current Behavior**: Warns if Playwright not installed; returns empty job list  
**Limitations**: Heavy JavaScript rendering, requires headless browser  

---

### 8. scan-builtin.mjs 🎭 **Playwright Stub**
**Status**: Stub — Playwright required  
**Target**: `https://builtin.com/jobs?search=<q>&remote=true`  
**Method**: Headless browser (Playwright)  
**Installation**:
```bash
pnpm add -D playwright
```
**Example**:
```bash
node scripts/scan-builtin.mjs --query "data architect"
```
**Current Behavior**: Warns if Playwright not installed; returns empty job list  
**Limitations**: SPA with dynamic content loading  

---

### 9. scan-wellfound.mjs 🎭 **Playwright Stub — Infinite Scroll**
**Status**: Stub — Playwright + scroll logic required  
**Target**: `https://wellfound.com/jobs?remote=true&role=<q>`  
**Method**: Headless browser with infinite scroll detection  
**Installation**:
```bash
pnpm add -D playwright
```
**Example**:
```bash
node scripts/scan-wellfound.mjs --query "analytics engineering"
```
**Current Behavior**: Warns if Playwright not installed; returns empty job list  
**Limitations**: Infinite scroll requires multiple scroll + load cycles  

---

### 10. scan-otta.mjs 🎭 **Playwright Stub**
**Status**: Stub — Playwright required (WelcomeToTheJungle)  
**Target**: `https://welcometothejungle.com/en/jobs`  
**Method**: Headless browser (Playwright)  
**Installation**:
```bash
pnpm add -D playwright
```
**Example**:
```bash
node scripts/scan-otta.mjs --query "data architect"
```
**Current Behavior**: Warns if Playwright not installed; returns empty job list  
**Limitations**: Heavy SPA, requires DOM wait for job cards  

---

## HTML Parsing Fallback

For `scan-simplyhired.mjs` and `scan-keyvalues.mjs`: If cheerio is not installed, scrapers fall back to regex HTML parsing which may miss edge cases, malformed HTML, or dynamic content. To avoid edge cases:

```bash
pnpm add cheerio  # Optional, improves robustness
```

---

## Deduplication Logic

All scrapers:
1. Load existing URLs from `data/scan-history.tsv` (first column) into a `Set`
2. Filter fetched jobs: `jobs.filter(j => !seen.has(j.url))`
3. Slice to limit: `.slice(0, limit)`
4. Append to TSV only new URLs

**Important**:
- historical notes in older sessions may still refer to the obsolete legacy TSV shape
- the active canonical shape is now `url, first_seen, portal, title, company, status`
- a direct-source board should not be considered first-class until it flows through the same main-pipeline write path as other supported sources

---

## Dry-Run vs Live

### Dry-Run (Default)
- Fetches jobs from API/HTML
- Prints `DRY-RUN — not writing`
- Prints first 5 results as JSON
- No file writes

### JSON Dry-Run
- Fetches jobs from API/HTML
- Returns a JSON array to stdout
- Intended for orchestration by `scripts/auto-scan.mjs`
- No file writes

### Live Mode
- Fetches jobs
- Deduplicates against scan-history.tsv
- Appends rows to `data/scan-history.tsv` (TSV format)
- Appends entries to `data/pipeline.md` (Markdown list)
- Prints summary: `[source] Query="..." → N new (M total)`

---

## Integration into auto-scan.mjs

Do not wire every standalone board script directly into the hourly scan loop.

Current preferred pattern:
- standalone scripts may expose `--json` for structured dry-run output
- `scripts/auto-scan.mjs` owns filtering, dedupe, `scan-history.tsv`, and `pipeline.md` writes
- only boards with proven runtime behavior should be enabled in `direct_job_board_queries`

Current state:
- `weworkremotely` is the validated reference implementation for a promoted direct-source board
- `simplyhired` remains disabled because the site returns Cloudflare block pages in this environment
- `wellfound`, `dice`, `builtin` standalone, and `otta` are not first-class and should not be wired as if they are production-ready

---

## Testing Checklist

- [ ] All **mainline** scan paths used in `auto-scan.mjs` run with `--dry-run` without crashing (not every experimental script is production-wired — see [SUPPORTED-JOB-SOURCES.md](SUPPORTED-JOB-SOURCES.md))
- [ ] API-based scrapers (remoteok, remotive, weworkremotely) return non-empty job lists
- [ ] HTML-based scrapers that are not blocked (for example keyvalues) return non-empty job lists
- [ ] Stub scrapers (dice, builtin, wellfound, otta) print Playwright warning gracefully
- [x] `scan-weworkremotely` flows through `auto-scan --direct-only` and appends canonical scan-history + pipeline formats
- [ ] Additional promoted direct-source boards flow through `auto-scan` with the same canonical write path
- [ ] Deduplication works: run twice, verify second run returns fewer new jobs
- [ ] Query filtering works: `--query "power bi"` returns BI-related roles only

---

## Known Limitations

1. **API Rate Limits**: RemoteOK, Remotive, etc. may throttle heavy scanning. Space out runs by 30+ seconds.
2. **HTML Changes**: SimplyHired and KeyValues regex parsing breaks if HTML structure changes. Monitor for failures.
3. **Playwright Missing**: Dice, BuiltIn, Wellfound, OTTA stubs warn gracefully but return empty. Install Playwright for functional scrapers.
4. **Infinite Scroll**: Wellfound requires scroll + wait logic — stub only captures static load.
5. **Authentication**: Hired.com requires login — public scraping not available.

---

## Future Enhancements

- Add optional cheerio parsing for robustness (SimplyHired, KeyValues)
- Implement Playwright full scrapers for dice, builtin, wellfound, otta
- Add retry logic + exponential backoff for rate limits
- Wire into daily cron job for automated scanning
- Add job deduplication across multiple query terms


---
Inspired by the upstream repository: https://github.com/santifer/career-ops
