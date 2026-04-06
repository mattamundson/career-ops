# Mode: tracker — Application Tracker

Read and display `data/applications.md`.

**Tracker format:**
```markdown
| # | Date | Company | Role | Score | Status | PDF | Report |
```

Possible states: `Evaluated` → `Applied` → `Responded` → `Contact` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

- `Applied` = candidate submitted their application
- `Responded` = A recruiter/company reached out and candidate responded (inbound)
- `Contact` = Candidate proactively reached out to someone at the company (outbound, e.g., LinkedIn power move)

If the user asks to update a status, edit the corresponding row.

Show also statistics:
- Total applications
- By status
- Average score
- % with PDF generated
- % with report generated
