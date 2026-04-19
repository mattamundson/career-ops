# Playwright Submission Automation — v13 Gotchas & Patterns

This doc distills the 5 critical learnings from the Wipfli iCIMS disaster (v13) and subsequent Playwright submission work.

## Setup Prerequisite

```bash
pnpm add playwright
pnpm exec playwright install chromium
```

Use raw `playwright` npm package, NOT the MCP server. MCP sandboxes file uploads to `.playwright-mcp/`, breaking ATS workflows.

---

## Gotcha 1: Playwright MCP Sandboxing (FILE UPLOADS)

**Problem:** The `@anthropic-ai/playwright` MCP server saves uploaded files to `.playwright-mcp/` sandbox directory. Application-tracking systems (ATS) expect files in the actual working directory.

**Symptom:** ATS doesn't detect uploaded resume, or file appears missing after form submission.

**Fix:** Use raw `playwright` package via pnpm:

```javascript
import { chromium } from 'playwright';  // NOT @anthropic-ai/playwright

const context = await chromium.launchPersistentContext('.playwright-session', {
  headless: false,
  viewport: { width: 1280, height: 800 },
});
```

---

## Gotcha 2: iCIMS Token-Based URL Invalidation

**Problem:** iCIMS uses query-param tokens (`eem`, `pnumber`, `ccode`, `code`) that expire or invalidate on page reload or navigation away from the origin. Reloading mid-flow aborts the session.

**Symptom:** After reloading or navigating back, iCIMS redirects to login or shows "Invalid Session" error.

**Fix:** 
- Never reload the page during submission flow
- Don't navigate away from the origin domain
- If you must restart, paste the original URL fresh (tokens typically last 10-15 minutes)

```javascript
// WRONG: DO NOT RELOAD
// await page.reload();

// RIGHT: Navigate without leaving the flow
await page.goto(applyUrl, { waitUntil: 'networkidle', timeout: 30000 });
```

---

## Gotcha 3: Double File-Chooser Bug on Label Clicks

**Problem:** iCIMS form labels are sometimes linked to file inputs. Clicking the label triggers the file dialog once; clicking it again (accidentally) triggers a second dialog, sometimes aborting the first upload.

**Symptom:** File dialog opens, you select a file, then a second dialog pops up unexpectedly, canceling your selection.

**Fix:** Click the `<input type="file">` element directly, never the associated `<label>`. Use Playwright's `setInputFiles()`:

```javascript
// WRONG: Clicking label can trigger double dialog
// await page.click('label[for="resume-upload"]');

// RIGHT: Click input directly and use setInputFiles()
const fileInput = await page.$('input[type="file"]');
if (fileInput) {
  await fileInput.setInputFiles('/path/to/resume.pdf');
  // Optional: trigger change event if needed
  await page.click('input[type="file"]');  // Alternative if above doesn't trigger parsing
}
```

---

## Gotcha 4: DOM Re-render After Resume Parsing

**Problem:** Many ATS platforms (iCIMS, WorkDay) parse uploaded resumes server-side and re-render the form with auto-populated fields (name, phone, email extracted from resume). This re-render shifts or removes DOM element refs that Playwright cached.

**Symptom:** Field refs work fine for the first few fields, then "stale element reference" errors appear after resume upload. New fields appear that weren't queried initially.

**Fix:** After each major step (resume upload, file parsing), wait for re-render, then re-query field refs:

```javascript
// Upload resume
const fileInput = await page.$('input[type="file"]');
await fileInput.setInputFiles(pdfPath);

// CRITICAL: Wait for parsing to complete
await page.waitForTimeout(2000);  // Give ATS time to parse
console.log('Waiting for resume parsing...');
await page.waitForTimeout(2000);

// RE-QUERY all field refs after parse
const fieldsAfterParse = await getAccessibleNames(page);
const emailField = fieldsAfterParse.find(f => f.label?.includes('Email'));

// Now use the fresh ref
if (emailField?.name) {
  await page.fill(`input[name="${emailField.name}"]`, candidate.email);
}
```

---

## Gotcha 5: hCaptcha Blocks Final Submission

**Problem:** iCIMS and some WorkDay flows use hCaptcha (reCAPTCHA alternative) as the final gate before submission. Playwright cannot solve hCaptcha programmatically; you must pause for human interaction.

**Symptom:** Form fills successfully, but clicking "Submit" redirects to a captcha challenge. Bot automation halts.

**Fix:** Pause execution and wait for human to solve captcha manually:

```javascript
/**
 * pauseForCaptcha() waits for stdin input (user presses ENTER)
 * Use in shared helpers:
 */
export async function pauseForCaptcha(page, msg = 'Solve captcha and press ENTER') {
  console.log('\n>>> ' + msg + ' <<<\n');
  await new Promise(r => process.stdin.once('data', r));
}

// In submission flow:
console.log('🔐 Captcha detected. Solve it manually, then press ENTER.');
await pauseForCaptcha(page, 'Verify and press ENTER to finalize submission');

// After human solves, attempt to click Submit
const submitBtn = await page.$('button:has-text("Submit")');
if (submitBtn) {
  await page.click('button:has-text("Submit")');
}
```

---

## Testing Workflow: Dry-Run → Live

All submission scripts support a two-phase workflow:

### Phase 1: Dry-Run (Inspect Form Structure)

```bash
node submit-workday.mjs --apply-url "https://..." --dry-run
```

Output: Lists all detected form fields with accessible names, labels, placeholders. Use this to build the field mapping for your script.

### Phase 2: Live (Submit)

```bash
node submit-workday.mjs --apply-url "https://..." --pdf "resume.pdf" --cover-letter "cover-letter.txt" --live
```

Fills fields, uploads resume, pauses for captcha, attempts submission.

---

## Safe Clicking Pattern (Retry Logic)

iCIMS and WorkDay sometimes have stale element references on click. Use safe click wrapper:

```javascript
export async function safeClick(page, ref, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.click(ref);
      return;
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`Retry click (${i + 1}/${retries})...`);
      await page.waitForTimeout(500);
    }
  }
}
```

---

## Persistent Browser Context (Session Reuse)

Launches browser with persistent session saved to `.playwright-session/`:

```javascript
const context = await chromium.launchPersistentContext('.playwright-session', {
  headless: false,
  viewport: { width: 1280, height: 800 },
});
```

This caches cookies and session state, useful for multi-step flows or resuming interrupted sessions.

---

## TODO / Known Limitations

- **Gotcha 1:** No programmatic reCAPTCHA v3 solving — future: integrate solver API
- **Gotcha 2:** iCIMS token lifetime varies; document per ATS where found
- **Gotcha 3:** Form label detection could be stronger (scan for `aria-labelledby`)
- **Gotcha 4:** Resume parsing timing is heuristic (2s timeout); may need tuning per ATS
- **Gotcha 5:** hCaptcha pause is manual; explore hCaptcha solver integrations in future sprints

---

## References

- Wipfli iCIMS submission report (v13): Full details in career-ops session logs
- Playwright docs: https://playwright.dev/docs/api/class-Page#page-set-input-files
- hCaptcha: https://www.hcaptcha.com/ (no public solving API; manual required)

---
Inspired by the upstream repository: https://github.com/santifer/career-ops
