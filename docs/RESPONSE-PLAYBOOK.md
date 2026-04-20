---
title: Response Playbook — what to do when a recruiter responds
audience: Matt
last-updated: 2026-04-19
---

# Response Playbook

When you get a notification from `📬 career-ops`, here's what to do — by event type.

The notification body shows the matched application(s) like:
```
• #032 C.H. Robinson — recruiter_reply
   ↳ "Re: your application — quick chat?"
```

For each entry, the action depends on the **event** label.

---

## 1. `acknowledged` — automated ATS confirmation

Examples:
- "Your application has been received"
- "Thanks for applying!"
- "We noticed you started a job application" (KinderCare-style — half-finished ATS)

**Action:**
1. Skim the email. If it's the "you started but didn't finish" kind, **return to the ATS and finish the submission.**
2. Otherwise, no action needed — the system already logged it.
3. Confirm the row in `data/applications.md` has the right status (likely still `Applied` or `Responded`).

---

## 2. `recruiter_reply` — human recruiter wants to engage

Examples:
- "Are you available for a quick chat next week?"
- "Tell me more about your experience with X"
- "Saw your application — would love to discuss"

**Action:**
1. **Reply within 24 hours.** Recruiter velocity is the #1 signal of seriousness.
2. Pull up the original evaluation report at `reports/{###}-{slug}-{date}.md` for the company-specific angle.
3. Draft a short, specific reply (3-5 sentences):
   - Confirm interest
   - Reference one specific detail from the JD
   - Propose 2-3 time windows (Central Time)
   - Sign-off with phone + LinkedIn
4. Log it:
   ```
   pnpm run respond
   # → app-id: ###
   # → event: 3 (recruiter_reply) or skip (already logged)
   # → notes: "Replied with availability for Tu/Wed PM CT"
   ```

---

## 3. `phone_screen_scheduled` — a call is on the calendar

**Action:**
1. Add to your calendar (Google Calendar / iCal). Note the recruiter's name + email.
2. **Block 30 min before for prep**: re-read the JD, the evaluation report, and your CV bullets that map to the role.
3. Pull `interview-prep/story-bank.md` for relevant STAR+R stories.
4. Have water + paper notes ready (recruiters can hear pen-clicking; use a soft pad).
5. Log:
   ```
   pnpm run respond
   # → event: 4 (phone_screen_scheduled)
   # → notes: "scheduled <date> <time> CT with <name>"
   ```

---

## 4. `phone_screen_done` — call happened

**Action:**
1. Within 2 hours, send a **short** thank-you email:
   - Reaffirm interest
   - Reference one thing from the conversation (proves you listened)
   - Re-state next-step expectation
2. Log:
   ```
   pnpm run respond
   # → event: 5 (phone_screen_done)
   # → notes: "called with <name>; next step: <X>; comp range: <Y>"
   ```

---

## 5. `on_site_scheduled` / `interview` — full-loop or panel

**Action:**
1. **Block 4 hours of prep time** in the day before:
   - Company deep-dive (use brain MCP search: company news, recent products, leadership)
   - Re-read all role docs in `reports/` and `data/outreach/{slug}.md`
   - Prepare 5 questions to ask each interviewer
   - Run through 3-5 likely technical scenarios
2. Send pre-interview confirmation email morning-of to interview coordinator.
3. Log:
   ```
   pnpm run respond
   # → event: 6 or 7 (on_site_scheduled / interview)
   ```

---

## 6. `offer` — they want you

**Action:**
1. **Don't accept on the call.** Standard line: "Thank you, this is exciting — I'd like 24-48 hours to review the full package."
2. Get everything in writing: comp, equity, signing bonus, vesting, PTO, start date, title.
3. Compare against any other active processes — even a soft pipeline can support a counter.
4. Use the `compare` mode if you have multiple offers active.
5. Log:
   ```
   pnpm run respond
   # → event: 9 (offer)
   # → notes: "$XXXk base + $XXk RSU + $XXk signing — review by <date>"
   ```

---

## 7. `rejected` — they passed

**Action:**
1. **Send a 2-line graceful reply within 24h** (keeps door open for future roles):
   > Thanks for letting me know, and for the time you spent reviewing my background. I'd appreciate any specific feedback that would help me, and please keep me in mind for future BI/data architect roles at {company}.
2. Log:
   ```
   pnpm run respond
   # → event: 10 (rejected)
   # → notes: "<one-line reason if given>"
   ```
3. Don't dwell. Run `pnpm run dashboard` and look at the next 5 actions.

---

## 8. False positives

If the matched email is NOT actually from the recruiter (e.g. an Indeed digest that mentioned the company in passing):

1. **Don't change the application's status manually** — let the system stay consistent.
2. Edit the row in `data/applications.md` to strip the misleading note.
3. Tighten the query in `.env` (`GMAIL_RECRUITER_QUERY`) to exclude the noisy sender pattern.
4. Run `pnpm run gmail-sync:dry` to verify the new query doesn't repeat the mismatch.

---

## Where things live

| What | Where |
|---|---|
| Notification trigger | `scripts/gmail-recruiter-sync.mjs` (matchedCount > 0) |
| Notification channels | Pushover (if `PUSHOVER_TOKEN`/`PUSHOVER_USER` set) → Windows toast → file |
| Durable alert files | `data/notifications/gmail-sync-{timestamp}.md` |
| Review queue (unmatched) | `data/outreach/gmail-sync-review-{date}.md` |
| Run summaries | `data/run-summaries/gmail-sync-{timestamp}.md` |
| Response log | `data/responses.md` (tracked) |
| Application tracker | `data/applications.md` (gitignored) |
| Dashboard | `dashboard.html` — Morning Briefing surfaces unread `recruiter_reply` events |

---

## Optional: enable Pushover for mobile alerts

If you want notifications on your phone (not just Windows desktop):

1. Create account at https://pushover.net (one-time $5 per platform)
2. Install Pushover app on your phone
3. From the Pushover dashboard, copy your **User Key**
4. Create an "Application" → name `career-ops` → copy the **API Token**
5. Add to `.env`:
   ```
   PUSHOVER_TOKEN=...
   PUSHOVER_USER=...
   ```
6. Next sync run will deliver to phone in addition to Windows toast.
