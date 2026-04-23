# Weekly scorecard — filled (2026-04-22)

Week **2026-04-16 → 2026-04-22** (7 days, inclusive). Generated from `applications.md`, `data/responses.md`, `data/outreach/`, and `data/prefilter-results/` (score cross-check).

---

## Copy/paste (roadmap §4) — **completed**

```text
Week ending: 2026-04-22

Applications submitted (quality, you reviewed): 4
  (from responses.md: submitted_at in range)

Recruiter / HM conversations held: 4
  (distinct app_id; human-touch events; last_event_at in range)

Interviews (any stage): 0

Outreach sent (3.5+ only): 166 of 196
  (see methodology below; 30 files had no prefilter file or parseable **Quick Score**)

Rows moved out of "stale" (follow-up, discard, defer): 0
  (week-over-week not tracked in repo; 18 rows currently over cadence — work down from dashboard/digest)

System: verify:ci last run: 2026-04-22 — Pass (exit 0)
  (pnpm run scorecard:week -- --run-verify; full verify-all 7/7, 285 unit tests)

Biggest blocker (one line): 18 over-cadence rows + 10 Ready to Submit — run prep/apply flow on the queue before net-new eval volume.
```

---

## Queue snapshot (now)

| Bucket | Count |
|--------|------:|
| GO | 0 |
| Conditional GO | 9 |
| Ready to Submit | 10 |
| Stale (over profile cadence, now) | 18 |

---

## Outreach **≥3.5** (how 166 was computed)

For each `data/outreach/*.md` whose file **mtime** fell in the week, we look for a same-named file in `data/prefilter-results/`, parse `**Quick Score:** X/5`, and count if **X ≥ 3.5**.  

- **196** outreach files in the mtime window.  
- **166** with prefilter **Quick Score** ≥ 3.5.  
- **30** with no prefilter or no parseable line (unknown score — review manually if you need exact compliance with “3.5+ only”).

This is a **proxy** for “high-fit outreach drafts in the batch,” not proof each was sent on LinkedIn.

---

## System notes (from last `--run-verify`)

- **verify:ci** passed; cron/status warned on recent `cron-health-check` non-zero and one **Evening Scan** non-zero in the last 24h (check `data/events/*.jsonl` + Task Scheduler if that persists).

---

*To regenerate: `pnpm run scorecard:week` / `pnpm run scorecard:week -- --run-verify`. Re-run the outreach cross-count if you add a proper script; this snapshot was generated ad hoc for 2026-04-22.*
