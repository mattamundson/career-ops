# Contributing to Career-Ops

Thanks for your interest in contributing! Career-Ops is built with Claude Code, and you can use it for development too.

## Quick Start

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test with a fresh clone (see [docs/SETUP.md](docs/SETUP.md))
5. Commit and push
6. Open a Pull Request

## What to Contribute

**Good first contributions:**
- Add companies to `templates/portals.example.yml`
- Translate modes to other languages
- Improve documentation
- Add example CVs for different roles (in `examples/`)
- Report bugs via [Issues](https://github.com/santifer/career-ops/issues)

**Bigger contributions:**
- New evaluation dimensions or scoring logic
- Dashboard TUI features (in `dashboard/`)
- New skill modes (in `modes/`)
- Script improvements (`.mjs` utilities)

## Guidelines

- Keep modes language-agnostic when possible (Claude handles both EN and ES)
- Scripts should handle missing files gracefully (check `existsSync` before `readFileSync`)
- Dashboard changes require `go build` — test with real data before submitting
- Don't commit personal data (cv.md, profile.yml, applications.md, reports/)

## Development

```bash
# Scripts
node verify-pipeline.mjs     # Health check
node cv-sync-check.mjs        # Config check

# Dashboard
cd dashboard && go build -o career-dashboard .
./career-dashboard -path ..
```

### Git hooks

Husky runs `.husky/pre-commit` and `.husky/pre-push` automatically.

- **pre-commit** — runs `pnpm run secrets:check`, then regenerates `dashboard.html` when a tracked dashboard input is staged (`data/responses.md`, `dashboard.html` itself, `scripts/generate-dashboard.mjs`, or its `scripts/lib/*.mjs` deps). Primary data sources (`applications.md`, `pipeline.md`, `scan-history.tsv`) are gitignored and local-only — regenerate manually via `pnpm run dashboard` when those change.
- **pre-push** — runs `pnpm run verify:ci` and `pnpm test`.

### Windows and Go (`dashboard/`)

On some Windows machines, `go test ./...` or `go vet ./...` may be blocked by enterprise Application Control while `go build` still works. The canonical gate for dashboard changes is **CI** (Linux job in `.github/workflows/verify.yml`: `go vet` then `go test`). If local tests fail for policy reasons, push a branch and rely on the workflow, or run the same commands in WSL.

### Operator surfaces (this fork)

HTML `dashboard.html` vs Go TUI, refresh commands, and what dashboards omit: [docs/WHICH-DASHBOARD-WHEN.md](docs/WHICH-DASHBOARD-WHEN.md).

Before claiming a job posting is still live in docs or outreach, verify the JD URL in a real browser session (Playwright or manual)—not search snippets alone. See `CLAUDE.md` offer verification rules.

## Need Help?

- [Open an issue](https://github.com/santifer/career-ops/issues)
- [Read the architecture docs](docs/ARCHITECTURE.md)
- Built by [santifer](https://santifer.io)
