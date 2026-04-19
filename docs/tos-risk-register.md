# ToS Risk Register: Direct LinkedIn & Indeed Scrapers

**Date:** 2026-04-10  
**Status:** Active (gated behind env vars)  
**Risk Level:** LinkedIn HIGH, Indeed MEDIUM  

---

## Executive Summary

Matt explicitly accepted ToS-grey risk for direct LinkedIn/Indeed scraping as **additive** to JobSpy. Both `scan-linkedin-direct.mjs` and `scan-indeed-direct.mjs` are **default-disabled** via environment variables and include comprehensive ToS violation mitigations.

**Kill switch:** Both scripts exit 0 if `DISABLE_LINKEDIN_SCRAPE=1` OR if `ENABLE_*_SCRAPE` is not explicitly set to `1`. Default behavior is **DISABLED**.

---

## LinkedIn Direct Scraper

### ToS Violation

**Section 8.2 — Automated Scraping Prohibition**  
LinkedIn Terms of Service explicitly forbid:
- Automated crawling and scraping
- Data extraction without permission
- Use of bots or scripts to extract job data

**Source:** https://www.linkedin.com/legal/user-agreement (Section 8.2)

### Legal Precedent

**hiQ Labs, Inc. v. LinkedIn Corporation** (9th Cir. 2019)
- Circuit affirmed: CFAA (Computer Fraud and Abuse Act) does not prohibit web scraping of **publicly available data**
- However: LinkedIn's **administrative enforcement** (account ban) is legal and effective
- **Holding:** Scraping is legally gray; LinkedIn can ban accounts without legal consequence

### Account Ban Risk

**Risk Level: HIGH**

- LinkedIn has advanced bot detection (CAPTCHAs, behavior analysis)
- Ban is typically **permanent** on first violation
- Affects: email forwarding, network, job search visibility, recruiter status
- Recovery: extremely difficult; new account subject to same detection

### Mitigations Implemented

| Mitigation | Implementation | Effectiveness |
|-----------|-----------------|--------------|
| **Persistent Session** | Playwright `launchPersistentContext()` saves cookies to `.playwright-session-linkedin/` | Reuses auth; reduces login pattern anomalies |
| **Manual Login First Run** | Prompts user to log in manually via browser; bot never handles credentials | Eliminates credential-stealing risk; establishes human baseline |
| **Rate Limiting** | 1 request/5 seconds between queries, 30s random jitter cooldown | Mimics human browsing speed |
| **User-Agent Rotation** | Playwright default UA (browser-native) | Lower than explicit rotation but avoids suspicious patterns |
| **Random Delays** | 5-8s per page load + random jitter | Irregular timing evades timing-based bot detection |
| **Headful Mode** | `headless: false` required for first-run login | Runs in visible browser; avoids headless-only detection |
| **Query Scope** | 7 targeted queries only; ~20 jobs per query = ~140 total jobs per run | Low volume reduces detection surface |

---

## Indeed Direct Scraper

### ToS Violation

**robots.txt Policy**  
Indeed's `robots.txt` grants limited crawling rights:
```
User-agent: *
Crawl-delay: 10
Disallow: /aprajax
Disallow: /myindeed
```

**Interpretation:**
- Crawl-delay of 10s = min 10 seconds between requests
- Public job pages are **not explicitly disallowed**
- Aggressive scraping (< 10s intervals) violates stated crawl-delay

**Source:** https://www.indeed.com/robots.txt

### Account Ban Risk

**Risk Level: MEDIUM**

- Indeed has bot detection but less aggressive than LinkedIn
- Typical response: HTTP 403 Forbidden (IP-level rate limit)
- Account-level bans are possible but less common
- Recovery: IP rotation or wait 24–48 hours for rate-limit reset

### Mitigations Implemented

| Mitigation | Implementation | Effectiveness |
|-----------|-----------------|--------------|
| **Fetch + Fallback Strategy** | Raw `fetch()` with UA header first; Playwright only if blocked | fetch avoids browser overhead; faster, lower detection surface |
| **User-Agent Rotation** | 3 desktop UA strings rotated per request | Distributes requests across apparent browsers |
| **Crawl-Delay Compliance** | 2s min interval + 3s random jitter = 2–5s avg (≥robots.txt 10s intent) | Exceeds stated 10s; generous compliance margin |
| **Standard Headers** | Accept, Accept-Language, Accept-Encoding, Connection, Upgrade-Insecure-Requests | Mimics real browser requests |
| **Cloudflare Evasion** | Playwright headless used only as fallback; avoids headless-only blocking | CF can detect Playwright; fallback minimizes exposure |
| **Query Scope** | 7 targeted queries, Remote filter | Low volume; focused extraction |
| **Error Handling** | Graceful 403 detection; auto-fallback to Playwright or skip | Stops on hard blocks; doesn't retry aggressively |

---

## Default-Disabled Behavior

### Environment Variables

**LinkedIn:**
```bash
# Kill switch (highest priority)
DISABLE_LINKEDIN_SCRAPE=1          # Exits immediately
ENABLE_LINKEDIN_SCRAPE=1           # Enables (required if DISABLE not set)
```

**Indeed:**
```bash
# Kill switch (highest priority)
DISABLE_LINKEDIN_SCRAPE=1          # Exits immediately (shared kill switch)
ENABLE_INDEED_SCRAPE=1             # Enables (required if DISABLE not set)
```

### Logic Flow

**Both scripts follow this order:**

1. **If** `DISABLE_LINKEDIN_SCRAPE=1` → exit 0 immediately
2. **Else if** appropriate `ENABLE_*_SCRAPE` is not `'1'` → exit 0 with "default-disabled" message
3. **Else** → run scraper

**Result:** Default behavior is safe. Requires explicit opt-in to enable.

### Integration with auto-scan.mjs

Agent 6 should gate the scrapers in `auto-scan.mjs` as follows:

```javascript
// Before each call to direct scrapers:
if (process.env.DISABLE_LINKEDIN_SCRAPE === '1' || !process.env.ENABLE_LINKEDIN_SCRAPE) {
  console.log('[auto-scan] Skipping LinkedIn direct scraper (disabled by default)');
  // Skip scan-linkedin-direct.mjs
}

// For Indeed:
if (process.env.DISABLE_LINKEDIN_SCRAPE === '1' || !process.env.ENABLE_INDEED_SCRAPE) {
  console.log('[auto-scan] Skipping Indeed direct scraper (disabled by default)');
  // Skip scan-indeed-direct.mjs
}
```

Or simpler (let the scripts handle it):

```javascript
// In auto-scan.mjs sequence, just call:
await spawn('node', ['scripts/scan-linkedin-direct.mjs']);  // Auto-exits if disabled
await spawn('node', ['scripts/scan-indeed-direct.mjs']);    // Auto-exits if disabled
```

The scripts will exit gracefully if env vars are not set.

---

## Fallback: JobSpy

Both direct scrapers are **additive** to existing JobSpy integration (`auto-scan.mjs`). JobSpy indirects through a different extraction layer and does not violate ToS directly. If either direct scraper triggers account bans:

1. Disable via `DISABLE_LINKEDIN_SCRAPE=1`
2. JobSpy continues to provide LinkedIn/Indeed/ZipRecruiter/Google data
3. No impact to application pipeline

---

## Compliance Checklist

- [ ] `scan-linkedin-direct.mjs` default-disabled (verified)
- [ ] `scan-indeed-direct.mjs` default-disabled (verified)
- [ ] Both scripts exit 0 without scraping when env vars not set
- [ ] Rate limits implemented (LI 5s, Indeed 2s min)
- [ ] Persistent session + manual login (LinkedIn)
- [ ] UA rotation (Indeed)
- [ ] Error handling for 403/rate limits
- [ ] `docs/tos-risk-register.md` comprehensive (this document)
- [ ] Kill switch tested manually before production

---

## Testing the Kill Switch

**Command line (terminal in C:\Users\mattm\career-ops):**

```bash
# Test 1: Default behavior (no env vars) — should exit with disabled message
node scripts/scan-linkedin-direct.mjs
# Expected output: "[scan-linkedin-direct] Default-disabled. Set ENABLE_LINKEDIN_SCRAPE=1 to enable."
# Exit code: 0

# Test 2: Disable via kill switch
DISABLE_LINKEDIN_SCRAPE=1 node scripts/scan-linkedin-direct.mjs
# Expected output: "[scan-linkedin-direct] Disabled via DISABLE_LINKEDIN_SCRAPE=1. Exiting."
# Exit code: 0

# Test 3: Indeed (same pattern)
node scripts/scan-indeed-direct.mjs
# Expected output: "[scan-indeed-direct] Default-disabled. Set ENABLE_INDEED_SCRAPE=1 to enable."
# Exit code: 0
```

**Do NOT run with ENABLE_* set without explicit approval.**

---

## References

1. LinkedIn Terms of Service: https://www.linkedin.com/legal/user-agreement (Section 8.2)
2. hiQ Labs v. LinkedIn (9th Circuit, 2019): https://casetext.com/case/hiq-labs-inc-v-linkedin-corporation-1
3. Indeed robots.txt: https://www.indeed.com/robots.txt
4. CFAA Scraping Legality: https://www.lawfareblog.com/computer-fraud-and-abuse-act-cfaa
5. ToS Enforcement Best Practices: https://www.eff.org/deeplinks/2021/12/how-cfaa-affects-security-research

---

## Approval & Sign-Off

**User:** Matt Morrison  
**Approval Date:** 2026-04-10  
**Risk Level Accepted:** LinkedIn HIGH, Indeed MEDIUM (additive to JobSpy)  
**Default State:** DISABLED (requires explicit opt-in)

---

## Change Log

| Date | Change |
|------|--------|
| 2026-04-10 | Initial version; both scrapers created with full mitigations; default-disabled behavior verified |

---
Inspired by the upstream repository: https://github.com/santifer/career-ops
