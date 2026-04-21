# Policy — MCP Dependencies

Audience: anyone adding or tuning an MCP-based integration in career-ops. Read before shipping a new MCP source. Read again if an existing MCP starts misbehaving.

---

## 1. The problem this policy addresses

MCP (Model Context Protocol) servers integrated via `uvx <package>@latest` are **fragile external dependencies** with two properties that don't appear in typical npm/pip dependencies:

1. **Version drift.** `@latest` auto-updates on every fresh install. If upstream changes the tool schema, argument shape, or return format, our integration breaks silently — no package-lock signal, no explicit upgrade trigger.
2. **Local auth state is the dependency.** MCPs like `linkedin-scraper-mcp` store authenticated session in a local Chromium profile. Losing that state = mandatory re-auth (often headful, often manual). Unlike API tokens that can be provisioned via CI, this is a human-in-the-loop recovery.

Both properties mean MCP integrations need explicit version-pinning + auth-state backup practices. This policy codifies those.

---

## 2. Version pinning

### 2.1 Rule

**Production cron paths MUST NOT use `@latest`.** Pin to a specific version. Development and ad-hoc scripts may use `@latest`.

### 2.2 How to pin

Find the current working version:
```bash
uvx --quiet linkedin-scraper-mcp@latest --version
# Or check the directory:
ls ~/.cache/uv/tools/linkedin-scraper-mcp/
```

In the script that invokes it, change:
```js
new McpClient('uvx', ['linkedin-scraper-mcp@latest'], ...)
```
to:
```js
new McpClient('uvx', ['linkedin-scraper-mcp@0.3.1'], ...)  // pinned 2026-04-21
```

Comment with the date pinned, so later sessions know how stale the pin is.

### 2.3 Unpinning / upgrading

Weekly check (add to Matt's weekly maintenance):
```bash
# Compare pinned versions in scripts against upstream latest:
grep -rnE "@[0-9]+\.[0-9]+\.[0-9]+" scripts/ | grep -E "(linkedin-scraper|indeed-scraper|other-mcp)"
```

When upgrading:
1. Read upstream CHANGELOG / release notes.
2. Run the new version manually: `uvx <package>@<new-version> --help`.
3. Run the wrapper script in isolation: `node scripts/scan-<source>.mjs --live`.
4. Confirm expected output.
5. Update the pin.
6. Commit with message: `chore(mcp): pin <package> to <version> — <reason>`.
7. Monitor first 3 cron runs.

### 2.4 Emergency unpin

If the upstream MCP has a critical fix and our pin blocks it:
1. Unpin to `@latest` in the script.
2. Run manually to confirm it works.
3. Commit: `chore(mcp): temporarily unpin <package> — upstream fix needed, will repin`.
4. After 48 hours of stable runs, re-pin to the new version.

---

## 3. Auth state backup and restore

### 3.1 What to back up

For any MCP with local auth state:
- The entire profile directory (e.g., `~/.linkedin-mcp/profile/`).
- Not the `invalid-state-*/` snapshots (they're noise).

### 3.2 When to back up

- **Manual trigger:** before any re-auth attempt (don't overwrite a working session with a half-completed login).
- **Scheduled:** weekly. Keep 4 generations.
- **Pre-upgrade:** before unpinning/upgrading an MCP version — if the upgrade corrupts state, you have a fallback.

### 3.3 How to back up (Windows)

Use the backup script:

```powershell
powershell -NoProfile -File scripts/backup-mcp-profile.ps1           # keep 4 (default)
powershell -NoProfile -File scripts/backup-mcp-profile.ps1 -Keep 8   # keep 8
powershell -NoProfile -File scripts/backup-mcp-profile.ps1 -DryRun   # preview only
```

The script:
- Writes to `$env:USERPROFILE\.linkedin-mcp-backups\profile-YYYYMMDD-HHMM\`
- Excludes `invalid-state-*/` snapshots (per §3.1)
- Uses robocopy with `/R:1 /W:1` so it won't hang on a locked `Cookies` DB
- Prunes old backups beyond `-Keep` N (default 4)

Exit codes: 0 success, 1 source missing, 2 destination write failed, 3 prune warning (backup still succeeded).

If robocopy is unavailable, the script falls back to `Copy-Item`.

Equivalent raw PowerShell (no retention):

```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmm"
$src = "$env:USERPROFILE\.linkedin-mcp\profile"
$dst = "$env:USERPROFILE\.linkedin-mcp-backups\profile-$ts"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path $src -Destination $dst -Recurse -Force
```

### 3.4 How to restore

```powershell
$backup = Get-ChildItem "$env:USERPROFILE\.linkedin-mcp-backups\" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Remove-Item -Path "$env:USERPROFILE\.linkedin-mcp\profile" -Recurse -Force
Copy-Item -Path $backup.FullName -Destination "$env:USERPROFILE\.linkedin-mcp\profile" -Recurse -Force
```

Validate by running `node scripts/scan-linkedin-mcp.mjs --live` — should complete without auth errors.

---

## 4. Drift detection

### 4.1 Automated check (aspirational, not yet implemented)

A weekly task should:
1. Run `uvx --upgrade-check <package>` for each MCP (command varies by uv version).
2. Report available updates.
3. Flag in dashboard or notify.

### 4.2 Manual check

Add to Matt's weekly routine:
```bash
# List all MCP versions referenced in scripts
grep -rhE "@[0-9]+\.[0-9]+\.[0-9]+" scripts/ | sort -u

# For each, check upstream
npm show <package> version   # for npm-published MCPs
pip show <package>           # for pip-published MCPs
```

### 4.3 Detecting silent breakage

Even with a pinned version, upstream could modify the published artifact. Guard against:
- **Checksum monitoring:** record the `sha256` of the installed MCP's main entry point; alert on change.
- **Schema snapshot testing:** the MCP's `list_tools` response should remain stable; snapshot and diff weekly.

Neither is implemented yet. Tracked in Phase 3 follow-on TODOs of the 2026-04-20 night handoff.

---

## 5. Incident response for upstream behavior change

If a pinned MCP starts failing suddenly:

1. **Assess:** is the failure consistent with a behavior change (e.g., tool schema changed, argument renamed) vs. an environmental issue (profile lock, rate limit)?
2. **Check upstream:**
   - GitHub issues / releases for the MCP package.
   - Twitter/Hacker News search for the package name + "broken" / "down".
3. **If upstream has a fix:**
   - Unpin to the fix version (§2.3 or §2.4).
   - Monitor 3 runs.
   - Re-pin.
4. **If no upstream fix:**
   - Document in `docs/POSTMORTEMS-scan-pipeline.md`.
   - Consider adapting our wrapper to the new behavior.
   - Consider temporarily disabling the source (comment out in portals.yml).

---

## 6. Adding a new MCP — checklist

When integrating a new MCP source:

1. ☐ Pin the version from day one (never ship with `@latest` in cron).
2. ☐ Document auth-state location in this policy's §3 + in the source's scanner script.
3. ☐ Create a backup script (or wire into `scripts/backup-mcp-profile.ps1`).
4. ☐ Add a section to `docs/RUNBOOK-<source>.md` — or to the shared runbook — covering:
   - How to re-auth
   - Where state lives
   - Common failure modes
5. ☐ Register preflight (Phase 3.2 of the 2026-04-20 night handoff) — `scripts/lib/<source>-preflight.mjs`.
6. ☐ Emit completion events with `{status, retried, errors[]}` so partial_success propagation works (Phase 3.3).
7. ☐ Add to source-health registry (Phase 3.4) — just emit events with the right `scanner.<name>.completed` name.
8. ☐ Add to `docs/ARCHITECTURE-scan-pipeline.md` §2 source failure-domain table with baseline reliability estimate.

---

## 7. Currently tracked MCP dependencies

| Package | Pinned? | Version | Pin date | Owner script | Auth state? |
|---------|---------|---------|----------|--------------|-------------|
| `linkedin-scraper-mcp` | ✅ | `4.9.3` | 2026-04-20 | `scripts/scan-linkedin-mcp.mjs:119` | Yes — `~/.linkedin-mcp/profile/` |
| (future Indeed MCP?) | — | — | — | `scripts/scan-indeed.mjs` (currently Playwright, not MCP) | — |

**Next weekly check:** 2026-04-27. Compare upstream `pip index versions linkedin-scraper-mcp` against pinned 4.9.3; upgrade per §2.3 if a new version is available and released notes look clean.

---

## 8. Why this policy is short

This policy codifies three practices: pin versions, back up auth state, detect drift. Everything else is standard dependency hygiene that applies to any third-party code. The three above are MCP-specific because MCPs uniquely combine `@latest`-by-default distribution with local-state dependencies.

If the policy grows to 10+ sections, something has gone wrong — either MCP tooling has matured (good, simplify) or we've over-engineered (bad, cut).

---

*See also: `docs/AI-SESSION-CONTINUITY-2026-04-20-night.md` §18.3; `docs/RUNBOOK-linkedin-mcp.md` §4 session-expired recovery; `docs/ARCHITECTURE-scan-pipeline.md` §9 adding a new source.*
