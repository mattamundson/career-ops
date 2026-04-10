#!/usr/bin/env bash
# backup-to-github.sh — Stage appropriate files and push to GitHub
# Usage: bash scripts/backup-to-github.sh "optional session summary"

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

SESSION_SUMMARY="${1:-session backup}"
TODAY=$(date +%Y-%m-%d)
COMMIT_MSG="chore: backup ${TODAY} — ${SESSION_SUMMARY}"

echo "=== career-ops GitHub Backup ==="
echo "Repo: $REPO_DIR"
echo "Commit: $COMMIT_MSG"
echo ""

# Stage modified tracked files (dashboard.html, apply-queue.md, prefilter-results changes)
git add -u

# Stage new content that should be committed
# company-intel research (valuable, not sensitive)
git add data/company-intel/ 2>/dev/null || true

# New prefilter result cards (evaluation work product)
git add data/prefilter-results/ 2>/dev/null || true

# Priority actions and pipeline state docs
git add data/priority-actions-*.md 2>/dev/null || true

# outreach data
git add data/outreach/ 2>/dev/null || true

# task manifest (local Claude Code state — optional, included for continuity)
git add .claude/task-manifest.json 2>/dev/null || true

# Explicitly exclude handoff docs (session artifacts, not source)
# .gitignore already handles: .env, node_modules, scan-history.tsv, output/, reports/
# Handoff *.md files in root are NOT in .gitignore — skip them manually here

echo ""
echo "=== Staged files ==="
git diff --cached --name-only

echo ""
echo "=== Committing ==="
git commit -m "$COMMIT_MSG" || { echo "Nothing to commit."; exit 0; }

echo ""
echo "=== Pushing to origin ==="
git push origin master

echo ""
echo "Done. View at: https://github.com/mattamundson/career-ops"
