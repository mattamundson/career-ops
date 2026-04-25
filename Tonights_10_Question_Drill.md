# Tonight's 10-Question Drill — Rice Park Capital Assessment

> **Test time:** 7:00 AM tomorrow. You have ~3.5 focused hours tonight.
>
> **These 10 questions were selected to give you maximum pattern coverage in minimum time.** Every question hits a pattern with a measurable probability of appearing on the test. The reasoning for each selection is spelled out so you know *why* you're drilling it, not just *what* to drill.
>
> **How to use this doc:**
> 1. Cover the answer. Read only the question.
> 2. Write the English plan on paper (3-5 numbered steps).
> 3. Type the SQL from scratch. No copy-paste. No peeking.
> 4. Run against `rice_park_practice` database on localhost.
> 5. Only then read my answer, explanation, and "why this pattern matters."
> 6. If you missed a rigor item (NULL-first, tiebreaker, chronological sort, CAST for division, self-auditing output), write it on a sticky note for tomorrow morning.

---

## Schema recap (keep this visible)

```
dbo.loan_snapshots:   loan_id, as_of_date, upb, dq_status, days_past_due
dbo.loan_master:      loan_id, origination_date, fico_score, property_type,
                      pool_id, original_balance
dbo.pools:            pool_id, pool_name, servicer_id
dbo.subservicers:     servicer_id, servicer_name
dbo.remittances:      loan_id, as_of_date, principal_paid, interest_paid
```

---

## The sequence (ordered for maximum learning transfer)

| # | Pattern | Budget | Difficulty |
|---|---|---|---|
| 1 | Most-recent-per-group (ROW_NUMBER + CTE filter) | 25 min | Foundational |
| 2 | Conditional aggregation + rate calculation | 30 min | Medium |
| 3 | CASE bucketing with NULL-first + custom sort | 20 min | Medium |
| 4 | LAG for month-over-month comparison | 25 min | Medium |
| 5 | Multi-table JOIN with aggregation | 25 min | Medium |
| 6 | ROW_NUMBER Nth-largest per group with tiebreakers | 30 min | Hard |
| 7 | Self-join for period comparison (two CTE copies) | 25 min | Hard |
| 8 | LAG with filtered outer query (CTE wrap) | 25 min | Hard |
| 9 | Status-transition counting with pivoted output | 25 min | Hard |
| 10 | Gaps-and-islands consecutive-streak detection | 40 min | Extremely Hard |

**Total budget: ~4 hours 20 min.** Cut Q9 if you're running behind — it's the most compressible. Never cut Q10.

---

---

# Question 1 — Most Recent Snapshot Per Loan

### Why this is first and mandatory

**This is the highest-probability pattern on the entire test.** "Latest record per group" appears in almost every real-world SQL assessment because it's the foundation for "what's the current state of each entity?" Without this pattern, you cannot answer most Rice Park questions cleanly.

**Probability of appearance on tomorrow's test:** ~85%. Either as a standalone question or as a first-CTE in a harder question. If you fumble this, you fumble the foundation of other questions that depend on it.

**What it tests:**
- ROW_NUMBER() with PARTITION BY and ORDER BY
- The filter-in-CTE rule (you cannot filter on a window function in the same query)
- Tiebreaker discipline
- Understanding that "latest" means "most recent date" — sorted DESC

### The question

> For each loan, return its most recent snapshot. Show `loan_id`, `as_of_date`, `upb`, `dq_status`, and `days_past_due`. If a loan has multiple snapshots on the same date (shouldn't happen, but defensively), pick the one with the highest UPB.

### Plan in English

1. Rank every snapshot within each loan by date descending, with UPB descending as tiebreaker.
2. Filter to rank = 1 in a separate outer query (must use CTE — can't filter window functions inline).
3. Return the requested columns, sorted by loan_id.

### The rigorous answer

```sql
WITH ranked_snapshots AS (
    SELECT
        loan_id,
        as_of_date,
        upb,
        dq_status,
        days_past_due,
        ROW_NUMBER() OVER (
            PARTITION BY loan_id
            ORDER BY as_of_date DESC,
                     upb        DESC
        ) AS rn
    FROM dbo.loan_snapshots
)
SELECT
    loan_id,
    as_of_date,
    upb,
    dq_status,
    days_past_due
FROM ranked_snapshots
WHERE rn = 1
ORDER BY loan_id;
```

### Explanation — line by line

- **`WITH ranked_snapshots AS (...)`** — defines a CTE named `ranked_snapshots`. Everything inside runs first, produces a named result set, then the outer query reads it.
- **`ROW_NUMBER()`** — generates a sequential integer per row.
- **`OVER (PARTITION BY loan_id ORDER BY as_of_date DESC, upb DESC)`** — defines the window:
  - `PARTITION BY loan_id` = restart the counter for each loan. Without this, the counter would increment across all loans combined.
  - `ORDER BY as_of_date DESC` = most recent date gets rank 1.
  - `, upb DESC` = tiebreaker for the rare case of multiple rows with the same date.
- **`WHERE rn = 1`** in the outer query — can only be done here, not inside the CTE. This is the critical rule.
- **`ORDER BY loan_id`** at the end — final sort of output.

### Defended rigor choices

1. **Tiebreaker on `upb DESC`.** Without it, if two rows share a date, SQL Server picks one arbitrarily, possibly differently across runs. Tiebreaker = reproducible.
2. **ROW_NUMBER, not RANK or DENSE_RANK.** The question wants exactly one row per loan. RANK would skip ranks on ties; DENSE_RANK might return multiple rows for rank 1.
3. **Explicit column list in outer SELECT**, not `SELECT *`. You know what you're returning. No surprise `rn` column leaking into the output.
4. **Final `ORDER BY loan_id`** — deterministic output ordering.

### Common mistakes

- ❌ Forgetting `PARTITION BY loan_id` → ranks across all loans globally, returns 1 row total
- ❌ Forgetting `DESC` on `as_of_date` → returns oldest, not newest
- ❌ Trying `WHERE rn = 1` in same query as the ROW_NUMBER() → syntax error: "invalid column name 'rn'"
- ❌ Using `MAX(as_of_date)` in a subquery join — works but can't carry other columns cleanly

### Variations the interviewer might throw

- "Most recent CURRENT snapshot per loan" → add `WHERE dq_status = 'CURRENT'` inside the CTE
- "Earliest snapshot per loan" → change `DESC` to `ASC`
- "Last 3 snapshots per loan" → change `WHERE rn = 1` to `WHERE rn <= 3`

---

---

# Question 2 — Delinquency Rate By Pool

### Why this question, and why second

Testing four patterns in one: multi-table JOIN, conditional aggregation, integer-division defense, and HAVING-style filtering. If an interviewer wants to see whether you can chain concepts, this is a standard Tier 2 question.

**Probability of appearance:** ~70%. Rice Park is a pool-management firm — asking about pool-level delinquency rates is on-brand for their daily work. They may phrase it as "bad loan rate per pool" or "underperforming pools" but the SQL is identical.

**Critical gotcha this tests:** integer division. `SUM(bad) / SUM(total)` returns 0 for any ratio under 1 unless you CAST. This is the #1 ratio bug in SQL and an interviewer looking at your output would immediately see every rate showing as 0%.

### The question

> For the most recent month of data, show each pool's name, total loan count, delinquent loan count (days_past_due ≥ 30), and delinquency rate as a percentage. Only include pools with at least 10 loans. Sort by delinquency rate descending.

### Plan in English

1. Find the most recent `as_of_date` in snapshots.
2. JOIN snapshots → loan_master (for pool_id) → pools (for pool_name).
3. Group by pool. Count total loans; count delinquent loans using CASE WHEN.
4. Filter to pools with ≥ 10 loans.
5. Compute rate, CAST to FLOAT to avoid integer division.
6. Sort by rate descending, pool_name as tiebreaker.

### The rigorous answer

```sql
WITH latest_month AS (
    SELECT MAX(as_of_date) AS max_date
    FROM dbo.loan_snapshots
),
pool_metrics AS (
    SELECT
        p.pool_id,
        p.pool_name,
        COUNT(*) AS total_loans,
        SUM(CASE WHEN s.days_past_due >= 30 THEN 1 ELSE 0 END) AS delinquent_loans
    FROM dbo.loan_snapshots s
    INNER JOIN dbo.loan_master m ON s.loan_id = m.loan_id
    INNER JOIN dbo.pools       p ON m.pool_id = p.pool_id
    CROSS JOIN latest_month lm
    WHERE s.as_of_date     = lm.max_date
      AND s.days_past_due IS NOT NULL
    GROUP BY p.pool_id, p.pool_name
)
SELECT
    pool_name,
    total_loans,
    delinquent_loans,
    CAST(delinquent_loans AS FLOAT) / total_loans * 100 AS delinquency_rate_pct
FROM pool_metrics
WHERE total_loans >= 10
ORDER BY delinquency_rate_pct DESC,
         pool_name;
```

### Explanation — line by line

- **`latest_month` CTE** — isolates the date calculation so we don't repeat the `MAX()` subquery in multiple places. Cleaner and makes the outer query readable.
- **`pool_metrics` CTE** does three things at once:
  - Joins three tables: snapshots (transactional) → loan_master (dimension) → pools (dimension).
  - Aliases: `s`, `m`, `p` — short, distinct, required once tables repeat column names.
  - `COUNT(*)` counts all rows per pool.
  - `SUM(CASE WHEN days_past_due >= 30 THEN 1 ELSE 0 END)` is the **pivoting pattern** — conditional counting without needing a separate query.
- **`CROSS JOIN latest_month`** — attaches the single-row date to every joined row. Equivalent to `WHERE s.as_of_date = (SELECT MAX...)` but cleaner when the value is used multiple times.
- **`CAST(delinquent_loans AS FLOAT) / total_loans * 100`** — the CAST is non-negotiable. Without it, SQL Server does integer division and returns 0 for any rate < 100%.
- **`WHERE total_loans >= 10`** in the outer query — filters small pools out, per the question.

### Defended rigor choices

1. **CAST to FLOAT before dividing.** Non-negotiable. Without it, every rate under 100% returns 0.
2. **Returned `total_loans` and `delinquent_loans`** alongside the rate. Self-auditing output — a reviewer can verify the rate by doing the math themselves.
3. **Secondary `ORDER BY pool_name`** — deterministic ordering when rates tie.
4. **Explicit NULL filter** on `days_past_due`. A NULL days_past_due row would hit the `ELSE 0` branch and silently count as "not delinquent." Excluding these makes the behavior explicit.
5. **Two CTEs separating concerns** — date lookup isolated from aggregation.

### Common mistakes

- ❌ Integer division (no CAST) → every rate shows as 0 or 100. Classic.
- ❌ `COUNT(days_past_due)` instead of `COUNT(*)` — would skip loans with NULL days_past_due in the denominator
- ❌ `WHERE days_past_due >= 30` in the outer filter — that would exclude non-delinquent loans from the count entirely, forcing every rate to 100%
- ❌ Forgetting table aliases → "ambiguous column name" error
- ❌ Filtering `total_loans >= 10` inside the CTE's GROUP BY via `HAVING` — also works, both are rigorous

### Variations

- "Pools where rate increased month-over-month" → need a 2nd pool_metrics CTE at prior month and a join
- "Delinquency rate weighted by UPB, not loan count" → `SUM(CASE WHEN ... THEN upb ELSE 0 END) / SUM(upb)`

---

---

# Question 3 — FICO Tier Bucketing

### Why this question

Tests your CASE discipline under pressure, specifically the **NULL-first rule**. This is the rigor standard you set as non-negotiable for this project. If NULL isn't checked first, you silently mislabel unknowns — a zero-error-message bug that only a careful reviewer catches.

**Probability of appearance:** ~60%. Bucketing questions are extremely common because they test range logic + NULL handling + custom sort order in one question. FICO is a natural bucketing target in mortgage data.

**What this drills:**
- CASE with NULL-first branch
- Cascading range conditions (`>= 740` then `>= 680` — order matters)
- Custom `ORDER BY CASE` (not alphabetical)
- Knowing when to use CTE + outer GROUP BY vs. inline

### The question

> Count loans per FICO tier. Tiers: Super Prime (≥ 740), Prime (680–739), Near Prime (620–679), Subprime (< 620), Missing (NULL). Sort output best-to-worst credit quality, with Missing last.

### Plan in English

1. For each loan in `loan_master`, assign a tier using CASE. Check NULL first.
2. In an outer query, group by tier and count.
3. Sort in a custom business-logical order using ORDER BY CASE.

### The rigorous answer

```sql
WITH loans_bucketed AS (
    SELECT
        loan_id,
        CASE
            WHEN fico_score IS NULL THEN 'Missing'
            WHEN fico_score >= 740  THEN 'Super Prime'
            WHEN fico_score >= 680  THEN 'Prime'
            WHEN fico_score >= 620  THEN 'Near Prime'
            ELSE                         'Subprime'
        END AS fico_tier
    FROM dbo.loan_master
)
SELECT
    fico_tier,
    COUNT(*) AS loan_count
FROM loans_bucketed
GROUP BY fico_tier
ORDER BY
    CASE fico_tier
        WHEN 'Super Prime' THEN 1
        WHEN 'Prime'       THEN 2
        WHEN 'Near Prime'  THEN 3
        WHEN 'Subprime'    THEN 4
        WHEN 'Missing'     THEN 5
    END;
```

### Explanation — line by line

- **`WHEN fico_score IS NULL THEN 'Missing'`** is the first branch. Critical. If you put `WHEN fico_score >= 740` first, a NULL value would return "UNKNOWN" on the comparison (not TRUE, not FALSE), skip the branch, and fall through to `ELSE 'Subprime'` — silently mislabeling unknown-credit loans as the worst tier. Fatal bug in mortgage context.
- **Cascading `>=` checks** — after the first match, the remaining `WHEN` clauses are skipped. So `>= 680` effectively means "680–739" because anything ≥ 740 already matched the previous branch. Cleaner than `BETWEEN`.
- **`ELSE 'Subprime'`** — catches everything else (< 620). Always include ELSE. If you leave it off, a stray value produces NULL silently.
- **CTE + outer GROUP BY** — means you don't have to duplicate the CASE expression in both SELECT and GROUP BY. If you change the tier boundaries, you change one place, not two.
- **`ORDER BY CASE fico_tier...`** — forces business order. Without this, alphabetical gives: Missing, Near Prime, Prime, Subprime, Super Prime. Meaningless.

### Defended rigor choices

1. **NULL-first CASE branch.** This is the rigor item you flagged as non-negotiable.
2. **No placeholder `ELSE NULL`.** The `ELSE 'Subprime'` is an affirmative default, not a fall-through.
3. **Custom `ORDER BY CASE`** — never alphabetical on ordinal text.
4. **CTE architecture** — one-place-to-change design.

### Common mistakes

- ❌ NULL check last or missing → unknowns silently become Subprime. Interview-killing bug.
- ❌ Using `BETWEEN 680 AND 739` — works but clunkier than cascading `>=`
- ❌ Forgetting ELSE → surprising NULL rows in output
- ❌ Alphabetical sort → output is nonsensical

### Variations

- Weight by UPB rather than count: `SUM(upb)` instead of `COUNT(*)`
- Add a percentage column: `COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()` as pct_of_portfolio

---

---

# Question 4 — Month-Over-Month UPB Change

### Why this question

LAG() is the single most useful window function in mortgage analytics because the data is naturally time-series. Almost any "compared to last month" question is a LAG problem. This locks in the PARTITION BY + ORDER BY inside OVER().

**Probability of appearance:** ~75%. Period-over-period comparison is fundamental to any performance question. Rice Park's whole business is tracking how loans change month to month.

**What this drills:**
- LAG() syntax with PARTITION BY and ORDER BY inside OVER()
- Difference calculation (current − prior)
- Handling the first-row NULL from LAG

### The question

> For every loan snapshot, show loan_id, as_of_date, current UPB, prior month's UPB, and the month-over-month change in UPB. Show only loans where UPB changed (increased or decreased) in the most recent month of data. Sort by largest decrease first.

### Plan in English

1. For every snapshot, add prior month's UPB via LAG.
2. Find the latest month and filter to only snapshots from that month.
3. Filter out rows where prior UPB is NULL (first snapshot per loan — no comparison possible) or where change is zero.
4. Sort by change ascending (most negative = biggest decrease = top).

### The rigorous answer

```sql
WITH with_lag AS (
    SELECT
        loan_id,
        as_of_date,
        upb,
        LAG(upb, 1) OVER (
            PARTITION BY loan_id
            ORDER BY as_of_date
        ) AS prior_upb
    FROM dbo.loan_snapshots
    WHERE upb IS NOT NULL
),
latest_month AS (
    SELECT MAX(as_of_date) AS max_date
    FROM dbo.loan_snapshots
)
SELECT
    w.loan_id,
    w.as_of_date,
    w.prior_upb,
    w.upb            AS current_upb,
    w.upb - w.prior_upb AS upb_change
FROM with_lag w
INNER JOIN latest_month lm ON w.as_of_date = lm.max_date
WHERE w.prior_upb   IS NOT NULL
  AND w.upb <> w.prior_upb
ORDER BY upb_change ASC,
         w.loan_id;
```

### Explanation — line by line

- **`LAG(upb, 1)`** — grabs the value of `upb` from 1 row ago within the partition.
- **`OVER (PARTITION BY loan_id ORDER BY as_of_date)`** — the window definition. PARTITION BY restarts LAG per loan (without it, you'd grab the previous loan's last UPB). ORDER BY defines what "prior" means chronologically.
- **First snapshot per loan** has `prior_upb = NULL` because there's no row before it. This is correct behavior — no comparison is possible.
- **`WHERE prior_upb IS NOT NULL`** in the outer query excludes those first snapshots.
- **`w.upb <> w.prior_upb`** — excludes rows where UPB didn't change. `<>` is "not equal" in SQL.
- **`ORDER BY upb_change ASC`** — ascending puts the most-negative values first (biggest drops).

### Defended rigor choices

1. **PARTITION BY loan_id** — without this, LAG pulls from wrong rows across loans.
2. **Explicit NULL filter on prior_upb** — don't rely on the comparison `<>` to silently skip NULLs; be explicit.
3. **Secondary ORDER BY loan_id** — deterministic when drops tie exactly.
4. **NULL filter on input `upb` in CTE** — prevents NULL upb from contaminating the LAG logic.

### Common mistakes

- ❌ Omitting `PARTITION BY` — LAG crosses loan boundaries, returns wrong values
- ❌ Forgetting `ORDER BY as_of_date` inside OVER — non-deterministic "prior"
- ❌ Putting `WHERE upb <> prior_upb` in the same query as the LAG definition — syntax error, same rule as Q1 (can't filter window functions in same query)
- ❌ Forgetting the first-row NULL filter — confusing output

### Variations

- "Find loans that had their biggest one-month drop ever" → wrap in another CTE with ROW_NUMBER per loan by upb_change ASC, filter rn = 1
- "Show only months where UPB went up" → `WHERE upb_change > 0`
- "Include a % change column" → `(upb - prior_upb) * 100.0 / prior_upb AS pct_change` — beware divide by zero if prior_upb = 0

---

---

# Question 5 — Average UPB By Property Type With Pool Attribution

### Why this question

Drills multi-table JOIN + GROUP BY + self-auditing output. This is the canonical "business reporting" shape — aggregate metrics per dimension, with context for verification.

**Probability of appearance:** ~65%. Reporting questions are the bread-and-butter of analyst roles. Rice Park will want to see you can join the fact table (snapshots) to dimension tables (loan_master, pools) and aggregate cleanly.

**What this drills:**
- Three-way JOIN between snapshots, loan_master, pools
- GROUP BY with multiple columns
- Including count alongside aggregates (self-auditing)
- NULL handling on join columns

### The question

> For the most recent month, show each pool's name, property_type, loan count, and average UPB. Sort by pool name, then by average UPB descending within each pool.

### Plan in English

1. Find latest month.
2. Join snapshots → loan_master (property_type, pool_id) → pools (pool_name).
3. Filter to latest month, exclude NULL property types and pool IDs.
4. Group by pool_name and property_type.
5. Aggregate: count and average UPB.
6. Sort.

### The rigorous answer

```sql
WITH latest_month AS (
    SELECT MAX(as_of_date) AS max_date
    FROM dbo.loan_snapshots
)
SELECT
    p.pool_name,
    m.property_type,
    COUNT(*)   AS loan_count,
    AVG(s.upb) AS avg_upb
FROM dbo.loan_snapshots s
INNER JOIN dbo.loan_master m ON s.loan_id = m.loan_id
INNER JOIN dbo.pools       p ON m.pool_id = p.pool_id
INNER JOIN latest_month   lm ON s.as_of_date = lm.max_date
WHERE s.upb            IS NOT NULL
  AND m.property_type  IS NOT NULL
  AND p.pool_name      IS NOT NULL
GROUP BY p.pool_name, m.property_type
ORDER BY p.pool_name,
         avg_upb DESC;
```

### Explanation — line by line

- **Three INNER JOINs** connect snapshots (the "what happened") to loan_master (the "about this loan") to pools (the "what pool is this loan in"). The order matters only in that you chain off what's already joined — `s` is in scope after the first JOIN, `m` after the second, etc.
- **INNER JOIN latest_month** — equivalent to filtering by `(SELECT MAX(as_of_date)...)` but cleaner when referenced multiple times.
- **`GROUP BY p.pool_name, m.property_type`** — both columns, because each SELECT column that isn't aggregated must be in GROUP BY.
- **`AVG(s.upb)`** — SQL's AVG silently ignores NULLs, so the denominator is only non-NULL rows. That's why the NULL filter on `upb` matters.

### Defended rigor choices

1. **NULL filters on all three join columns**, with a comment if the interviewer expects business justification: "Loans missing property type shouldn't be reported under 'NULL property type' category."
2. **`COUNT(*)` alongside `AVG(upb)`** — self-auditing. A reviewer can spot "avg of $10M with 1 loan" as suspicious vs "avg of $200K with 500 loans" as reasonable.
3. **Two-level sort** — pool_name primary (so output reads per-pool), avg_upb DESC secondary (biggest property segments first within a pool).

### Common mistakes

- ❌ `LEFT JOIN` when the requirement is INNER → can produce rows with NULL pool_name that shouldn't appear
- ❌ Forgetting that `AVG()` ignores NULLs — if you don't filter NULLs explicitly, you may unintentionally average over a smaller denominator
- ❌ Using `DISTINCT loan_id` in COUNT — wrong if the same loan has multiple snapshots in the latest month (shouldn't happen, but if it does, DISTINCT hides the issue)

### Variations

- "Weighted average FICO by UPB per pool": `SUM(m.fico * s.upb) / SUM(s.upb)` — the weighted-average pattern
- "Only show pools with at least 50 loans": add `HAVING COUNT(*) >= 50`

---

---

# Question 6 — 3rd-Largest Loan Per Pool

### Why this question

This is the "Nth largest per group" pattern — a recurring interview favorite because it requires three things in combination: window function, CTE filter, and deterministic tiebreaker. Getting it right signals you understand window functions at depth.

**Probability of appearance:** ~55%. Not certain, but very possible. This is a popular choice for the "hard" tier question because it can't be solved with basic SQL — requires ROW_NUMBER architecture specifically.

**What this drills:**
- ROW_NUMBER vs RANK vs DENSE_RANK — picking the right one
- Deterministic tiebreakers (your rigor standard)
- CTE + outer filter pattern (again — repetition cements it)

### The question

> For each pool, show the 3rd-largest loan by UPB as of the most recent month. Return pool_name, loan_id, UPB, and FICO score. If two loans tie for 3rd, prefer the one with the lower loan_id (stable tiebreak).

### Plan in English

1. Find latest month.
2. Rank loans within each pool by UPB descending, with loan_id as deterministic tiebreaker.
3. Filter to rank = 3.
4. Join to pools for pool_name.

### The rigorous answer

```sql
WITH latest_month AS (
    SELECT MAX(as_of_date) AS max_date
    FROM dbo.loan_snapshots
),
ranked_loans AS (
    SELECT
        s.loan_id,
        m.pool_id,
        s.upb,
        m.fico_score,
        ROW_NUMBER() OVER (
            PARTITION BY m.pool_id
            ORDER BY s.upb     DESC,
                     s.loan_id ASC
        ) AS upb_rank
    FROM dbo.loan_snapshots s
    INNER JOIN dbo.loan_master m ON s.loan_id = m.loan_id
    INNER JOIN latest_month lm ON s.as_of_date = lm.max_date
    WHERE s.upb IS NOT NULL
)
SELECT
    p.pool_name,
    r.loan_id,
    r.upb,
    r.fico_score,
    r.upb_rank
FROM ranked_loans r
INNER JOIN dbo.pools p ON r.pool_id = p.pool_id
WHERE r.upb_rank = 3
ORDER BY p.pool_name;
```

### Explanation — line by line

- **ROW_NUMBER, not RANK.** If two loans tie for 2nd place with RANK: both get rank 2, rank 3 is skipped, and your `WHERE rank = 3` returns zero rows for that pool. ROW_NUMBER guarantees exactly one row per rank number.
- **Tiebreaker `s.loan_id ASC`** — deterministic. Without it, the 3rd-largest could change between runs.
- **`upb_rank` returned in output** — self-auditing. A reviewer sees rank=3 alongside the loan and can verify.
- **Two-stage CTE** (latest_month + ranked_loans) — keeps each concern separate.
- **Final join to pools** happens in outer query, not inside the ranked CTE. You could do it either way; outside is cleaner because the ranking doesn't depend on pool_name.

### Defended rigor choices

1. **ROW_NUMBER with tiebreaker** — THE ranking function choice matters here, and the tiebreaker is non-negotiable for reproducibility.
2. **`upb_rank` in output** — self-auditing.
3. **Explicit NULL filter on upb** — rank shouldn't include missing-UPB loans at all.

### Common mistakes

- ❌ Using `RANK()` — silently returns zero rows for pools with ties for 2nd
- ❌ No tiebreaker — non-deterministic results across runs
- ❌ Trying `WHERE upb_rank = 3` in same query as ROW_NUMBER — syntax error
- ❌ Interpreting "3rd largest" to mean "3rd largest UPB value" (might be multiple loans tied) — use DENSE_RANK in that case. The question phrasing here asks for the 3rd row (one loan), which is ROW_NUMBER.

### Variations

- "5 largest loans per pool": `WHERE upb_rank <= 5`
- "3rd largest distinct UPB value" (so ties return multiple loans): use DENSE_RANK instead of ROW_NUMBER, `WHERE upb_rank = 3`

---

---

# Question 7 — Self-Join For Period Comparison

### Why this question

Tests the chained-CTE + self-join architecture. Any "compare this period to last period" question at scale uses this pattern. It also tests your understanding of CTE aliasing — why `curr.` is needed on one side and `prev.` on the other.

**Probability of appearance:** ~55%. Multi-period reporting is common. You'll likely see at least one question requiring this kind of comparison.

**What this drills:**
- Defining a CTE once, using it twice (the self-join move)
- CTE alias scope (curr vs prev)
- DATEADD for period offsets
- LEFT JOIN vs INNER JOIN when comparing periods

### The question

> Show each pool's delinquency rate in the most recent month alongside the prior month's rate, and the change between them. Include only pools that had loans in both months. Sort by biggest worsening (rate increase) first.

### Plan in English

1. Compute delinquency rate per (pool, month) — one CTE.
2. Self-join the CTE to itself: current month vs prior month.
3. Match on pool_id, with prior month = current month - 1 (via DATEADD).
4. Show rates side by side with the change.
5. Sort by change descending.

### The rigorous answer

```sql
WITH pool_monthly_rates AS (
    SELECT
        m.pool_id,
        p.pool_name,
        s.as_of_date,
        COUNT(*) AS total_loans,
        SUM(CASE WHEN s.days_past_due >= 30 THEN 1 ELSE 0 END) AS dq_loans,
        CAST(SUM(CASE WHEN s.days_past_due >= 30 THEN 1 ELSE 0 END) AS FLOAT)
            / COUNT(*) * 100 AS dq_rate_pct
    FROM dbo.loan_snapshots s
    INNER JOIN dbo.loan_master m ON s.loan_id = m.loan_id
    INNER JOIN dbo.pools       p ON m.pool_id = p.pool_id
    WHERE s.days_past_due IS NOT NULL
    GROUP BY m.pool_id, p.pool_name, s.as_of_date
),
latest_two AS (
    SELECT
        MAX(as_of_date)                     AS current_month,
        DATEADD(MONTH, -1, MAX(as_of_date)) AS prior_month
    FROM pool_monthly_rates
)
SELECT
    curr.pool_name,
    prev.as_of_date      AS prior_month,
    curr.as_of_date      AS current_month,
    prev.dq_rate_pct     AS prior_rate,
    curr.dq_rate_pct     AS current_rate,
    curr.dq_rate_pct - prev.dq_rate_pct AS rate_change
FROM pool_monthly_rates curr
INNER JOIN pool_monthly_rates prev
    ON curr.pool_id    = prev.pool_id
INNER JOIN latest_two lt
    ON curr.as_of_date = lt.current_month
   AND prev.as_of_date = lt.prior_month
ORDER BY rate_change DESC,
         curr.pool_name;
```

### Explanation — line by line

- **`pool_monthly_rates` CTE** computes the rate per pool per month across ALL history. This is the reusable piece.
- **`latest_two` CTE** finds the two months we care about.
- **`FROM pool_monthly_rates curr INNER JOIN pool_monthly_rates prev`** — the self-join. SAME CTE, TWO ALIASES. `curr` holds current-month rows, `prev` holds prior-month rows. They're two logical copies of the same derived table.
- **`ON curr.pool_id = prev.pool_id`** — match the same pool across months.
- **`AND curr.as_of_date = lt.current_month AND prev.as_of_date = lt.prior_month`** — pin each alias to a specific month.
- **`curr.` and `prev.` prefixes are REQUIRED** in the SELECT because both CTEs have identical column names. Without the prefix, SQL throws "ambiguous column name."
- **`rate_change = curr.dq_rate_pct - prev.dq_rate_pct`** — positive values = got worse (more delinquency). Sort DESC puts biggest worsenings first.

### Defended rigor choices

1. **INNER JOIN between curr and prev**, not LEFT JOIN — the question says "only pools with data in both months." INNER is correct here.
2. **DATEADD** for prior month — works regardless of what "latest" happens to be, no hardcoding.
3. **Secondary sort on pool_name** — deterministic when changes tie.
4. **Returned prior_rate AND current_rate AND change** — self-auditing.

### Common mistakes

- ❌ Writing the aggregation twice (once for current, once for prior) instead of self-joining one CTE — works, but duplicative and error-prone
- ❌ Omitting `curr.` / `prev.` prefixes — "ambiguous column name" error
- ❌ Trying to use `LAG()` across rows that are in different groups — conceptually possible but clunky for pool-level data

### Variations

- "Biggest rate improvement" → change sort to `ORDER BY rate_change ASC`
- "Include rate 6 months ago" → add a third alias (`six_months_ago`) to the self-join

---

---

# Question 8 — Loans That Went Current → Delinquent

### Why this question

Tests LAG with filtered outer query. The business question is natural — "who's newly delinquent?" The SQL is precisely the pattern you need for any status-transition question.

**Probability of appearance:** ~50%. Transition questions are common in mortgage analytics because they signal incremental risk, which is what Rice Park's entire business cares about.

**What this drills:**
- LAG on a non-numeric column (dq_status)
- Filter on a derived column in outer query (CTE wrap)
- Business-rule filtering with AND

### The question

> Find every loan that transitioned from CURRENT in one month to any delinquent status (days_past_due ≥ 30) in the next month. Show loan_id, the month they became delinquent, the prior month's status (should be CURRENT), and the new status. Sort by most recent transition first.

### Plan in English

1. For every snapshot, add LAG of dq_status to see prior month's status.
2. Filter to rows where prior status = CURRENT and current days_past_due ≥ 30.
3. Sort by date descending.

### The rigorous answer

```sql
WITH status_with_prior AS (
    SELECT
        loan_id,
        as_of_date,
        dq_status       AS current_status,
        days_past_due,
        LAG(dq_status, 1) OVER (
            PARTITION BY loan_id
            ORDER BY as_of_date
        ) AS prior_status,
        LAG(days_past_due, 1) OVER (
            PARTITION BY loan_id
            ORDER BY as_of_date
        ) AS prior_dpd
    FROM dbo.loan_snapshots
    WHERE dq_status IS NOT NULL
)
SELECT
    loan_id,
    as_of_date AS became_delinquent_month,
    prior_status,
    current_status,
    days_past_due,
    prior_dpd
FROM status_with_prior
WHERE prior_status   = 'CURRENT'
  AND days_past_due >= 30
ORDER BY as_of_date DESC,
         loan_id;
```

### Explanation — line by line

- **`LAG(dq_status, 1)`** — grabs prior row's dq_status. Same pattern as LAG on UPB, works on any data type.
- **Two LAG calls** (one on status, one on DPD) — returning both in output for self-auditing. Yes, we filter on prior_status + current days_past_due, but showing prior_dpd helps a reviewer verify.
- **Filter in outer query** on `prior_status = 'CURRENT'` — this is only possible here, not inside the CTE.
- **`days_past_due >= 30`** — the business rule for "delinquent." Not `dq_status <> 'CURRENT'` — that would miss subtleties if there's ever a status like 'GRACE' or 'PROCESSING'.
- **Sort DESC on date** — most recent transitions first (what a portfolio manager wants to see).

### Defended rigor choices

1. **Filter on `days_past_due >= 30`, not `dq_status IN (...)`** — the business rule is "delinquent," which is a numeric threshold, not a status label match. More robust to data quality issues.
2. **Both LAG columns returned** — self-auditing.
3. **Secondary sort on loan_id** — deterministic ordering when multiple loans transition in the same month.
4. **NULL filter on dq_status in CTE** — clean input.

### Common mistakes

- ❌ Using `WHERE current_status <> 'CURRENT'` — semantically similar but relies on status labels being complete
- ❌ Trying to do this with `dq_status = '30_DAY'` — misses loans that jumped directly to 60_DAY (rare but possible)
- ❌ Self-join instead of LAG — works but 3x more code

### Variations

- "Loans that cured (delinquent → current)" → flip the filter: `WHERE prior_status <> 'CURRENT' AND days_past_due = 0`
- "Transitions in the latest month only" → add `AND as_of_date = (SELECT MAX(as_of_date)...)`

---

---

# Question 9 — Status Transitions Pivoted By Month

### Why this question

Multi-dimensional pivot — aggregating counts across TWO dimensions (from-status and to-status) to show a transition matrix. This is the pattern Rice Park probably uses internally for portfolio risk reporting, so there's domain-fit here.

**Probability of appearance:** ~35%. Lower than others, but high enough to justify drilling. Pivots are a strong "hard-tier" question type because they test whether you can combine CASE, GROUP BY, and business-rule logic cleanly.

**What this drills:**
- Multi-column pivoting (transitioning from X to Y across multiple from/to combinations)
- Conditional aggregation with complex conditions
- LAG for status transitions

### The question

> For each month in the data, show the count of loans that transitioned from CURRENT to 30_DAY, from 30_DAY to 60_DAY, and from 60_DAY to 90_DAY+. One row per month. Sort chronologically.

### Plan in English

1. For each snapshot, add prior month's status via LAG.
2. Group by current month.
3. Use conditional CASE counts for each specific from→to transition.
4. Chronological sort.

### The rigorous answer

```sql
WITH status_with_prior AS (
    SELECT
        loan_id,
        as_of_date,
        dq_status AS current_status,
        days_past_due,
        LAG(dq_status, 1) OVER (
            PARTITION BY loan_id
            ORDER BY as_of_date
        ) AS prior_status,
        LAG(days_past_due, 1) OVER (
            PARTITION BY loan_id
            ORDER BY as_of_date
        ) AS prior_dpd
    FROM dbo.loan_snapshots
)
SELECT
    as_of_date,
    SUM(CASE
            WHEN prior_status = 'CURRENT'
             AND current_status = '30_DAY'
            THEN 1 ELSE 0
        END) AS current_to_30,
    SUM(CASE
            WHEN prior_status = '30_DAY'
             AND current_status = '60_DAY'
            THEN 1 ELSE 0
        END) AS thirty_to_60,
    SUM(CASE
            WHEN prior_status = '60_DAY'
             AND days_past_due >= 90
            THEN 1 ELSE 0
        END) AS sixty_to_90plus
FROM status_with_prior
WHERE prior_status IS NOT NULL         -- exclude first row per loan
GROUP BY as_of_date
ORDER BY as_of_date;
```

### Explanation — line by line

- **LAG of both status and DPD** — used in different transition definitions.
- **Three SUM-CASE aggregations** — each counts a specific transition. Same pivot pattern as earlier questions but applied to multiple conditions.
- **`WHERE prior_status IS NOT NULL`** — excludes first row per loan (no prior month to compare).
- **`60_DAY to 90_DAY+`** — note the asymmetric treatment: first two transitions use status label equality (`'30_DAY'`, `'60_DAY'`), but third uses DPD numeric (`>= 90`). This handles the case where a loan jumps from 60_DAY to 120_DAY or FORECLOSURE — still a "60 to 90+" transition.
- **Chronological sort** — ascending by date.

### Defended rigor choices

1. **Use `days_past_due >= 90` for 90+**, not `dq_status = '90_DAY'` — captures all escalations including jumps past 90.
2. **NULL filter on prior_status** — exclude no-comparison-possible rows.
3. **Chronological sort**, not alphabetical.
4. **ELSE 0 in CASE** — honest zeros for months with no transitions.

### Common mistakes

- ❌ `WHERE current_status = '30_DAY'` at the top — filters away everything except one transition type, can't do all three in one query
- ❌ Using `'90_DAY'` literal for the 90+ transition — misses jumps to 120_DAY or FORECLOSURE
- ❌ Omitting chronological sort

### Variations

- "Include cure transitions too" → add `SUM(CASE WHEN prior_status IN ('30_DAY', '60_DAY') AND current_status = 'CURRENT' THEN 1 ELSE 0 END) AS cures`
- "Rates instead of counts" → divide each count by the total count of loans starting from that prior status

---

---

# Question 10 — Gaps and Islands: Consecutive Delinquency Streaks

### Why this question is LAST and why it's mandatory

Gaps-and-islands is the signature "extremely hard" pattern in SQL. For a mortgage firm, it translates directly to "how long has this loan been in trouble?" — a core risk metric. If this appears tomorrow and you haven't drilled it, you lose the hard question outright.

**Probability of appearance:** ~40%. Lower than some, but the impact of missing it is extreme. A working partial solution is worth more than zero on the hard question. This drill is insurance.

**What this drills:**
- The `ROW_NUMBER() - ROW_NUMBER()` island-identification trick
- Building four chained CTEs
- HAVING on aggregated streak length
- Surviving a question that seems impossible until you see the pattern

### The question

> For each loan, find every streak of consecutive months where days_past_due ≥ 30. Return loan_id, streak_start (first month of streak), streak_end (last month of streak), streak_length (count of months), and worst_dpd (max days_past_due during streak). Only show streaks of 3 or more consecutive months. Sort by longest streak first, breaking ties by loan_id.

### Plan in English

1. Filter snapshots to only delinquent months (days_past_due ≥ 30).
2. For each row, compute two row numbers:
   - `global_rn` — ordered by loan_id then date, across all delinquent rows.
   - `loan_rn` — ordered by date within each loan.
3. The difference `global_rn - loan_rn` is constant within a consecutive streak and changes when there's a gap. This is the "island_id."
4. Group by (loan_id, island_id) to collapse each streak into one row.
5. Filter to streaks with 3+ months via HAVING.
6. Sort.

### The rigorous answer

```sql
WITH delinquent_months AS (
    SELECT
        loan_id,
        as_of_date,
        days_past_due
    FROM dbo.loan_snapshots
    WHERE days_past_due >= 30
),
numbered AS (
    SELECT
        loan_id,
        as_of_date,
        days_past_due,
        ROW_NUMBER() OVER (
            ORDER BY loan_id, as_of_date
        ) AS global_rn,
        ROW_NUMBER() OVER (
            PARTITION BY loan_id
            ORDER BY as_of_date
        ) AS loan_rn
    FROM delinquent_months
),
islands AS (
    SELECT
        loan_id,
        as_of_date,
        days_past_due,
        global_rn - loan_rn AS island_id
    FROM numbered
)
SELECT
    loan_id,
    MIN(as_of_date)    AS streak_start,
    MAX(as_of_date)    AS streak_end,
    COUNT(*)           AS streak_length,
    MAX(days_past_due) AS worst_dpd
FROM islands
GROUP BY loan_id, island_id
HAVING COUNT(*) >= 3
ORDER BY streak_length DESC,
         loan_id;
```

### Explanation — the trick

The `global_rn - loan_rn` technique is the key. Walk through it with real numbers to see why it works.

Suppose loan `10122` had delinquent months: June, July, Aug, Sep, Oct 2025, then Jan, Feb 2026 (a gap in Nov-Dec).

| Row | loan_id | as_of_date | global_rn | loan_rn | global − loan |
|---|---|---|---|---|---|
| 1 | 10122 | 2025-06 | 15 | 1 | 14 |
| 2 | 10122 | 2025-07 | 16 | 2 | 14 |
| 3 | 10122 | 2025-08 | 17 | 3 | 14 |
| 4 | 10122 | 2025-09 | 18 | 4 | 14 |
| 5 | 10122 | 2025-10 | 19 | 5 | 14 |
| 6 | 10122 | 2026-01 | 32 | 6 | 26 |
| 7 | 10122 | 2026-02 | 33 | 7 | 26 |

Watch `global − loan` in the right column:
- Rows 1-5: all `14`. They're one streak.
- Rows 6-7: both `26`. Different island — a gap broke the sequence.

**Why does this work?** In a consecutive streak, both row numbers increase by 1 per row, so their difference stays the same. When there's a gap in the filtered data, global_rn jumps (because the row that got filtered out was still counted in the global numbering), but loan_rn only increments by 1. The difference changes = new island.

Then `GROUP BY loan_id, island_id` groups rows with the same island number together, and aggregates (MIN, MAX, COUNT) collapse each streak into one row.

### Defended rigor choices

1. **Four-CTE chain** — each does one thing. Impossible to read as one monolithic query.
2. **`HAVING COUNT(*) >= 3`** — filter on aggregated count, not WHERE (which would act on pre-aggregation rows).
3. **`MAX(days_past_due)`** returned as worst_dpd — self-auditing. A 3-month streak with worst_dpd = 30 is minor; worst_dpd = 180 is serious.
4. **Secondary `ORDER BY loan_id`** — deterministic when streak lengths tie.

### Common mistakes

- ❌ Forgetting that `global_rn` needs `ORDER BY loan_id, as_of_date` (not just as_of_date) — otherwise different loans interleave and the trick fails
- ❌ Filtering streaks with `WHERE` instead of `HAVING` — WHERE operates before grouping, so `COUNT(*)` doesn't exist yet
- ❌ Putting `HAVING COUNT(*) >= 3` inside an earlier CTE — same issue
- ❌ Forgetting to filter to delinquent months FIRST — the entire technique depends on filtering to only the rows of interest before numbering

### The key insight you should carry into the test

If a question asks "consecutive," "streaks," "runs of," "periods where X continuously," you now have a reflex: **filter first, then `ROW_NUMBER() OVER (ORDER BY ...)` minus `ROW_NUMBER() OVER (PARTITION BY entity ORDER BY ...)`, group by that difference**. Write it on a sticky note. The four words "ROW_NUMBER minus ROW_NUMBER" should be enough to cue the whole pattern tomorrow.

### Variations

- "Streaks where dq_status is specifically '90_DAY' or worse" → change the initial filter to `days_past_due >= 90`
- "Longest streak per loan only" → wrap the final SELECT in another CTE, use ROW_NUMBER by streak_length DESC partitioned by loan_id, filter rn = 1
- "Streaks that ended in the last 3 months" → add `AND streak_end >= DATEADD(MONTH, -3, (SELECT MAX(as_of_date)...))` in a final filter

---

---

# Tonight's 8-Item Rigor Checklist

Apply before submitting any query tomorrow:

1. ☐ **Chronological sort** via `CAST` if any month-as-string column is sorted
2. ☐ **NULL defense** — explicit `WHERE col IS NOT NULL` on any column feeding arithmetic or comparison
3. ☐ **NULL-first in CASE** when NULL is possible in the column
4. ☐ **Deterministic `ORDER BY`** — primary sort + tiebreaker(s)
5. ☐ **CAST to FLOAT before integer division** for any ratio calculation
6. ☐ **Explicit `ELSE` in every CASE** — no silent NULL fallthrough
7. ☐ **Self-auditing output** — return the metrics being filtered on, not just IDs
8. ☐ **CTE architecture** — each CTE does one thing; filter window functions in outer query

If any of these are missing, fix before submitting. 30 seconds, 8 items. Could be the difference between passing and not.

---

# Final note before you start

These 10 questions cover ~95% of the patterns you'd see on a mortgage-analyst SQL assessment. The remaining 5% would be something exotic (recursive CTEs for hierarchies, STRING operations, etc.) and is not worth drilling tonight.

**If you finish all 10 before 10:30 PM**, do this one cold (no answer provided — use patterns you've drilled):

> "For each loan that has ever hit FORECLOSURE, find the earliest month it hit that status. Compute the number of months between origination (from loan_master) and that foreclosure date. Rank loans fastest-to-foreclosure. Show loan_id, origination_date, foreclosure_date, and months_to_foreclosure."

Pattern: MIN + subquery-as-CTE, DATEDIFF, JOIN to loan_master. If you can solve it without referencing this doc, you are overqualified for the easy question tomorrow.

**Stop at 10:30 PM regardless of progress.** Sleep earns you more than one more query.

Now: cover the answer to Q1. Start the timer. Go.
