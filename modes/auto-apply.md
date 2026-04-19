# Mode: auto-apply — Batch Application Automation

Automated batch application processor. Scans the apply queue, generates cover letters, and submits applications to supported ATS platforms via API.

## Quick Reference

```bash
# See what's ready to submit
node scripts/auto-apply-batch.mjs --status

# Generate missing cover letters (no submissions)
node scripts/auto-apply-batch.mjs --generate-cl

# Dry-run: show what would be submitted
node scripts/auto-apply-batch.mjs

# Submit up to 5 applications
node scripts/auto-apply-batch.mjs --live --max 5

# Submit specific applications by ID
node scripts/auto-apply-batch.mjs --live --app-ids 025,024,023
```

## Supported ATS Platforms

| ATS | Method | Submit Script |
|-----|--------|--------------|
| Greenhouse | JSON API (public endpoint) | `submit-greenhouse.mjs` |
| Ashby | JSON API | `submit-ashby.mjs` |
| Lever | JSON API | `submit-lever.mjs` |
| SmartRecruiters | JSON API | `submit-smartrecruiters.mjs` |
| Workable | JSON API | `submit-workable.mjs` |
| Workday | Playwright form-fill | `submit-workday.mjs` |
| iCIMS | Playwright form-fill | `submit-icims.mjs` |

## Workflow

```
1. PARSE       → Read apply-queue.md for GO/Ready to Submit entries
2. FILTER      → Only entries with supported ATS URLs (no LinkedIn/Indeed aggregators)
3. CHECK       → Verify PDF resume + cover letter exist
4. GENERATE    → Auto-generate cover letter if missing (Claude Sonnet)
5. APPROVE     → Show approval summary (dry-run default)
6. SUBMIT      → Dispatch to correct ATS submitter (--live required)
7. LOG         → Record result in automation events + update tracker
```

## Safety Guards

- **Default: dry-run** — must pass `--live` explicitly to submit
- **Daily cap**: `--max N` limits submissions per batch (default: 10)
- **Rate limit**: 3-second delay between submissions
- **Aggregator URLs skipped**: LinkedIn/Indeed URLs are logged but not submitted (use `resolve-aggregator-urls.mjs` first)
- **Blocked entries skipped**: Entries with unresolved blockers are not submitted

## Resume Selection

Priority order:
1. PDF specified in apply-queue.md (`**PDF:**` field)
2. `--auto-resume` flag → semantic matching against JD
3. Default: `output/Matt_Amundson_TOP_2026.docx`

## Cover Letter Generation

When `--generate-cl` or `--live` is passed and no cover letter exists:
- Uses Claude Sonnet to generate a tailored 250-350 word cover letter
- Reads cv.md for experience context
- Reads company + role + salary from apply-queue.md
- Saves to `output/cover-letters/{company-slug}-auto-{app-id}.txt`
- Requires: `ANTHROPIC_API_KEY` in `.env`

## After Submission

After each successful submission:
1. Update `data/applications.md` status → `Applied`
2. Log event to `data/events/YYYY-MM-DD.jsonl`
3. Write result artifact to `data/apply-runs/dispatch-{id}-{timestamp}.json`
4. Follow up with cadence alerts (9 AM + 4 PM CT)
