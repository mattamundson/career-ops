# Postmortems — Scan Pipeline

Chronological log of non-trivial scan-pipeline incidents. Append new entries at the top (newest first). Use the template at the bottom of this file.

---

## 2026-04-20 — LinkedIn MCP — profile-lock cascade (PermissionError → AuthenticationError)

**Impact:** LinkedIn source produced zero jobs on evening scan; all other sources healthy. No user-visible impact beyond LinkedIn query gap; JobSpy + Firecrawl covered.

**Duration:** Detected 19:57 CT, root-caused 20:02 CT (~5 min), fixed + committed 20:04 CT. No production outage — scan gracefully degraded.

**Symptom:** stderr cascade `AuthenticationError: Stored runtime profile is invalid` → `OSError` → `PermissionError: [WinError 32]` on `.linkedin-mcp\profile\Default\Network\Cookies`.

**Root cause:** Accumulated 914MB of `invalid-state-*` snapshots (4 days old) + transient Windows file-lock on SQLite Cookies DB. Defender or brief Chrome-process-exit race held `EXCLUSIVE_LOCK` on Cookies during the MCP's profile move. No stale Chrome process was identifiable at diagnosis time (see §12.6 of handoff — momentary-lock model).

**Fix:** Added preflight (`killStaleLinkedInChrome` + `pruneInvalidStateSnapshots`) and single retry on profile-lock detection. Both gracefully degrade to empty result so scan continues.

**Prevention:** Preflight now runs on every LinkedIn MCP invocation (via registered preflight registry). Retry covers transient lock races. Future: Defender exclusion on `.linkedin-mcp/` if recurrence persists (see `docs/RUNBOOK-linkedin-mcp.md` §3.3).

**Commits:** `42f5cd4` (primary fix), `3865fc9` (extract to lib), `c3bac67` (partial_success propagation), `e2e9d5a` (observability for recurrence detection).

**Artifacts:** `docs/AI-SESSION-CONTINUITY-2026-04-20-night.md` §2-§15 (exhaustive diagnosis narrative); `data/events/2026-04-20.jsonl` for raw events.

---

## Postmortem Template

Copy below for new entries. Place new entries at top of file.

```markdown
## YYYY-MM-DD — <source> — <short symptom>

**Impact:** [which scan(s) affected, yield loss, user-visible impact]

**Duration:** [detected time → fixed time]

**Symptom:** [stderr excerpt, one line]

**Root cause:** [one paragraph]

**Fix:** [what was done]

**Prevention:** [code/policy change to prevent recurrence, or why none is practical]

**Commits:** [hashes of fix commits]

**Artifacts:** [log file paths, event IDs, handoff doc references]
```

---

*See also: `docs/RUNBOOK-linkedin-mcp.md` for response procedures; `docs/ARCHITECTURE-scan-pipeline.md` for source failure-domain context.*
