# AI session continuity — 2026-04-12

Exhaustive handoff for the next AI or human session. Workspace: `c:\Users\mattm\career-ops` (Matthew Amundson fork).

> **Note:** This filename avoids `.gitignore` patterns that exclude `*handoff*.md`. Git snapshots live in `docs/handoff-2026-04-12-git-*.txt` (committed in `8079ec4`).

---

## 1. Session summary (chronological)

1. **Dashboard vs upstream roadmap (plan)** — Documented dual operator surfaces (HTML `dashboard.html` vs Go TUI), refresh cadence, non-goals. Added canonical docs and cross-links; CI `go vet` for `dashboard/` (these files exist **on disk**; several were **never merged into `origin/master`** — see §4 and §9).
2. **“Next steps” plan (operator habits)** — Encoded weekly rhythm, batch-evaluation hygiene, upstream audit template, panel-tightening guidance, Windows/Go notes in `CONTRIBUTING.md` (same caveat: may be **local-only** if still untracked).
3. **Interview volume** — Advisory only (no repo changes): funnel focus, stale inventory, conversations vs ATS-only.
4. **Work-mode priority (Minneapolis)** — Implemented **hybrid / on-site / MSP-local** boost vs **fully remote** for ordering and dashboard Priority, while keeping **high-scoring remote** competitive. Wired through Node (`scoring-core.mjs`, `generate-dashboard.mjs`), Go (`work_arrangement.go`, TUI default **focus** sort), tests, `README.md`, `docs/SYSTEM-STATUS.md` (these parts **are on `origin/master`** via commit `d782e91`).
5. **“Proceed” (first)** — Created commit `d782e91` (feature) on `master`; `config/profile.yml` could not be included (gitignored).
6. **“Proceed” (second)** — Updated **`config/profile.example.yml`** with fork note + compensation copy; commit `6e515c8`; **`git push origin master`** succeeded (pre-push ran `verify:ci` + `test:scoring`).
7. **Handoff artifacts** — Wrote full `git status` / `git log -20` / `git diff --stat` to `docs/handoff-2026-04-12-git-*.txt`; commit `8079ec4`; pushed to `origin/master`.

---

## 2. Files created or modified (by theme)

### Pushed to `origin/master` (verify with `git show <commit> --name-only`)

| Commit | Paths | Purpose |
|--------|--------|---------|
| `d782e91` | `scripts/lib/scoring-core.mjs`, `scripts/generate-dashboard.mjs`, `dashboard/internal/data/work_arrangement.go`, `dashboard/internal/data/work_arrangement_test.go`, `dashboard/internal/ui/screens/pipeline.go`, `tests/scoring-core.test.mjs`, `README.md`, `docs/SYSTEM-STATUS.md`, `dashboard.html` | Location-aware priority + TUI focus sort + tests + regenerated HTML |
| `6e515c8` | `config/profile.example.yml` | Document sort bias in example profile |
| `8079ec4` | `docs/handoff-2026-04-12-git-status.txt`, `docs/handoff-2026-04-12-git-log.txt`, `docs/handoff-2026-04-12-git-diff-stat.txt` | Full git snapshots for this handoff |

### Present on disk but **not** on `origin/master` (as of handoff)

Git reports these as **untracked** or otherwise absent from remote — **next session should reconcile** (add, commit, push) if they are intended to ship:

- **Dashboard / ops docs:** `docs/WHICH-DASHBOARD-WHEN.md`, `docs/DASHBOARD-HTML-PANELS.md`, `docs/DASHBOARD-TUI-UPSTREAM-PARITY.md`, `docs/UPSTREAM-DRIFT.md`, and related edits to `docs/MAINTENANCE-RITUALS.md`, `CONTRIBUTING.md`, `CLAUDE.md` (if still modified locally).
- **CI:** entire `.github/workflows/` tree exists locally (e.g. `verify.yml` with `go vet`) but **`origin/master` has no `.github/workflows/verify.yml`** per `git cat-file`.
- **Local-only profile:** `config/profile.yml` (gitignored) holds Minneapolis narrative updates; **not** in any commit.

### Large local working tree

Hundreds of **modified** paths under `data/`, `modes/`, `scripts/`, etc. (see full `git diff --stat` in §9). Treat as **separate from** the focused commits above unless you intentionally batch them.

---

## 3. Current state

| Area | State |
|------|--------|
| **Remote `master`** | Includes through **`8079ec4`** (handoff git text files) after last successful push. |
| **Working tree** | **Very dirty**: ~903 files with unstaged changes vs `HEAD` per `git diff --stat`; many **untracked** paths (including `.github/workflows/`, multiple `docs/*.md`, large `data/` trees). |
| **Servers / daemons** | No long-running dev servers were started in this session. |
| **Verification** | Last successful runs in-session: `pnpm run verify:all`, `pnpm run test:scoring`, `go test ./...` (dashboard). Pre-push hook ran `verify:ci` + tests before push. |
| **Broken** | Nothing identified as broken in the **pushed** slice. **Risk:** local-only CI/docs drift from GitHub if workflows never pushed. |

---

## 4. In-progress work

- **Reconciling local vs remote:** Many valuable files (dashboard operator docs, workflows) are **on disk** but **not** on `origin/master`. Next session should decide: commit + push, or `.gitignore` / remove duplicates.
- **Optional upstream audit:** `docs/DASHBOARD-TUI-UPSTREAM-PARITY.md` includes an empty **Audit log** table — still to be filled after `git fetch` + `git diff upstream/main -- dashboard/`.
- **Large data batch:** Modified `data/company-intel/`, `data/prefilter-results/`, etc. — unclear if intentional single commit or noise; needs human triage before any wholesale `git add`.

---

## 5. Blockers discovered

| Blocker | Detail |
|---------|--------|
| **`config/profile.yml` gitignored** | Personal narrative (e.g. Minneapolis ordering language) does not travel via git; only `config/profile.example.yml` was updated on remote. |
| **Docs / CI not on remote** | `docs/WHICH-DASHBOARD-WHEN.md` and peers, and `.github/workflows/`, are missing from `origin/master` while present locally — continuity risk for clones and GitHub Actions. |
| **Commit oddity (historical)** | Commit `d782e91` message listed some paths as `create mode` for files that may have pre-existed elsewhere — verify history if auditing blame. |

---

## 6. Key decisions made

| Topic | Decision |
|-------|----------|
| **Dual dashboards** | Keep **both** HTML and TUI; document “which when” and weekly rhythm (in local `WHICH-DASHBOARD-WHEN.md` when committed). |
| **Work arrangement buckets** | `onsite_hybrid` (hybrid, on-site language, MSP keywords) vs `remote` vs `unknown`. Optional-hybrid JDs classify as **hybrid** if the word “hybrid” appears (beats pure remote phrase). |
| **Multipliers** | `onsite_hybrid`: **×1.06**; `remote`: **×0.92**; `unknown`: **×1.0** — constants in `LOCATION_PRIORITY` in `scoring-core.mjs`; **keep in sync** with `dashboard/internal/data/work_arrangement.go`. |
| **High remote still wins mid hybrid** | `focusSortKey = score × multiplier` preserves strong remote scores (e.g. 5.0 remote vs 4.0 hybrid). |
| **TUI default sort** | **`focus`** first in cycle; **`s`** cycles `focus → score → date → company → status`. |
| **Dashboard Priority** | `computeApplicationPriority` multiplies the existing formula by `locationMultiplier`; apply queue + “top opportunities” sort by **priorityScore**; report **Remote** / **TL;DR** / **Why** parsed in `readReport()` for classification. |
| **CI** | `go vet ./...` before `go test` in local `verify.yml` (must be **pushed** to enable on GitHub). |

---

## 7. TODO items (planned, not started or incomplete)

- [ ] **Commit and push** untracked operator docs (`WHICH-DASHBOARD-WHEN.md`, `DASHBOARD-HTML-PANELS.md`, `DASHBOARD-TUI-UPSTREAM-PARITY.md`, `UPSTREAM-DRIFT.md`) and any intended `MAINTENANCE-RITUALS.md` / `CONTRIBUTING.md` / `CLAUDE.md` edits.
- [ ] **Commit and push** `.github/workflows/verify.yml` (and siblings) so CI matches local.
- [ ] Run **upstream `dashboard/` diff** and fill audit table in `DASHBOARD-TUI-UPSTREAM-PARITY.md`.
- [ ] Optional: YAML-driven multipliers (currently hardcoded) if Matt wants tuning without code edits.
- [ ] Optional: extend classification with more MSP suburbs or employer-specific patterns after real JD misfires.
- [ ] Triage **903-file** `git diff` — decide keep / revert / split commits.

---

## 8. Full to-do list (agenda snapshot)

There is **no active in-editor todo list** carried from Cursor for this handoff. Completed plan todos (from earlier in the thread) included: dashboard roadmap docs, next-steps ritual docs, work-mode implementation, profile example push.

**Suggested consolidated backlog** = §7 checkboxes above.

---

## 9. Git state

Captured for handoff (see commit `8079ec4` for exact bytes). Raw outputs (complete, unabridged):

| Artifact | Path |
|----------|------|
| `git status` | [docs/handoff-2026-04-12-git-status.txt](handoff-2026-04-12-git-status.txt) |
| `git log --oneline -20` | [docs/handoff-2026-04-12-git-log.txt](handoff-2026-04-12-git-log.txt) |
| `git diff --stat` | [docs/handoff-2026-04-12-git-diff-stat.txt](handoff-2026-04-12-git-diff-stat.txt) |

### Inline: `git log --oneline -20` (duplicate for quick read; re-run locally for freshness)

```
8079ec4 docs: exhaustive session handoff 2026-04-12 with git artifacts
6e515c8 docs: note work-mode sort bias in profile example compensation copy
d782e91 feat: prioritize hybrid and MSP-local roles over remote in sorts
18bbe58 check
64ff445 commit all
5e11fe7 feat(submit-v14): profile-fields loader + Greenhouse batch submitter
71ec7b0 feat(scan-v14): add iCIMS, Workable, BuiltIn fetchers + WorkDay crash safety wrap
82cef5c feat(dashboard-v14): response tracker with daily goal, funnel, follow-up queue, channel performance
462c452 feat(intel): Agility Robotics comprehensive intel with verified Greenhouse API path
4707fd3 docs(status): add discovery findings to 2026-04-10 report
530fd4e feat(reports): 2026-04-10 status report + apply-readiness checklist
5e0d0de feat(scan): 2026-04-10 accumulation — ~250 prefilter cards from background scans
c4e7f17 chore(gitignore): exclude scan-scheduler.log
298ba11 feat(outreach): add 5 templates for ready-to-apply roles
56f5420 feat(intel): add 10 company research stubs
5bd5b47 feat(dashboard): expand Apply Queue section and metrics (+948 lines)
6ed4959 fix(prefilter): status field update for 5 v12 cards
bf206ec feat: 2026-04-09 deep-dive — 163 company-intel, 51 prefilter cards, automation scripts, Firecrawl fix
ed41fb7 feat(career-ops): batch evaluate 52 prefilter cards, add reports 024-031, expand apply queue to 17 roles
1bd37ca feat(career-ops): batch evaluate 52 prefilter cards, add 8 A-F reports (024-031), expand apply queue to 15 roles
6bad077 feat: dashboard Apply Queue, expanded job board keywords, V4C.ai upgraded
```

### Inline: `git diff --stat` summary line

From the captured file footer: **`903 files changed, 3185 insertions(+), 485 deletions(-)`** — see the linked file for per-path lines.

### Branch relationship

After the last push in this session: **`master`** matched **`origin/master`** at **`8079ec4`**, with large unstaged/untracked local deltas as in the `git status` snapshot file.

---

## First actions for the next session

1. Open [docs/handoff-2026-04-12-git-status.txt](handoff-2026-04-12-git-status.txt) and decide what must land on `origin/master` first (workflows + operator docs are high leverage).
2. Run `pnpm run verify:all` after any merge of local vs remote.
3. If enabling GitHub Actions: ensure `.github/workflows/*.yml` is committed and default branch name matches workflow `on.push.branches`.

---

*Re-run the three git commands before relying on numbers — the working tree may have changed.*
