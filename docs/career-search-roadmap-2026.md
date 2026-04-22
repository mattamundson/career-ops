# Career search roadmap — goals, timelines, cadence

**Owner:** Matthew M. Amundson  
**Last updated:** 2026-04-22  
**Companion docs:** [`DAILY-USAGE.md`](DAILY-USAGE.md) (morning routine), [`RESPONSE-PLAYBOOK.md`](RESPONSE-PLAYBOOK.md) (recruiter replies), [`MAINTENANCE-RITUALS.md`](MAINTENANCE-RITUALS.md) (system hygiene)

This file is the **planning layer** on top of the automation: *what* you are trying to accomplish *by when*, and how you will know you are on track. Revise it in place as reality changes (interviews accelerate, priorities shift, or a role lands early).

---

## 1. North-star outcomes (what “success” means)

| Horizon | Outcome | Success looks like |
|--------|---------|---------------------|
| **Near term (0–8 weeks)** | A healthy, reviewable pipeline | Tracker + digest + dashboard reflect truth; you are not losing leads to stale status or dead URLs. |
| **Mid term (2–4 months)** | Enough **right-fit** conversations | Recruiter screens and hiring-manager calls for roles you would actually take (remote / data-architect–aligned / comp band). |
| **End state** | Acceptable offer or clear pivot | Signed offer *or* explicit decision to narrow geography, title band, or company profile based on data. |

**Non-goals (explicit):** mass applying below fit threshold; auto-submit; optimizing metrics that do not change outcomes (report count, pipeline.md length).

**Ethical line (unchanged):** automation prepares; **you** submit after review ([`../CLAUDE.md`](../CLAUDE.md) — “NEVER submit without user review”).

---

## 2. Time-boxed phases

Dates assume today ≈ **2026-04-22**. Rename phases if you slip—keep the *sequence*, not the calendar obsession.

### Phase A — System truth & batch workflow pilot (~~2 weeks~~ → **by 2026-05-05**)

| Goal | Done when | How you’ll verify |
|------|------------|-------------------|
| **Automation matches reality** | Scanner / cron issues are triaged, not ignored | `pnpm run health` or `verify:all` green; evening scan shows no fresh `setSourceAttempted` / TDZ in `data/events/*.jsonl` after deploy. |
| **Batch packaging is practiced** | You have run prep-queue dry-run and at least one small real batch with `--limit` | `pnpm run prep-queue -- --dry-run` then a capped run; review `packages/` + tracker updates. |
| **Apply batch is understood** | You know the prepare → review → confirm flow | `apply-review:batch` with `--prepare` and `--dry-run` before any `--confirm` + `--accept-submit-risk`. |
| **Dashboard / responses** | `dashboard.html` and `data/responses.md` either committed when meaningful or accepted as local-only churn | `git status` is explainable in one sentence. |

**Exit criteria for Phase A:** one full loop completed on paper: **GO rows → prep-queue → review artifacts → (optional) apply-review prepare** without confusion about commands.

### Phase B — Throughput with a quality floor (**2026-05-06 → 2026-05-31**)

| Goal | Target (adjust to bandwidth) | Guardrail |
|------|------------------------------|------------|
| **Quality applications** | **2–4** well-prepared applies / week to ≥ **3.0/5** (prefer **3.5+**) roles | Skip or defer sub-3.0 except intentional strategic reasons (document in notes). |
| **Pipeline hygiene** | **Zero** `Applied` rows ghosting past cadence without a logged next step (follow-up, discard, or defer) | Use digest + `log-response` / tracker updates. |
| **Outreach** | **1–3** high-signal LinkedIn / warm intros / week to roles already scored **≥3.5** | Tied to surfacer + cooldown rules in code; no spray-and-pray. |
| **Ops** | Health notifications actionable within **24h** of red | Don’t let cron failures accumulate unnamed. |

**Exit criteria for Phase B:** stable weekly rhythm: you can say every Friday *how many* quality touches (apply + material responses + scheduled interviews) *without* pulling an all-nighter to catch up.

### Phase C — Conversion & offer cycle (**2026-06-01 → 2026-08-31**)

| Goal | Intent |
|------|--------|
| **Interview load** | Convert `Contact` / `Interview` states into **dated** next steps in tracker notes. |
| **Offer policy** | Before first offer, skim [`modes/offer.md`](../modes/offer.md) (or your offer checklist) for comp, level, remit, and risk. |
| **Narrative** | Story-bank and [`interview-prep/story-bank.md`](../interview-prep/story-bank.md) cover your top 5 evidence threads for data architecture + GenAI. |

**Exit criteria for Phase C:** you are choosing among processes, not only feeding the top of the funnel.

---

## 3. Weekly operating rhythm (the methodical part)

| When | Timebox | Action |
|------|---------|--------|
| **Mon–Fri (morning)** | **5–15 min** | [Daily routine](DAILY-USAGE.md): digest, dashboard skim, act on top 3. |
| **1× / week (pick a fixed slot)** | **30–45 min** | **Pipeline review:** GO / Conditional GO / Ready to Submit; kill dead links; update statuses; schedule prep-queue or apply-review batch for the week. |
| **1× / week (same session or follow-up)** | **15 min** | **Metrics snapshot** (see §4) — 5 numbers in a note or scratch file. |
| **Monthly (first business day)** | **45 min** | Re-read this roadmap: adjust targets, mark completed phases, add one “big rock” for the next month. |

---

## 4. Scorecard (copy / paste weekly)

Use the same list every week so trends matter.

**Pre-fill from the repo (tracker + `responses.md` + outreach mtimes):**

```bash
pnpm run scorecard:week
# JSON:  pnpm run scorecard:week -- --json
# Optional:  pnpm run scorecard:week -- --run-verify
# Phase A checklist lines:  pnpm run scorecard:week -- --phase-a
```

The script prints counts and a copy-paste block. You still fill **outreach 3.5+** (score not auto-inferred), **stale rows moved**, **blocker**, and verify date unless you used `--run-verify`.

```text
Week ending: YYYY-MM-DD

Applications submitted (quality, you reviewed): ___
Recruiter / HM conversations held: ___
Interviews (any stage): ___
Outreach sent (3.5+ only): ___
Rows moved out of "stale" (follow-up, discard, defer): ___
System: verify:all or verify:ci last run: ___   Pass/Fail: ___
Biggest blocker (one line): ___
```

---

## 5. System objectives (parallel track)

These are **infrastructure** goals, not job outcomes—but they protect time.

| Item | By | Check |
|------|-----|--------|
| Scanner TDZ fix validated in production | End of Phase A | No new `setSourceAttempted` errors after evening scan. |
| `cron-health-check` not chronically red | Ongoing | If red 3+ days, open a maintenance block ([`MAINTENANCE-RITUALS.md`](MAINTENANCE-RITUALS.md)). |
| `prep-queue` only scheduled after dry-run + `--limit` | Before any Task Scheduler entry | You’ve seen one clean batch. |

---

## 6. If you get off track

1. **Shrink scope:** reduce weekly apply target before abandoning the roadmap.  
2. **One recovery week:** no new evals; only tracker hygiene + responses + one batch prep.  
3. **Re-anchor:** update the dates in §2 in this file so guilt does not accumulate.

---

## 7. Changelog (edit when you change the plan)

| Date | Change |
|------|--------|
| 2026-04-22 | Initial roadmap (Phases A–C); added `pnpm run scorecard:week` + `scripts/weekly-scorecard.mjs` to pre-fill §4. |
