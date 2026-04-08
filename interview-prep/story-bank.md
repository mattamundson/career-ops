# Story Bank — Master STAR+R Stories

This file accumulates your best interview stories over time. Each evaluation (Block F) adds new stories here. Instead of memorizing 100 answers, maintain 5-10 deep stories that you can bend to answer almost any behavioral question.

## How it works

1. Every time `/career-ops oferta` generates Block F (Interview Plan), new STAR+R stories get appended here
2. Before your next interview, review this file — your stories are already organized by theme
3. The "Big Three" questions can be answered with stories from this bank:
   - "Tell me about yourself" → combine 2-3 stories into a narrative
   - "Tell me about your most impactful project" → pick your highest-impact story
   - "Tell me about a conflict you resolved" → find a story with a Reflection

## Stories

---

### [Architecture] GMS Intelligence Pipeline
**Source:** Report #001 — Panopto — DataOps Engineer
**S (Situation):** Metal manufacturer with no data infrastructure — every purchasing and production decision was made manually with no visibility into live operational data.
**T (Task):** Build an end-to-end pipeline from the ERP API through analytics to AI-driven purchasing alerts.
**A (Action):** Built Paradigm ERP REST API → Python ETL → Power BI semantic models → AI purchasing alert engine → n8n automation → Microsoft Teams delivery. Owned every layer.
**R (Result):** Zero manual handoffs across all three operational domains — inventory, coil purchasing, and manufacturing. Live reorder triggers driving daily purchasing decisions.
**Reflection:** The bridge must be owned end-to-end or gaps appear at handoff points. Every layer I didn't own became a reliability risk.
**Best for questions about:** data architecture, end-to-end ownership, AI automation, operational analytics, "tell me about your most impactful project"

---

### [Data Modeling] Inventory Health Index
**Source:** Report #001 — Panopto — DataOps Engineer
**S (Situation):** Purchasing decisions made by gut feel — no consumption data model existed. SKU-count metrics were actively misleading because metal sells and stores in linear feet, not units.
**T (Task):** Build a domain-specific coil inventory consumption model with live reorder triggers.
**A (Action):** Rejected the generic SKU-count approach; built a linear-foot normalization model by gauge. Added blended 7/30/60/90-day usage windows to smooth short-term spikes. Output is commands ("order this", "run this today"), not charts.
**R (Result):** Gauge-level precision — separate consumption rates per thickness variant (26ga vs 29ga). Drives daily purchasing decisions across 300+ SKUs.
**Reflection:** Domain specificity beats generic models every time. The right abstraction is the one that matches how the business actually operates.
**Best for questions about:** data modeling, domain-driven design, requirements analysis, "tell me about a time you challenged assumptions"

---

### [Observability] n8n Closed-Loop Monitoring
**Source:** Report #001 — Panopto — DataOps Engineer
**S (Situation):** No visibility into cross-system operational state — anomalies in ERP inventory, barcode scanning, or production only surfaced during manual daily review.
**T (Task):** Build real-time monitoring with alerting across ERP, barcode, BI, and Teams.
**A (Action):** Used n8n as the integration fabric connecting 4 systems. Event-driven webhook triggers (not polling) for sub-second latency. Conditional logic routes alerts by type and suppresses noise below threshold.
**R (Result):** Operational monitoring that previously required daily manual review now runs continuously. Anomaly detected → alert fired → action taken with zero manual steps.
**Reflection:** Event-driven beats scheduled polling — continuous monitoring catches things that batch processes miss by design. Alert fatigue is an architecture problem, not a volume problem.
**Best for questions about:** observability, monitoring, data reliability, systems thinking, "tell me about a time you improved operational efficiency"

---

### [Reliability] Barcode Scanning System
**Source:** Report #001 — Panopto — DataOps Engineer
**S (Situation):** Manual clipboard-based inventory reconciliation used since company founding — 3 operational areas (receiving, production, shipping) reconciled separately with no real-time visibility.
**T (Task):** Build a production barcode scanning system that eliminates manual reconciliation entirely.
**A (Action):** Android app (ruggedized device compatible) → Node.js middleware → Paradigm ERP REST API with retry logic → Zebra ZPL label printer at point-of-production. Built offline-resilient queue for scan events when network drops.
**R (Result):** Real-time lot-level visibility. Full audit trail — every coil label printed, scanned, and consumed tracked in ERP with timestamps. Enables FIFO enforcement and defect traceability.
**Reflection:** Offline resilience is non-negotiable in production environments. Queues beat synchronous calls when the network is a shop floor Wi-Fi.
**Best for questions about:** production systems, reliability, automation, "tell me about a technical challenge you overcame"

---

### [Scale] FirstEnergy Enterprise Analytics
**Source:** Report #001 — Panopto — DataOps Engineer
**S (Situation):** Fortune 200 utility, thousands of business users, compliance-intensive regulated environment where data errors carry audit risk.
**T (Task):** Deliver analytics and workflow modernization at regulated-enterprise scale with audit requirements.
**A (Action):** Led analytics initiatives and software delivery for business-critical solutions with emphasis on auditability. Multi-team environment with compliance checkpoints built into every release.
**R (Result):** Delivered reliable, auditable reporting systems across a multi-team environment. Systems met compliance requirements consistently.
**Reflection:** Compliance requirements are a proxy for reliability standards — the same rigor that passes audits is exactly what production data systems need to be trustworthy.
**Best for questions about:** enterprise scale, compliance, regulated environments, stakeholder management, "tell me about a time you worked in a high-stakes environment"

---

### [AI/ML] Jarvis Trader
**Source:** Report #001 — Panopto — DataOps Engineer
**S (Situation):** Building an autonomous AI trading system — needed a reliable, observable data pipeline where bad data directly meant bad trades and real capital risk.
**T (Task):** Architect a 5-layer regime detection system with data reliability built in from the ground up.
**A (Action):** Python FastAPI engine, IB Gateway API integration, ConsecutiveLossTracker wired into SafetyLayer for circuit-breaking, 5-layer market regime filter before any signal is trusted, 1,295 passing tests. Walk-Forward Efficiency (WFE) as the primary model quality gate — models below 0.5 blocked from live trading regardless of backtest performance.
**R (Result):** Live paper trading on MCL (WFE=0.82) and MNQ (WFE=0.57). Best backtest: MES 1h PF=5.27, Sharpe=4.16, +47.2%. The WFE gate blocked a PF=5.27 MES model that was overfit (WFE=0.09).
**Reflection:** AI systems are only as reliable as the data contracts they depend on. Observability at every layer — you can't trust a signal you can't trace.
**Best for questions about:** AI/ML architecture, data reliability, systems thinking, "tell me about a project that required rigorous testing"

---

### [Ownership] COO Tech Stack
**Source:** Report #001 — Panopto — DataOps Engineer
**S (Situation):** Family business with zero operational technology — no ERP integration, no data pipeline, no analytics, no automation. No playbook, no team, no budget, no prior art to copy.
**T (Task):** Own the entire operational technology stack from ERP to barcode to BI to AI with zero outside contractors.
**A (Action):** Built every system described in the resume — ERP REST API integrations, Python ETL, Power BI semantic models, Android barcode app, n8n automation, AI purchasing alerts, and the Jarvis Trader system. On-call for every layer when anything broke.
**R (Result):** Production operational intelligence stack running in a live manufacturing environment with real financial stakes. Every purchasing decision across inventory and coil buying now runs through systems I built.
**Reflection:** Ownership means you're on call when it breaks — that's what separates builders from architects. The systems that matter most are the ones someone depends on when the plant is running.
**Best for questions about:** ownership mindset, full-stack thinking, "tell me about a time you had to figure something out with no guidance", "why do you want an IC role after being a COO"
