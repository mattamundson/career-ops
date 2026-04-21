# Runbook — LinkedIn MCP Scan Failures

Audience: Claude or Matt responding to a LinkedIn MCP scan failure. If you're firefighting at 6am, start at §2 symptoms table and triage from there. Read §1 only if you have time.

---

## 1. Context (read once, not during an incident)

LinkedIn is one of 10+ sources in the career-ops scan pipeline. It's the only source that uses an MCP (Model Context Protocol) server rather than an API or Playwright. The MCP is `linkedin-scraper-mcp`, pulled on-demand via `uvx linkedin-scraper-mcp@latest` and spawned as a stdio JSON-RPC child process by `scripts/scan-linkedin-mcp.mjs`.

**Why this source fails more than others:**
- Uses a local Chromium profile at `%USERPROFILE%\.linkedin-mcp\` for session persistence (cookies, auth tokens).
- Needs to **move** the profile directory during startup — and Windows file-lock semantics on SQLite Cookies DB make that brittle.
- Auto-updates via `@latest` — upstream behavior changes propagate silently.
- Holds authenticated session in local Chrome profile; re-auth requires headful browser flow.

**Typical failure modes ranked by frequency:**
1. Profile-lock (WinError 32) — Chrome/Defender/OneDrive holding `Cookies` file. Tonight's fix (42f5cd4) handles most cases automatically.
2. Session expired — 30-day auth token aged out. Requires headful re-login.
3. Anti-bot triggered — too-frequent scraping trips LinkedIn's detection. Wait, reduce query count.
4. Rate limit — HTTP 429. Back off 10 min.
5. Upstream MCP breakage — `@latest` pulled a broken version.

---

## 2. Symptoms Table (triage here)

| Symptom | Likely cause | Go to |
|---------|--------------|-------|
| `WinError 32`, `PermissionError`, "Stored runtime profile is invalid" | Profile lock | §3 |
| "no valid LinkedIn session", "login in progress", "not authenticated" | Session expired | §4 |
| "captcha", "Access Denied" (without PermissionError) | Anti-bot | §5 |
| "HTTP 429", "rate limit" | Rate limit | §6 |
| uvx install error, "No module named", upstream traceback | Upstream MCP breakage | §7 |
| `.linkedin-mcp/` is >1GB | Disk blowout | §8 |
| `scanner.linkedin_mcp.completed` event missing entirely | MCP subprocess didn't start | §9 |
| `status: partial_success` with `retried: true` | Retry path fired — investigate recurrence | §10 |

---

## 3. Profile-lock failure (the most common)

### Triage flowchart

```
Error stderr contains "PermissionError" or "WinError 32"?
├─ Yes, preflight killed 0 Chrome processes → non-Chrome lock (§3.3)
├─ Yes, preflight killed 1+ Chrome processes AND retry succeeded → normal, monitor only (§3.1)
├─ Yes, preflight killed 1+ AND retry also failed → partial Chrome cleanup or fast re-lock (§3.2)
└─ No → return to §2 symptoms table
```

### §3.1 — Preflight caught it (happy path)

Tonight's fix (commit `42f5cd4`) makes this the common case. What happened:
1. Scan spawned LinkedIn MCP.
2. First attempt hit `PermissionError` on `.linkedin-mcp/profile/Default/Network/Cookies`.
3. `isProfileLockError()` matched.
4. Preflight ran: killed N Chrome processes with `*linkedin-mcp*` in CommandLine.
5. Slept 5s for kernel handle cleanup.
6. Retried scan — succeeded.
7. Event emitted with `status: 'partial'` and `retried: true` (per Phase 3.3 target; currently `status: 'success'` until Phase 3.3 lands).

**Action:** None required. Log the incident. If frequency is >1/week, investigate root cause (§3.3).

### §3.2 — Preflight ran but retry also failed

The kill was incomplete, or a new lock acquired between preflight and retry.

**Diagnose:**
1. Re-run manually with full visibility: `node scripts/scan-linkedin-mcp.mjs --live 2>&1 | tee /tmp/linkedin-debug.log`
2. Inspect how many Chromes the preflight killed: `grep "killed" /tmp/linkedin-debug.log`.
3. If 0 kills → non-Chrome lock; go to §3.3.
4. If 1+ kills but still fails → Chrome respawning or AV racing. Add a second retry (temporary, as a workaround):
   ```bash
   # Run this as a one-off to validate the fix direction:
   for i in 1 2 3; do
     node scripts/scan-linkedin-mcp.mjs --live && break
     sleep 10
   done
   ```
5. If retries eventually succeed after 3+ iterations → the lock is transient; Scenario §3.3 is needed for durability.

**Fix:** Increase preflight sleep from 5s to 15s; or add a second retry to the script. Neither is ideal — if you're here twice, escalate to §3.3.

### §3.3 — Non-Chrome lock holder

Preflight finds no Chrome to kill, but lock persists. Culprit is Defender, OneDrive, or another process.

**Diagnose:**
1. Install Sysinternals handle.exe (see §22.4 of handoff).
2. Trigger the scan in one terminal: `node scripts/scan-linkedin-mcp.mjs --live`.
3. In another terminal, during the hang, run: `handle.exe "C:\Users\mattm\.linkedin-mcp\profile\Default\Network\Cookies"`.
4. Observe the holder process name.

**Fix by holder:**

| Holder | Fix |
|--------|-----|
| `MsMpEng.exe` (Defender) | Admin PowerShell: `Add-MpPreference -ExclusionPath "$env:USERPROFILE\.linkedin-mcp"` |
| `OneDrive.exe` | OneDrive Settings → Backup → exclude `.linkedin-mcp` |
| `node.exe` (another scan running) | Kill the other scan; add mutex to auto-scan.mjs (future work) |
| `python.exe` (unrelated) | Identify which Python, kill if safe |
| `SearchIndexer.exe` | Admin: `Add-MpPreference -ExclusionPath` as above — also excludes from indexing |

**Verification:** After fix, run `node scripts/scan-linkedin-mcp.mjs --live`. Should complete in <30s with zero retries.

---

## 4. Session expired

**Symptom:** stderr shows "no valid LinkedIn session", "login in progress", "not authenticated". No PermissionError.

**Root cause:** LinkedIn's auth token in the MCP profile aged out (~30 days). The MCP needs a fresh login via headful browser.

**Fix:**

1. **Backup current profile** before re-auth:
   ```bash
   cp -r ~/.linkedin-mcp/profile ~/.linkedin-mcp/profile-backup-$(date +%Y%m%d)
   ```
2. Run the MCP in headful/interactive mode to trigger browser:
   ```bash
   uvx linkedin-scraper-mcp@latest --interactive
   ```
   (If `--interactive` is wrong flag, check `uvx linkedin-scraper-mcp@latest --help`.)
3. Complete LinkedIn login in the spawned browser — email, password, any MFA/captcha.
4. Verify session persists: `node scripts/scan-linkedin-mcp.mjs --live` should succeed.

**Verification:** Subsequent scan completes cleanly. Remove backup after 7 days of stable runs.

---

## 5. Anti-bot triggered

**Symptom:** Error includes "captcha", "Access Denied" but not PermissionError. Or: scan completes but returns 0 jobs with no clear error.

**Root cause:** LinkedIn detected scraper-like behavior. Trips on IP reputation, query rate, or behavioral fingerprint.

**Fix:**

1. **Immediately:** stop all LinkedIn scraping for 6-12 hours. Don't retry — it worsens the flag.
2. **Reduce query count** in next scan. Current default is ~8 queries per scan. Try 4.
3. **Add jitter** between queries (2-5s random). Check `scan-linkedin-mcp.mjs` for `await sleep(...)` between queries — if absent, add.
4. **Re-auth** (§4) — sometimes a fresh login resets the flag.
5. If persists, consider rotating the LinkedIn account used.

---

## 6. Rate limit (HTTP 429)

**Symptom:** stderr "HTTP 429", "rate limit", "too many requests".

**Fix:**

1. Wait 10 minutes. Retry manually.
2. If persists, wait 1 hour. Retry.
3. Reduce query count in `portals.yml` LinkedIn query set.

---

## 7. Upstream MCP breakage

**Symptom:** `uvx` error, Python traceback, "No module named", or dramatic stderr volume.

**Root cause:** `linkedin-scraper-mcp@latest` pulled a broken version.

**Fix:**

1. Find the last-known-good version: check `~/.cache/uv/` history or prior successful runs' stderr for a version string.
2. Pin to that version:
   ```bash
   # In scripts/scan-linkedin-mcp.mjs, change:
   new McpClient('uvx', ['linkedin-scraper-mcp@latest'], ...)
   # To:
   new McpClient('uvx', ['linkedin-scraper-mcp@0.3.1'], ...)  # or last-good
   ```
3. Open an issue on the MCP's upstream repo describing the breakage.
4. Once upstream fixes: unpin (revert to `@latest`) OR pin to the new good version.

See `docs/POLICY-mcp-dependencies.md` for the broader version-pinning policy.

---

## 8. Disk blowout

See handoff §20.3 for the full scenario. Short version:

1. List snapshots: `ls -la ~/.linkedin-mcp/ | grep invalid-state`
2. Manual prune: `node -e "import('./scripts/scan-linkedin-mcp.mjs').then(m => m.pruneInvalidStateSnapshots?.())"` (requires Phase 3.1 main-guard + export; until then, `rm -rf ~/.linkedin-mcp/invalid-state-*` except newest by mtime).
3. If growing fast (>1 snapshot/day), escalate to §3 — something is forcing repeated invalid-state events.

---

## 9. MCP subprocess never started

**Symptom:** No `scanner.linkedin_mcp.completed` event in `data/events/YYYY-MM-DD.jsonl`. Orchestrator may log `exit code 1` or `spawn ENOENT`.

**Diagnose:**
1. `uvx --help` — should succeed. If not, `uv` not installed.
2. `uvx linkedin-scraper-mcp@latest --help` — should return usage. If "network error", check internet.
3. `node scripts/scan-linkedin-mcp.mjs --live` — standalone. Check stderr.

**Fix by cause:**
- `uv` not installed: `pipx install uv` or `pip install uv`.
- Network: wait + retry.
- Script import error: `node --check scripts/scan-linkedin-mcp.mjs`.

---

## 10. Retry path fired — was it a one-off or pattern?

**Symptom:** Run summary shows `status: partial_success`, event payload has `retried: true` (Phase 3.3 behavior).

**Action (not incident response — post-facto analysis):**

1. How frequently is retry firing?
   ```bash
   grep -c '"retried":true' data/events/2026-04-*.jsonl | awk -F: '{sum+=$2} END {print sum}'
   ```
2. Against total runs in the same period:
   ```bash
   grep -c 'scanner.linkedin_mcp.completed' data/events/2026-04-*.jsonl | awk -F: '{sum+=$2} END {print sum}'
   ```
3. Retry rate = (retry count) / (total runs). Thresholds:
   - <5% — normal. Transient AV / Defender races.
   - 5-20% — monitor. Add §3.3 Defender exclusion preemptively if not yet done.
   - >20% — durable root cause unaddressed. Escalate to full diagnosis (§3.3).

---

## 11. Postmortem Template

After any non-trivial incident, append to `docs/POSTMORTEMS-scan-pipeline.md` (create if needed) using this template:

```markdown
## YYYY-MM-DD — LinkedIn MCP — [symptom]

**Impact:** [which scan(s) affected, yield loss, user-visible impact]
**Duration:** [detected time → fixed time]
**Symptom:** [stderr excerpt, one line]
**Root cause:** [one paragraph]
**Fix:** [what was done]
**Prevention:** [code/policy change to prevent recurrence]
**Commits:** [hashes of fix commits]
**Artifacts:** [log file paths, event IDs]
```

---

## 12. When all else fails

1. Disable LinkedIn as a scan source temporarily:
   ```bash
   # In portals.yml, comment out the LinkedIn queries block for today's run.
   ```
2. Scan without LinkedIn; other sources continue.
3. Debug LinkedIn out-of-band.
4. Re-enable once validated.

Do NOT remove LinkedIn permanently — some postings only appear there.

---

*See also: `docs/AI-SESSION-CONTINUITY-2026-04-20-night.md` §15 diagnostic trees, §20 operational runbook, §22 environment specifics; `docs/ARCHITECTURE-scan-pipeline.md` for source-failure-domain context; `docs/POLICY-mcp-dependencies.md` for version pinning.*
