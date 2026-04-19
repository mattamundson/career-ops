# Application status model

Single source of truth for the **Status** column in [`data/applications.md`](../data/applications.md): [`templates/states.yml`](../templates/states.yml).

## Pre-submit workflow (evaluation + human gate)

These statuses mean the report exists; the next step is yours (no bot submits applications).

| Status | Meaning |
|--------|---------|
| **GO** | Strong fit — queue for application when you have bandwidth. |
| **Conditional GO** | Good fit — resolve blockers listed in **Notes** before applying. |
| **Ready to Submit** | PDF (and usually cover letter) ready — final human review, then send via employer site. |
| **In Progress** | You started the employer ATS (multi-step form, captcha, draft saved). |

## Post-submit lifecycle

| Status | Meaning |
|--------|---------|
| **Evaluated** | Report done; you have not committed to apply or skip yet (legacy / neutral). |
| **Applied** | You clicked Submit / sent the application. |
| **Responded** | Employer or recruiter replied (inbound). |
| **Contact** | You reached out first (outbound, e.g. LinkedIn). |
| **Interview** | Active interview loop. |
| **Offer** | Offer in hand. |
| **Rejected** | Company declined. |
| **Discarded** | You closed the opportunity or the role is gone. |
| **SKIP** | Do not apply (fit, geo, comp, or stack). |

## Rules

- No markdown bold (`**`) in the status field.
- No dates in the status field (use the **Date** column).
- Put nuance in **Notes**, not in the status string.

## Automation

- `node verify-pipeline.mjs` — validates statuses, scores, report links.
- `node verify-pipeline.mjs --stale-check` — warns when rows exceed cadence (see `cadence:` in `config/profile.yml`; defaults include shorter windows for **Ready to Submit** and **In Progress**).

## Ethical rule

Never mark **Applied** until **you** have submitted. Agents may draft forms and PDFs; the human confirms before send.
