# SQL Sprint

An interactive SQL learning environment that runs entirely in the browser — no backend, no setup, no account required. Write real SQL, get real results, get graded on correctness.

Built to solve a specific problem: most SQL learning tools either give you passive reading material or a blank sandbox with no structure. This one does neither. It sequences the concepts, grades your work against an actual query engine, tells you exactly what went wrong, and surfaces the drills you struggled on again later. The feedback loop is tight by design.

---

## Architecture

Single-file React 18 application. Everything — the UI, the lesson content, the SQL engine, the grading logic, the spaced repetition system, the badge engine — ships in one standalone HTML file. Open it in a browser and it runs. No Node, no npm, no server, no account.

**Why a single file?**

Portability. A learning tool that requires a setup step has already lost. The file can be emailed, shared via a link, dropped into a folder, opened offline. It runs identically on every machine with a modern browser.

**SQL Engine**

SQL execution is handled by [AlaSQL](https://github.com/AlaSQL/alasql), a JavaScript SQL database that runs in-browser. All three schemas are loaded into AlaSQL's in-memory store at startup. When you submit a query, it executes against the live data and returns a real result set — not a simulation, not a hardcoded response.

Grading works by running your query and the reference solution in parallel and comparing result sets. If the output matches — accounting for column order differences — you pass. There's no fuzzy matching, no partial parsing. Either your query returns the right data or it doesn't.

**State Management**

All session state — XP, completed lessons, drill history, badge unlocks, spaced repetition card schedules, sandbox query history — is persisted to `localStorage`. Closing and reopening the file resumes where you left off. Each storage operation is wrapped in try/catch with graceful fallback to in-memory state.

**Component Structure**

Built in React 18 with hooks throughout. No Redux, no external state library. The primary state model is a flat progress object keyed by lesson ID and drill ID, with derived state calculated at render time. Animations use Framer Motion. Charts and data visualizations in the execution plan viewer use Recharts.

---

## Features

### Lessons

Eleven lessons, sequenced to build on each other. Concepts are taught before syntax — you understand what a window function is doing before you're asked to write one.

| Lesson | Topic |
|--------|-------|
| 1 | SELECT — column projection, aliases |
| 2 | WHERE — filtering, operators, NULL behavior |
| 3 | ORDER BY — sorting, multi-column, directional |
| 4 | Aggregate Functions — COUNT, SUM, AVG, MIN, MAX |
| 5 | GROUP BY + HAVING — grouping mechanics, execution order |
| 6 | JOINs — INNER, LEFT, multi-table chaining |
| 7 | Subqueries — scalar, correlated, derived tables, EXISTS |
| 8 | CTEs — WITH clause, chained CTEs, CTE vs subquery |
| 9 | Window Functions — OVER(), PARTITION BY, ROW_NUMBER, RANK, LAG, LEAD, frames |
| 10 | CASE Expressions — searched CASE, SUM(CASE WHEN) conditional aggregation |
| 11 | Multi-Table Analysis — combining all patterns |

Each lesson contains:
- A concept explanation with examples
- A primary challenge problem
- 5–10 additional drills
- A quick-fire conceptual check

### Auto-Grading

Every drill submission executes your SQL against the live in-memory database. The grader:

1. Runs your query and the reference solution
2. Normalizes column ordering
3. Compares result sets row by row
4. Returns one of: exact match, correct data with wrong column order (still passes), wrong row count, wrong values, or syntax error with the engine's error message

Wrong answers tell you specifically what's different — not just "incorrect." If your query returns 8 rows and the answer returns 5, you see that number. If you're missing a column, it names the column.

### Schemas

Three schemas unlock progressively as you level up. All data is synthetic.

**Core Schema** — Available from lesson 1.

```
employees   → id, first_name, last_name, department, salary, hire_date, manager_id, age, city
departments → id, name, budget, location, head_count
products    → id, name, category, price, stock, supplier_id, rating
orders      → id, customer_id, product_id, quantity, order_date, status, total
customers   → id, name, email, city, tier, joined
```

**E-Commerce Schema** — Unlocks at level 3.

```
ec_users        → id, username, email, country, signup_date, plan, ltv
ec_sessions     → id, user_id, session_date, pages_viewed, duration_secs, source, converted
ec_transactions → id, user_id, amount, txn_date, plan, status
ec_reviews      → id, user_id, product_category, rating, review_date, sentiment
```

**Analytics Schema** — Unlocks at level 6.

```
events      → id, user_id, event_type, page, ts, session_id
funnels     → stage, user_count, stage_order
cohorts     → cohort_month, users, retained_m1, retained_m2, retained_m3
attribution → id, user_id, channel, touchpoint, touchpoint_date, converted, revenue
```

### Capstone Challenges

Three multi-concept problems at senior analyst difficulty. Each requires combining JOINs, aggregations, window functions, CTEs, and CASE expressions in a single query. Timed from first keystroke. Graded A through S based on correctness, time taken, and number of attempts.

- **Sales Performance Dashboard** — customer spending analysis with revenue ranking
- **Product Inventory Intelligence** — stock health labeling, urgency ranking, category value rollup
- **Employee Compensation Analytics** — department average comparison, above/below average flag, salary rank within department

### Spaced Repetition

Every drill you complete is tracked with an SM-2-based spaced repetition algorithm. Drills you answer confidently get scheduled further out. Drills you struggle on come back sooner. The "Due Today" queue surfaces drills for review in priority order. The system tracks ease factor, interval, and repetition count per card — the same mechanics used by Anki.

### Query Execution Plan Visualizer

Submit any query and toggle the execution plan view. The visualizer breaks down:

- Which tables are scanned and how many rows each contains
- JOIN order and estimated intermediate row counts
- WHERE filter placement and estimated selectivity
- GROUP BY aggregation strategy
- HAVING filter application
- Window function computation phase
- ORDER BY and LIMIT application
- Performance notes flagging expensive patterns (leading wildcard LIKE, large sorts, missing index candidates)

This is pedagogically the most useful feature. Understanding *why* a query is slow requires seeing the execution order, not just the result.

### SQL Editor

The query editor supports:
- Syntax highlighting (keywords, functions, strings, numbers, comments)
- Keyword autocomplete — start typing a SQL keyword and suggestions appear
- Auto-indentation via Tab / Shift+Tab to de-indent
- Auto-format via Ctrl+Shift+F — reformats the query with standard capitalization and line breaks
- Keyboard shortcuts: Ctrl+Enter to run, Ctrl+Shift+Enter to submit for grading
- Hint system — shows a targeted hint without revealing the answer

### Progression System

- **XP** — earned per drill, per lesson completion, per capstone grade
- **Levels** — every 300 XP advances a level, unlocking schema tiers
- **Badges** — 13 badges for milestones: first query, streaks, capstone completion, S-rank, sandbox exploration, drill volume
- **Streak tracking** — consecutive lesson completions tracked and displayed

### Sandbox Mode

Free-play query environment with access to all three schemas regardless of level. Query history persists across sessions. No grading, no time pressure — just a place to experiment.

---

## Lesson Design Philosophy

**Concepts before syntax.** The common failure mode in SQL education is teaching `SELECT * FROM table` on day one and treating it as progress. Knowing the syntax for a window function is useless if you don't understand what a window is. Every lesson leads with the conceptual model before showing the code.

**Execution order is taught explicitly.** Most SQL learners have a broken mental model of how queries execute because nobody explains it. This tool teaches FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY as a first-class concept, not a footnote. That single explanation resolves a huge category of confusion about why aliases don't work in WHERE, why you can't filter on aggregates with WHERE, and why window functions can't appear in WHERE clauses at all.

**Failure is data.** Wrong answers give you the specific gap — row count mismatch, missing column, wrong values — not just a red X. The goal is for every wrong answer to teach you something, not just register as a failure.

**Drills are longer than you think you need.** Each lesson has 8–10 drills, which feels like too many until the third or fourth time you write the same pattern from scratch and it finally sticks. Repetition under variation is what builds actual recall, not reading a correct example once.

---

## Running It

Download `sql-sprint-standalone.html`. Open it in Chrome, Firefox, Edge, or Safari. Everything else is handled.

No internet connection required after the file is downloaded. All assets are inlined.

---

## What I Learned Building This

The hardest part wasn't the SQL engine or the React architecture — it was the grading logic. Determining whether a query is "almost right" turns out to be a genuinely difficult problem. Row count matching is easy. Column presence is easy. Value comparison is easy. But communicating *why* something is wrong in a way that's actually useful for learning required several iterations.

The spaced repetition implementation was the most interesting algorithmic problem. SM-2 looks simple on paper — ease factor, interval, repetition count — but the edge cases accumulate fast. What happens if a user doesn't open the app for two weeks? What's the right ease factor floor? How do you handle a card that's been marked "easy" eight times in a row?

The execution plan visualizer was pure product intuition. Nobody asked for it. But after watching people write correct queries without understanding why a naive approach would destroy performance on a real dataset, it became obvious the tool was incomplete without some window into what the engine is actually doing.

Building something to teach a subject forces you to understand it at a different level. You can't write a lesson on window function frames without internalizing exactly what ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW is actually computing and why it differs from the whole-partition default. Every lesson in this tool represents a concept I had to understand well enough to explain, then verify my explanation by writing a question that can only be answered correctly if the student actually got it.

---

## Stack

- React 18
- AlaSQL (in-browser SQL engine)
- Framer Motion (animations)
- Recharts (data visualization)
- Lucide React (icons)
- Tailwind CSS (styling)

---

If you're trying to learn SQL and you've been frustrated by tools that either talk at you or throw you into a blank editor with no direction — I hope this helps. It's the tool I wished existed when I needed it.

All the best,

Matt Amundson
