# Career-Ops Status Report — 2026-04-10
**Session:** v13 (continuation of v12 deep-dive)
**Session window:** 00:40 – 08:00 CDT
**Candidate:** Matthew M. Amundson | Minneapolis MN | Target $100-140K

---

## Pipeline Funnel (as of 2026-04-10 08:00 CDT)

| Stage | Count (04-09) | Count (04-10) | Δ |
|-------|---------------|---------------|---|
| Discovered (scan-history.tsv unique) | 2,397 | 2,714 | +317 |
| Prefilter cards | 414 | ~664 | +~250 |
| A-F evaluated | 31 | 36 | +5 (auto-promoted) |
| GO decisions | 9 | 9 | 0 |
| Conditional GO | 11 | 11 | 0 |
| Ready to submit (PDF+CL complete) | 17 | 19 | +2 (Panopto + Valtech unblocked) |
| **Applications submitted** | 2 | 2 | **0** |
| **Applications in progress** | 0 | 1 | **+1 (Wipfli)** |

---

## Today's Progress

### ✅ Completed
1. **Wipfli iCIMS Step 1 of 4 fully filled** — all fields set, resume + cover letter uploaded. Blocked only at hCaptcha challenge.
2. **Panopto + Valtech cover letters generated** — unblocks 2 stale GO decisions (4 days old) for immediate submission
3. **Firecrawl fix VERIFIED WORKING** — 23 queries producing 20 results each across Ashby/Greenhouse/Lever/broad job boards. v12's query simplification was successful.
4. **check-cadence-alert.mjs tested and production-ready** — 36 entries scanned, staleness detection working, env var inheritance confirmed
5. **OPENCLAW_WHATSAPP_TO env var set** — `+16128771189` persisted at User scope; staleness alerts can now fire via WhatsApp
6. **6 new commits pushed to GitHub** — working tree cleaned:
   - `6ed4959` fix(prefilter): status field update for 5 v12 cards
   - `5bd5b47` feat(dashboard): expand Apply Queue section (+948 lines)
   - `56f5420` feat(intel): 10 company research stubs
   - `298ba11` feat(outreach): 5 templates for ready-to-apply roles
   - `c4e7f17` chore(gitignore): exclude scan-scheduler.log
   - `5e0d0de` feat(scan): ~250 prefilter cards from background scans
7. **Daily 6am scan ran successfully** — 164 new prefilter cards, 347 new offers promoted to evaluation
8. **applications.md updated** — Wipfli → In Progress, Panopto/Valtech → Ready to Submit (CL noted)

### 🚧 Blocked
1. **Wipfli final submission** — hCaptcha requires Matt to solve manually. Browser session has since died; will need full recovery playbook via Appendix D of v13 handoff.
2. **Agility Robotics submission** — not started, next in queue after Wipfli

### 📝 Discovered
1. **5 duplicate entries in applications.md** (rows 032-036) — auto-promoted from today's scan duplicating existing rows 025, 016, 024, 029, 028. Needs triage cleanup.
2. **Master Career-Ops Build.MD** mystery file is a stale 604KB handoff from 2026-04-07. Recommendation: leave untracked.
3. **Matt's street address missing** from config/profile.yml — blocking accuracy on all future applications with address fields.

---

## Top 5 Priorities for Next Session

1. **Matt solves Wipfli captcha** OR restarts Wipfli via Appendix D recovery playbook + solves captcha + advances Steps 2-4. Current login: `MattMAmundson@gmail.com` / `Matt@Wipfli2026!`.
2. **Matt provides real street address + zip** — update `config/profile.yml` before ANY more submissions.
3. **Submit Panopto (#001) and Valtech (#002)** — now have cover letters, 4 days stale, urgent.
4. **Submit Agility Robotics (#3 from user's original request)** — LinkedIn URL `https://www.linkedin.com/jobs/view/4393992086`, files ready.
5. **Submit 4 more top-priority ready roles** — Vultr, GSquared, Modine, Rescale, KinderCare (all have PDFs + CLs, waiting on form-filling time).

---

## Strategic Observations

- **The funnel remains inverted:** 19 applications ready, only 2 submitted. Tier 1-2 priorities must ship in the next session.
- **Discovery pipeline is healthy:** Firecrawl fixed, scan scheduler working, ~250 new cards/day. The problem is NOT discovery — it's submission velocity.
- **Captchas are the real bottleneck:** Every iCIMS/Workday application has one. Recommendation: batch submissions into a single "Matt-present captcha-clearing session" of 90 minutes, targeting 5 applications.
- **Automation infrastructure maturity:** v12 + v13 have built a robust discovery/evaluation/triage pipeline. The missing piece is a human-in-the-loop submission workflow. Consider: WhatsApp voice-call notification when a captcha appears so Matt can solve within the same browser session.

---

## Blockers Requiring Matt's Attention

1. Solve Wipfli hCaptcha (2-5 min)
2. Provide street address + zip (30 seconds)
3. Schedule 90-minute "submission session" for batch captcha solving
4. Register prefilter Task Scheduler job (2 min as Admin): `powershell -ExecutionPolicy Bypass -File scripts\register-prefilter-task.ps1`

---

**Session v13 handoff:** `C:\Users\mattm\Career-Ops-Update_04.10.2026_HANDOFF_CLAUDE_SESSIONv13.md` (expanded edition with 4 appendices including full iCIMS field-name map + custom combobox pattern + Playwright MCP quirks + recovery playbook).
