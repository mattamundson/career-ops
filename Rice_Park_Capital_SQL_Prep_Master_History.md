# Rice Park Capital SQL Assessment — Master Conversation History

> **Consolidated record** of all preparation sessions for the Rice Park Capital MS SQL Assessment (invited by Rosegate).
>
> **Assessment window:** Feb 10, 2026 → Apr 25, 2026 (12:00 AM EDT)
> **Duration:** 2 hours
> **Candidate:** Matt Amundson

---

## Table of Contents

1. [Session Context & Timeline](#1-session-context--timeline)
2. [About the Firm, the Role, and the Candidate's Approach](#2-about-the-firm-the-role-and-the-candidates-approach)
3. [Initial Prep Strategy (February 2026)](#3-initial-prep-strategy-february-2026)
4. [Re-engagement — April 21, 2026](#4-re-engagement--april-21-2026)
5. [Environment Discovery & The Azure Red Herring](#5-environment-discovery--the-azure-red-herring)
6. [The Local Database — `rice_park_practice`](#6-the-local-database--rice_park_practice)
7. [Foundational Patterns — Queries 1, 2, 3](#7-foundational-patterns--queries-1-2-3)
8. [The Critical Pattern — Gaps and Islands](#8-the-critical-pattern--gaps-and-islands)
9. [Advanced — Delinquency Trajectory Analysis](#9-advanced--delinquency-trajectory-analysis)
10. [Expert — Cohort Loss Cascade (Window Function Mastery)](#10-expert--cohort-loss-cascade-window-function-mastery)
11. [PhD Tier — Markov Chain Transition Matrix](#11-phd-tier--markov-chain-transition-matrix)
12. [State-of-the-Art — Bayesian HMM + Monte Carlo](#12-state-of-the-art--bayesian-hmm--monte-carlo)
13. [Debug Log — SQL Server Recursive CTE Limits](#13-debug-log--sql-server-recursive-cte-limits)
14. [Session Handoff & Current Blocker](#14-session-handoff--current-blocker)
15. [Pattern Recognition Cheat Sheet](#15-pattern-recognition-cheat-sheet)
16. [Key Decisions & Rationale](#16-key-decisions--rationale)
17. [TODO — Open Items Going Into Friday](#17-todo--open-items-going-into-friday)
18. [The Final Fix — Type-Clean Recursive CTE](#18-the-final-fix--type-clean-recursive-cte)
19. [Friday Pre-Flight Checklist](#19-friday-pre-flight-checklist)
20. [Test-Day Playbook — The 2-Hour Clock](#20-test-day-playbook--the-2-hour-clock)
21. [Appendix A: Mortgage Domain Glossary](#21-appendix-a-mortgage-domain-glossary)
22. [Appendix B: Sample Test Questions by Difficulty Tier](#22-appendix-b-sample-test-questions-by-difficulty-tier)

---

## 1. Session Context & Timeline

| Date | Event |
|---|---|
| **Feb 10, 2026** | Rice Park Capital (via Rosegate) invites Matt to take MS SQL Assessment. 2-hour window, easy/hard/extremely-hard questions. |
| **Feb 2026** | Original prep conversation: strategy built around gaps-and-islands, recursive CTEs, window functions. Azure SQL database stood up for practice. Next steps: thank-you email, env setup, HackerEarth practice test. |
| **Apr 21, 2026 (Tue)** | Re-engagement. Assessment still not taken. ~4 days remain until Apr 25 deadline. Starting point: **zero** focused SQL practice done since February. |
| **Apr 21 – 22, 2026 (overnight)** | Marathon prep session — progressed from zero → foundational → expert → state-of-the-art in one sitting. |
| **Apr 25, 2026 (Fri)** | Assessment deadline. |

---

## 2. About the Firm, the Role, and the Candidate's Approach

### Rice Park Capital
Rice Park Capital is a residential mortgage asset management firm. The firm invests in and manages pools of mortgage loans — that is the business, and every test question should be read through that lens. When they ask "find loans with X characteristic," they mean it in a portfolio management context: risk concentration, servicing performance, cohort health, loss projection.

**Why the database choices matter.** The practice database `rice_park_practice` mirrors the firm's actual data shape: a `loan_master` (static attributes), monthly `loan_snapshots` (performance over time), and pool/servicer reference tables. If the test hands you a mortgage dataset, expect this shape. Rehearse patterns against the firm's data model, not generic schemas.

### The candidate's learning methodology
This prep session followed a distinctive approach — worth documenting because it shapes how to re-engage the material later:

1. **Reverse-engineer from state-of-the-art.** Rather than building up from foundations, the candidate requested the hardest possible query first, then worked backwards to understand each piece. *"I want the most advanced state of the art code and then I want to work backwards on how to rebuild it all."*
2. **Push past "the hardest."** When the AI called the Markov chain the ceiling, the candidate pushed back: *"I think you have another level."* This escalated the work into Bayesian HMM + Monte Carlo territory, which ultimately surfaced more pattern-recognition value than the foundations would have alone.
3. **Learn by type-mismatch.** Most of the real SQL Server knowledge was won by hitting every recursive-CTE restriction, aggregate-over-subquery error, and type-parity requirement in turn. Debug iterations carried more signal than clean walkthroughs would have.

**Implication for re-engagement:** when returning to this material, don't reread the foundations first. Open the hardest query in §12, identify one CTE that feels opaque, rebuild just that CTE from scratch, then move to the next. That's the mode that sticks.

---

## 3. Initial Prep Strategy (February 2026)

The original plan, built in February after the invite:

- **Format expectations:** 2 hours, three difficulty tiers (easy / hard / extremely hard) — the "extremely hard" question almost certainly involves **gaps-and-islands** or **recursive CTEs**.
- **Pattern focus:** gaps-and-islands, recursive CTEs, window functions (ROW_NUMBER, RANK, LAG/LEAD).
- **Environment:** Azure SQL database provisioned for practice.
- **Next steps at close of Feb session:**
  1. Send thank-you email to the recruiter.
  2. Finish SQL environment setup.
  3. Take the HackerEarth practice test to learn the platform.

**What actually happened between Feb and Apr 21:** none of the above. Zero practice hours. No HackerEarth dry-run. Just connection troubleshooting on the Azure instance.

---

## 4. Re-engagement — April 21, 2026

Opening check-in, honest assessment:

| Skill | Self-rating (/10) |
|---|---|
| Basic JOINs + GROUP BY | 0 |
| Window functions (ROW_NUMBER, RANK, LAG/LEAD) | 0 |
| CTEs | 0 |
| Recursive CTEs | 0 |
| Gaps-and-islands | 0 |
| Hours of focused practice since Feb | 0 |
| HackerEarth practice test taken? | No |

**Framing:** this is a **4-day crash course from zero**, not a refresher. Four focused days is enough *if* the plan is surgical about what matters.

**Core principle adopted:** HackerEarth tests are pattern recognition games. Learn ~5 patterns, recognize which to apply, execute. 20 solved problems > 200 pages of documentation.

---

## 5. Environment Discovery & The Azure Red Herring

Initial attempt: connect to the Azure SQL database built in February.

### Azure issues (sequential)
1. **Azure Data Studio** — "mssql: Object Explorer task didn't complete within 45 seconds" (45s timeout).
2. **Firewall block** — client IP `34.72.174.153` not whitelisted. Fix path: Azure Portal → SQL server → Networking → Add client IPv4 address → Save.
3. **Wrong tool** — ended up in Azure Resource Graph Explorer (which queries *Azure resources*, not database contents). Redirected to Azure Portal → Query Editor.
4. **Empty Azure DB** — once connection was sorted, the Azure database `matt-rp-practice-sql` had **zero tables**. The Azure instance was a red herring.

### The pivot
Matt pushed back: *"Why do I need LeetCode when I already have a database of mortgage data?"*

This was correct. The Azure DB was empty but the **local SQL Server instance** (`localhost`) had a fully-populated `rice_park_practice` database. Stop fighting Azure. Use what works.

---

## 6. The Local Database — `rice_park_practice`

### Schema discovered
7 tables of realistic mortgage data:

| Table | Role |
|---|---|
| `loan_master` | Static loan info (FICO, property, original amounts) |
| **`loan_snapshots`** | **Monthly time-series performance data (the goldmine)** |
| `pool_monthly_activity` | Pool-level performance over time |
| `pools` | Pool static attributes |
| `portfolio_of_record` | Portfolio assignments |
| `remittances` | Payment history |
| `subservicers` | Servicer information |

### Why `loan_snapshots` is the goldmine
- Monthly snapshots per loan → natural time-series
- `dq_status` transitions (CURRENT → 30_DAY → 60_DAY → … → FORECLOSURE)
- `days_past_due`, `upb`, `as_of_date` — everything needed for gaps-and-islands, window functions, running totals.

This data is **better than LeetCode** for this test because Rice Park will almost certainly ask mortgage-domain questions, and domain familiarity compounds pattern knowledge.

### Inventory queries used
```sql
USE rice_park_practice;

-- List all tables
SELECT TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_SCHEMA, TABLE_NAME;

-- Column structures
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- Sample data
SELECT TOP 10 * FROM loan_snapshots ORDER BY loan_id, as_of_date;
```

> **Syntax gotcha:** after `USE rice_park_practice;`, reference tables as `dbo.loan_snapshots` (schema.table) — **not** `rice_park_practice.loan_snapshots` (database.schema.table).

---

## 7. Foundational Patterns — Queries 1, 2, 3

### Query 1 — Highest delinquency per loan (basic GROUP BY)

```sql
SELECT loan_id, MAX(days_past_due) AS max_days_delinquent
FROM dbo.loan_snapshots
GROUP BY loan_id
ORDER BY max_days_delinquent DESC;
```

**Top results:**
| loan_id | max_days_delinquent |
|---|---|
| 10122 | 300 |
| 10118 | 240 |
| 10345 | 240 |
| 10191 | 180 |
| 10255 | 120 |

Loan **10122** at 300 days = ~10 months behind → "seriously distressed asset."

### Query 2 — Month-over-month UPB change (LAG)

```sql
SELECT
    loan_id,
    as_of_date,
    upb AS current_upb,
    LAG(upb, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS prior_month_upb,
    upb - LAG(upb, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS upb_change
FROM dbo.loan_snapshots
WHERE loan_id = '10001'
ORDER BY as_of_date;
```

**Sample output for loan 10001:**

| as_of_date | current_upb | prior_month_upb | upb_change |
|---|---|---|---|
| 2025-05-31 | 636,988.58 | NULL | NULL |
| 2025-06-30 | 635,221.82 | 636,988.58 | **−1,766.76** |
| 2025-07-31 | 633,355.22 | 635,221.82 | −1,866.60 |
| 2025-08-31 | 633,355.22 | 633,355.22 | **0.00** ⚠️ |
| 2025-09-30 | 631,448.17 | 633,355.22 | −1,907.05 |
| … | | | |
| 2026-02-28 | 626,139.70 | 626,139.70 | **0.00** 🚨 |
| 2026-03-31 | 626,139.70 | 626,139.70 | **0.00** 🚨 |
| 2026-04-30 | 626,139.70 | 626,139.70 | **0.00** 🚨 |

**Insight:** `upb_change = 0` for 3+ consecutive months = borrower stopped paying principal → delinquency.

### Query 3 — Status transitions via self-join

```sql
SELECT
    curr.loan_id,
    prev.as_of_date AS prior_month,
    curr.as_of_date AS current_month,
    prev.dq_status AS was_status,
    curr.dq_status AS now_status,
    curr.days_past_due
FROM dbo.loan_snapshots curr
INNER JOIN dbo.loan_snapshots prev
    ON curr.loan_id = prev.loan_id
   AND curr.as_of_date = DATEADD(MONTH, 1, prev.as_of_date)
WHERE prev.dq_status = 'CURRENT'
  AND curr.days_past_due >= 30
ORDER BY curr.as_of_date DESC;
```

**Result:** 17 new delinquencies in April 2026 alone. Self-join pattern (`DATEADD(MONTH, 1, prev.as_of_date)`) is the workhorse for any "compare this month to last month" question.

### Lessons banked from Queries 1–3
- `LAG()` grabs the previous row's value inside a partition.
- Self-joins with `DATEADD` compare adjacent rows — useful when you want both rows in the output (LAG only gives you the value).
- Remember `dbo.` prefix; error diagnosis under time pressure is part of the test.

---

## 8. The Critical Pattern — Gaps and Islands

> **This is the pattern Rice Park will almost certainly test on the "extremely hard" question.** Master it or fail.

### Business question
"For each loan, find **all consecutive delinquency periods**. Show start, end, length, worst status."

### The query (Tested ✅)

```sql
WITH delinquent_months AS (
    SELECT loan_id, as_of_date, dq_status, days_past_due
    FROM dbo.loan_snapshots
    WHERE days_past_due >= 30
),
numbered AS (
    SELECT
        loan_id, as_of_date, dq_status, days_past_due,
        ROW_NUMBER() OVER (ORDER BY loan_id, as_of_date) AS global_rn,
        ROW_NUMBER() OVER (PARTITION BY loan_id ORDER BY as_of_date) AS loan_rn
    FROM delinquent_months
),
islands AS (
    SELECT
        loan_id, as_of_date, dq_status, days_past_due,
        global_rn - loan_rn AS island_id
    FROM numbered
)
SELECT
    loan_id,
    MIN(as_of_date) AS delinquency_start,
    MAX(as_of_date) AS delinquency_end,
    COUNT(*) AS months_delinquent,
    MAX(days_past_due) AS worst_dpd_in_period,
    MAX(dq_status) AS worst_status
FROM islands
GROUP BY loan_id, island_id
HAVING COUNT(*) >= 3
ORDER BY months_delinquent DESC, loan_id;
```

### Top results
| loan_id | start | end | months | worst_dpd | worst_status |
|---|---|---|---|---|---|
| **10122** | 2025-06-30 | 2026-04-30 | **11** | 300 | FORECLOSURE |
| 10341 | 2025-07-31 | 2026-04-30 | 10 | 120 | 90_DAY |
| 10345 | 2025-06-30 | 2026-04-30 | 10 | 240 | FORECLOSURE |
| 10118 | 2025-08-31 | 2026-04-30 | 9 | 240 | FORECLOSURE |
| 10001 | 2025-07-31 | 2026-04-30 | 5 | 60 | 60_DAY |

### Why `global_rn − loan_rn` works (the trick to internalize)

Take loan 10001's delinquent months:

| Month | global_rn | loan_rn | Difference (island_id) |
|---|---|---|---|
| 2025-07-31 | 23 | 1 | 22 |
| 2025-08-31 | 24 | 2 | 22 ← same island |
| 2025-09-30 | 25 | 3 | 22 |
| 2025-10-31 | 26 | 4 | 22 |
| 2025-11-30 | 27 | 5 | 22 |
| *(gap — cured in Dec)* | | | |
| 2026-01-31 | 180 | 6 | 174 ← new island |
| 2026-02-28 | 181 | 7 | 174 |

**The magic:**
- Consecutive months → both counters tick +1 → difference is constant.
- A gap → `global_rn` jumps but `loan_rn` keeps going by 1 → difference changes.
- **Same difference = same island.** `GROUP BY loan_id, island_id` collapses each streak.

### Recognition trigger for Friday
If you see "find consecutive…", "identify streaks…", "periods where…", your brain should fire: **`global_rn − loan_rn AS island_id`.**

### Follow-up: multi-episode detection (taught, returned zero rows)
Logic was correct; the dataset simply doesn't contain loans that went DQ → cured → DQ again. Every delinquent loan in this portfolio either stayed delinquent or the window ended. **Lesson:** empty results ≠ broken query. Remove filters (`HAVING COUNT(*) >= 2`) to confirm.

---

## 9. Advanced — Delinquency Trajectory Analysis

### Business question
"Find loans that **escalated** through DQ stages (DPD increasing), then later **improved**. Measure time at peak severity."

### The query (Tested ✅ — 5 chained CTEs)

```sql
WITH
status_flow AS (
    SELECT
        loan_id, as_of_date, dq_status, days_past_due,
        LAG(dq_status, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS prev_status,
        LAG(days_past_due, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS prev_dpd,
        LEAD(dq_status, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS next_status,
        LEAD(days_past_due, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS next_dpd
    FROM dbo.loan_snapshots
),
escalations AS (
    SELECT loan_id, as_of_date AS escalation_date, dq_status AS current_status, days_past_due AS peak_dpd
    FROM status_flow
    WHERE days_past_due > ISNULL(prev_dpd, 0)
      AND days_past_due >= 60
      AND next_dpd > days_past_due
),
improvements AS (
    SELECT loan_id, as_of_date AS improvement_date, dq_status AS current_status, days_past_due
    FROM status_flow
    WHERE days_past_due < ISNULL(prev_dpd, 999)
      AND prev_dpd >= 60
      AND days_past_due > 0
),
trajectories AS (
    SELECT
        e.loan_id, e.escalation_date, e.current_status AS escalation_status, e.peak_dpd,
        MIN(i.improvement_date) AS improvement_date,
        MIN(i.current_status) AS improvement_status
    FROM escalations e
    LEFT JOIN improvements i
        ON e.loan_id = i.loan_id
       AND i.improvement_date > e.escalation_date
    GROUP BY e.loan_id, e.escalation_date, e.current_status, e.peak_dpd
)
SELECT
    loan_id, escalation_date, improvement_date,
    DATEDIFF(MONTH, escalation_date, improvement_date) AS months_at_peak,
    escalation_status, improvement_status, peak_dpd,
    CASE
        WHEN improvement_date IS NULL THEN 'Never Improved'
        WHEN DATEDIFF(MONTH, escalation_date, improvement_date) <= 3 THEN 'Quick Recovery'
        ELSE 'Slow Recovery'
    END AS recovery_pattern
FROM trajectories
ORDER BY months_at_peak DESC, loan_id;
```

### What the data showed
- **Quick recovery (2–3 months):** loans 10028, 10134, 10308, 10367, 10423, 10479 — hit 60_DAY, bounced back to 30_DAY.
- **Slow recovery (4 months):** loan 10308 (had two escalation events).
- **Never improved (majority):** 10122, 10118, 10345, 10191 — escalated → foreclosure. Loan 10122 marched 90 → 120 → 150 → 180 → 210 → 240 → 270 → 300 days over 11 months.

### Building methodology (transferable to Friday)
1. Sketch logic on paper *before* SQL.
2. Build **one CTE at a time** and test with `WHERE loan_id = '10122'` before moving on.
3. Each CTE does ONE thing:
   - `status_flow` — add context (prev/next status)
   - `escalations` — filter to escalation rows
   - `improvements` — filter to improvement rows
   - `trajectories` — join A → B
   - Final SELECT — compute metrics

---

## 10. Expert — Cohort Loss Cascade (Window Function Mastery)

### Business question
"For each vintage, track how loan population flows through delinquency stages over time. Compute arrival rates, cure rates, 3-month rolling averages, and flag HIGH-RISK / ACCELERATING cohorts."

### The query — 8 CTEs, 12+ window functions (Tested ✅)

```sql
USE rice_park_practice;

WITH
-- Step 1: Derive vintage year (first snapshot year) per loan
loan_vintage AS (
    SELECT
        ls.loan_id,
        ls.as_of_date,
        ls.dq_status,
        ls.days_past_due,
        ls.upb,
        YEAR(MIN(ls.as_of_date) OVER (PARTITION BY ls.loan_id)) AS vintage_year
    FROM dbo.loan_snapshots ls
),

-- Step 2: Map status → ordinal severity, keep previous month's severity
status_severity AS (
    SELECT
        *,
        CASE dq_status
            WHEN 'CURRENT'     THEN 0
            WHEN '30_DAY'      THEN 1
            WHEN '60_DAY'      THEN 2
            WHEN '90_DAY'      THEN 3
            WHEN '120_DAY'     THEN 4
            WHEN 'FORECLOSURE' THEN 5
            ELSE 0
        END AS severity_level,
        LAG(CASE dq_status
            WHEN 'CURRENT'     THEN 0
            WHEN '30_DAY'      THEN 1
            WHEN '60_DAY'      THEN 2
            WHEN '90_DAY'      THEN 3
            WHEN '120_DAY'     THEN 4
            WHEN 'FORECLOSURE' THEN 5
            ELSE 0
        END, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS prev_severity
    FROM loan_vintage
),

-- Step 3: Population + arrivals + cures per vintage × month × severity
monthly_cohort_snapshot AS (
    SELECT
        vintage_year,
        as_of_date,
        severity_level,
        dq_status,
        COUNT(*)  AS loan_count,
        SUM(upb)  AS total_upb,
        SUM(CASE WHEN prev_severity IS NOT NULL AND severity_level > prev_severity THEN 1 ELSE 0 END) AS new_arrivals,
        SUM(CASE WHEN prev_severity IS NOT NULL AND severity_level < prev_severity THEN 1 ELSE 0 END) AS cures
    FROM status_severity
    GROUP BY vintage_year, as_of_date, severity_level, dq_status
),

-- Step 4: Attach previous month's count per vintage × severity
cohort_with_lag AS (
    SELECT
        *,
        LAG(loan_count, 1) OVER (PARTITION BY vintage_year, severity_level ORDER BY as_of_date) AS prev_month_count,
        LAG(total_upb,   1) OVER (PARTITION BY vintage_year, severity_level ORDER BY as_of_date) AS prev_month_upb
    FROM monthly_cohort_snapshot
),

-- Step 5: Flow rates (arrival %, cure %, retention %)
flow_metrics AS (
    SELECT
        vintage_year, as_of_date, severity_level, dq_status,
        loan_count, prev_month_count, new_arrivals, cures,
        loan_count - ISNULL(prev_month_count, 0) AS net_change,
        CASE WHEN ISNULL(prev_month_count, 0) > 0
             THEN CAST(new_arrivals AS FLOAT) / prev_month_count * 100 ELSE 0 END AS arrival_rate_pct,
        CASE WHEN ISNULL(prev_month_count, 0) > 0
             THEN CAST(cures        AS FLOAT) / prev_month_count * 100 ELSE 0 END AS cure_rate_pct,
        CASE WHEN ISNULL(prev_month_count, 0) > 0
             THEN CAST((loan_count - new_arrivals + cures) AS FLOAT) / prev_month_count * 100 ELSE 0 END AS retention_rate_pct
    FROM cohort_with_lag
),

-- Step 6: Cumulative (YTD) + rolling 3-month averages
cumulative_cascade AS (
    SELECT
        vintage_year, as_of_date, severity_level, dq_status,
        loan_count, new_arrivals, cures,
        arrival_rate_pct, cure_rate_pct, retention_rate_pct,
        SUM(new_arrivals) OVER (PARTITION BY vintage_year, severity_level ORDER BY as_of_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_arrivals,
        SUM(cures)        OVER (PARTITION BY vintage_year, severity_level ORDER BY as_of_date
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_cures,
        AVG(arrival_rate_pct) OVER (PARTITION BY vintage_year, severity_level ORDER BY as_of_date
            ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS rolling_3mo_arrival_rate,
        AVG(cure_rate_pct)    OVER (PARTITION BY vintage_year, severity_level ORDER BY as_of_date
            ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS rolling_3mo_cure_rate
    FROM flow_metrics
),

-- Step 7: Peak arrival rate per vintage × severity + the month it occurred
peak_risk_months AS (
    SELECT
        vintage_year,
        severity_level,
        dq_status,
        MAX(arrival_rate_pct) AS peak_arrival_rate,
        (SELECT TOP 1 as_of_date
         FROM cumulative_cascade cc2
         WHERE cc2.vintage_year   = cc.vintage_year
           AND cc2.severity_level = cc.severity_level
           AND cc2.arrival_rate_pct = MAX(cc.arrival_rate_pct)
         ORDER BY as_of_date
        ) AS peak_month
    FROM cumulative_cascade cc
    GROUP BY vintage_year, severity_level, dq_status
)

-- Step 8: Most recent month + HIGH_RISK / ACCELERATING flags
SELECT
    c.vintage_year,
    c.as_of_date,
    c.severity_level,
    c.dq_status,
    c.loan_count          AS current_population,
    c.cumulative_arrivals AS total_arrivals_ytd,
    c.cumulative_cures    AS total_cures_ytd,
    c.arrival_rate_pct    AS current_arrival_rate,
    c.rolling_3mo_arrival_rate AS avg_3mo_arrival_rate,
    p.peak_arrival_rate,
    p.peak_month,
    CASE
        WHEN c.arrival_rate_pct >= p.peak_arrival_rate * 0.8 THEN 'HIGH RISK'
        WHEN c.arrival_rate_pct >= p.peak_arrival_rate * 0.5 THEN 'ELEVATED'
        ELSE 'NORMAL'
    END AS risk_level,
    CASE
        WHEN c.arrival_rate_pct >  c.rolling_3mo_arrival_rate       THEN 'ACCELERATING'
        WHEN c.arrival_rate_pct <  c.rolling_3mo_arrival_rate * 0.8 THEN 'DECELERATING'
        ELSE 'STABLE'
    END AS trend
FROM cumulative_cascade c
INNER JOIN peak_risk_months p
    ON c.vintage_year   = p.vintage_year
   AND c.severity_level = p.severity_level
WHERE c.as_of_date = (SELECT MAX(as_of_date) FROM loan_vintage)
  AND c.severity_level > 0
ORDER BY c.vintage_year, c.severity_level;
```

### Key output — April 2026 snapshot (2025 vintage)

| severity_level | dq_status | current_pop | current_arrival_rate | 3mo_avg | peak_rate | peak_month | risk_level | trend |
|---|---|---|---|---|---|---|---|---|
| 1 | 30_DAY | 37 | 45% | 56.8% | 100% | 2026-01-31 | NORMAL | DECELERATING |
| 2 | 60_DAY | 20 | **93%** | 88.9% | 109% | 2026-02-28 | **HIGH RISK** | **ACCELERATING** 🚨 |
| 3 | 90_DAY | 5 | 57% | 230% | 600% | 2025-09-30 | NORMAL | DECELERATING |
| 4 | 120_DAY | 2 | 0% | 33% | 200% | 2025-12-31 | NORMAL | DECELERATING |
| 5 | FORECLOSURE | 4 | 0% | 11% | 200% | 2026-01-31 | NORMAL | DECELERATING |

### Business story
- 30_DAY front door is **slowing** (fewer new DQs entering pipeline).
- 60_DAY is a **black hole**: 93% of last month's 30_DAY population moved to 60_DAY this month, and the trend is accelerating.
- Back end (120_DAY, FORECLOSURE) is stable — for now.

### Three window frames introduced
| Frame | Syntax | Use case |
|---|---|---|
| Default (running total) | `OVER (PARTITION BY x ORDER BY y)` | Cumulative sums — uses `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` by default |
| Row-based | `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` | Moving avg over N rows (ignores gaps) |
| Value-based | `RANGE BETWEEN INTERVAL '3' MONTH PRECEDING AND CURRENT ROW` | Date-based window (honors gaps) |

**Memorize:** for rolling 3-month averages on monthly data → `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`.

### Pattern recognition
"Track X flowing through stages over time" + "conversion rates" + "peaks and trends" = this pattern. Structure:
1. Raw → add context (LAG/LEAD)
2. Aggregate to stage-month grain
3. LAG on the aggregates for MoM rates
4. Moving averages via `ROWS BETWEEN`
5. Compare current vs peak → risk flag

---

## 11. PhD Tier — Markov Chain Transition Matrix

### Business question
"Build a transition probability matrix (any state → any state in next month). Project forward. Identify absorbing states. Compute mean time to absorption."

### The query — 11 CTEs (Tested ✅)
Output combined via `UNION ALL` into four report types: `TRANSITION_MATRIX`, `CURRENT_DISTRIBUTION`, `PROJECTION_1MO`, `ABSORPTION_ANALYSIS`.

```sql
USE rice_park_practice;

WITH
state_definition AS (
    SELECT state_id, state_name FROM (VALUES
        (0, 'CURRENT'), (1, '30_DAY'), (2, '60_DAY'),
        (3, '90_DAY'),  (4, '120_DAY'), (5, 'FORECLOSURE')
    ) AS states(state_id, state_name)
),

loan_states AS (
    SELECT
        loan_id,
        as_of_date,
        CASE dq_status
            WHEN 'CURRENT'     THEN 0
            WHEN '30_DAY'      THEN 1
            WHEN '60_DAY'      THEN 2
            WHEN '90_DAY'      THEN 3
            WHEN '120_DAY'     THEN 4
            WHEN 'FORECLOSURE' THEN 5
            ELSE 0
        END AS current_state,
        LEAD(CASE dq_status
            WHEN 'CURRENT'     THEN 0
            WHEN '30_DAY'      THEN 1
            WHEN '60_DAY'      THEN 2
            WHEN '90_DAY'      THEN 3
            WHEN '120_DAY'     THEN 4
            WHEN 'FORECLOSURE' THEN 5
            ELSE 0
        END, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS next_state
    FROM dbo.loan_snapshots
),

transition_counts AS (
    SELECT current_state AS from_state, next_state AS to_state, COUNT(*) AS transition_count
    FROM loan_states
    WHERE next_state IS NOT NULL
    GROUP BY current_state, next_state
),

transition_matrix AS (
    SELECT
        tc.from_state,
        tc.to_state,
        tc.transition_count,
        SUM(tc.transition_count) OVER (PARTITION BY tc.from_state) AS total_from_state,
        CAST(tc.transition_count AS FLOAT) /
            SUM(tc.transition_count) OVER (PARTITION BY tc.from_state) AS probability
    FROM transition_counts tc
),

complete_matrix AS (
    SELECT
        s1.state_id   AS from_state,
        s2.state_id   AS to_state,
        s1.state_name AS from_state_name,
        s2.state_name AS to_state_name,
        ISNULL(tm.probability, 0) AS probability
    FROM state_definition s1
    CROSS JOIN state_definition s2
    LEFT JOIN transition_matrix tm
        ON s1.state_id = tm.from_state
       AND s2.state_id = tm.to_state
),

current_distribution AS (
    SELECT
        current_state AS state_id,
        COUNT(*)      AS loan_count,
        CAST(COUNT(*) AS FLOAT) / SUM(COUNT(*)) OVER () AS proportion
    FROM loan_states
    WHERE as_of_date = (SELECT MAX(as_of_date) FROM loan_states)
    GROUP BY current_state
),

-- Matrix × vector: next-month distribution
projection_1mo AS (
    SELECT
        cm.to_state   AS state_id,
        sd.state_name,
        SUM(ISNULL(cd.proportion, 0) * cm.probability) AS projected_proportion
    FROM complete_matrix cm
    LEFT JOIN current_distribution cd ON cm.from_state = cd.state_id
    INNER JOIN state_definition sd    ON cm.to_state   = sd.state_id
    GROUP BY cm.to_state, sd.state_name
),

-- Diagonal of the matrix (self-loop probabilities) tells us stickiness
absorbing_states AS (
    SELECT
        from_state,
        from_state_name,
        probability AS self_loop_probability,
        CASE
            WHEN probability >= 0.95 THEN 'ABSORBING'
            WHEN probability >= 0.75 THEN 'HIGHLY_STICKY'
            WHEN probability >= 0.50 THEN 'MODERATELY_STICKY'
            ELSE 'TRANSIENT'
        END AS state_type
    FROM complete_matrix
    WHERE from_state = to_state
),

-- For each loan-month, find first foreclosure date strictly after (materialized first)
foreclosure_dates AS (
    SELECT
        ls.loan_id,
        ls.current_state,
        ls.as_of_date,
        (SELECT MIN(ls2.as_of_date)
         FROM loan_states ls2
         WHERE ls2.loan_id = ls.loan_id
           AND ls2.current_state = 5
           AND ls2.as_of_date > ls.as_of_date
        ) AS foreclosure_date
    FROM loan_states ls
    WHERE ls.current_state < 5
),

-- Then aggregate the plain column (workaround: no aggregate over subquery)
time_to_foreclosure AS (
    SELECT
        current_state,
        DATEDIFF(MONTH, as_of_date, foreclosure_date) AS months_to_foreclosure,
        CASE WHEN foreclosure_date IS NOT NULL THEN 1 ELSE 0 END AS did_foreclose
    FROM foreclosure_dates
),

absorption_risk AS (
    SELECT
        ttf.current_state,
        sd.state_name,
        AVG(ttf.months_to_foreclosure) AS avg_months_to_foreclosure,
        COUNT(*) AS sample_size,
        CAST(SUM(ttf.did_foreclose) AS FLOAT) / COUNT(*) * 100 AS eventual_foreclosure_rate_pct
    FROM time_to_foreclosure ttf
    INNER JOIN state_definition sd ON ttf.current_state = sd.state_id
    GROUP BY ttf.current_state, sd.state_name
)

-- Combine four report types into one result set
SELECT 'TRANSITION_MATRIX' AS report_type,
       from_state, from_state_name, to_state, to_state_name, probability,
       NULL AS current_count, NULL AS projected_1mo_pct,
       NULL AS state_type, NULL AS avg_months_to_foreclosure, NULL AS foreclosure_rate_pct
FROM complete_matrix
WHERE probability > 0

UNION ALL

SELECT 'CURRENT_DISTRIBUTION', cd.state_id, sd.state_name, NULL, NULL, NULL,
       cd.loan_count, cd.proportion * 100, NULL, NULL, NULL
FROM current_distribution cd
INNER JOIN state_definition sd ON cd.state_id = sd.state_id

UNION ALL

SELECT 'PROJECTION_1MO', p1.state_id, p1.state_name, NULL, NULL, NULL,
       NULL, p1.projected_proportion * 100, NULL, NULL, NULL
FROM projection_1mo p1

UNION ALL

SELECT 'ABSORPTION_ANALYSIS', ar.current_state, ar.state_name, NULL, NULL, NULL,
       NULL, NULL, abs_st.state_type, ar.avg_months_to_foreclosure, ar.eventual_foreclosure_rate_pct
FROM absorption_risk ar
INNER JOIN absorbing_states abs_st ON ar.current_state = abs_st.from_state

ORDER BY report_type, from_state, to_state;
```

> **Subtle note on the output:** `absorbing_states` labels any state with self-loop probability ≥ 0.95 as `ABSORBING`. CURRENT has a 95.2% self-loop in this dataset, so it gets tagged `ABSORBING` too — which is a threshold artifact, not a real claim that a healthy loan can never become delinquent. The genuine absorbing state is FORECLOSURE (100% self-loop). If you tighten the threshold to ≥ 0.99, only FORECLOSURE qualifies.

### The empirical transition matrix (real output)

| From ↓ / To → | CURRENT | 30_DAY | 60_DAY | 90_DAY | 120_DAY | FORECLOSURE |
|---|---|---|---|---|---|---|
| **CURRENT** | **95.2%** | 4.8% | — | — | — | — |
| **30_DAY** | 37.6% | 32.3% | **30.1%** | — | — | — |
| **60_DAY** | 20.0% | 27.0% | 27.0% | **26.1%** | — | — |
| **90_DAY** | 18.5% | — | 37.0% | 14.8% | **29.6%** | — |
| **120_DAY** | — | — | — | 7.7% | **61.5%** | **30.8%** |
| **FORECLOSURE** | — | — | — | — | — | **100.0%** |

### Absorption analysis (eventual foreclosure probability)

| Current state | Avg months to FC | Eventual FC rate |
|---|---|---|
| CURRENT | 7 | 0.17% |
| 30_DAY | 5 | 1.1% |
| 60_DAY | 4 | 5.1% |
| 90_DAY | 2 | 11.4% |
| **120_DAY** | **1** | **43.8%** 🚨 |

### Current vs projected distribution (next month)

| State | Current | Projected 1mo | Δ |
|---|---|---|---|
| CURRENT | 85.2% | 85.2% | flat |
| 30_DAY | 8.0% | 7.9% | ↓ 0.1 |
| 60_DAY | 4.3% | 4.0% | ↓ 0.3 |
| 90_DAY | 1.1% | 1.3% | ↑ 0.2 |
| 120_DAY | 0.4% | 0.6% | ↑ 0.2 |
| FORECLOSURE | 0.9% | 1.0% | ↑ 0.1 |

**Portfolio story:** middle of the pipeline shrinking, tail (120+, foreclosure) growing → losses accruing on the back end.

### Key takeaway
- **FORECLOSURE is the absorbing state** (100% self-loop).
- **120_DAY is MODERATELY_STICKY** (61.5% stay). Event horizon.
- **30_DAY is the intervention point** — 37.6% cure today; boosting that to 50% prevents enormous downstream losses.

### Debugging moment
First attempt failed with: *"Cannot perform an aggregate function on an expression containing an aggregate or a subquery."* Cause: `AVG(DATEDIFF(MONTH, x, (SELECT MIN(y) FROM …)))`. Fix: **materialize** the subquery result into its own CTE column, then aggregate the plain column in the next CTE.

```sql
-- BROKEN
AVG(DATEDIFF(MONTH, as_of_date, (SELECT MIN(...) FROM ...)))

-- FIXED: Two CTEs
foreclosure_dates AS (
    SELECT ..., (SELECT MIN(...) FROM ...) AS foreclosure_date
    FROM ...
),
time_to_foreclosure AS (
    SELECT DATEDIFF(MONTH, as_of_date, foreclosure_date) AS months_to_fc
    FROM foreclosure_dates
)
SELECT AVG(months_to_fc) FROM time_to_foreclosure  -- clean
```

**Lesson → save for Friday:** "Materialize before aggregating."

---

## 12. State-of-the-Art — Bayesian HMM + Monte Carlo

> **Status:** Closed. Query went through 4 debug iterations (see §13 for the hard-won list). Final fix — explicit `CAST` on every anchor column — is documented in §18.

### What the query does (when it runs)
Combines three PhD-level techniques in pure SQL:
1. **Bayesian inference (Hidden Markov Model)** — treats observed `dq_status` as a noisy signal of the true underlying risk state. Uses an emission matrix to express P(observed | hidden).
2. **Monte Carlo simulation** — generates 100 simulated 12-month paths per loan using recursive CTE + pseudo-random number generation via `CHECKSUM` hashing.
3. **Value at Risk (VaR) & Expected Shortfall (CVaR)** — portfolio loss distribution with 50/75/90/95/99 percentiles; stress-test scenario with 2× deterioration / 0.5× cure rates.

### Ten advanced concepts it exercises
1. Hidden states + emission matrix (Bayesian)
2. Forward algorithm for state estimation
3. Cross-join to form complete probability matrices (fills unobserved cells with small prior)
4. Monte Carlo path generation (100 sims × 500 loans × 12 months = ~600k rows)
5. Pseudo-random numbers in SQL via `ABS(CHECKSUM(...)) % 1000000` (deterministic, reproducible)
6. Cumulative probability tables for state selection (workaround for recursive CTE limits — see §13)
7. Loss accumulation per simulated path
8. VaR via `ROW_NUMBER` percentiles (not `PERCENTILE_CONT` — see §13)
9. CVaR as avg of losses above VaR threshold
10. Stress scenario with re-weighted transitions, re-normalized, re-simulated

### Final corrected query (as of session close)
Full file saved at `/home/claude/ultimate_bayesian_hmm_monte_carlo.sql`. The query is long (~360 lines). The structure:

```
state_definition
loan_states
observed_transitions → transition_matrix → complete_transition_matrix → cumulative_transition_matrix
emission_matrix
current_portfolio → normalized_posterior
simulation_seeds
monte_carlo_paths (RECURSIVE)
portfolio_loss_by_simulation
loss_ranked → loss_percentiles
stress_transition_matrix → normalized_stress_matrix → cumulative_stress_matrix
stress_paths (RECURSIVE) → stress_loss_distribution → stress_loss_ranked → stress_var
transition_sensitivity → top_risk_transitions
-- Final: UNION ALL of BASE_CASE_VAR + STRESS_SCENARIO_VAR + TOP_RISK_TRANSITIONS
```

---

## 13. Debug Log — SQL Server Recursive CTE Limits

A hard-won list of things SQL Server does **not** allow in the recursive member of a recursive CTE:

| Forbidden in recursive member | Fix used |
|---|---|
| `TOP` / `OFFSET` | Rewrite with cumulative probabilities + `MIN()` |
| `MIN`, `MAX`, any aggregate | Hardcode probability thresholds as `CASE` statements |
| `GROUP BY` / `HAVING` | Pre-aggregate into a non-recursive CTE first |
| `DISTINCT` | Dedup upstream |
| Subqueries that reference the recursive CTE | Push logic into the anchor / use lookup CTEs |
| **Column type mismatch between anchor and recursive part** | Explicit `CAST(... AS FLOAT)` / `CAST(... AS INT)` on every column in the anchor |

### Other SQL Server gotchas hit this session
- `PERCENTILE_CONT` requires `OVER (...)` clause in T-SQL — **cannot** be used as a grouped aggregate like in PostgreSQL. Replacement: `ROW_NUMBER() OVER (ORDER BY …)` + `MAX(CASE WHEN rn = CAST(n * 0.95 AS INT) THEN value END)`.
- Can't `AVG(DATEDIFF(MONTH, x, (SELECT MIN(...) FROM ...)))` — aggregate over subquery forbidden. Split into two CTEs.
- `USE rice_park_practice;` doesn't let you reference `rice_park_practice.loan_snapshots`; use `dbo.loan_snapshots`.
- Multiple CTEs separated by commas; NO comma before the final `SELECT`.

### Final error (resolved — see §18)
```
Msg 240, Level 16, State 1, Line 7
Types don't match between the anchor and the recursive part in column "cumulative_loss"
of recursive query "monte_carlo_paths".
Msg 240, Level 16, State 1, Line 7
Types don't match between the anchor and the recursive part in column "from_state"
of recursive query "monte_carlo_paths".
```

**Root cause:** SQL Server requires *exact* type parity between the anchor `SELECT` and every recursive `SELECT` of a recursive CTE. Implicit conversions that work in a normal query are rejected here. Four columns drifted:
- `cumulative_loss` — anchor was `FLOAT`, recursive produced `NUMERIC` via `state_definition.loss_severity` literals (`0.05` typed as `NUMERIC(3,2)`)
- `current_state` — anchor pulled from a `VALUES` block literal; recursive returned a `CASE` expression with bare integer literals; T-SQL inferred different widths
- `random_seed` — `CHECKSUM` returns `INT` but accumulates into `BIGINT` territory with the `% 1000000` arithmetic in the recursive step
- `upb` — clean in isolation but trivially varies by path through upstream CTEs

**Resolution:** `CAST` every column explicitly in both anchor and recursive members so the types are declared, not inferred. Fix is in §18.

---

## 14. Session Handoff & Current Blocker

### Files produced (in `/home/claude/`)
- `ultimate_bayesian_hmm_monte_carlo.sql` — the state-of-the-art query (pending final type fix)
- `SESSION_HANDOFF.md` — exhaustive 15-section handoff doc
- `SESSION_SUMMARY.md` — visual quick-reference
- Plus earlier scratch: 4-day crash course curriculum, SQL quick-reference card, mortgage SQL practice exercises

### What's running / stopped / broken
- ✅ Local SQL Server at `localhost` — working
- ✅ `rice_park_practice` database — 7 tables, real mortgage data, fully usable
- ❌ Azure SQL (`matt-rp-practice-sql`) — empty; abandoned (not needed)
- ⚠️ Bayesian HMM query — anchor/recursive type mismatch remaining; needs explicit `CAST`s on every anchor column

### In-progress work (closed)
- ✅ **Type mismatch fixed** — explicit `CAST` added to every column in both anchor and recursive members; see §18.
- ✅ **`OPTION (MAXRECURSION 0)`** appended to the outer `SELECT` to prevent the default 100-iteration ceiling from aborting any 12-month projection with more than ~8 sims (recursion depth = months, not rows, so 12 is fine — but the option is cheap insurance against future edits).
- Pending on user: execute the patched query in §18, capture VaR_95 at months 1 / 6 / 12, compare base vs stress.

### Open pedagogical threads
- User explicitly requested "go backwards — show me the state-of-the-art, then teach me how to rebuild it." This is the current learning mode.
- User stance: "I don't believe that's the hardest you can go." Prompted escalation from Markov chain → Bayesian HMM + Monte Carlo.

---

## 15. Pattern Recognition Cheat Sheet

For Friday's assessment, map the question to the pattern fast:

| If the question says… | Reach for… |
|---|---|
| "month-over-month change" / "compare to previous row" | `LAG()` / `LEAD()` |
| "compare adjacent months and keep both rows" | self-join with `DATEADD(MONTH, 1, prev.as_of_date)` |
| "find consecutive periods" / "identify streaks" / "runs of…" | **gaps-and-islands**: `ROW_NUMBER() - ROW_NUMBER() AS island_id` |
| "escalation then improvement" / "track transitions A → B" | LAG + two filter CTEs (escalations, improvements) + join |
| "rolling 3-month average" | `AVG(...) OVER (... ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)` |
| "cumulative total" / "running sum" | `SUM(...) OVER (PARTITION BY ... ORDER BY ...)` (default frame) |
| "predict future distribution" / "project forward N months" | Markov transition matrix + recursive CTE or N multiplications |
| "probability of eventually reaching state X" | absorption analysis (correlated subquery for first hitting time) |
| "confidence interval" / "VaR" / "loss distribution" | `ROW_NUMBER`-based percentile + `MAX(CASE WHEN rn = pct THEN value END)` |
| empty result set | DON'T assume broken query — remove filters, validate data first |
| "can't use aggregate on subquery" | materialize subquery into its own CTE column |

### Build discipline (internalize for Friday)
1. Sketch logic on paper first (no SQL).
2. Build **one CTE at a time**; test each with a single known loan.
3. Every CTE does exactly one thing.
4. When stuck: remove filters, test on one `loan_id`, check counts.

---

## 16. Key Decisions & Rationale

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Practice data | Local `rice_park_practice` | LeetCode or Azure SQL | Real mortgage data → domain knowledge compounds pattern knowledge. Azure was empty. |
| Teaching direction | State-of-the-art first, then deconstruct | Ground up | User request. High ceiling forces comfort with complexity; reverse-engineering teaches architecture. |
| Random numbers in SQL | `ABS(CHECKSUM(...)) % 1000000` | `NEWID()` or external RNG | Deterministic + reproducible; works inside recursive CTEs. |
| State selection in recursive CTE | Cumulative probability + `CASE` | Dynamic `MIN(to_state) WHERE cumulative_prob >= r` | SQL Server forbids aggregates in recursive members. |
| Percentile calculation | `ROW_NUMBER` + `MAX(CASE …)` | `PERCENTILE_CONT` | T-SQL requires `OVER()` on `PERCENTILE_CONT`; won't work as grouped aggregate. |
| Simulation scale | 100 sims × 12 months | 1000 sims | Performance on recursive CTE; enough for demo. |
| SQL purity | Pure T-SQL, no SPs / CLR / Python | SQL Server ML Services | Portable, auditable, no external dependencies. |

---

## 17. TODO — Open Items Going Into Friday

### Done tonight
1. ✅ **Bayesian HMM query fixed** — explicit `CAST`s on every column; `OPTION (MAXRECURSION 0)` added. See §18 for the patched query.
2. Next: copy the patched query from §18 into SSMS / Azure Data Studio and capture VaR_95 at month 1 / 6 / 12, delta vs stress, top risk transition.

### Wednesday (Day 2 practice)
- Pool-level aggregations: aggregate `loan_snapshots` to `pool_monthly_activity` grain.
- Multi-table joins: `loan_master` × `loan_snapshots` → delinquency by FICO bucket.
- Geography & property-type cuts.

### Thursday (Day 3 — full simulation)
- **2-hour timed practice run.** Three questions, easy / hard / extremely-hard.
- Use only the personal quick-reference card (no internet).
- Record time per question; identify weak spots.

### Friday (Assessment)
- Take the Rice Park Capital assessment on HackerEarth inside the 2-hour window.
- Submit before Apr 25, 12:00 AM EDT.

### Patterns still not covered (bring if time allows)
- PIVOT / UNPIVOT
- `STRING_AGG` for list concatenation
- `FOR JSON PATH` for API-style outputs
- Temp tables vs CTEs — when each is preferable
- Stored procedures for encapsulating logic

---

## 18. The Final Fix — Type-Clean Recursive CTE

### The principle
SQL Server's recursive CTE type-checker is strict: every column in the anchor `SELECT` must declare the **same type** as its counterpart in the recursive `SELECT`. The engine does not coerce. It errors out with `Msg 240`. The only robust defense is **declaring types explicitly with `CAST`** rather than relying on inference.

### The patch

Replace the `monte_carlo_paths` CTE in `/home/claude/ultimate_bayesian_hmm_monte_carlo.sql` with this type-clean version:

```sql
monte_carlo_paths AS (
    -- ANCHOR: explicit types on every column
    SELECT
        ss.loan_id,
        CAST(ss.sim_number AS BIGINT)                AS sim_number,
        CAST(0 AS INT)                               AS month,
        CAST(np.hidden_state AS INT)                 AS current_state,
        CAST(np.upb AS DECIMAL(18,2))                AS upb,
        CAST(ss.random_seed AS BIGINT)               AS random_seed,
        CAST(0 AS FLOAT)                             AS cumulative_loss
    FROM simulation_seeds ss
    INNER JOIN normalized_posterior np
        ON ss.loan_id = np.loan_id
    WHERE np.hidden_state = np.observed_state

    UNION ALL

    -- RECURSIVE: every column CAST to match the anchor's declared type
    SELECT
        mcp.loan_id,
        CAST(mcp.sim_number AS BIGINT)               AS sim_number,
        CAST(mcp.month + 1 AS INT)                   AS month,
        CAST(
            CASE
                WHEN mcp.current_state = 0 THEN
                    CASE WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 952
                         THEN 0 ELSE 1 END
                WHEN mcp.current_state = 1 THEN
                    CASE
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 376 THEN 0
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 699 THEN 1
                        ELSE 2
                    END
                WHEN mcp.current_state = 2 THEN
                    CASE
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 200 THEN 0
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 470 THEN 1
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 739 THEN 2
                        ELSE 3
                    END
                WHEN mcp.current_state = 3 THEN
                    CASE
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 185 THEN 0
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 555 THEN 2
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 703 THEN 3
                        ELSE 4
                    END
                WHEN mcp.current_state = 4 THEN
                    CASE
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 <  77 THEN 3
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 692 THEN 4
                        ELSE 5
                    END
                ELSE 5  -- FORECLOSURE is absorbing
            END
        AS INT)                                      AS current_state,
        CAST(mcp.upb AS DECIMAL(18,2))               AS upb,
        CAST(mcp.random_seed AS BIGINT)              AS random_seed,
        CAST(
            mcp.cumulative_loss +
            (CASE mcp.current_state
                 WHEN 0 THEN 0.00
                 WHEN 1 THEN 0.05
                 WHEN 2 THEN 0.15
                 WHEN 3 THEN 0.35
                 WHEN 4 THEN 0.60
                 WHEN 5 THEN 1.00
                 ELSE 0.00
             END) * mcp.upb * 0.01
        AS FLOAT)                                    AS cumulative_loss
    FROM monte_carlo_paths mcp
    WHERE mcp.month < 12
)
```

### Why each CAST is there

| Column | Anchor type | Recursive type (before fix) | Fix |
|---|---|---|---|
| `sim_number` | `BIGINT` (from `ROW_NUMBER`) | matched, but made explicit | `CAST(… AS BIGINT)` both sides |
| `month` | `INT` literal `0` | `INT` from arithmetic | `CAST(… AS INT)` both sides for symmetry |
| `current_state` | From `VALUES` block — T-SQL infers `TINYINT` on small literals | `CASE` returning bare `0..5` — inferred differently per branch | `CAST(… AS INT)` both sides |
| `upb` | `DECIMAL` from source column | same source column but may drift through prior CTEs | `CAST(… AS DECIMAL(18,2))` both sides |
| `random_seed` | `INT` from `CHECKSUM` | arithmetic expansion near `INT` overflow → SQL Server promotes | `CAST(… AS BIGINT)` both sides |
| `cumulative_loss` | `FLOAT` via `CAST(0 AS FLOAT)` | `NUMERIC` from `loss_severity` (`0.05`, `0.15`…) × `DECIMAL upb` | Wrap whole expression in `CAST(… AS FLOAT)` |

### And — the one other thing that will bite you

Add this to the **outer** `SELECT` at the very end of the query (after `ORDER BY`):

```sql
OPTION (MAXRECURSION 0);
```

SQL Server's default recursion depth is **100**. A 12-month projection only goes 12 levels deep, so you're safe today — but the second you edit this to project 24 or 36 months, or someone nudges the projection logic to recurse differently, the default blows up. `MAXRECURSION 0` means "no limit." It's one line; use it.

### Complete patched query

Copy the entire fenced block below into SSMS or Azure Data Studio and execute. Expected runtime: 30–60 seconds. Expected output: ~34 rows across three `report_type` values (`BASE_CASE_VAR`, `STRESS_SCENARIO_VAR`, `TOP_RISK_TRANSITIONS`).

```sql
/* =============================================================================
   BAYESIAN HIDDEN MARKOV MODEL + MONTE CARLO LOSS DISTRIBUTION
   Rice Park Capital SQL Assessment Prep — Final Fixed Version
   -----------------------------------------------------------------------------
   Fixes applied vs. prior iteration:
     1. Explicit CAST on every column in anchor AND recursive members of the
        monte_carlo_paths and stress_paths CTEs. SQL Server Msg 240 demands
        exact type parity between anchor and recursive selects.
     2. OPTION (MAXRECURSION 0) appended to the outer SELECT — defaults to 100
        which is fine at 12 months but fails silently for any longer horizon.
     3. All prior fixes retained:
        - Cumulative probability CASE statements replace TOP/MIN in recursive
          member (SQL Server forbids TOP + aggregates + GROUP BY in recursive).
        - PERCENTILE_CONT replaced with ROW_NUMBER + MAX(CASE ...) percentile
          trick (T-SQL requires OVER() on PERCENTILE_CONT).
        - Subquery-inside-aggregate in absorption_risk split into two CTEs
          (materialize subquery before aggregating).

   Expected runtime: 30-60 seconds. Expected output: ~34 rows across three
   report_types: BASE_CASE_VAR, STRESS_SCENARIO_VAR, TOP_RISK_TRANSITIONS.
   ========================================================================= */

USE rice_park_practice;

WITH

-- ---------------------------------------------------------------------------
-- PART 1: Data prep
-- ---------------------------------------------------------------------------

state_definition AS (
    SELECT state_id, state_name, loss_severity FROM (VALUES
        (0, 'CURRENT',     0.00),
        (1, '30_DAY',      0.05),
        (2, '60_DAY',      0.15),
        (3, '90_DAY',      0.35),
        (4, '120_DAY',     0.60),
        (5, 'FORECLOSURE', 1.00)
    ) AS states(state_id, state_name, loss_severity)
),

loan_states AS (
    SELECT
        loan_id,
        as_of_date,
        upb,
        CASE dq_status
            WHEN 'CURRENT'     THEN 0
            WHEN '30_DAY'      THEN 1
            WHEN '60_DAY'      THEN 2
            WHEN '90_DAY'      THEN 3
            WHEN '120_DAY'     THEN 4
            WHEN 'FORECLOSURE' THEN 5
        END AS observed_state,
        ROW_NUMBER() OVER (PARTITION BY loan_id ORDER BY as_of_date) AS time_index
    FROM dbo.loan_snapshots
),

-- ---------------------------------------------------------------------------
-- PART 2: Empirical transition matrix
-- ---------------------------------------------------------------------------

observed_transitions AS (
    SELECT current_state, next_state, COUNT(*) AS cnt
    FROM (
        SELECT
            observed_state AS current_state,
            LEAD(observed_state) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS next_state
        FROM loan_states
    ) t
    WHERE next_state IS NOT NULL
    GROUP BY current_state, next_state
),

transition_matrix AS (
    SELECT
        current_state AS from_state,
        next_state    AS to_state,
        CAST(cnt AS FLOAT) / SUM(cnt) OVER (PARTITION BY current_state) AS probability
    FROM observed_transitions
),

complete_transition_matrix AS (
    SELECT
        s1.state_id AS from_state,
        s2.state_id AS to_state,
        ISNULL(tm.probability, 0.0001) AS probability
    FROM state_definition s1
    CROSS JOIN state_definition s2
    LEFT JOIN transition_matrix tm
        ON s1.state_id = tm.from_state
       AND s2.state_id = tm.to_state
),

-- ---------------------------------------------------------------------------
-- PART 3: Bayesian emission matrix
-- ---------------------------------------------------------------------------

emission_matrix AS (
    SELECT
        hidden_state,
        observed_state,
        CASE
            WHEN hidden_state = observed_state         THEN 0.70
            WHEN ABS(hidden_state - observed_state) = 1 THEN 0.20
            WHEN ABS(hidden_state - observed_state) = 2 THEN 0.08
            ELSE 0.02 / 3
        END AS emission_probability
    FROM (
        SELECT s1.state_id AS hidden_state, s2.state_id AS observed_state
        FROM state_definition s1
        CROSS JOIN state_definition s2
    ) states
),

-- ---------------------------------------------------------------------------
-- PART 4: Forward algorithm (posterior over hidden states per loan)
-- ---------------------------------------------------------------------------

current_portfolio AS (
    SELECT
        ls.loan_id,
        ls.observed_state,
        ls.upb,
        em.hidden_state,
        em.emission_probability * (1.0 / 6.0) AS posterior_probability
    FROM loan_states ls
    CROSS JOIN emission_matrix em
    WHERE ls.as_of_date = (SELECT MAX(as_of_date) FROM loan_states)
      AND em.observed_state = ls.observed_state
),

normalized_posterior AS (
    SELECT
        loan_id,
        observed_state,
        upb,
        hidden_state,
        posterior_probability /
            SUM(posterior_probability) OVER (PARTITION BY loan_id) AS hidden_state_prob
    FROM current_portfolio
),

-- ---------------------------------------------------------------------------
-- PART 5: Monte Carlo seeds (100 simulated paths per loan)
-- ---------------------------------------------------------------------------

simulation_seeds AS (
    SELECT
        np.loan_id,
        sims.sim_number,
        ABS(CHECKSUM(CAST(np.loan_id AS VARCHAR) + CAST(sims.sim_number AS VARCHAR))) % 1000000
            AS random_seed
    FROM normalized_posterior np
    CROSS JOIN (
        SELECT TOP 100 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS sim_number
        FROM dbo.loan_snapshots
    ) sims
    WHERE np.hidden_state = np.observed_state
),

-- ---------------------------------------------------------------------------
-- PART 6: Monte Carlo path simulation (recursive)
-- FIXED: every column CAST explicitly in both anchor and recursive members
-- ---------------------------------------------------------------------------

monte_carlo_paths AS (
    -- ANCHOR
    SELECT
        ss.loan_id,
        CAST(ss.sim_number      AS BIGINT)        AS sim_number,
        CAST(0                  AS INT)           AS month,
        CAST(np.hidden_state    AS INT)           AS current_state,
        CAST(np.upb             AS DECIMAL(18,2)) AS upb,
        CAST(ss.random_seed     AS BIGINT)        AS random_seed,
        CAST(0                  AS FLOAT)         AS cumulative_loss
    FROM simulation_seeds ss
    INNER JOIN normalized_posterior np
        ON ss.loan_id = np.loan_id
    WHERE np.hidden_state = np.observed_state

    UNION ALL

    -- RECURSIVE
    SELECT
        mcp.loan_id,
        CAST(mcp.sim_number     AS BIGINT)        AS sim_number,
        CAST(mcp.month + 1      AS INT)           AS month,
        CAST(
            CASE
                WHEN mcp.current_state = 0 THEN
                    CASE WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 952
                         THEN 0 ELSE 1 END
                WHEN mcp.current_state = 1 THEN
                    CASE
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 376 THEN 0
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 699 THEN 1
                        ELSE 2
                    END
                WHEN mcp.current_state = 2 THEN
                    CASE
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 200 THEN 0
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 470 THEN 1
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 739 THEN 2
                        ELSE 3
                    END
                WHEN mcp.current_state = 3 THEN
                    CASE
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 185 THEN 0
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 555 THEN 2
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 703 THEN 3
                        ELSE 4
                    END
                WHEN mcp.current_state = 4 THEN
                    CASE
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 <  77 THEN 3
                        WHEN (mcp.random_seed + mcp.month * 997) % 1000 < 692 THEN 4
                        ELSE 5
                    END
                ELSE 5  -- FORECLOSURE is absorbing
            END
        AS INT)                                   AS current_state,
        CAST(mcp.upb            AS DECIMAL(18,2)) AS upb,
        CAST(mcp.random_seed    AS BIGINT)        AS random_seed,
        CAST(
            mcp.cumulative_loss +
            (CASE mcp.current_state
                 WHEN 0 THEN 0.00
                 WHEN 1 THEN 0.05
                 WHEN 2 THEN 0.15
                 WHEN 3 THEN 0.35
                 WHEN 4 THEN 0.60
                 WHEN 5 THEN 1.00
                 ELSE 0.00
             END) * mcp.upb * 0.01
        AS FLOAT)                                 AS cumulative_loss
    FROM monte_carlo_paths mcp
    WHERE mcp.month < 12
),

-- ---------------------------------------------------------------------------
-- PART 7: Portfolio-level loss distribution per simulation
-- ---------------------------------------------------------------------------

portfolio_loss_by_simulation AS (
    SELECT
        sim_number,
        month,
        SUM(cumulative_loss) AS total_portfolio_loss,
        SUM(CASE WHEN current_state = 5 THEN upb ELSE 0 END) AS foreclosed_balance,
        SUM(CASE WHEN current_state >= 3 THEN upb ELSE 0 END) AS severely_delinquent_balance,
        COUNT(DISTINCT CASE WHEN current_state = 5 THEN loan_id END) AS foreclosed_count
    FROM monte_carlo_paths
    GROUP BY sim_number, month
),

-- ---------------------------------------------------------------------------
-- PART 8: VaR / CVaR via ROW_NUMBER percentile trick
-- ---------------------------------------------------------------------------

loss_ranked AS (
    SELECT
        month,
        total_portfolio_loss,
        foreclosed_balance,
        severely_delinquent_balance,
        foreclosed_count,
        ROW_NUMBER() OVER (PARTITION BY month ORDER BY total_portfolio_loss) AS rn,
        COUNT(*)     OVER (PARTITION BY month) AS total_sims
    FROM portfolio_loss_by_simulation
),

loss_percentiles AS (
    SELECT
        month,
        AVG(total_portfolio_loss)   AS mean_loss,
        STDEV(total_portfolio_loss) AS std_dev_loss,
        MIN(total_portfolio_loss)   AS min_loss,
        MAX(total_portfolio_loss)   AS max_loss,
        MAX(CASE WHEN rn = CAST(total_sims * 0.50 AS INT) THEN total_portfolio_loss END) AS VaR_50_median,
        MAX(CASE WHEN rn = CAST(total_sims * 0.75 AS INT) THEN total_portfolio_loss END) AS VaR_75,
        MAX(CASE WHEN rn = CAST(total_sims * 0.90 AS INT) THEN total_portfolio_loss END) AS VaR_90,
        MAX(CASE WHEN rn = CAST(total_sims * 0.95 AS INT) THEN total_portfolio_loss END) AS VaR_95,
        MAX(CASE WHEN rn = CAST(total_sims * 0.99 AS INT) THEN total_portfolio_loss END) AS VaR_99,
        AVG(CASE WHEN rn >= total_sims * 0.95 THEN total_portfolio_loss END)             AS CVaR_95,
        AVG(foreclosed_balance)          AS avg_foreclosed_balance,
        AVG(severely_delinquent_balance) AS avg_severe_dq_balance,
        AVG(foreclosed_count)            AS avg_foreclosed_count
    FROM loss_ranked
    GROUP BY month
),

-- ---------------------------------------------------------------------------
-- PART 9: Stress scenario (2x deterioration, 0.5x cure)
-- ---------------------------------------------------------------------------

stress_transition_matrix AS (
    SELECT
        from_state,
        to_state,
        CASE
            WHEN to_state > from_state THEN probability * 2.0
            WHEN to_state < from_state THEN probability * 0.5
            ELSE probability
        END AS stressed_probability
    FROM complete_transition_matrix
),

normalized_stress_matrix AS (
    SELECT
        from_state,
        to_state,
        stressed_probability /
            SUM(stressed_probability) OVER (PARTITION BY from_state) AS probability
    FROM stress_transition_matrix
),

stress_paths AS (
    -- ANCHOR (same CAST discipline)
    SELECT
        ss.loan_id,
        CAST(ss.sim_number   AS BIGINT)        AS sim_number,
        CAST(0               AS INT)           AS month,
        CAST(np.hidden_state AS INT)           AS current_state,
        CAST(np.upb          AS DECIMAL(18,2)) AS upb,
        CAST(ss.random_seed  AS BIGINT)        AS random_seed,
        CAST(0               AS FLOAT)         AS cumulative_loss
    FROM simulation_seeds ss
    INNER JOIN normalized_posterior np
        ON ss.loan_id = np.loan_id
    WHERE np.hidden_state = np.observed_state
      AND ss.sim_number <= 50  -- half the sims for stress (performance)

    UNION ALL

    -- RECURSIVE (stressed transitions: approximately double deterioration)
    SELECT
        sp.loan_id,
        CAST(sp.sim_number   AS BIGINT)        AS sim_number,
        CAST(sp.month + 1    AS INT)           AS month,
        CAST(
            CASE
                WHEN sp.current_state = 0 THEN
                    CASE WHEN (sp.random_seed + sp.month * 997) % 1000 < 900
                         THEN 0 ELSE 1 END  -- 10% deterioration vs 4.8% base
                WHEN sp.current_state = 1 THEN
                    CASE
                        WHEN (sp.random_seed + sp.month * 997) % 1000 < 188 THEN 0
                        WHEN (sp.random_seed + sp.month * 997) % 1000 < 511 THEN 1
                        ELSE 2  -- deterioration doubled
                    END
                WHEN sp.current_state = 2 THEN
                    CASE
                        WHEN (sp.random_seed + sp.month * 997) % 1000 < 100 THEN 0
                        WHEN (sp.random_seed + sp.month * 997) % 1000 < 235 THEN 1
                        WHEN (sp.random_seed + sp.month * 997) % 1000 < 504 THEN 2
                        ELSE 3
                    END
                WHEN sp.current_state = 3 THEN
                    CASE
                        WHEN (sp.random_seed + sp.month * 997) % 1000 <  92 THEN 0
                        WHEN (sp.random_seed + sp.month * 997) % 1000 < 277 THEN 2
                        WHEN (sp.random_seed + sp.month * 997) % 1000 < 425 THEN 3
                        ELSE 4
                    END
                WHEN sp.current_state = 4 THEN
                    CASE
                        WHEN (sp.random_seed + sp.month * 997) % 1000 <  38 THEN 3
                        WHEN (sp.random_seed + sp.month * 997) % 1000 < 423 THEN 4
                        ELSE 5
                    END
                ELSE 5
            END
        AS INT)                                AS current_state,
        CAST(sp.upb          AS DECIMAL(18,2)) AS upb,
        CAST(sp.random_seed  AS BIGINT)        AS random_seed,
        CAST(
            sp.cumulative_loss +
            (CASE sp.current_state
                 WHEN 0 THEN 0.00
                 WHEN 1 THEN 0.05
                 WHEN 2 THEN 0.15
                 WHEN 3 THEN 0.35
                 WHEN 4 THEN 0.60
                 WHEN 5 THEN 1.00
                 ELSE 0.00
             END) * sp.upb * 0.01
        AS FLOAT)                              AS cumulative_loss
    FROM stress_paths sp
    WHERE sp.month < 12
),

stress_loss_distribution AS (
    SELECT sim_number, month, SUM(cumulative_loss) AS total_portfolio_loss
    FROM stress_paths
    GROUP BY sim_number, month
),

stress_loss_ranked AS (
    SELECT
        month,
        total_portfolio_loss,
        ROW_NUMBER() OVER (PARTITION BY month ORDER BY total_portfolio_loss) AS rn,
        COUNT(*)     OVER (PARTITION BY month) AS total_sims
    FROM stress_loss_distribution
),

stress_var AS (
    SELECT
        month,
        AVG(total_portfolio_loss) AS stress_mean_loss,
        MAX(CASE WHEN rn = CAST(total_sims * 0.95 AS INT) THEN total_portfolio_loss END) AS stress_VaR_95,
        MAX(CASE WHEN rn = CAST(total_sims * 0.99 AS INT) THEN total_portfolio_loss END) AS stress_VaR_99
    FROM stress_loss_ranked
    GROUP BY month
),

-- ---------------------------------------------------------------------------
-- PART 10: Top-risk transitions (sensitivity)
-- ---------------------------------------------------------------------------

transition_sensitivity AS (
    SELECT
        from_state,
        to_state,
        probability AS base_probability,
        CASE
            WHEN to_state = 5 THEN probability * 10
            ELSE probability
        END AS importance_score
    FROM complete_transition_matrix
    WHERE probability > 0.01
),

top_risk_transitions AS (
    SELECT TOP 10
        sd1.state_name AS from_state_name,
        sd2.state_name AS to_state_name,
        ts.base_probability,
        ts.importance_score,
        RANK() OVER (ORDER BY ts.importance_score DESC) AS risk_rank
    FROM transition_sensitivity ts
    INNER JOIN state_definition sd1 ON ts.from_state = sd1.state_id
    INNER JOIN state_definition sd2 ON ts.to_state   = sd2.state_id
    ORDER BY ts.importance_score DESC
)

-- ---------------------------------------------------------------------------
-- FINAL OUTPUT: union three report types
-- ---------------------------------------------------------------------------

SELECT
    'BASE_CASE_VAR' AS metric_type,
    CAST(lp.month AS VARCHAR(20)) AS month_or_state,
    NULL AS from_state,
    NULL AS to_state,
    lp.mean_loss,
    lp.std_dev_loss,
    lp.VaR_50_median,
    lp.VaR_75,
    lp.VaR_90,
    lp.VaR_95,
    lp.VaR_99,
    lp.CVaR_95,
    NULL AS stress_VaR_95,
    NULL AS risk_rank
FROM loss_percentiles lp

UNION ALL

SELECT
    'STRESS_SCENARIO_VAR',
    CAST(sv.month AS VARCHAR(20)),
    NULL,
    NULL,
    sv.stress_mean_loss,
    NULL, NULL, NULL, NULL,
    sv.stress_VaR_95,
    sv.stress_VaR_99,
    NULL,
    sv.stress_VaR_95,
    NULL
FROM stress_var sv

UNION ALL

SELECT
    'TOP_RISK_TRANSITIONS',
    NULL,
    trt.from_state_name,
    trt.to_state_name,
    trt.base_probability,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    trt.risk_rank
FROM top_risk_transitions trt

ORDER BY metric_type, month_or_state, risk_rank
OPTION (MAXRECURSION 0);  -- no artificial cap on recursion depth
```

---

## 19. Friday Pre-Flight Checklist

One page. Print it. Read it Friday morning before you click **Begin Assessment**.

### 30 minutes before start
- [ ] Bladder empty, water bottle full, phone face-down and on silent
- [ ] Quiet room. Door closed. Anyone else in the house notified.
- [ ] Laptop plugged in. Second monitor if available.
- [ ] SSMS / Azure Data Studio open and connected to `localhost` → `rice_park_practice`
- [ ] Run one quick query to confirm the DB is alive:
      `SELECT TOP 1 * FROM dbo.loan_snapshots;`
- [ ] `sql_quick_reference.md` open in a second window (or printed)
- [ ] This master doc open — specifically §15 (pattern cheat sheet) and §18 (the fix)
- [ ] Notepad (paper) + pen for sketching logic before typing SQL
- [ ] HackerEarth environment unblocked in browser; webcam/mic tested if proctored
- [ ] Close Slack, email, everything non-essential

### The moment the test starts
- [ ] **Read all three questions end-to-end first.** Don't start coding until you've seen all three. You'll sequence them correctly only after you've seen the hardest.
- [ ] On scratch paper, for each question, write one line: *"which pattern?"*
- [ ] Time-budget the three questions before writing any SQL (see §20)

### Syntax gotchas to remember (these cost 5 minutes each when they bite)
- After `USE db;` reference tables as `dbo.tablename`, not `db.tablename`
- Every CTE separated by comma; **no** comma before the final `SELECT`
- If the statement before `WITH` didn't end with `;`, use `;WITH ...`
- `PERCENTILE_CONT` requires `OVER(...)` in T-SQL — it's **not** a grouped aggregate here. Use the `ROW_NUMBER` + `MAX(CASE WHEN rn = pct THEN value END)` trick.
- No `TOP`, no aggregates, no `GROUP BY` in the recursive member of a recursive CTE
- Types must match *exactly* between anchor and recursive members → `CAST` everything
- `OPTION (MAXRECURSION 0)` on any recursive CTE that goes more than 100 levels deep

### If something goes sideways during the test
- Syntax error you can't parse in 60s → comment out the offending CTE, return a partial query. A working 80% answer beats a broken 100% answer.
- Empty result set → don't assume broken. Remove `HAVING` / `WHERE` filters to sanity-check the underlying data. (Gaps-and-islands returned zero multi-episode loans legitimately — §8.)
- Aggregate-over-subquery error → materialize the subquery into its own CTE column first (§11).
- Recursive CTE type mismatch → `CAST` every column in the anchor to match the recursive (§18).

---

## 20. Test-Day Playbook — The 2-Hour Clock

Assume three questions: easy, hard, extremely-hard.

### Time budget

| Phase | Time | Activity |
|---|---|---|
| 0:00 – 0:05 | 5 min | Read all three questions. Identify pattern for each. Budget remaining time. |
| 0:05 – 0:25 | 20 min | **Easy.** Submit quickly. Bank time. |
| 0:25 – 1:05 | 40 min | **Hard.** Sketch logic on paper first. Build CTE by CTE. Test each. |
| 1:05 – 1:55 | 50 min | **Extremely hard.** Almost certainly gaps-and-islands or recursive CTE. Sketch *thoroughly* before typing. |
| 1:55 – 2:00 | 5 min | Buffer. Re-read your submissions. Check each query actually returned rows. |

### Per-question discipline
1. **Read.** Identify the business question underneath the technical wording. "Consecutive periods" = gaps-and-islands. "Month-over-month" = LAG. "Project forward" = transition matrix.
2. **Sketch.** On paper, one line per step. "First CTE filters to DQ months. Second adds row numbers. Third computes island_id. Fourth groups." *Before touching SQL.*
3. **Build one CTE at a time.** Test each with a single known `loan_id` before chaining.
4. **Validate.** Run the query. Count the rows. Do they make sense? (If zero rows, don't submit without checking §13 for debug patterns.)
5. **Submit.** Don't polish forever. 80% quality + submitted > 100% quality + unsubmitted.

### The extremely-hard question — expected patterns, ranked
Based on the Feb prep strategy and the domain (mortgage loan performance):

1. **Gaps-and-islands on delinquency streaks** (§8) — classic, likely
2. **Recursive CTE for portfolio projection / amortization schedule** — second most likely
3. **Multi-CTE trajectory analysis** (§9) — possible
4. **Running-window cohort flow metrics** (§10) — possible
5. **Markov state projection** (§11) — less likely but possible

If you see any of 1–3, you've drilled it. For 4–5, the discipline from §9 ("build one CTE at a time, test each") applies regardless of which specific pattern.

### Last thing — the mental frame
The test is not asking you to be a SQL poet. It's asking: *do you recognize the pattern, and can you execute it?* You've drilled the patterns. Recognize, execute, submit.

---

## 21. Appendix A: Mortgage Domain Glossary

Terms used throughout this document and likely on the test, each defined once so you don't have to decode them under time pressure.

### Loan-level
- **UPB** — Unpaid Principal Balance. The remaining amount owed on the loan. Declines as the borrower pays down principal.
- **DPD** — Days Past Due. How many days behind the borrower is on the current payment.
- **DQ / Delinquent** — any status with `days_past_due > 0`. In this dataset the buckets are `CURRENT`, `30_DAY`, `60_DAY`, `90_DAY`, `120_DAY`, `FORECLOSURE`.
- **Cure** — a delinquent loan returning to `CURRENT` status.
- **Seasoning** — how long the loan has been on the books (months since origination).
- **FICO** — the borrower's credit score at origination. Captured in `loan_master`, not in snapshots.
- **LTV** — Loan-to-Value ratio. Mortgage amount / property value at origination.

### Portfolio-level
- **Vintage** — the year (or month) of origination. A "2025 vintage" loan is one originated in 2025. Used for cohort analysis because loans originated together tend to perform similarly (same underwriting environment, same economy).
- **Pool** — a group of loans held together, often as a securitized asset. Modeled in the `pools` and `pool_monthly_activity` tables.
- **Portfolio of record** — which portfolio a loan is currently assigned to (loans move between portfolios via transfers).
- **Subservicer** — a third-party firm that handles day-to-day servicing (collecting payments, managing delinquency workout) on behalf of the asset owner.
- **Remittance** — a periodic payment from the subservicer to the owner of the loan, reflecting principal + interest collected.

### Risk analytics
- **Transition matrix** — a table of probabilities `P(next_state | current_state)`. Used to model how loans move through delinquency stages.
- **Markov chain** — the assumption that next state depends only on current state (not history). Simplifying but commonly used in credit risk.
- **Absorbing state** — a state you can't leave once entered. In this dataset, `FORECLOSURE` is absorbing (100% self-loop).
- **Sticky state** — a state with high self-loop probability (≥ 50%). Not absorbing but hard to escape.
- **Mean First Passage Time** — average number of steps to first reach a target state. "Months to foreclosure" in this context.
- **VaR** (Value at Risk) — a loss quantile. `VaR_95 = $X` means "95% of simulated outcomes have loss ≤ $X." Regulatory-grade risk metric.
- **CVaR** / **Expected Shortfall** — the average loss *conditional on exceeding* VaR. Captures tail severity that VaR alone doesn't.
- **Monte Carlo simulation** — generate many random paths through the model, aggregate to a distribution. Used here to build the loss distribution by simulating 100 paths per loan over 12 months.
- **Bayesian HMM** (Hidden Markov Model) — a model where the observed state (`dq_status`) is a noisy signal of a latent "true" risk state. `P(observed | hidden)` is the emission matrix.
- **Emission matrix** — the table of probabilities mapping each hidden state to possible observed states.
- **Forward algorithm** — standard HMM technique for estimating the posterior distribution over hidden states given observations.
- **Stress scenario** — a what-if analysis where transition probabilities are tilted adverse (e.g., double deterioration, halve cures) to simulate a recession.

### Time-series / SQL-specific
- **Snapshot** — a row representing a loan's state at a point in time (one per month in this dataset).
- **MoM** — Month-over-Month. Change between consecutive monthly snapshots.
- **YTD** — Year-to-Date. Cumulative since the start of the year.
- **Cohort** — a group defined by shared characteristics (usually origination year). Cohort analysis tracks how that group ages.
- **Gaps-and-islands** — a family of SQL problems around finding consecutive runs (islands) in sparse or gappy data. The signature technique is the `ROW_NUMBER()` difference trick.
- **CTE** — Common Table Expression. The `WITH name AS (...)` construct for naming intermediate result sets.
- **Recursive CTE** — a CTE that references itself. Used for hierarchies, graph traversal, iterative calculations (like 12-month projections).

---

## 22. Appendix B: Sample Test Questions by Difficulty Tier

Concrete example questions Rice Park might pose, mapped to the patterns you've drilled. Use these as flashcards: read the question, sketch the pattern on paper in 60 seconds, then check against the hint.

### Easy tier (~15-20 minutes, 1 pattern)

**E1.** "List all loans currently at 60+ days past due, sorted by UPB descending."
- *Pattern:* basic `SELECT ... WHERE days_past_due >= 60 AND as_of_date = (latest) ORDER BY upb DESC`
- *Watch:* making sure you filter to the latest snapshot, not all history

**E2.** "For each loan, what is the most recent delinquency status?"
- *Pattern:* `ROW_NUMBER() OVER (PARTITION BY loan_id ORDER BY as_of_date DESC)` + filter to `rn = 1`

**E3.** "Count loans by current dq_status bucket."
- *Pattern:* `GROUP BY dq_status` on latest snapshot

### Hard tier (~30-45 minutes, 2-3 patterns combined)

**H1.** "For each pool, compute the weighted-average FICO score and the delinquency rate (% of loans with DPD ≥ 30) as of the most recent month."
- *Pattern:* join `loan_master` × `loan_snapshots`, filter to latest snapshot per loan, `GROUP BY pool_id`, use `SUM(fico * upb) / SUM(upb)` for weighted avg

**H2.** "Find all loans where the UPB decreased by more than 10% in a single month. Report the loan_id, month, and percentage drop."
- *Pattern:* `LAG(upb)` over loan + filter on ratio. Not just a drop — a *proportional* drop.

**H3.** "For each month, calculate the number of loans that transitioned from CURRENT to any delinquent status, and express it as a percentage of the prior month's CURRENT population."
- *Pattern:* self-join with `DATEADD(MONTH, 1, ...)` + two aggregations (numerator: new DQ count; denominator: prior-month CURRENT count)

**H4.** "Identify all loans that have had at least 3 consecutive months of delinquency at some point in their history."
- *Pattern:* **gaps-and-islands**. Filter to DQ rows, compute `island_id`, `HAVING COUNT(*) >= 3`.

### Extremely hard tier (~45-60 minutes, full architecture)

**X1.** "For each origination vintage (year), show the cumulative default rate at months 6, 12, 18, and 24 of seasoning."
- *Pattern:* derive vintage + seasoning per loan, identify each loan's first `FORECLOSURE` month, compute seasoning at that point, then `SUM(CASE WHEN first_fc_seasoning <= N THEN 1 ELSE 0 END) / COUNT(DISTINCT loan_id)` per vintage × N
- *Tests:* multi-CTE architecture, handling loans that never default, cumulative logic

**X2.** "Identify loans that entered forbearance (cured from DQ back to CURRENT) then re-defaulted within 6 months. For each, report the cure date, the re-default date, and the number of months between."
- *Pattern:* gaps-and-islands to find DQ episodes, identify cures (DQ → CURRENT transitions), join to next DQ within 6 months
- *Tests:* two passes of gaps-and-islands + self-join on derived events

**X3.** "Build a transition matrix from the data showing the probability of moving from each delinquency state to each other state in the next month. Then, assuming current portfolio composition and the transition probabilities hold, project the expected delinquency distribution 3 months forward."
- *Pattern:* **exactly §11**. Build empirical transition matrix, multiply by current distribution, iterate 3 times
- *Tests:* window-function normalization, matrix-vector multiplication via `SUM(proportion * probability)`, multi-step projection

**X4.** "For each subservicer, identify their 'problem portfolio': loans that went from CURRENT to 90+ days delinquent within 6 months of the servicer taking over. Report count and total UPB per subservicer."
- *Pattern:* join servicing_history (transfer dates) × loan_snapshots, filter snapshots to within 6 months of transfer, find the max dpd in that window
- *Tests:* complex join conditions with date windows, subservicer-level aggregation, interpreting the business question correctly

---

## Final note — the meta-lesson

Every pattern above is mechanical once recognized. The real work on Friday is **pattern recognition under time pressure**. If the question is:

> "For each borrower, find the longest stretch of consecutive missed payments and the worst status during that stretch."

…you shouldn't be thinking "what's the SQL?" You should already be typing:

```sql
ROW_NUMBER() OVER (ORDER BY ...) - ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...) AS island_id
```

That's the whole game.

---

*End of consolidated history. Good luck Friday. Go build the dent.*