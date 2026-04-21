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
| 024 | KinderCare Learning Companies | Senior Power BI Developer / Microsoft Fabric Administrator | 2026-04-18 | Gmail Sync | acknowledged | 2026-04-20 | 2 | Auto-reply: "we noticed you started a job application" — finish partial ATS submission.; acknowledged via Gmail from kindercare@myworkday.com: Hello, We&#39;re honored that you&#39;ve applied to Senior Power BI Developer / Microsoft Fabric Administrator - Fully Remote! and can&#39;t wait to learn more about you. We will b |
| 003 | Vultr | Senior Business Intelligence Architect | 2026-04-09 | Gmail Sync | acknowledged | 2026-04-20 | 11 | acknowledged via Gmail from Vultr Hiring Team: Matthew, Thank you for your application for the Senior Business Intelligence Architect position with Vultr. We recognize career decisions, including where and with whom you work, a |
| 025 | Mortenson | Senior Finance BI Developer | 2026-04-20 | Oracle HCM | submitted | 2026-04-20 | — | Submitted via Oracle HCM with resume + cover letter |
