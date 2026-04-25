# Git strategy for high-volume `data/`

The repo generates many markdown files under `data/company-intel/`, `data/prefilter-results/`, and similar paths. This document is the **decision record** for how to commit them without drowning in noise.

## Windows paths

- Prefer **forward slashes** in commands and documentation (`docs/foo.md`, not `docs\foo.md`).
- Git on Windows usually maps `.claude/skills/...` and `.claude\skills\...` to one working tree path; if your tool shows duplicates in `git status`, run `git status` from a terminal and avoid creating a second physical copy of the same skill file.

## What to commit

| Path | Recommendation |
|------|----------------|
| `data/applications.md` | Commit after meaningful tracker updates (merge-tracker or status edits). |
| `data/pipeline.md` | Commit when triaged or batch-updated. |
| `data/apply-queue.md`, `data/*-report*.md`, `data/reconciliation*.md` | Commit when you use them as operational truth. |
| `data/company-intel/*.md` | **Batch commit** by date or theme (e.g. `docs: company intel batch 2026-04-12`) OR omit if treated as scratch — but then clones lose research. |
| `data/prefilter-results/*.md` | Same as company-intel: batch commit or treat as ephemeral (your call). |
| `reports/*.md` | **Gitignored** by default — backups are local only. |

## What not to commit

- Secrets: `.env`, OAuth tokens, cookies, recruiter portal passwords.
- Huge binaries unless intentional.
- **`*.bak`** — created by `pipeline:dedupe` / `pipeline:prune-tracked --apply`; gitignored (see [MAINTENANCE-RITUALS.md](MAINTENANCE-RITUALS.md)).
- Machine-local editor noise (optional): add to `.git/info/exclude` if personal only.

## Practical workflow

1. Stage in slices: `git add data/applications.md data/apply-queue.md` first, then intel batches.
2. Run `pnpm run verify:all` before pushing — see [MAINTENANCE-RITUALS.md](MAINTENANCE-RITUALS.md).
3. Use `git diff --stat` before commit to ensure the diff matches intent.
4. If `git status` is too large to read, use `git status -uno` or path-scoped status: `git status data/applications.md`.

## Reports and CI

Because `reports/*.md` is gitignored, default verification treats missing report files as warnings:

```bash
pnpm run verify
```

Full strict check on a machine that already has `reports/*.md` locally:

```bash
pnpm run verify:strict
```
