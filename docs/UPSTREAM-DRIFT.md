# Upstream drift (optional)

This fork diverged from [santifer/career-ops](https://github.com/santifer/career-ops) on purpose (English-only modes, Matt profile, `scripts/` layout, HTML dashboard, JobSpy/direct-board matrix, automation events, etc.). You do **not** need continuous merge parity.

## When to look upstream

- Security or dependency alerts on shared pieces (Go modules, Playwright, Node deps).
- A **scanner or integrity** idea ships upstream you want (`CHANGELOG.md`, `scan.mjs` vs your [`scripts/auto-scan.mjs`](../scripts/auto-scan.mjs)).
- Documentation patterns you want to reuse (without overwriting `CLAUDE.md` / profile).

## Lightweight rhythm (suggested)

1. **Quarterly** (or before a big refactor): `git fetch upstream` and skim `upstream/main` **CHANGELOG** and **README** diff.
2. **Cherry-pick** small commits or copy patterns manually—avoid wholesale merges into a dirty `data/` tree.
3. Log decisions in git commit messages: `docs: note upstream idea X deferred because Y`.

## Related

- [DASHBOARD-TUI-UPSTREAM-PARITY.md](DASHBOARD-TUI-UPSTREAM-PARITY.md) — focused `dashboard/` diff checklist  
- [SUPPORTED-JOB-SOURCES.md](SUPPORTED-JOB-SOURCES.md) — fork source-of-truth for boards  
