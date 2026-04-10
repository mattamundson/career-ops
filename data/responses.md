# Response Tracker
# One row per application submission. Parsed by scripts/generate-dashboard.mjs
# Append new rows with: node scripts/log-response.mjs --app-id XXX --event EVENT --date YYYY-MM-DD
#
# Event types:
#   submitted       - Initial application sent
#   acknowledged    - Auto-reply or "received" email from ATS
#   recruiter_reply - Human recruiter responded (email/call/LinkedIn)
#   phone_screen    - Phone screen scheduled or completed
#   interview       - Technical/panel interview scheduled or completed
#   offer           - Offer received
#   rejected        - Rejection received
#   withdrew        - Matt withdrew application
#   ghosted         - No response after 14 days, move to follow-up flag
#
# Schema: | app_id | company | role | submitted_at | ats | status | last_event_at | response_days | notes |

| app_id | company | role | submitted_at | ats | status | last_event_at | response_days | notes |
|--------|---------|------|--------------|-----|--------|---------------|---------------|-------|
| 001 | Panopto | DataOps Engineer | 2026-04-06 | Lever | submitted | 2026-04-06 | — | 4 days stale as of 2026-04-10, cover letter added v13 |
| 002 | Valtech | Data and AI Architect | 2026-04-06 | Greenhouse | submitted | 2026-04-06 | — | 4 days stale as of 2026-04-10, cover letter added v13 |
| 011 | Wipfli | Enterprise Data Architect | 2026-04-10 | iCIMS | in_progress | 2026-04-10 | — | iCIMS Step 1/4 filled, blocked at hCaptcha, browser session died. Requires recovery via Appendix D. |
