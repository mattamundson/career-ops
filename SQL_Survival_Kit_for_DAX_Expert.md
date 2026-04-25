# SQL Survival Kit for a DAX Expert — Tomorrow's Assessment

> **Written for:** a DAX expert with career-level exposure to SQL but out of practice. You've seen JOINs, CASE, GROUP BY, and CTEs in production code but haven't been writing them lately. You don't need to be taught what these are. You need reps to re-cement the syntax so it comes automatically under time pressure.
>
> **Goal:** pass a 2-hour SQL assessment tomorrow. One shot. On camera. No retakes.
>
> **How to use this:** Don't read it cover-to-cover. Skim Part 1, then spend your time on Parts 4 and 5 — the practice reps. Your bottleneck is muscle memory, not concept.

---

## The Governing Principle: rigorous, not "acceptable"

Everything in this kit assumes the **rigorous path**, not the minimum-viable one. In an interview assessment, the difference between the two is the difference between getting the job and not.

The rigorous path means:

| Lazy / "acceptable" | Rigorous |
|---|---|
| `ORDER BY Month` (alphabetical) when `Month` is `'January 2026'` | `ORDER BY CAST('01 ' + Month AS DATE)` (chronological) |
| `ROW_NUMBER() OVER (ORDER BY value DESC)` with no tiebreaker | `ROW_NUMBER() OVER (ORDER BY value DESC, date ASC, id ASC)` — deterministic |
| Ignore NULLs and hope the data is clean | Explicit `WHERE col IS NOT NULL` with a one-line comment on why |
| Return just the answer column | Return the answer + the supporting metrics, so the output is self-auditing |
| Silently assume "no rows = zero" | State the assumption aloud; mention when a calendar dimension is needed |
| `RANK` / `DENSE_RANK` / `ROW_NUMBER` — pick whichever feels right | Pick the one that matches the literal question, and be able to articulate why |
| Compound `HAVING` with nested CASE | CTE that names each metric, then a clean `WHERE` on the CTE |

**Whenever you see "usually fine" or "typically accepted" or "good enough" in any SQL resource, mentally flag it and go one level more rigorous.** The assessment is graded by a human who has time to scrutinize your query. They will notice.

---

## Part 1: The DAX → SQL Rosetta Stone

This is your main leverage. Every DAX pattern you know has a SQL equivalent. Learn the translation and you can write most queries.

| What you want to do | In DAX | In SQL |
|---|---|---|
| Filter rows | `FILTER(Table, Table[col] > 10)` | `SELECT * FROM table WHERE col > 10` |
| Count rows matching a condition | `CALCULATE(COUNTROWS(Table), Table[status] = "Active")` | `SELECT COUNT(*) FROM table WHERE status = 'Active'` |
| Sum with filter | `CALCULATE(SUM(Table[amount]), Table[year] = 2025)` | `SELECT SUM(amount) FROM table WHERE year = 2025` |
| Distinct count | `DISTINCTCOUNT(Table[customer_id])` | `SELECT COUNT(DISTINCT customer_id) FROM table` |
| Aggregation by group | `SUMMARIZE(Sales, Sales[region], "Total", SUM(Sales[amount]))` | `SELECT region, SUM(amount) FROM sales GROUP BY region` |
| Aggregate with filter after grouping | `FILTER(SUMMARIZE(...), [Total] > 1000)` | `SELECT ... GROUP BY ... HAVING SUM(amount) > 1000` |
| Join to related table | `RELATED(Dim_Product[category])` | `INNER JOIN product ON sales.product_id = product.id` |
| Keep all rows even if no match | `LEFT OUTER JOIN` in Power Query | `LEFT JOIN` in SQL |
| Conditional column | `SWITCH(TRUE(), col > 10, "High", col > 5, "Mid", "Low")` | `CASE WHEN col > 10 THEN 'High' WHEN col > 5 THEN 'Mid' ELSE 'Low' END` |
| Intermediate calculation | `VAR x = SUM(Sales[amount]) RETURN x * 1.1` | `WITH x AS (SELECT SUM(amount) AS total FROM sales) SELECT total * 1.1 FROM x` |
| IF condition | `IF(col > 10, "Yes", "No")` | `CASE WHEN col > 10 THEN 'Yes' ELSE 'No' END` |
| Null check | `ISBLANK(col)` | `col IS NULL` (not `= NULL`) |
| Default for null | `IF(ISBLANK(col), 0, col)` | `ISNULL(col, 0)` or `COALESCE(col, 0)` |
| Top N rows | `TOPN(10, Table, Table[amount], DESC)` | `SELECT TOP 10 * FROM table ORDER BY amount DESC` |
| Concat strings | `CONCATENATE(a, b)` or `a & b` | `a + b` (SQL Server) or `CONCAT(a, b)` |
| Today's date | `TODAY()` | `GETDATE()` (SQL Server) |
| Date part | `YEAR(col)`, `MONTH(col)` | `YEAR(col)`, `MONTH(col)` — identical |
| Date arithmetic | `DATEADD(col, 1, MONTH)` | `DATEADD(MONTH, 1, col)` — note argument order |
| Count working across rows | Implicit via row context | Explicit via `GROUP BY` or window function |

### The one big conceptual difference

In DAX, **context is implicit**. A measure automatically respects the filters of whatever visual it's in. You rarely write `GROUP BY` because the visual handles it.

In SQL, **context is explicit**. You must say `GROUP BY region` if you want per-region totals. Nothing is implicit.

**This makes SQL easier once you internalize it.** No filter context propagation, no context transition, no `CALCULATE` gymnastics. Just: *"which rows do I want, grouped by what, aggregated how."*

---

## Part 2: The Eight Patterns You Need

Read each. Run the example on your database (`rice_park_practice`, on `localhost`). The query writing matters more than the reading. Patterns 1-6 are fundamentals you've seen; Patterns 7-8 are the intermediate techniques most likely on the harder test questions.

### Pattern 1: SELECT + WHERE + ORDER BY

**DAX thought:** "Give me these columns from this table, only rows matching this condition, sorted by this."

```sql
-- Show the 20 most delinquent loans (current month)
SELECT
    loan_id,
    upb,
    days_past_due,
    dq_status
FROM dbo.loan_snapshots
WHERE as_of_date = '2026-04-30'
  AND days_past_due > 0
ORDER BY days_past_due DESC;
```

**Key vocabulary:**
- `SELECT col1, col2` — which columns (like choosing fields in Power BI)
- `FROM table` — which table
- `WHERE condition` — filter rows
- `AND` / `OR` — combine conditions
- `ORDER BY col DESC` — sort descending (`ASC` is default)
- `SELECT TOP 20` — limit to 20 rows (SQL Server syntax)
- String values need single quotes: `'Active'` not `"Active"` (unlike DAX)
- `IS NULL` / `IS NOT NULL` — never `= NULL`

---

### Pattern 2: INNER JOIN

**DAX thought:** "Combine two tables via their relationship, keeping only rows that match on both sides."

In DAX you use relationships and `RELATED()`. In SQL you write the join explicitly.

```sql
-- Show loan balance alongside the borrower's FICO score
-- Requires joining loan_snapshots (balance) with loan_master (FICO)
SELECT
    s.loan_id,
    s.upb,
    s.dq_status,
    m.fico_score,
    m.property_type
FROM dbo.loan_snapshots s
INNER JOIN dbo.loan_master m
    ON s.loan_id = m.loan_id
WHERE s.as_of_date = '2026-04-30';
```

**Key vocabulary:**
- `s` and `m` are **table aliases** — shorthand. Required when joining so column names aren't ambiguous.
- `ON s.loan_id = m.loan_id` — how the tables relate. This is the DAX relationship, made explicit.
- `INNER JOIN` = "only keep rows that exist in both tables." If a loan is in `loan_snapshots` but missing from `loan_master`, it won't appear.

**DAX mental model:** this is like `RELATED(LoanMaster[FICO])` inside `loan_snapshots` rowcontext, except you're forced to name the join key.

---

### Pattern 3: LEFT JOIN

**Use when:** you want ALL rows from the left table, and optional matching rows from the right.

```sql
-- All loan snapshots, with FICO if available, NULL if not
SELECT
    s.loan_id,
    s.upb,
    m.fico_score  -- will be NULL for loans not in loan_master
FROM dbo.loan_snapshots s
LEFT JOIN dbo.loan_master m
    ON s.loan_id = m.loan_id;
```

**When to use which:**
- `INNER JOIN` — "only loans that have master records" (strict)
- `LEFT JOIN` — "all loan snapshots, add master info if we have it" (forgiving)
- Default to `INNER JOIN` unless you specifically need unmatched rows

---

### Pattern 4: GROUP BY + Aggregation

**DAX thought:** `SUMMARIZE` or a measure in a visual with a dimension in rows.

```sql
-- Average UPB and loan count by delinquency status (latest month)
SELECT
    dq_status,
    COUNT(*) AS loan_count,
    AVG(upb) AS avg_upb,
    SUM(upb) AS total_upb,
    MAX(days_past_due) AS worst_dpd
FROM dbo.loan_snapshots
WHERE as_of_date = '2026-04-30'
GROUP BY dq_status
ORDER BY loan_count DESC;
```

**Rules that trip up beginners:**
1. **Every non-aggregated column in `SELECT` must be in `GROUP BY`.** If you SELECT `dq_status, loan_id` you must GROUP BY both. If you want "one row per dq_status," you can't SELECT `loan_id` without aggregating it.
2. `COUNT(*)` counts rows. `COUNT(col)` counts non-null values of `col`. `COUNT(DISTINCT col)` counts unique values.
3. **To filter aggregates, use `HAVING` — not `WHERE`.** `WHERE` filters rows before grouping; `HAVING` filters the grouped results.

```sql
-- Only show dq_status buckets with more than 10 loans
SELECT dq_status, COUNT(*) AS loan_count
FROM dbo.loan_snapshots
WHERE as_of_date = '2026-04-30'
GROUP BY dq_status
HAVING COUNT(*) > 10;
```

---

### Pattern 5: CASE WHEN

**DAX thought:** `SWITCH(TRUE(), condition1, result1, condition2, result2, default)`

```sql
-- Bucket loans by balance size for reporting
SELECT
    loan_id,
    upb,
    CASE
        WHEN upb > 500000 THEN 'Jumbo'
        WHEN upb > 200000 THEN 'Standard'
        WHEN upb > 0      THEN 'Small'
        ELSE 'Paid Off'
    END AS size_bucket
FROM dbo.loan_snapshots
WHERE as_of_date = '2026-04-30';
```

**Common use: CASE inside aggregation for conditional counting.**

```sql
-- Count delinquent vs current loans in one query
SELECT
    SUM(CASE WHEN days_past_due = 0 THEN 1 ELSE 0 END) AS current_count,
    SUM(CASE WHEN days_past_due > 0 THEN 1 ELSE 0 END) AS delinquent_count,
    SUM(CASE WHEN days_past_due >= 60 THEN upb ELSE 0 END) AS severely_dq_upb
FROM dbo.loan_snapshots
WHERE as_of_date = '2026-04-30';
```

This pattern — `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` — is the SQL way of doing conditional counting. Memorize it. You'll use it everywhere.

---

### Pattern 6: Basic CTE (Common Table Expression)

**DAX thought:** `VAR x = ... RETURN something_using_x`. Intermediate named result.

```sql
-- Find loans with above-average UPB
WITH avg_balance AS (
    SELECT AVG(upb) AS portfolio_avg
    FROM dbo.loan_snapshots
    WHERE as_of_date = '2026-04-30'
)
SELECT
    s.loan_id,
    s.upb,
    a.portfolio_avg,
    s.upb - a.portfolio_avg AS diff_from_avg
FROM dbo.loan_snapshots s
CROSS JOIN avg_balance a
WHERE s.as_of_date = '2026-04-30'
  AND s.upb > a.portfolio_avg
ORDER BY s.upb DESC;
```

**Why CTEs are great:**
- Readable: you can give each step a name
- Testable: run just the CTE by itself to check
- Composable: one CTE can feed into another

**Syntax rules:**
- Starts with `WITH name AS ( ... )`
- Multiple CTEs separated by comma: `WITH a AS (...), b AS (...), c AS (...)`
- No comma before the final `SELECT`
- If the statement before the `WITH` didn't end in `;`, write `;WITH` instead (rare, but safe to remember)

---

### Pattern 7: Window Functions

**DAX thought:** this is the closest SQL gets to DAX. Window functions compute values across a set of rows related to the current row — *without* collapsing the rows like `GROUP BY` does. You keep every row and attach a calculation to it.

Think of it as: `CALCULATE(SUM(...), filter)` inside a row context — but the "filter" is the `PARTITION BY` and the ordering is the `ORDER BY`.

**The syntax pattern is universal:**
```sql
<function>() OVER (PARTITION BY <grouping_col> ORDER BY <sort_col>)
```

**The four you need to know:**

#### `ROW_NUMBER()` — number the rows within each group

```sql
-- For each loan, number its snapshots 1, 2, 3... in date order
SELECT
    loan_id,
    as_of_date,
    upb,
    ROW_NUMBER() OVER (PARTITION BY loan_id ORDER BY as_of_date) AS month_num
FROM dbo.loan_snapshots;
```

**Killer use case: "the most recent row per group."** This is the #1 window-function pattern in interviews.
```sql
-- Most recent snapshot per loan (only 1 row per loan)
WITH ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY loan_id ORDER BY as_of_date DESC) AS rn
    FROM dbo.loan_snapshots
)
SELECT * FROM ranked WHERE rn = 1;
```
Memorize this pattern. You'll use it constantly.

#### `LAG()` and `LEAD()` — grab previous or next row's value

```sql
-- Show current UPB alongside previous month's UPB for each loan
SELECT
    loan_id,
    as_of_date,
    upb AS current_upb,
    LAG(upb, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS prev_upb,
    upb - LAG(upb, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS upb_change
FROM dbo.loan_snapshots
WHERE loan_id = '10001'
ORDER BY as_of_date;
```

- `LAG(col, 1)` = the value from 1 row ago in the partition
- `LEAD(col, 1)` = the value from 1 row ahead
- For the first row in a partition, `LAG` returns `NULL` (no previous row exists)

**This replaces the need for self-joins in many cases** — cleaner and faster.

#### `SUM() OVER` — running totals / cumulative metrics

```sql
-- Running total of UPB paydown per loan
SELECT
    loan_id,
    as_of_date,
    upb,
    upb - LAG(upb, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS monthly_paydown,
    SUM(upb) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS cumulative_upb_seen
FROM dbo.loan_snapshots
WHERE loan_id = '10001';
```

#### `RANK()` / `DENSE_RANK()` — rank with ties

- `RANK()` — ties get same rank, next rank skips (1, 2, 2, 4, 5)
- `DENSE_RANK()` — ties get same rank, next rank doesn't skip (1, 2, 2, 3, 4)
- `ROW_NUMBER()` — ties broken arbitrarily, no duplicates (1, 2, 3, 4, 5) — **always add explicit tiebreakers**

**How to choose — match the literal question:**
- "Top 3 loans by UPB" (asking for *rows*) → `ROW_NUMBER()` with deterministic tiebreakers. Returns exactly 3 rows.
- "Top 3 UPB values" (asking for *values*) → `DENSE_RANK()`. May return more than 3 rows if values tie.
- "The rank of this loan among all loans" (competition-style) → `RANK()`. Matches how sports rankings work.

### Always make `ROW_NUMBER()` deterministic

If you write `ROW_NUMBER() OVER (ORDER BY transaction_value DESC)` and two rows tie at the exact same value, SQL Server picks one arbitrarily — and may pick a different one next run. Your query becomes non-reproducible.

```sql
-- NOT rigorous: arbitrary tiebreaking
ROW_NUMBER() OVER (ORDER BY transaction_value DESC)

-- Rigorous: deterministic tiebreakers
ROW_NUMBER() OVER (
    ORDER BY transaction_value DESC,  -- primary
             as_of_date       ASC,    -- tiebreaker 1: earlier row wins
             loan_id          ASC     -- tiebreaker 2: lower id wins
)
```

Every `ORDER BY` in a `ROW_NUMBER()` should have tiebreakers unless the primary sort column is guaranteed unique (like a primary key). Treat this as non-negotiable.

### The killer combination: window function + filter in a CTE

```sql
-- "Top 3 loans by UPB within each dq_status bucket"
WITH ranked AS (
    SELECT
        loan_id, dq_status, upb,
        DENSE_RANK() OVER (PARTITION BY dq_status ORDER BY upb DESC) AS rnk
    FROM dbo.loan_snapshots
    WHERE as_of_date = '2026-04-30'
)
SELECT loan_id, dq_status, upb, rnk
FROM ranked
WHERE rnk <= 3
ORDER BY dq_status, rnk;
```

**You cannot filter on a window function directly** — it's calculated after `WHERE`. You must wrap it in a CTE (or subquery) and filter on the alias in the outer query. This trips up everyone at least once. Expect to hit it.

### One DAX-specific mental bridge
In DAX, `RANKX(ALL(Table), Table[measure])` ranks within the whole table. With `ALLEXCEPT(Table, Table[category])` you'd rank within category. In SQL:
- `RANK() OVER (ORDER BY col)` = rank across the whole table → DAX `RANKX(ALL(...))`
- `RANK() OVER (PARTITION BY category ORDER BY col)` = rank within each category → DAX `RANKX(ALLEXCEPT(...))`

The `PARTITION BY` is literally the "what to reset rank within" argument.

---

### Pattern 8: Chained CTEs + Self-Join for Period Comparison

**This is the architectural pattern for hard questions.** You won't solve a genuinely hard SQL problem in one CTE. You'll solve it in 3–5 CTEs, each doing one thing, building on the one before.

**The mental model:** decompose the problem into steps. Give each step a name. Feed each step into the next.

```sql
WITH
step1_filter_and_enrich AS (
    -- Get only the rows we care about, add derived columns
),
step2_aggregate AS (
    -- Compute group-level metrics
),
step3_compare_or_rank AS (
    -- Rank or compare across groups
)
SELECT * FROM step3_compare_or_rank
WHERE <final filter>;
```

**Mortgage example — worked end-to-end:**

Question: *"For each loan, find the largest single-month drop in UPB and the month it happened. Show only loans where that drop exceeded $5,000."*

This is hard if you try to write it as one query. Easy as a chain:

```sql
WITH
-- Step 1: For each row, grab the previous month's UPB
month_over_month AS (
    SELECT
        loan_id,
        as_of_date,
        upb,
        LAG(upb, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS prev_upb,
        upb - LAG(upb, 1) OVER (PARTITION BY loan_id ORDER BY as_of_date) AS upb_change
    FROM dbo.loan_snapshots
),

-- Step 2: Filter out the first month (no prev) and keep only drops
drops_only AS (
    SELECT *
    FROM month_over_month
    WHERE upb_change < 0  -- negative = UPB went down
),

-- Step 3: Rank the drops per loan (biggest drop = rank 1)
ranked_drops AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY loan_id ORDER BY upb_change ASC) AS drop_rank
    FROM drops_only
)

-- Final: the largest drop per loan, filtered to drops > $5k
SELECT
    loan_id,
    as_of_date AS drop_month,
    prev_upb,
    upb,
    upb_change AS drop_amount
FROM ranked_drops
WHERE drop_rank = 1
  AND ABS(upb_change) > 5000
ORDER BY upb_change ASC;
```

Four CTEs. Each one obvious in isolation. The whole is clear because the parts are named.

### The self-join alternative

Same problem, without window functions, using a self-join:

```sql
SELECT
    curr.loan_id,
    curr.as_of_date,
    prev.upb AS prior_upb,
    curr.upb AS current_upb,
    curr.upb - prev.upb AS change
FROM dbo.loan_snapshots curr
LEFT JOIN dbo.loan_snapshots prev
    ON curr.loan_id = prev.loan_id
   AND prev.as_of_date = DATEADD(MONTH, -1, curr.as_of_date)
WHERE curr.upb - prev.upb < -5000;
```

**Why learn both?** Because:
- Window functions (`LAG`) are cleaner when you have both rows' data side-by-side
- Self-joins are more flexible when the relationship isn't exactly "previous row" — e.g., "same customer 6 months later" or "any prior transaction above $X"
- Some interviewers specifically want to see self-joins
- Sometimes the window-function version is slower; the self-join gives the query planner more options

**When to reach for which:**

| Situation | Use |
|---|---|
| "Compare each row to the previous/next row in sequence" | `LAG` / `LEAD` (Pattern 7) |
| "Compare rows with arbitrary relationship (e.g., same key, different flag)" | Self-join (Pattern 8) |
| "Multi-step transformation, each step depends on the last" | Chained CTEs (Pattern 8) |
| "Top N per group" | `ROW_NUMBER` + CTE filter (Pattern 7) |

### Build-it-in-layers discipline

When you see a hard question, **resist writing the whole thing at once.** Instead:

1. Write `step1` as a standalone `SELECT`. Run it. Does it return what you expect?
2. Wrap it in `WITH step1 AS (...)`. Write `step2` that queries `step1`. Run it.
3. Keep going. At each step, only the CURRENT step is "new code." Everything before is tested.

This is the same discipline good DAX authors use — you don't write a 5-line `CALCULATE` with nested `FILTER`s in one shot. You build it measure by measure, testing each.

---

## Part 3: The First Five Minutes of Any Test Question

When you see the question and the schema, do this *before* writing any SQL:

### Step 1: Read the schema
The test will show you tables. For each one, note:
- What's the primary key? (usually `id` or `<thing>_id`)
- What columns would you filter on?
- What columns would you aggregate?

### Step 2: Explore with simple queries
Don't trust the schema description alone. Run:

```sql
-- See what one row looks like
SELECT TOP 5 * FROM <table_name>;

-- See what values exist in a column
SELECT DISTINCT status FROM <table_name>;

-- See how many rows
SELECT COUNT(*) FROM <table_name>;

-- See the date range
SELECT MIN(as_of_date), MAX(as_of_date) FROM <table_name>;
```

### Step 3: Restate the question in your own words
If the question is "find customers with repeat orders in Q3," say it back to yourself: *"count orders per customer, filtered to Q3, where count > 1."*

Once you can say it as a sequence of operations, the SQL almost writes itself.

### Step 4: Write it in pieces
- First: just get the raw data. `SELECT * FROM orders WHERE quarter = 3;`
- Then: add the aggregation. `GROUP BY customer_id, count the rows.`
- Then: filter the aggregation. `HAVING count > 1.`

Build it in layers. Test each layer. Don't try to write the final query in one shot.

---

## Part 4: Tonight's Practice Plan (3–5 hours)

Work through these on your `rice_park_practice` database. Time yourself — aim for 10–15 minutes per exercise. **Don't look up answers until you've struggled for 10 minutes.**

### Round 1: Warm-up (45 min)

**E1.** List all loans currently at 60+ days past due, sorted by UPB descending.
```
Expected skills: SELECT, WHERE, ORDER BY
Hint: filter on days_past_due and the latest as_of_date
```

**E2.** Count loans by `dq_status` as of April 30, 2026.
```
Expected skills: GROUP BY, COUNT(*)
```

**E3.** Show average UPB and count of loans, grouped by `dq_status`.
```
Expected skills: GROUP BY with multiple aggregates
```

### Round 2: Joins (60 min)

**H1.** Show each loan's current UPB alongside its FICO score (from `loan_master`).
```
Expected skills: INNER JOIN
```

**H2.** For each loan, show its total payment history count from `remittances`.
```
Expected skills: INNER JOIN + GROUP BY
Hint: you'll aggregate remittances per loan_id
```

**H3.** Show ALL loans from `loan_master`, even ones with no snapshots.
```
Expected skills: LEFT JOIN
Hint: if no match, the right-side columns will be NULL
```

### Round 3: CASE + Conditional Aggregation (60 min)

**H4.** Create a risk bucket column: 'Healthy' (dq=0), 'Early DQ' (1-30), 'Serious DQ' (31-90), 'Critical' (90+). Count loans in each bucket.
```
Expected skills: CASE WHEN, GROUP BY on expression
```

**H5.** For each month, count current loans vs delinquent loans in separate columns.
```
Expected skills: SUM(CASE WHEN ... THEN 1 ELSE 0 END)
This is the pattern. Master it.
```

**H6.** Calculate total UPB of delinquent loans as % of total UPB, for the latest month.
```
Expected skills: SUM(CASE WHEN...) * 1.0 / SUM(...) — watch integer division!
Hint: in SQL Server, INTEGER / INTEGER = INTEGER (truncates). Multiply by 1.0 or CAST to FLOAT first.
```

### Round 4: CTEs (45 min, if time permits)

**X1.** Using a CTE, find loans whose UPB is above the portfolio average.
```
Expected skills: WITH clause, CROSS JOIN or subquery to pull the average
```

**X2.** Using two chained CTEs, rank loans by UPB and show the top 10 per dq_status bucket.
```
Expected skills: multiple CTEs, maybe ROW_NUMBER if you've got it
```

### After each exercise
Mark: ✓ solved, ~ solved with help, ✗ couldn't solve. Track the pattern, not the individual problem. If you struggled on H2, re-read Pattern 2 (INNER JOIN) before bed.

---

## Part 5: Tomorrow Morning (2–3 hours before the test)

**There is no practice test.** This is one-and-done, recorded, on camera. That means the first 5 minutes of the real test are when you'll orient yourself to the interface — budget for that (see Part 6).

So tomorrow morning is pure rep-building. Your bottleneck is recall speed, not new concepts.

### First 60 minutes: Rapid-fire pattern reps

The goal: write 10 small queries in 60 minutes. Don't optimize for elegance — optimize for "I wrote it, it ran, I moved on." You're building a reflex.

Pick ten questions below, one from each bucket. Spend ~5-6 minutes each. Run them against your `rice_park_practice` database.

**Joins (pick 2):**
- List each loan's current UPB alongside its original FICO score.
- Show all loans from `loan_master`, with their most recent `as_of_date` from `loan_snapshots` (or NULL if no snapshots).
- For each loan, count how many remittance records exist.

**GROUP BY (pick 2):**
- Average UPB by `dq_status` for the latest month.
- Count loans per pool (joining `loan_master` to `pools` if needed).
- Total UPB by origination year.

**CASE (pick 2):**
- Bucket loans into 'Small' (<$200k), 'Medium', 'Large' (>$500k) and count each.
- Show % of portfolio delinquent (use `SUM(CASE WHEN dq > 0 THEN upb ELSE 0 END) * 1.0 / SUM(upb)`).

**Window functions (pick 2):**
- Rank loans by UPB within each `dq_status` bucket, show top 3.
- Show each loan's month-over-month UPB change using `LAG`.

**Chained CTE (pick 2):**
- Find loans whose UPB is above the portfolio average.
- Find the single biggest UPB drop per loan, and the month it happened.

**Scoring:** Don't grade yourself on correctness — grade yourself on *time-to-first-attempt*. If you stare at the blank editor for more than 30 seconds, you're rusty on that pattern. Flag it and do one more from that bucket.

### Next 30 minutes: One "boss battle" query

Do ONE of these end to end. No hints, no peeking at Part 2. Treat it as a mini-test:

**Option A:** "For each loan, find the longest stretch of consecutive months where UPB didn't decrease. Show the loan_id, the start and end month of that stretch, and how many months long it was."

**Option B:** "For each pool, calculate the current delinquency rate (% of loans with days_past_due >= 30) and the change from the prior month."

**Option C:** "Find all loans that went from CURRENT to 60+ days delinquent in a single month, then eventually returned to CURRENT. Show the loan_id, the date of the jump, and the date they cured."

These are realistic hard-question difficulty. If you can solve one in 25-30 minutes, you're ready.

### Last 30 minutes: Logistics, not SQL

- Re-read Part 6 (test strategy) and Part 7 (syntax reference). One pass, then close.
- Eat something with protein. Hydrate but don't over-caffeinate.
- Clear your desk of everything that isn't your laptop, water, and a notepad + pen.
- Bathroom. Close Slack, email, everything. Phone face-down on silent in another room.
- Check your camera and mic work. Test your internet with a speedtest.
- Take a 5-minute walk if you can. Sitting tense for 2 hours straight is harder than the SQL.

Then: open the test link at the exact time you've decided. Don't rush in.

---

## Part 6: Test Strategy

You have three questions, two hours, and a skill-level mismatch. The strategy is triage.

### Time budget (adjusted for your skill level)

| Phase | Time | What to do |
|---|---|---|
| 0:00 – 0:05 | 5 min | Read ALL three questions. Don't write yet. Identify which is easiest. |
| 0:05 – 0:35 | 30 min | **Easy question.** Get it 100% right. This is your floor. Submit it. |
| 0:35 – 1:25 | 50 min | **Hard question.** Build in layers. If stuck at 40 min, submit whatever you have and move on. |
| 1:25 – 1:55 | 30 min | **Extremely hard question.** Write SOMETHING. Even 40% of a correct query might score partial. Don't leave it blank. |
| 1:55 – 2:00 | 5 min | Re-check submissions. Verify each actually ran. |

### If the question feels impossible

**Don't panic.** Use this escape ladder:

1. **Can I solve a simpler version?** If the question asks "find consecutive months of delinquency," try just "find all delinquent months for each loan." Partial credit > blank.
2. **Can I SELECT * and just return the raw rows?** If the question involves complex aggregation and you're lost, just return the matching rows with a simple WHERE. It shows you understood the filter even if you couldn't aggregate.
3. **Can I use a SUBQUERY instead of a JOIN?** If joins are confusing, a subquery in the WHERE clause might work:
   ```sql
   -- Instead of joining loan_master to filter by FICO:
   SELECT * FROM loan_snapshots
   WHERE loan_id IN (SELECT loan_id FROM loan_master WHERE fico > 700);
   ```

### If you're getting a SQL error you don't understand

1. Remove the last thing you added. Does it work now? If yes, the problem is in what you just added.
2. Run just the `FROM` and `WHERE` parts (delete aggregation, ORDER BY). Does that return rows? If yes, the problem is in the aggregation or sort.
3. Check quote marks — single quotes for strings (`'Active'`), not double.
4. Check `IS NULL` — never `= NULL`.
5. Check that every non-aggregated column in `SELECT` is in `GROUP BY`.
6. Check table aliases — are all your columns prefixed correctly (`s.loan_id`, not `loan_id`)?

### The "I'm totally stuck" move

Write out the query in **comment form** as English pseudocode:
```sql
-- Step 1: Get all loans with their master info (JOIN loan_master)
-- Step 2: Filter to loans where FICO < 600
-- Step 3: For each remaining loan, find their max days_past_due
-- Step 4: Show only those where max DPD >= 60
```

Then try to translate line by line. Even partial translation shows you understood the problem, which is half of partial credit.

---

## Part 7: Syntax Quick Reference

Pin this open during the test if the platform allows it.

### Data types / NULL
- String literal: `'Active'` (single quotes, always)
- Null check: `col IS NULL`, `col IS NOT NULL`
- Null-coalesce: `ISNULL(col, 0)` (SQL Server) or `COALESCE(col, 0)` (standard)
- Cast: `CAST(col AS FLOAT)` or `CAST(col AS INT)`
- Integer division warning: `5 / 2 = 2` (truncates). Use `5 * 1.0 / 2 = 2.5` or `CAST(5 AS FLOAT) / 2`.

### Dates (SQL Server)
- Today: `GETDATE()`
- Year of date: `YEAR(col)`
- Month of date: `MONTH(col)`
- Day of date: `DAY(col)`
- Date arithmetic: `DATEADD(MONTH, 1, col)` — adds 1 month
- Date diff: `DATEDIFF(DAY, start_col, end_col)` — days between two dates
- Literal date: `'2026-04-30'` — string with single quotes, ISO format

### Comparison operators
- Equal: `=` (NOT `==` like Python)
- Not equal: `<>` or `!=`
- Greater/less: `>`, `<`, `>=`, `<=`
- In a list: `col IN ('A', 'B', 'C')`
- Between (inclusive): `col BETWEEN 10 AND 20`
- String matching: `col LIKE 'ABC%'` (% = wildcard)

### JOIN syntax
```sql
FROM table_a a
INNER JOIN table_b b ON a.key = b.key
LEFT  JOIN table_c c ON a.key = c.key
```

### Common aggregations
- `COUNT(*)` — all rows
- `COUNT(col)` — non-null values of col
- `COUNT(DISTINCT col)` — unique non-null values
- `SUM(col)` — total
- `AVG(col)` — average
- `MIN(col)` / `MAX(col)` — smallest/largest
- `STDEV(col)` — standard deviation (SQL Server)

### Sort direction
- `ORDER BY col` — ascending (default)
- `ORDER BY col DESC` — descending
- `ORDER BY col1, col2 DESC` — col1 asc, col2 desc

### Limiting rows
- SQL Server: `SELECT TOP 10 ... ORDER BY ...`
- Standard / PostgreSQL / MySQL: `SELECT ... ORDER BY ... LIMIT 10`
- The test is on SQL Server, so use `TOP`.

---

## Part 8: Worked Interview Questions

Four questions from a real recent pre-screen (same format as what Rice Park will use), solved at the rigorous standard. **Study the patterns of rigor, not just the queries.** The table structure: `Product_table` with columns `Month` (e.g., `'January 2026'`), `Product_Name` (`'A'` or `'B'`), `Quantity`, `Price`.

### Q1. Total sales by product by month

```sql
SELECT
    Month,
    Product_Name,
    SUM(Quantity * Price) AS total_sales
FROM Product_table
WHERE Quantity IS NOT NULL
  AND Price    IS NOT NULL
GROUP BY Month, Product_Name
ORDER BY
    CAST('01 ' + Month AS DATE),   -- chronological, not alphabetical
    Product_Name;
```

**Rigorous choices:**
1. `CAST('01 ' + Month AS DATE)` — chronological sort. Without this, `'April 2026'` sorts before `'August 2025'`. Wrong.
2. `WHERE IS NOT NULL` — defends against silent undercounts.
3. Secondary sort on `Product_Name` — result is deterministic across runs.
4. Multiplied per-row before summing. `SUM(Quantity) * SUM(Price)` is a classic wrong answer — it double-counts.

### Q2. Most recent month where either product had zero sales

```sql
WITH monthly_totals AS (
    SELECT
        Month,
        CAST('01 ' + Month AS DATE) AS month_date,
        SUM(CASE WHEN Product_Name = 'A' THEN Quantity * Price ELSE 0 END) AS a_sales,
        SUM(CASE WHEN Product_Name = 'B' THEN Quantity * Price ELSE 0 END) AS b_sales
    FROM Product_table
    GROUP BY Month
)
SELECT TOP 1
    Month,
    a_sales,
    b_sales,
    CASE
        WHEN a_sales = 0 AND b_sales = 0 THEN 'Both products had zero sales'
        WHEN a_sales = 0                 THEN 'Product A had zero sales'
        WHEN b_sales = 0                 THEN 'Product B had zero sales'
    END AS zero_sales_detail
FROM monthly_totals
WHERE a_sales = 0 OR b_sales = 0
ORDER BY month_date DESC;
```

**Rigorous choices:**
1. **CTE structure, not compound HAVING.** The CTE is readable, testable, and defendable. `SELECT * FROM monthly_totals` lets you verify the aggregations are right before filtering.
2. **`month_date` carried as a `DATE` through the CTE** so `ORDER BY ... DESC` is chronological, not alphabetical.
3. **Output includes which product(s) had zero sales**, not just the month. The interviewer doesn't have to ask the obvious follow-up.
4. **State the assumption out loud:** if a month has *no rows at all* for either product, it doesn't appear in `monthly_totals`. That's a deliberate choice — "zero sales" means "rows exist summing to zero," not "no rows." If the interviewer considers the no-rows case to be "zero sales," you need a calendar dimension `LEFT JOIN`ed to cover every month. Surface this in the interview.

### Q3. 10th-largest transaction for Product A, 5th-largest for Product B

```sql
WITH ranked AS (
    SELECT
        Month,
        Product_Name,
        Quantity,
        Price,
        Quantity * Price AS transaction_value,
        ROW_NUMBER() OVER (
            PARTITION BY Product_Name
            ORDER BY Quantity * Price                  DESC,  -- primary
                     CAST('01 ' + Month AS DATE)       ASC,   -- tiebreaker 1
                     Quantity                          DESC   -- tiebreaker 2
        ) AS rnk
    FROM Product_table
    WHERE Quantity IS NOT NULL
      AND Price    IS NOT NULL
      AND Quantity * Price > 0
)
SELECT
    Month,
    Product_Name,
    Quantity,
    Price,
    transaction_value,
    rnk AS rank_within_product
FROM ranked
WHERE (Product_Name = 'A' AND rnk = 10)
   OR (Product_Name = 'B' AND rnk = 5)
ORDER BY Product_Name;
```

**Rigorous choices:**
1. **Deterministic tiebreakers in `ROW_NUMBER`.** If two Product A transactions tie at $1,500, which is 10th? Declare explicitly: earlier month wins, then higher quantity. Query is reproducible.
2. **`ROW_NUMBER` — defended choice.** The question asks for *the 10th transaction*, which is a specific row. If it had asked for *the 10th-largest value*, `DENSE_RANK` would be correct. Be prepared to articulate which and why.
3. **Filter bad data before ranking.** NULLs and zero-value rows shouldn't occupy the top 10.
4. **Output includes the computed rank.** A reviewer verifying "is this really 10th?" can see `rank_within_product = 10` directly. Self-auditing.
5. **Cannot filter on `rnk` without the CTE.** `WHERE rnk = 10` in the same query that computes `rnk` is a syntax error — SQL processes `WHERE` before window functions. Common interview trap.

### Q4. Month where Product A quantity > 1000 AND Product B $ sales < $2000

```sql
WITH monthly_product_metrics AS (
    SELECT
        Month,
        CAST('01 ' + Month AS DATE) AS month_date,
        SUM(CASE WHEN Product_Name = 'A' THEN Quantity               ELSE 0 END) AS a_total_quantity,
        SUM(CASE WHEN Product_Name = 'B' THEN Quantity * Price       ELSE 0 END) AS b_total_sales
    FROM Product_table
    WHERE Quantity IS NOT NULL
      AND Price    IS NOT NULL
    GROUP BY Month
)
SELECT
    Month,
    a_total_quantity,
    b_total_sales
FROM monthly_product_metrics
WHERE a_total_quantity > 1000
  AND b_total_sales    < 2000
ORDER BY month_date;
```

**Rigorous choices:**
1. **CTE exposes both metrics as named columns.** `a_total_quantity` is units; `b_total_sales` is dollars. Grain is explicit in the names — never ambiguous.
2. **Output returns both metrics**, so a reviewer can verify A really exceeds 1000 units and B really is below $2000 in each returned row. Self-auditing again.
3. **Unit-pedantry.** The question says "quantity sales" for A and "$ sales" for B. Different columns in the aggregation. Miss this and the query compiles but returns wrong data.
4. **Chronological output.**

### The Rigor Checklist — apply to every query you write tomorrow

Before clicking submit on any answer, check:

- [ ] **Chronological dates.** Any `Month`/date-as-string column sorted via `CAST` to `DATE`, never as a string.
- [ ] **NULL defense.** Explicit `WHERE x IS NOT NULL` on any column feeding arithmetic or comparison, with a comment if non-obvious.
- [ ] **Deterministic `ORDER BY`.** Primary sort + tiebreakers, always. Even in `ROW_NUMBER` OVER clauses.
- [ ] **Self-auditing output.** Return the metrics being filtered on, not just the row identifier. The reviewer shouldn't need a second query to verify.
- [ ] **Assumptions surfaced.** If "zero" could mean "absent," "missing months" could matter, or "ties" could ambiguate — say it out loud, either in a comment or in the answer narrative.
- [ ] **Matching function to question.** `ROW_NUMBER` for "Nth row," `DENSE_RANK` for "Nth value," `RANK` for competition-style. Be able to articulate which and why.
- [ ] **Unit clarity.** Column names declare whether values are counts, dollars, percentages, etc. No ambiguity.
- [ ] **CTE over compound HAVING/subquery.** When a condition involves multiple aggregates, a named CTE beats a clever one-liner for readability and defensibility.

---

## Part 9: Final Thoughts

**You are not an SQL beginner.** You're a data expert using an unfamiliar syntax. There is a massive difference. Everyone who's good at DAX can become competent at SQL in days, not months — the underlying concepts are the same.

**The test will probably not require gaps-and-islands or recursive CTEs at full PhD depth.** Those are the "extremely hard" territory. The easy and hard questions will be covered by Patterns 1-6 in Part 2, possibly nudging into Pattern 7 (window functions). The extremely-hard question may require Pattern 8's chained-CTE architecture. Focus your time there.

**Partial credit is your friend.** Don't submit blank answers. A query that filters the right rows but gets the aggregation wrong still earns partial credit. A blank earns nothing.

**If you don't pass:** the result of not taking the test is identical to the result of failing it. Taking it and learning how these assessments actually work is net-positive regardless of outcome.

**One last thing:** if the test gives you an hour for a question and you finish in 30 minutes, don't submit right away. Re-read the question. Did it ask for count or for the actual rows? Did it say "descending" or "ascending"? Most lost points are from misreading the question, not from writing bad SQL.

Good luck. You've got this more than you think.
