# Mode: followup — Stale Application Nudge Drafts

## What it does

Drafts short follow-up emails for applications that have been silent for ≥ N days. Never sends. Writes drafts to `data/outreach/followup-YYYY-MM-DD-{id}-{slug}.md` for Matt to review and copy-paste.

## When to use

- Monday morning review: generate drafts for all ≥7d silent apps, cherry-pick which to send.
- Automatic: `check-cadence-alert.mjs` will invoke this script per-application for apps that hit the ghost threshold (Task 6, 14d silence).
- One-off: focus on a single application via `--application-id`.

## Usage

```bash
node scripts/generate-followups.mjs                    # defaults: 7d threshold, live drafts
node scripts/generate-followups.mjs --dry-run          # list candidates, don't draft
node scripts/generate-followups.mjs --stale-days=14    # only flag ≥14d silent
node scripts/generate-followups.mjs --application-id=024   # one app
node scripts/generate-followups.mjs --force            # re-draft even if a recent draft exists
```

## Inputs

- `data/applications.md` — canonical tracker; status field decides followupable.
- `data/responses.md` — per-app last event; used to compute `days_silent`.
- `config/profile.yml` — (future) `followup.stale_days` override.
- `ANTHROPIC_API_KEY` — if set, uses Claude Haiku for drafting; otherwise falls back to a template.

## Output

Each draft file:

```markdown
---
application_id: "024"
company: "KinderCare Learning Companies"
role: "Senior Power BI Developer"
status: "Applied"
applied_at: "2026-04-18"
last_event_at: "2026-04-20"
days_silent: 8
suggested_send_date: "2026-04-28"
drafted_at: "2026-04-28"
drafted_by: "claude-haiku"
---

# Follow-up draft — KinderCare Learning Companies / Senior Power BI Developer

**Application #024** · status: Applied · 8 days silent since 2026-04-20

## Subject
Following up — Senior Power BI Developer at KinderCare

## Body
Hi <Recruiter>,

I wanted to check in on my application for the Senior Power BI Developer role...

---
_Review before sending. Does not auto-send. To retire this draft, delete this file._
```

## Statuses that get followed up

| Status | Follow up? | Rationale |
|--------|------------|-----------|
| Applied | ✅ | Classic stale — recruiter hasn't engaged |
| Responded | ✅ | Early conversation — gentle nudge |
| Contact | ✅ | Active recruiter contact that went quiet |
| In Progress | ✅ | Partial ATS submission — ping to resolve |
| Interview | ✅ | Awaiting next-step details |
| GO / Ready to Submit | ❌ | Not yet submitted |
| Evaluated | ❌ | Not yet submitted |
| Rejected / Offer / Discarded / Withdrew / SKIP | ❌ | Terminal |

## Idempotency

By default a new draft for application #NNN is skipped if a draft for #NNN was written within the last 7 days. Override with `--force`.

## Ethics

**Never sends.** This mode produces drafts only. Follow-up emails must be reviewed, edited if needed, and sent by Matt from his own email account.
