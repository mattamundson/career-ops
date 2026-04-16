# Go TUI — optional upstream parity audit

Use this when you want to compare **only** [`dashboard/`](../dashboard/) against [santifer/career-ops](https://github.com/santifer/career-ops) without merging the whole fork.

## One-time setup

```bash
git remote add upstream https://github.com/santifer/career-ops.git   # skip if exists
git fetch upstream
```

## Diff (read-only)

```bash
git diff upstream/main -- dashboard/
```

Prefer a clean tree (or a spare worktree) so output is reviewable.

## Checklist — classify each difference

| Bucket | Question | Examples in this fork |
|--------|----------|------------------------|
| **Intentional** | Fork-specific UX or data paths? | `LastScannerHint` from `data/events/` ([`internal/data/automation_events.go`](../dashboard/internal/data/automation_events.go)); module path `career-ops/dashboard`; tracker column parsing fixes |
| **Accidental** | Regression vs upstream behavior? | Missing tab, broken sort, wrong status write — fix or file a note |
| **Structural** | File layout / dependency drift? | Upstream may keep scripts at repo root; this fork uses `scripts/` for Node — **not** a TUI concern unless imports broke |

## Verify locally after audit

```bash
cd dashboard
go vet ./...
go test ./...
go build -o career-dashboard .
./career-dashboard -path ..
```

On some Windows hosts `go test` may be blocked by Application Control; CI runs tests in Linux (see `.github/workflows/verify.yml`).

## Outcome

Keep a short note in your session log or PR description: **N files differ; M intentional; P follow-ups.** No need to maintain parity for parity’s sake—only fix accidental regressions and document intentional fork value.

## Audit log (fill after you run the diff)

Copy the header row into your notes or append below when you complete a pass.

| Date | `git diff` command | Files touched (approx.) | Intentional deltas | Accidental / follow-up | Notes / PR |
|------|-------------------|-------------------------|--------------------|-------------------------|------------|
| _YYYY-MM-DD_ | `git diff upstream/main -- dashboard/` | | | | |
