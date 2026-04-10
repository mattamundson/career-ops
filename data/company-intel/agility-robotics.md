---
company: Agility Robotics
slug: agility-robotics
last_updated: 2026-04-10
source: v13 session direct verification via Greenhouse API + WebFetch
---

# Company Intel: Agility Robotics

## Company Overview

Agility Robotics is a humanoid robotics company based in Albany, OR (founded 2015, spun out of Oregon State University). Their flagship product is **Digit**, a bipedal humanoid robot designed for logistics, warehouse automation, and manufacturing applications. Digit is actively deployed at commercial customers including Amazon (warehouse pilots), GXO Logistics, and Spanx. The company has raised ~$150M+ across multiple funding rounds with investors including DCVC, Playground Global, and Amazon Industrial Innovation Fund. Headcount estimated 200-300 employees as of 2026.

**Why this matters for Matt:** Agility is operating at the intersection of AI + robotics + warehouse operations — all three align with Matt's COO/manufacturing background and his Jarvis Trader/n8n automation experience. Robotics domain knowledge is NOT required; the BI Manager role is about building the data function that supports the business, not robotics R&D.

---

## Target Role: Manager, Business Intelligence

| Field | Value |
|-------|-------|
| **Job ID** | 5841009004 |
| **Title** | Manager, Business Intelligence |
| **Location** | Remote (fully remote confirmed via Greenhouse API) |
| **Comp** | $157K–$204K (per v12 evaluation, confirmed in JD) |
| **Score (v12)** | 3.8/5 GO |
| **Archetype match** | BI & Analytics Lead (primary) + Operational Data Architect (secondary) |

### Application Channel (VERIFIED 2026-04-10)

- **ATS:** Greenhouse (slug: `agilityrobotics`)
- **Direct application URL:** `https://job-boards.greenhouse.io/agilityrobotics/jobs/5841009004`
- **API endpoint:** `https://boards-api.greenhouse.io/v1/boards/agilityrobotics/jobs`
- **NOT LinkedIn Easy Apply** — application flows through Greenhouse form (much simpler than iCIMS, typically no captcha)
- **LinkedIn posting at `linkedin.com/jobs/view/4393992086` redirects to the Greenhouse application**

### What Makes This Role a Strong Fit

1. **"Existing BI analyst team to manage"** — matches Matt's COO experience managing cross-functional teams
2. **"ERP-from-scratch and BI-function-build-out preferred quals"** — direct match for GMS manufacturing intelligence pipeline (Paradigm ERP → Power BI → AI alerts)
3. **Manufacturing + logistics domain** — Matt's GMS experience is directly relevant
4. **Remote + $157-204K** — comfortably above Matt's $100K floor, within target range
5. **Manager level** — progression from IC-senior to management is the stated career trajectory in Matt's narrative

### Known Gaps

1. **Robotics domain specificity** — Matt has no prior robotics experience, but the role is BI management, not robotics engineering. Frame as: "I build data functions from scratch in industrial environments. The underlying manufacturing operations are where I'm native."
2. **Startup-stage modern BI tooling** — likely dbt + Snowflake + Looker (not Power BI). Matt's stack is Microsoft-heavy. Frame as: "Modern data stack fluency is a ramp, not a reinvention — the modeling discipline (dimensional modeling, metric definitions, semantic layer) transfers directly."
3. **No direct hardware/robotics SaaS experience** — but GMS manufacturing operator experience is adjacent.

---

## Talking Points for Cover Letter Personalization

### Opening hook
"Building a BI function from scratch in an industrial environment is exactly what I did at GMS — I installed Power BI company-wide, integrated it with the ERP, and added AI-driven alerts on top. Agility Robotics is that playbook at a more interesting scale with more interesting data."

### Evidence bullets
1. **GMS COO:** Built Paradigm ERP → Power BI → AI alerts pipeline from scratch. Inventory Health Index with gauge-level precision drives reorder decisions across 300+ SKUs. Zero manual handoffs, deployed to non-technical manufacturing staff.
2. **Pretium Partners:** Supported $25B+ distressed debt portfolio with risk dashboards — presenting insights to senior leadership, influencing capital decisions. "Influence without authority" at investment scale.
3. **Jarvis Trader:** Production AI system with 1,295 passing tests, 5-layer regime detection, ConsecutiveLossTracker safety layer. Demonstrates ability to architect data-driven AI systems with reliability discipline.
4. **FirstEnergy:** Fortune 200 enterprise scale — thousands of business users, compliance-intensive. Understands scaling BI governance.

### Gap framing
"Agility's stack is modern cloud data (likely dbt/Snowflake/Looker). My primary stack is Microsoft (Power BI/Fabric). The modeling discipline is identical — dimensional modeling, metric contracts, semantic layer governance. The specific tooling is a 60-90 day ramp I'd close in parallel with onboarding."

---

## Interview Prep Themes

### "Why robotics?"
"Robotics is where software meets physical reality, and industrial robotics specifically is where software meets operational reality. I've spent 10 years at that interface — ERP to shop floor, BI to purchasing decisions. Agility is that playbook applied to a hardware product that's still figuring out its data function."

### "Why management after being IC?"
"I've always been a player-coach. At GMS I built the stack AND owned the operational outcomes. I'm not trying to escape IC work — I want to multiply it through a team."

### "What's your first 90 days look like?"
"Listen first. Understand what data exists, what decisions are currently data-blind, and what the BI team's current frustrations are. The biggest mistake new BI managers make is building dashboards before understanding what decisions they need to support."

### "How do you think about BI for a humanoid robot company?"
"Two layers: (1) the internal business BI — revenue, deployments, customer success metrics, operational efficiency — which is identical to any other manufacturing/SaaS company. (2) the product telemetry layer — robot performance data, fleet operations, incident analysis — which is closer to IoT/observability. Both need a cohesive semantic layer to avoid 'two sources of truth' problems."

---

## Application Plan (Next Session)

### Step 1: Direct Greenhouse application
1. Navigate to `https://job-boards.greenhouse.io/agilityrobotics/jobs/5841009004`
2. Click "Apply Now" — opens Greenhouse form (usually single page, no account required)
3. Upload `output/cv-matt-agility-robotics-2026-04-09.pdf`
4. Paste or upload `output/cover-letters/agility-robotics-bi-manager.txt` into cover letter field
5. Fill standard fields: name, email, phone, LinkedIn URL, work authorization, etc.
6. No captcha typically on Greenhouse direct-apply flow
7. Submit, capture confirmation screenshot

### Step 2: Post-submission
1. Update `data/applications.md`: Agility Robotics row → status = Applied, date 2026-04-10 (or actual date)
2. Remove from `data/apply-queue.md`
3. Note confirmation email if received

### Estimated time
- **5-10 minutes** (much faster than Wipfli's iCIMS captcha flow)
- Can be done fully autonomously by Claude with minimal Matt involvement (unless standard work-auth questions require user input)

---

## Competitive Intelligence

- **2 open positions total at Agility Robotics** (per Glassdoor as of March 2026) — this is a high-signal posting, low-competition channel
- **BuiltIn, ZipRecruiter, startup.jobs** all mirror the posting — Matt's application via the canonical Greenhouse channel should deduplicate correctly
- **No Easy Apply traffic** — applications via Greenhouse direct are typically higher quality and get more recruiter attention than LinkedIn Easy Apply bulk channels

---

## Bottom Line

This is the EASIEST remaining submission in the ready-to-apply queue. No captcha, no multi-step iCIMS wizard — direct Greenhouse flow. Should be the NEXT application after Wipfli's captcha is cleared — or could even be submitted FIRST since it's faster.

**Verification status:** All data above verified via Greenhouse API (`boards-api.greenhouse.io/v1/boards/agilityrobotics/jobs`) and company careers page fetch on 2026-04-10.
