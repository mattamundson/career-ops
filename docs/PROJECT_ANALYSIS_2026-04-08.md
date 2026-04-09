# Career-Ops: Comprehensive Project Analysis
**Date:** 2026-04-08 | **Analyst:** Claude Sonnet 4.6 | **Session:** S29

---

## 1. Executive Summary

Career-ops is a fully operational AI-powered job search automation system built on the santifer/career-ops framework, personalized for **Matthew M. Amundson** (Minneapolis, MN) targeting $100K–$140K remote data/analytics/AI roles. The system is architecturally complete but operationally stalled: 96 opportunities sit untouched, 2 evaluated applications haven't been submitted in 2 days, and the automated scanner covers only 3 of 47 configured companies. The critical path forward is (1) git backup before disk failure, (2) submit the 2 stale applications, (3) triage 34 Anthropic prefilter cards, and (4) expand job board coverage beyond Greenhouse API.

**Project location:** `C:\Users\mattm\career-ops\`
**Skill location:** `C:\Users\mattm\.claude\skills\career-ops\`

---

## 2. Current State Snapshot (as of 2026-04-08)

| Dimension | Value | Health |
|-----------|-------|--------|
| Git commits | 11 local, 0 remote | 🔴 CRITICAL |
| Applications evaluated | 2 (Panopto 3.2/5, Valtech 3.8/5) | 🟡 Stale 2d |
| Applications submitted | 0 | 🔴 |
| Pipeline inbox (URLs) | 62 pending | 🟡 Backlog |
| Prefilter cards | 34 created, 0 scored | 🟡 Backlog |
| Scan history | 2,292 entries | ✅ Active |
| Dashboard | HTML + Go TUI | ✅ Operational |
| Salary target | $100K–$140K (min $100K) | ✅ Updated |
| Job board coverage | 0 of 6 major boards | 🔴 Gap |
| Portals tracked | 47 company pages | ✅ |
| Firecrawl integration | Not yet implemented | 🔴 Pending |
| GitHub remote | Not configured | 🔴 CRITICAL |

---

## 3. Session Progression Timeline

### Session 1 — April 6–7, 2026 (Initial Build)
**Completed:**
- Forked santifer/career-ops (12.5K stars), stripped git history
- Translated all 14 Spanish mode files to English
- Built candidate profile (profile.yml), CV (cv.md), 6 archetypes
- Go dashboard: fixed module path, compiled binary (5.1 MB)
- End-to-end auto-pipeline tested on Panopto + Valtech
- Generated 2 evaluation reports + 2 PDFs (116 KB each)
- 4 git commits

**Key Decisions:**
- 6 archetypes instead of 1 narrow target
- Exit narrative: "Built entire operational tech stack as COO → targeting orgs where I can apply systems thinking at scale"
- PDF via Playwright + HTML (not markdown converter)
- TSV-based tracker updates via merge-tracker.mjs (not manual edit)

### Session 2 — April 7, 2026 (Portal Scan + Features)
**Completed:**
- Batch Greenhouse API scan: 53 matches (Anthropic, Brex, Sigma, dbt Labs)
- 34 prefilter cards auto-generated (Anthropic + Brex roles)
- 6 archetype PDF variants generated in output/
- 8 role-specific PDFs generated
- Scan history populated to 2,292 entries

### Session 3 — April 8, 2026 (Dashboard + Automation)
**Completed:**
- HTML static dashboard built (generate-dashboard.mjs, 200+ lines)
- Catppuccin Mocha dark theme, 7 stats cards, client-side filter/sort
- Windows Task Scheduler: hourly dashboard refresh + daily 6am scan
- Salary target updated: $130K–$180K → **$100K–$140K** (min $100K)
- 11 total commits (dirty working tree: 2 modified, 7 untracked)

**Blockers Discovered:**
- No GitHub remote (CRITICAL)
- 2 evaluated applications not submitted (2 days stale)
- 34 prefilter cards at zero evaluation
- Dashboard shows only 3 companies (Greenhouse-only scanner)
- 4 disabled Greenhouse slugs need fix (Monte Carlo, Alation, West Monroe, Resultant)

---

## 4. Data Pipeline Metrics

### Scan History Breakdown
| Status | Count | % |
|--------|-------|---|
| skipped_title | 2,126 | 92.8% |
| skipped_dup | 106 | 4.6% |
| added | 59 | 2.6% |
| **Total** | **2,292** | |

**Company breakdown (Greenhouse API only):**
- Anthropic: 1,272 scans (55.5%)
- Brex: 750 scans (32.7%)
- Sigma Computing: 165 scans (7.2%)
- Carta: 54 scans (2.4%)
- dbt Labs: 50 scans (2.2%)

### Pipeline Inbox (62 URLs pending)
- dbt Labs: 6 URLs (Customer Solutions Architect, GTM Automation, Partner Solutions)
- Anthropic: 44 URLs (Applied AI Engineer variants, Solutions Architect across industries)
- Brex: 4 URLs (Data Engineer, Senior SWE Product Data Platform)

### Prefilter Cards (34 — ALL pending)
| Company | Cards |
|---------|-------|
| Anthropic | 30 |
| Brex | 4 |

**Anthropic card types:** Applied AI Engineer (5 variants), Solutions Architect (9 variants), Forward Deployed Engineer (2), Manager (5), Head of Solutions, Partner SA, Security Architect, Technical Deployment (2), Data Engineer, Business Systems Analyst, GRC Lead, Claude Evangelist

### Applications Tracker
| # | Company | Role | Score | Status | Days Since |
|---|---------|------|-------|--------|------------|
| 002 | Valtech | Data and AI Architect | 3.8/5 | Evaluated | 2 days |
| 001 | Panopto | DataOps Engineer | 3.2/5 | Evaluated | 2 days |

**Both applications evaluated but NOT submitted.** PDFs and reports are ready.

---

## 5. Portal Coverage Analysis

### Currently Active (Greenhouse API — 5 companies)
Anthropic, Brex, Sigma Computing, Carta, dbt Labs

### Configured but Not Auto-Scanned (42 company career pages)
Snowflake, Databricks, Fivetran, ThoughtSpot, Atlan, Looker, Tableau, Qlik, Alteryx, Starburst, n8n, Make, UiPath, Automation Anywhere, Zapier, Retool, Glean, OpenAI, Microsoft, Epicor, Infor, Plex/Rockwell, Katana, Ramp, Rippling, Target, UHG, Best Buy, General Mills, Medtronic, U.S. Bank, Optum, Slalom + more

### Disabled (needs slug/URL fix)
Monte Carlo (404), Alation (404), West Monroe Partners (404), Resultant (404), 3M

### Missing — 6 Major Job Boards
| Board | Status | Reason | Plan |
|-------|--------|--------|------|
| LinkedIn | Explicitly disabled (portals.yml line 289) | Blocks scraping | Firecrawl site: search |
| Indeed | Not configured | Not architected | Firecrawl site: search |
| ZipRecruiter | Not configured | Not architected | Firecrawl site: search |
| Monster | Not configured | Not architected | Firecrawl site: search |
| CareerBuilder | Not configured | Not architected | Firecrawl site: search |
| Glassdoor | Not configured (only used for company intel) | Not architected | Firecrawl site: search |

---

## 6. Infrastructure Inventory

### Scripts (14 automation scripts in scripts/)
| Script | Purpose |
|--------|---------|
| auto-scan.mjs (28 KB) | Greenhouse API scanner — primary discovery engine |
| prefilter-pipeline.mjs (13 KB) | Score queued JDs against profile |
| scan-report.mjs (14 KB) | Generate scan execution reports |
| generate-dashboard.mjs (21 KB) | Build HTML static dashboard |
| match-jd.mjs (13 KB) | Semantic match JD against profile |
| ats-score.mjs (11 KB) | ATS keyword match score |
| analyze-rejections.mjs (19 KB) | Rejection pattern analysis |
| embed-profile.mjs (11 KB) | Profile embeddings (107 KB, 3,349 lines ready) |
| velocity-report.mjs (13 KB) | Application velocity tracking |
| generate-variant.mjs (15 KB) | CV variant generation by archetype |
| check-cadence.mjs (6.9 KB) | Response cadence validation |
| company-intel.mjs (6.7 KB) | Company research fetcher |
| outreach-stats.mjs (5.6 KB) | Outreach effectiveness |
| select-template.mjs (9.4 KB) | Outreach template selector |

### Dashboards
- **Go TUI** (`dashboard/career-dashboard.exe`, 5.1 MB): Catppuccin theme, 6 filter tabs, lazy preview pane, inline status mutations
- **HTML static** (`dashboard.html`): Auto-refresh every 60min, Task Scheduler regeneration, 7 stats cards, client-side filter/sort

### Windows Task Scheduler
| Task | Schedule | Status |
|------|----------|--------|
| Career-Ops Dashboard | Hourly | READY |
| Career-Ops Scan | Daily 6am CT | READY |

### Mode Files (14 English modes)
auto-pipeline, offer, compare, contact, research, pdf, tracker, apply, scan, pipeline, batch, training, project, _shared

### Data Assets
| File | Size | Contents |
|------|------|---------|
| profile-embeddings.json | 107 KB | Vector embeddings (semantic matching ready) |
| scan-history.tsv | ~81 KB | 2,292 rows audit trail |
| applications.md | ~2 KB | 2 active applications |
| pipeline.md | ~3 KB | 62 pending URLs |
| company-intel/anthropic.md | 3.7 KB | Company research |
| company-intel/panopto.md | 3.7 KB | Company research |

---

## 7. CV & Resume Audit

### Four Resume Sources Compared

| Element | cv.md (source of truth) | AI Automation .docx | PowerBI Analytics .docx | REVISED .docx |
|---------|------------------------|---------------------|------------------------|---------------|
| GitHub link | ✅ | ❌ Missing | ❌ Missing | ❌ Missing |
| Side Projects section | ✅ Jarvis Trader + 23 skills | ❌ Missing | ❌ Missing | ❌ Missing |
| "Claude Code" in skills | ✅ | ❌ | ❌ | ❌ |
| "Agentic systems" | ✅ | ❌ | ❌ | ❌ |
| Playwright/Firebase/Vercel | ✅ | ❌ | ❌ | ✅ |
| Headline | Operational Data Architect | Data Architecture / AI Automation | BI Architect / Power BI | Operational Data Architect |
| Summary depth | Full | Moderate | Moderate | Full (best version) |
| Bullet strength | Strong | Good | Good | Strongest |
| Pretium framing | "Led analysis" | "Supported analysis" | "Supported analysis" | "Led analysis" |
| FirstEnergy location | "Akron, OH (Remote)" | "Akron, OH" | "Akron, OH" | "Akron, OH" |

### Critical Gaps in All .docx Files

1. **GitHub link** — `github.com/mattamundson` is missing from all 3 .docx resumes. For AI/data roles, this is a credibility signal.

2. **Side Projects section** — Jarvis Trader ($10K paper capital autonomous AI trading system with WFE scores) and 23 Claude Code skills are uniquely differentiating for AI/ML/automation roles. Not in any .docx.

3. **"Claude Code" + "Agentic systems"** — The exact terminology used by Anthropic and AI-forward employers. Should appear in skills section of AI-targeted variants.

4. **Pretium weakening** — AI Automation and PowerBI .docx both say "Supported analysis" at Pretium. cv.md correctly says "Led analysis." This undercuts seniority positioning.

### Archetype Alignment Assessment

| Archetype | Best Resume to Send | Gap |
|-----------|--------------------|----|
| Operational Data Architect | REVISED .docx | Add GitHub, Side Projects |
| AI Automation Engineer | AI Automation .docx | Add GitHub, Side Projects, Claude Code, fix Pretium |
| BI & Analytics Lead | PowerBI Analytics .docx | Add GitHub, Side Projects, fix Pretium |
| Business Systems / ERP | REVISED .docx | Minor edits |
| Applied AI / Solutions Architect | AI Automation .docx | Add GitHub, Side Projects, Claude Code |
| Operations Technology Leader | REVISED .docx | Executive summary tone |

---

## 8. SWOT Analysis

### Strengths

**S1 — Fully Operational AI Job Search Stack (Unique)**
No other candidate has a custom Claude Code skill, automated Greenhouse scanner, 6-archetype CV generation system, and real-time dashboard for their job search. This operational competency directly demonstrates the "AI automation" capability being sold to employers.

**S2 — 47 Company-Targeted Portal Coverage**
Direct Greenhouse API integration with 5 companies + 42 company career page configurations. Highly targeted vs. spray-and-pray general job board approach.

**S3 — 6 CV Variants with ATS-Optimized PDFs**
Each archetype (Operational Data Architect, AI Automation, BI Analytics, ERP/Business Systems, Applied AI/SA, Ops Tech Leader) has a tailored variant. Playwright-based PDF generation ensures formatting consistency across all exports.

**S4 — Rich Profile Embeddings (Semantic Matching Ready)**
107 KB profile-embeddings.json enables semantic similarity scoring between job descriptions and Matt's profile. Not yet wired to auto-scoring but infrastructure is complete.

**S5 — 12 Proof Points in article-digest.md**
GMS pipeline, Inventory Health Index, Barcode System, Jarvis Trader (with metrics), 23 Claude Code skills, Pretium ($25B), FirstEnergy (Fortune 200), Land O'Lakes, UltiMed, DST — all documented with quantified outcomes for interview storytelling.

**S6 — Dual Dashboard Infrastructure**
Go TUI for power-user sessions + HTML static for quick browser access. Both auto-refresh from the same data source. Demonstrates the same "operational intelligence" capability being sold to employers.

**S7 — Windows Task Scheduler Automation**
6am daily scan + hourly dashboard refresh run without manual intervention. System is working even when Matt isn't.

### Weaknesses

**W1 — No GitHub Remote (CRITICAL DATA LOSS RISK)**
11 commits exist only on local disk. One hardware failure, ransomware event, or Windows corruption = total project loss with no recovery path.

**W2 — 2 Evaluated Applications Not Submitted**
Panopto and Valtech were evaluated 2 days ago. Application windows close, and role urgency fades. Every day of delay reduces conversion probability.

**W3 — 34 Prefilter Cards at Zero Evaluation**
30 Anthropic cards represent the highest-fit opportunity cluster in the pipeline. None have been scored or advanced to full A-F evaluation. This is the highest-value untapped asset in the system.

**W4 — 62 Pipeline URLs Unprocessed**
The URL inbox has grown faster than evaluation capacity. Without regular triage, the pipeline becomes a backlog rather than a funnel.

**W5 — Scanner Only Covers 3 Companies in Automated Mode**
`auto-scan.mjs --greenhouse-only` runs daily but only pulls from Anthropic, Brex, Sigma, Carta, dbt Labs (the 5 Greenhouse API companies). The other 42 tracked company career pages never get checked automatically.

**W6 — Zero Coverage of 6 Major Job Boards**
LinkedIn, Indeed, ZipRecruiter, Monster, CareerBuilder, Glassdoor collectively host the majority of posted jobs. None are integrated. Missing high-volume discovery.

**W7 — GitHub Link Missing from All .docx Resumes**
The GitHub link in cv.md is not carried through to any of the 3 .docx files. For AI/data roles, a visible GitHub profile is a credibility signal.

**W8 — Side Projects Missing from .docx Resumes**
Jarvis Trader and the 23 Claude Code skills section exists in cv.md but not in any .docx variant. This is the most differentiating material for AI-targeting applications.

**W9 — Profile Embeddings Not Wired to Auto-Scoring**
The semantic matching infrastructure exists (profile-embeddings.json + match-jd.mjs) but isn't integrated into the prefilter pipeline for automatic relevance scoring.

### Opportunities

**O1 — Firecrawl Search Expands Top-of-Funnel 5-10x**
Adding 7 Firecrawl site: search queries (Indeed x2, LinkedIn, ZipRecruiter, Monster, CareerBuilder, Glassdoor) to the daily 6am scan will surface roles from the largest job markets without ToS violations.

**O2 — 34 Anthropic Cards = High-Fit Cluster**
Anthropic is the world's leading AI safety company with extensive AI Engineering, Solutions Architecture, and data roles. 30 pending prefilter cards represent a concentrated opportunity that aligns perfectly with Matt's AI automation background.

**O3 — $100K Salary Floor Broadens Pipeline**
Dropping from $130K minimum to $100K expands the eligible role pool significantly in Minneapolis-accessible markets. More roles pass the comp gate, more options for actual employment.

**O4 — Semantic Matching Not Yet Deployed**
`match-jd.mjs` + `profile-embeddings.json` can provide automated relevance scores that currently require manual evaluation. Wiring this into `prefilter-pipeline.mjs` would dramatically accelerate triage velocity.

**O5 — GitHub Repo Backup Creates Redundancy + Visibility**
Creating a private GitHub repo serves double duty: backup protection AND a professional portfolio artifact. The commit history itself demonstrates the engineering discipline of building a sophisticated job search system.

**O6 — Story Bank Not Yet Leveraged**
`interview-prep/story-bank.md` exists but hasn't been referenced in evaluations. STAR-format stories mapped to each archetype could improve interview conversion once the application pipeline activates.

**O7 — Company Intel Expansion Queue**
Only Anthropic and Panopto have company intel files. A `_queue.txt` exists for expansion. Populating 5-10 target companies enables better customization of cover letters and outreach messages.

### Threats

**T1 — Disk Failure = Total Loss**
No remote git backup. 11 commits + 2,292 scan history entries + 34 prefilter cards + 2 evaluation reports + 6 archetype PDFs exist only locally. This is the highest-severity risk in the entire system.

**T2 — Panopto + Valtech Evaluations Going Stale**
Both roles were evaluated 2 days ago (April 6). Most roles close within 2-4 weeks of posting, and candidate urgency signals (rapid application) are evaluated by recruiters. Delay = lower conversion.

**T3 — Anthropic Role Competition Intensity**
Anthropic is the most competitive employer in AI. With 30 prefilter cards, Matt is concentrated in a very high-competition pipeline. Even perfect applications face rejection rates of 95%+. Diversification into data, BI, and ERP roles at less-competitive companies should run in parallel.

**T4 — Job Market Velocity**
Senior data/AI roles at quality companies typically receive 200-500+ applications within 72 hours of posting. The 6am daily scan helps, but a 24-hour response time from scan to application is the target cadence.

**T5 — Local-Only Email + Contact History**
All outreach templates exist but no outreach records are tracked. Without a CRM or contact tracker, follow-up cadence is invisible.

**T6 — Windows Task Scheduler Reliability**
Scheduler tasks can silently fail if the machine reboots, the pnpm path changes, or environment variables shift. No alerting exists for failed scheduled scans.

---

## 9. Priority Action Matrix

### P0 — Do Today (Irreversible Risk)
1. **Create GitHub private repo + push 11 commits** — disk failure risk is existential
2. **Submit Panopto application** — 2 days stale, PDF ready
3. **Submit Valtech application** — 2 days stale, PDF ready
4. **Commit dirty working tree** — 2 modified + 7 untracked files

### P1 — This Week
5. **Implement Firecrawl job board queries** — expand discovery 5-10x
6. **Triage 34 Anthropic prefilter cards** — highest-fit cluster untouched
7. **A-F evaluate top 5 Anthropic roles** — prioritize Solutions Architect + Applied AI Engineer
8. **Fix 4 disabled Greenhouse slugs** — Monte Carlo, Alation, West Monroe, Resultant
9. **Add GitHub link + Side Projects to all 3 .docx resumes**

### P2 — This Month
10. **Run full Playwright scan** (all 47 company career pages, not just Greenhouse API)
11. **Wire semantic matching** into prefilter pipeline (profile-embeddings.json is ready)
12. **Expand company intel** to 10 more target companies
13. **Wire story-bank.md** into evaluation reports for interview prep context
14. **Add Task Scheduler failure alerting** (email or WhatsApp if scan fails)

---

## 10. Competitive Position Assessment

Matt's job search tooling is genuinely differentiated — not just "I used LinkedIn" but "I built a custom AI-powered job search system that scans 47 companies, generates archetype-targeted PDFs, and maintains a real-time dashboard." This itself is a proof point for the AI automation roles being targeted.

**Key positioning statement for interviews:**
> "I'm the candidate who built the automation system for my own job search. If you're hiring someone to automate your data workflows, I can show you the system I built to automate finding you."

---

*Report generated: 2026-04-08 by career-ops analysis session*
*Next review: After Firecrawl portal expansion implementation*
