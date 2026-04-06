# Mode: pipeline — URL Inbox (Second Brain)

Processes job URLs accumulated in `data/pipeline.md`. User adds URLs whenever they want, then runs `/career-ops pipeline` to process them all.

## Workflow

1. **Read** `data/pipeline.md` → look for `- [ ]` items in the "Pending" section
2. **For each pending URL**:
   a. Calculate next sequential `REPORT_NUM` (read `reports/`, take highest number + 1)
   b. **Extract JD** using Playwright (browser_navigate + browser_snapshot) → WebFetch → WebSearch
   c. If URL is not accessible → mark as `- [!]` with note and continue
   d. **Run full auto-pipeline**: A-F Evaluation → Report .md → PDF (if score >= 3.0) → Tracker
   e. **Move from "Pending" to "Processed"**: `- [x] #NNN | URL | Company | Role | Score/5 | PDF checkmark`
3. **If 3+ pending URLs**, launch parallel agents (Agent tool with `run_in_background`) to maximize speed.
4. **When done**, show summary table:

```
| # | Company | Role | Score | PDF | Recommended Action |
```

## pipeline.md Format

```markdown
## Pending
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior Data Architect
- [!] https://private.url/job — Error: login required

## Processed
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | Data Architect | 4.2/5 | PDF checked
```

## Intelligent JD Extraction from URL

1. **Playwright (preferred):** `browser_navigate` + `browser_snapshot`. Works with all SPAs.
2. **WebFetch (fallback):** For static pages or when Playwright is not available.
3. **WebSearch (last resort):** Search secondary portals that index the JD.

**Special cases:**
- **LinkedIn**: May require login → mark `[!]` and ask user to paste the text
- **PDF**: If URL points to a PDF, read it directly with the Read tool
- **`local:` prefix**: Read the local file. Example: `local:jds/company-role.md` → read `jds/company-role.md`

## Auto-numbering

1. List all files in `reports/`
2. Extract the number from the prefix (e.g., `142-acme...` → 142)
3. New number = highest found + 1

## Source Sync

Before processing any URL, verify sync:
```bash
node cv-sync-check.mjs
```
If desync detected, warn the user before continuing.
