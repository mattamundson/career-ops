# ATS JSON API Submitters — Technical Documentation

## Overview

Five Node.js ESM submitters automate JSON API applications to the four major ATS platforms. All follow a consistent pattern:
- CLI args: `--app-id <N>` (reads from `data/applications.md`), `--pdf <path>`, `--cover-letter <path>`, `--dry-run` (default), `--live` (required to POST)
- Dry-run mode prints the full request (endpoint, headers, payload) without sending
- Live mode POSTs via native `fetch()` and logs response to `data/responses.md` via `log-response.mjs`
- Exit code 0 on success, 1 on failure

---

## Greenhouse (Boards API)

**Submitter:** `scripts/submit-greenhouse.mjs`

### Endpoint
```
POST https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{job_id}/applications
Content-Type: multipart/form-data
```

### URL Extraction
```
Pattern: https://boards.greenhouse.io/{board_token}/jobs/{job_id}
Example: https://boards.greenhouse.io/agilityrobotics/jobs/5841009004
├─ board_token = "agilityrobotics"
└─ job_id = "5841009004"
```

### Field Map
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `first_name` | string | ✓ | Candidate first name |
| `last_name` | string | ✓ | Candidate last name |
| `email` | string | ✓ | Email address |
| `phone` | string | ✓ | Phone number |
| `resume` | file | ✓ | PDF file (multipart upload) |
| `cover_letter` | file | ✗ | Optional cover letter file |
| `linkedin_profile_url` | string | ✗ | LinkedIn profile (optional) |
| `github_profile_url` | string | ✗ | GitHub profile (optional) |

### Authentication
Public endpoint — no authentication required.

### Known Gotchas
- Greenhouse typically has NO captcha on public boards
- Single-page form (fast)
- File upload is straightforward `multipart/form-data`
- Confirmation page appears after successful submission

### Usage
```bash
# Dry-run
node scripts/submit-greenhouse.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --dry-run

# Live submission
node scripts/submit-greenhouse.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --live
```

---

## Ashby (Posting API)

**Submitter:** `scripts/submit-ashby.mjs`

### Endpoints (Two-Step Flow)

#### Step 1: Upload File
```
POST https://api.ashbyhq.com/posting-api/file-upload
Content-Type: multipart/form-data

Request:  { file: <binary> }
Response: { fileHandle: "file_<uuid>" }
```

#### Step 2: Submit Application
```
POST https://api.ashbyhq.com/posting-api/apply/{jobPostingId}
Content-Type: application/json
```

### URL Extraction
```
Pattern: https://jobs.ashbyhq.com/{company-slug}/posting/{jobPostingId}
Example: https://jobs.ashbyhq.com/example-corp/posting/550e8400-e29b-41d4-a716-446655440000
├─ company-slug = "example-corp"
└─ jobPostingId = "550e8400-e29b-41d4-a716-446655440000" (UUID)
```

### Field Map (Application Submit)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `applicationForm` | object | ✓ | Contains form fields |
| `  first_name` | string | ✓ | First name |
| `  last_name` | string | ✓ | Last name |
| `  email` | string | ✓ | Email address |
| `  phone` | string | ✓ | Phone number |
| `resume` | object | ✓ | `{ fileHandle: "<from-step-1>" }` |
| `coverLetter` | object | ✗ | Optional `{ fileHandle: "<from-step-1>" }` |

### Authentication
Public endpoint — no authentication required.

### Known Gotchas
- **Two-step flow is mandatory** — upload files first, receive fileHandle, then submit application
- File upload returns a `fileHandle` (UUID-like string) that must be used in the application submit
- Cover letter is optional; if not provided, submit only resume fileHandle
- Non-fatal cover letter upload failures — application can proceed without it
- No captcha on public apply endpoint

### Usage
```bash
# Dry-run (shows all steps)
node scripts/submit-ashby.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --dry-run

# Live submission (executes both steps)
node scripts/submit-ashby.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --live
```

---

## Lever (Postings API)

**Submitter:** `scripts/submit-lever.mjs`

### Endpoint
```
POST https://api.lever.co/v0/postings/{site}/{posting_id}?mode=apply
Content-Type: multipart/form-data
```

### URL Extraction
```
Pattern: https://jobs.lever.co/{site}/jobs/{posting_id}
Example: https://jobs.lever.co/acme-corp/12345678-1234-1234-1234-123456789012
├─ site = "acme-corp"
└─ posting_id = "12345678-1234-1234-1234-123456789012" (UUID)
```

### Field Map
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | ✓ | Full name: `{first_name} {last_name}` |
| `email` | string | ✓ | Email address |
| `phone` | string | ✓ | Phone number |
| `resume` | file | ✓ | PDF file (multipart upload) |
| `comments` | string | ✗ | Cover letter text (plain text, not file) |
| Optional EEO fields | various | ✗ | May appear in form, but not required for apply |

### Authentication
Public endpoint — no authentication required.

### Known Gotchas
- Cover letter is submitted as **text in `comments` field**, NOT as a file
- `name` field expects full name (not separate first/last)
- Query parameter `?mode=apply` is required
- No captcha on public apply endpoint
- Lever API is very permissive and usually quick to respond

### Usage
```bash
# Dry-run
node scripts/submit-lever.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --dry-run

# Live submission
node scripts/submit-lever.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --live
```

---

## SmartRecruiters (Candidate API)

**Submitter:** `scripts/submit-smartrecruiters.mjs`

### Endpoint
```
POST https://api.smartrecruiters.com/v1/postings/{postingId}/candidates
Content-Type: multipart/form-data
```

### URL Extraction
```
Pattern: https://{company}.smartrecruiters.com/jobs/posting/{postingId}
Example: https://acme.smartrecruiters.com/jobs/posting/12345678-1234-1234-1234-123456789012
├─ company = "acme"
└─ postingId = "12345678-1234-1234-1234-123456789012" (UUID)
```

### Field Map
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `firstName` | string | ✓ | First name |
| `lastName` | string | ✓ | Last name |
| `email` | string | ✓ | Email address |
| `phone` | string | ✓ | Phone number |
| `resume` | file | ✓ | PDF file (multipart upload) |
| `coverLetter` | file | ✗ | Optional cover letter file |
| `externalId` | string | ✗ | Optional external identifier |

### Authentication
**TODO: Requires Investigation** — SmartRecruiters API may require authentication key.

If the public apply endpoint (`POST /postings/{postingId}/candidates`) fails with 401/403, the authenticated endpoint requires:
```
Header: X-SmartRecruiters-Token: <API_KEY>
```

The API key would need to come from SmartRecruiters account admin. As of now, the submitter assumes public access; if authentication fails, you will need:
1. Contact the recruiting team to request API credentials
2. Add `SMARTRECRUITERS_API_KEY` to `.env`
3. Update `submit-smartrecruiters.mjs` to include the auth header

### Known Gotchas
- API authentication may be required (see above)
- If public apply fails, check with company's recruiting team for API access
- Field names are camelCase (`firstName`, `lastName`, NOT `first_name`, `last_name`)
- No public documentation of rate limits

### Usage
```bash
# Dry-run
node scripts/submit-smartrecruiters.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --dry-run

# Live submission (may fail if API auth required)
node scripts/submit-smartrecruiters.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --live
```

---

## Dispatcher (submit-dispatch.mjs)

**Submitter:** `scripts/submit-dispatch.mjs`

### Purpose
Routes applications to the correct ATS submitter by detecting the apply URL domain.

### Supported ATSs
| ATS | Domains | Submitter |
|-----|---------|-----------|
| Greenhouse | `greenhouse.io`, `boards.greenhouse.io` | `submit-greenhouse.mjs` |
| Ashby | `ashbyhq.com`, `jobs.ashbyhq.com` | `submit-ashby.mjs` |
| Lever | `lever.co`, `jobs.lever.co` | `submit-lever.mjs` |
| SmartRecruiters | `smartrecruiters.com` | `submit-smartrecruiters.mjs` |
| WorkDay | `workday.com` | `submit-workday.mjs` (Playwright) |
| iCIMS | `ats.icims.com`, `taleo.icims.com` | `submit-icims.mjs` (Playwright) |

### Detection Logic
```javascript
if (applyUrl.includes('greenhouse')) → submit-greenhouse.mjs
else if (applyUrl.includes('ashby')) → submit-ashby.mjs
else if (applyUrl.includes('lever.co')) → submit-lever.mjs
else if (applyUrl.includes('smartrecruiters')) → submit-smartrecruiters.mjs
else if (applyUrl.includes('workday.com')) → submit-workday.mjs (Playwright)
else if (applyUrl.includes('icims')) → submit-icims.mjs (Playwright)
else → error, unsupported ATS
```

### Usage
```bash
# Dry-run (auto-detects ATS, routes to correct submitter)
node scripts/submit-dispatch.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --dry-run

# Live submission
node scripts/submit-dispatch.mjs --app-id 025 --pdf resume.pdf --cover-letter cover.txt --live
```

### Pass-Through Args
All CLI arguments are passed directly to the selected submitter:
```bash
node submit-dispatch.mjs --app-id 025 --pdf resume.pdf --cover-letter cl.txt --dry-run

# Routes to (e.g., if Greenhouse):
# → node submit-greenhouse.mjs --app-id 025 --pdf resume.pdf --cover-letter cl.txt --dry-run
```

---

## Global CLI Interface

All submitters support:
```
--app-id <N>              Required. Row number from data/applications.md.
--pdf <path>              Required. Path to resume PDF.
--cover-letter <path>     Optional. Path to cover letter text file.
--dry-run                 Default. Print request without sending.
--live                    Send live POST request.
```

### Dry-Run Output Example
```
[submit-greenhouse] DRY-RUN: would send POST request
  Endpoint: https://boards-api.greenhouse.io/v1/boards/agilityrobotics/jobs/5841009004/applications
  Method: POST
  Board Token: agilityrobotics
  Job ID: 5841009004
  Form fields: first_name, last_name, email, phone, resume, cover_letter
  Resume file: /path/to/resume.pdf
  Cover letter file: /path/to/cover.txt

[submit-greenhouse] To submit live, use --live flag
```

### Live Submission Output Example
```
[submit-greenhouse] Submitting live to Greenhouse...
[submit-greenhouse] Response status: 201
[submit-greenhouse] Response body: { success: true, id: "app_12345" }
[submit-greenhouse] ✅ Submission successful
[log-response] Added new entry #032: Agility Robotics — Manager, BI (Greenhouse)
```

---

## Response Logging

On successful live submission, submitters automatically invoke `log-response.mjs`:
```bash
node scripts/log-response.mjs --app-id 025 --event submitted --ats {ATS_NAME}
```

This logs the application to `data/responses.md`:
```
| 025 | Agility Robotics | Manager, BI | 2026-04-10 | Greenhouse | submitted | 2026-04-10 | — | Auto-submitted via submit-greenhouse.mjs |
```

---

## Error Handling & Debugging

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Resume PDF not found at {path}` | Path invalid or file missing | Verify path, use absolute paths |
| `Could not extract {ats}/posting_id from {url}` | URL format unexpected | Check URL in `applications.md` |
| `No application row found for app-id={N}` | App ID not in `applications.md` | Verify app ID, check row format |
| Response status: 400/401 | Field format incorrect, auth missing | Check field map, verify endpoint |
| Response status: 404 | Job/posting not found | Verify posting_id, URL may be stale |

### Debugging

```bash
# Dry-run shows full request before sending
node scripts/submit-dispatch.mjs --app-id 025 --pdf resume.pdf --dry-run

# Check applications.md for correct app-id and URL
grep "| 025 |" data/applications.md

# Check responses.md for submission history
grep "025" data/responses.md
```

---

## Script index (quick lookup)

| ATS / flow | Script | Notes |
|------------|--------|--------|
| Greenhouse (JSON) | `scripts/submit-greenhouse.mjs` | Boards API; `--dry-run` default |
| Ashby | `scripts/submit-ashby.mjs` | Posting API |
| Lever | `scripts/submit-lever.mjs` | Postings API |
| iCIMS | `scripts/submit-icims.mjs` | Playwright — often **captcha** (human finish) |
| Workday | `scripts/submit-workday.mjs` | Playwright |
| Workable | `scripts/submit-workable.mjs` | Playwright |
| SmartRecruiters | `scripts/submit-smartrecruiters.mjs` | See limitations in this doc |
| Shared Playwright | `scripts/submit-playwright-shared.mjs` | Imported by browser-based submitters |

**Preflight:** `pnpm run preflight:gmail-sync` (and other `preflight:*` scripts) before scheduling automation.

## Captcha and human gate

Any flow that hits **hCaptcha / reCAPTCHA / invisible bot checks** must **stop** before final submit. Document the partial state in `data/applications.md` as **`In Progress`** and finish in a real browser. Never bypass captchas with third-party solving services in this repo’s workflows.

---

## Future Enhancements

- [ ] SmartRecruiters: add authenticated API key support
- [ ] WorkDay & iCIMS: migrate from Playwright to JSON API if public endpoints available
- [ ] Resume parsing: extract name/email from resume metadata
- [ ] Custom field mapping: support ATS-specific custom fields from config
- [ ] Batch submit: apply to multiple jobs in one command
- [ ] Webhook integration: trigger submitters from CI/CD or external webhooks

---

## References

- **Greenhouse Boards API:** https://developers.greenhouse.io/board-api.html
- **Ashby Posting API:** https://docs.ashbyhq.com/posting-api/overview (requires account login)
- **Lever Postings API:** https://github.com/LevrMo/lever-api-documentation
- **SmartRecruiters Candidate API:** https://dev.smartrecruiters.com/docs/candidate-api/overview (requires auth)

---
Inspired by the upstream repository: https://github.com/santifer/career-ops
