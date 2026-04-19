# Dashboard Response Tracker Integration

## Overview

The career-ops dashboard now consolidates response tracking directly into a visual dashboard, eliminating the need for a separate spreadsheet. All submissions and pipeline events are logged via CLI commands, parsed by `scripts/generate-dashboard.mjs`, and rendered as interactive sections.

## Schema

Response data is stored in `data/responses.md` as a markdown table with the following columns:

| Column | Format | Notes |
|--------|--------|-------|
| `app_id` | `001`, `002`, etc. | Zero-padded integer ID |
| `company` | Text | Company name |
| `role` | Text | Job title |
| `submitted_at` | `YYYY-MM-DD` | Application date |
| `ats` | `Lever`, `Greenhouse`, `iCIMS`, etc. | ATS platform |
| `status` | Event type | Current status (see Valid Events below) |
| `last_event_at` | `YYYY-MM-DD` | Most recent update date |
| `response_days` | Integer \| `—` | Days from submitted to last event |
| `notes` | Text | Free-form notes, semicolon-delimited for multiple updates |

### Valid Event Types

- `submitted` — Initial application sent
- `acknowledged` — Auto-reply or ATS receipt confirmation
- `recruiter_reply` — Human recruiter first contact
- `phone_screen_scheduled` — Phone screen calendar slot confirmed
- `phone_screen_done` — Phone screen completed
- `on_site_scheduled` — On-site interview scheduled
- `on_site_done` — On-site interview completed
- `offer` — Offer received
- `rejected` — Rejection received
- `withdrew` — Candidate withdrew
- `ghosted` — No response after 14 days
- `in_progress` — Partial submission (e.g., multi-step ATS form)

## Dashboard Sections

### 📈 Response Rate Metrics
Conversion funnel showing:
- **Applied → First Reply**: count + percentage of apps that received any response
- **First Reply → Phone**: count + percentage of replied apps reaching phone screen
- **Phone → On-Site**: count + percentage of phone screens advancing to on-site
- **On-Site → Offer**: count + percentage of on-sites converting to offers

Derived from status classifications:
- Reply status = any status NOT `submitted` or `ghosted`
- Phone status = statuses containing `phone_screen`, `on_site_*`, or `offer`
- On-site status = statuses containing `on_site_*` or `offer`
- Offer status = exactly `offer`

### Applied (Last 30 Days)
Table of all applications submitted in the past 30 days, sorted by submission date (newest first).
Columns: `#`, Company, Role, Submitted, ATS, Status, Days.

### Pending Response (>7 days)
Table of applications still in `submitted` status with no response for >7 days. Each row includes a copy-paste CLI command to log the next event:
```bash
node scripts/log-response.mjs --app-id 011 --event recruiter_reply --notes ""
```

### Active Conversations
Table of submissions currently in active conversation stages (phone_screen, on_site, or offer). Shows timeline (days since submission).

### Earlier Sections
- **Daily Goal** — visualizes applications submitted today vs. 50/day target
- **Response Funnel** — funnel visualization of submission → acknowledged → interview → offer
- **Follow-up Queue** — submissions >7 days without response, flagged for LinkedIn outreach
- **Channel Performance** — ATS breakdown with reply rate by platform

## CLI Commands

### Single Event Logging

```bash
# Log a new application
node scripts/log-response.mjs --new \
  --company "Acme Corp" \
  --role "Senior Data Engineer" \
  --ats Lever \
  --date 2026-04-10

# Log a follow-up event
node scripts/log-response.mjs --app-id 011 --event recruiter_reply --date 2026-04-12 --notes "Jen from talent team"

# Log phone screen completion
node scripts/log-response.mjs --app-id 011 --event phone_screen_done --date 2026-04-15
```

### Bulk Event Loading

Load multiple events from a YAML or JSON file:

```bash
node scripts/log-response.mjs --bulk events.yaml
```

**YAML Format** (`events.yaml`):
```yaml
events:
  - app_id: "011"
    event: recruiter_reply
    date: 2026-04-12
    notes: "Initial recruiter outreach"
  - app_id: "012"
    event: phone_screen_scheduled
    date: 2026-04-13
    notes: "Scheduled for Tuesday 2pm"
```

**JSON Format** (as fallback):
```json
[
  { "app_id": "011", "event": "recruiter_reply", "date": "2026-04-12", "notes": "..." },
  { "app_id": "012", "event": "phone_screen_scheduled", "date": "2026-04-13" }
]
```

The script auto-detects format and processes all valid entries.

## Dashboard Generation

Regenerate the dashboard after logging events:

```bash
# One-time generation
node scripts/generate-dashboard.mjs

# Generate and auto-open in browser
node scripts/generate-dashboard.mjs --open
```

The script:
1. Parses `data/responses.md`, `data/applications.md`, and pipeline data
2. Computes metrics and derives section content
3. Writes `dashboard.html` (self-contained; can be opened offline)

Auto-refresh is set to 3600 seconds (1 hour) in the HTML `<meta>` tag.

## Example Workflow

1. **Submit application**:
   ```bash
   node scripts/log-response.mjs --new --company "TechCorp" --role "ML Engineer" --ats Greenhouse
   ```
   Output: `Added new entry #007: TechCorp — ML Engineer (Greenhouse)`

2. **Recruiter replies**:
   ```bash
   node scripts/log-response.mjs --app-id 007 --event recruiter_reply --date 2026-04-12
   ```

3. **Regenerate dashboard**:
   ```bash
   node scripts/generate-dashboard.mjs --open
   ```

4. **View metrics**:
   Open `dashboard.html` → scroll to "Response Rate Metrics" to see funnel progression.

## Implementation Details

### Parsing
- `parseResponses()` in `generate-dashboard.mjs` extracts rows from markdown table
- Each row is parsed into a JS object with typed fields
- Invalid rows are silently skipped

### Metric Calculation
- `response_days` is auto-computed from `submitted_at` and `last_event_at`
- Funnel stages are derived from status field, not separate columns
- Percentages are calculated per stage relative to the prior stage

### Bulk Loading
- `loadBulkEvents()` in `log-response.mjs` parses YAML or JSON
- Simple regex-based YAML parser; no external dependency needed
- Falls back to JSON for `.json` files
- Invalid app_ids or event types are warned but don't halt processing

## Files Modified

- `scripts/generate-dashboard.mjs` — added 5 new section generators
- `scripts/log-response.mjs` — added `--bulk <file>` support
- `dashboard.html` — regenerated with new sections
- `docs/dashboard-response-tracker.md` — this file

---
Inspired by the upstream repository: https://github.com/santifer/career-ops
