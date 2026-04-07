# Article Digest — Proof Points

Compact proof points from portfolio projects. Read by career-ops at evaluation time.

---

## GMS Operational Intelligence Pipeline

**Hero metrics:** Zero manual handoffs, real-time purchasing decisions replacing manual ERP workflows across inventory, coil purchasing, and manufacturing operations

**Architecture:** Paradigm ERP REST API → Power BI semantic models (DAX/SQL) → AI-driven purchasing alerts → automated reorder triggers → Microsoft Teams alerting → n8n orchestration layer

**Key decisions:**
- Used ERP REST API directly (not database) to ensure data integrity and avoid vendor lock-in
- Power BI semantic layer as the single source of truth — all alerts derive from the same model
- n8n as the integration fabric connecting disparate systems without custom code maintenance burden

**Proof points:**
- Replaced manual purchasing decisions with live production intelligence across all three operational domains
- Closed-loop monitoring: ERP data → BI alert → Teams notification → purchasing action, zero manual steps
- System survived live manufacturing environment with real financial stakes (purchasing decisions affect raw material costs)

---

## Inventory Health Index

**Hero metrics:** Domain-specific consumption model operating in linear feet with gauge-level precision; 7/30/60/90-day blended usage windows; live reorder triggers driving "order this" and "run this today" decisions

**Architecture:** ERP coil inventory data → linear-foot normalization by gauge → blended usage window calculation → consumption rate scoring → reorder threshold engine → direct purchasing action output

**Key decisions:**
- Rejected SKU-count model (misleading for metal); built domain-specific linear-foot model matching how the business actually buys and sells
- Four usage windows (7/30/60/90-day) blended rather than single window to prevent false alarms from short-term spikes
- Output is actionable commands ("order this", "run this today"), not charts or dashboards

**Proof points:**
- Gauge-level precision: separate consumption rates per thickness variant (e.g., 26ga vs 29ga)
- Live integration with ERP API — reorder triggers fire from actual inventory movement, not manual counts
- Reduced purchasing decision lag from days (manual review) to real-time

---

## Production Barcode Scanning System

**Hero metrics:** Full print → scan → track ERP lifecycle; eliminated manual inventory reconciliation; real-time lot-level visibility

**Architecture:** Android app (barcode scanner) → Node.js API → Paradigm ERP REST API lifecycle calls → Zebra label printer integration → lot-level inventory records

**Key decisions:**
- Android platform for shop floor (ruggedized device compatibility, no Windows dependency)
- Node.js middleware layer: translates scan events to ERP API calls, handles retry logic and error states
- Zebra-native label format: labels print at point-of-production, scan on use — no paper reconciliation

**Proof points:**
- Replaced manual clipboard-based inventory reconciliation used since company founding
- Full audit trail: every coil label printed, scanned, and consumed is tracked in ERP with timestamps
- Lot-level visibility enables first-in-first-out enforcement and defect traceability
- Built and deployed to live shop floor during active manufacturing operations

---

## GMS Cross-System Automation (n8n)

**Hero metrics:** Closed-loop operational monitoring connecting 4 systems; zero manual handoffs in the monitoring-to-alert chain

**Architecture:** n8n workflow engine → ERP event triggers → Power BI semantic model queries → barcode scan event listeners → Microsoft Teams alert routing → conditional escalation logic

**Key decisions:**
- n8n over custom code: visual workflow editor allows non-developer ops staff to modify alert logic without engineering involvement
- Webhook-based event triggers rather than polling — reduces latency from minutes to seconds
- Teams as the notification layer (already in use by staff, no new tool adoption required)

**Proof points:**
- 4-system integration (ERP + barcode + BI + Teams) with no custom integration middleware beyond n8n
- Zero manual handoffs: anomaly detected → alert fired → action taken is fully automated
- Alert fatigue mitigation: conditional logic suppresses noise (low-stock alerts only fire below threshold, not on every inventory read)

---

## GMS Product Data Infrastructure

**Hero metrics:** 307-item digital product catalog; replaced manual data entry; e-commerce-ready product publishing

**Architecture:** ERP product data API → Python transformation pipeline → normalized product schema (panels, trims, colors, dimensions) → structured JSON catalog → e-commerce platform-ready output

**Key decisions:**
- API-driven extraction rather than manual export — ensures catalog stays in sync with ERP as products change
- Domain schema designed for e-commerce publishing requirements (image slots, variant structure, SEO fields) not just internal use
- Color/finish normalization: standardized 40+ color names to consistent display names across SKU families

**Proof points:**
- 307 items cataloged across 3 product families (panels, trims, accessories) with full variant structure
- Reduced catalog build time from estimated 3+ weeks of manual data entry to automated pipeline
- Schema validated against real e-commerce platform requirements (Shopify product API structure)

---

## GMS CRM Architecture

**Hero metrics:** First system of record for pre-sales activity; captured previously invisible pipeline across all leads and opportunities

**Architecture:** Vercel-hosted frontend → Firebase Firestore (real-time database) → n8n automation (lead capture, status triggers) → role-based views (sales rep vs. leadership) → pipeline reporting

**Key decisions:**
- Firebase for real-time sync: sales reps update deal status from mobile without page reload
- Vercel + Firebase stack: zero server maintenance vs. self-hosted CRM alternatives
- n8n integration: new lead form submissions auto-create Firestore records and trigger Teams notifications

**Proof points:**
- Replaced ad-hoc tracking with structured pipeline — first visibility into pre-sales funnel in company history
- Role-based views: sales reps see own pipeline; leadership sees consolidated pipeline with stage analytics
- Built and deployed in live business environment with active sales team using it

---

## Jarvis Trader

**Hero metrics:** Walk-Forward Efficiency MCL=0.82, MNQ=0.57; $10K paper capital autonomous management; 1,295 passing tests; 5-layer market regime detection

**Architecture:** Python FastAPI engine (port 8010) → Interactive Brokers API (paper port 4002) → 5-layer regime detection → RL-trained signal models → STC(OS=15,OB=83) + ATR(0.70x/1.50x) strategy → SQLite state + Redis cache → React dashboard (port 3010)

**Key decisions:**
- Walk-Forward Efficiency as primary model quality gate: WFE below 0.5 blocked from live trading regardless of backtest PF
- 5-layer regime detection (trend, volatility, momentum, liquidity, correlation) before any signal is trusted
- Separate capital allocation per instrument ($5K MCL, $5K MNQ) with independent safety layers
- STC oscillator over RSI: faster regime response, better suited for futures tick structure

**Proof points:**
- MCL WFE=0.82 (production-grade); MNQ WFE=0.57 (approved with monitoring)
- Best backtest: MES 1h PF=5.27, Sharpe=4.16, +47.2% (WFE=0.09 flagged overfit, blocked from live)
- 1,295 passing tests, 0 failing — full test suite coverage across engine, signals, safety, and regime layers
- RL signal model: Run 10 Strong-Exit config (entry_cost=-0.01, hold_cost=-0.010, t1_bonus=0.50)
- ConsecutiveLossTracker wired into SafetyLayer: 3 losses→0.5x size, 5→0.25x, 7→halt
- WhatsApp approval workflow via OpenClaw gateway for position approvals outside market hours
- Morning briefing at 8:45 CT with regime, positions, and overnight summary delivered via WhatsApp

---

## Claude Code Skills and Plugins (23+ Skills)

**Hero metrics:** 23 production-ready skills; autonomous trading signal notifications; multi-agent task management; ML experiment automation framework

**Architecture:** Claude Code plugin system → custom SKILL.md files → MCP server integrations → OpenClaw WhatsApp gateway → Paperclip multi-agent orchestrator → n-autoresearch ML loop

**Key decisions:**
- OpenClaw as the AI-to-WhatsApp bridge: enables autonomous proactive notifications without human-initiated chat
- Paperclip for multi-agent coordination: atomic task checkout prevents duplicate agent work across 10-parallel-agent sessions
- n-autoresearch maps to Jarvis Trader experiment loop: rl_config.py Run 1-10 history is manual n-autoresearch done before the framework existed

**Proof points:**
- OpenClaw gateway: WhatsApp alerts for trading signals, approval requests, morning briefings, and health pings — all autonomous
- 4 cron jobs: morning brief (7 AM CT), pre-market news (8:30 AM CT), proactive heartbeat (30 min), EOD summary (4 PM CT)
- Paperclip V5: 33-file pack with goal hierarchy supporting P0/P1 priority enforcement across agent sessions
- n-autoresearch: 8 experiment categories mapped to Jarvis Trader (reward_shape, episode_config, signal_params, regime_filter, rl_hyperparams, feature_engineering, ablation, combine)
- Skills deployed: jarvis-trader, brief, pos, regime, engine-health, news-monitor, session-logs, summarize, n-autoresearch, paperclip, and 13 more

---

## Pretium Partners Risk Analytics

**Hero metrics:** $25B+ distressed debt analysis; predictive risk dashboards; elevated-risk asset surfacing across multi-asset portfolio

**Architecture:** Multi-source deal data → SQL database → Power BI semantic models → advanced DAX risk measures → predictive analytics visualizations → executive presentation layer

**Key decisions:**
- Power BI + DAX for risk modeling: enabled non-technical leadership to interact with complex risk metrics without analyst intermediation
- Custom DAX measures for distressed debt: standard financial metrics don't apply (no earnings, restructuring scenarios) — built domain-specific measures
- Blended data sources: deal terms, market data, and internal scoring in a single semantic model

**Proof points:**
- $25B+ in distressed debt and global investment opportunity analysis supported
- Elevated-risk asset flagging: automated surfacing of assets crossing risk thresholds, replacing manual portfolio review cycles
- Served as primary resource for SaaS applications and fund-of-funds operations including client audits
- Presented pricing due-diligence to senior leadership across global investment opportunities

---

## Land O'Lakes Supply Chain Analytics

**Hero metrics:** SQL database supporting 6,000+ annual truck purchases; Power BI ETL pipelines across 3 supply-chain teams; procurement analytics for active consulting engagements

**Architecture:** Raw procurement data → SQL database (custom schema) → ETL pipelines → Tableau + Power BI dashboards → procurement insight reports → consulting engagement deliverables

**Key decisions:**
- Built SQL database from scratch: existing data lived in spreadsheets, no queryable source of record existed
- Dual BI platform strategy (Tableau + Power BI): matched tools to specific team preferences and use cases
- Agile delivery: weekly sprint cadence with stakeholder demos, requirement updates, and iterative refinement

**Proof points:**
- 6,000+ annual truck purchase records modeled with customer, dealership, and opportunity dimensions
- Served as Power BI super-user across 3 supply-chain teams simultaneously
- Procurement analytics directly supported active consulting engagements used in client deliverables
- ETL pipeline design eliminated manual data wrangling that consumed analyst time before each reporting cycle

---

## UltiMed Data Warehouse Redesign

**Hero metrics:** +35% sales data insight increase; implemented Microsoft Power BI company-wide; owned all management-facing reporting

**Architecture:** Legacy indirect data warehouse → redesigned schema → Power BI semantic model → KPI dashboards → weekly/monthly sales reports → forecast models

**Key decisions:**
- Redesigned warehouse schema rather than patching: existing indirect data model had gaps producing incorrect attributions
- Power BI as the reporting standard: replaced fragmented Excel reporting across departments with a single platform
- Owned the full reporting lifecycle (data → model → dashboard → presentation) rather than just data prep

**Proof points:**
- +35% improvement in sales data insight quality measured by stakeholder adoption and report request reduction
- Led Power BI implementation org-wide: first standardized BI platform in company history
- Managed weekly and monthly sales reporting cycles with zero misses across 2-year tenure
- Sales margin visibility dashboard surfaced margin compression by product line previously invisible in raw data

---

## DST Market Services Reporting Automation

**Hero metrics:** +65% daily reporting efficiency; $1M+ brokerage dividend account management; clients include U.S. Bank, DA Davidson, BB&T

**Architecture:** Raw brokerage data → Excel macro automation → advanced formula layer → daily exception reports → cash/share reconciliation workflow → client-facing outputs

**Key decisions:**
- Excel macros over purpose-built tools: existing client systems required Excel-based deliverables, automation had to work within that constraint
- Exception-first reporting: built reports to surface anomalies rather than confirming normal, reducing analyst time on non-issues
- Reconciliation workflow: structured process for cash/share discrepancies reduced investigation time from hours to minutes

**Proof points:**
- +65% improvement in daily reporting efficiency through macro automation and formula optimization
- $1M+ across brokerage dividend accounts managed with zero client-facing reconciliation errors
- Institutional clients: U.S. Bank, DA Davidson, BB&T — high-stakes accuracy requirements met consistently
- Risk item investigation process built structured exception workflow that became team standard

---
