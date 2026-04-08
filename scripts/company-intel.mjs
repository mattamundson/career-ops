#!/usr/bin/env node
/**
 * Feature 7 — Company Research Pre-Fetch
 * Generates a structured intel template for a given company.
 * Usage:
 *   node scripts/company-intel.mjs --company=Panopto
 *   node scripts/company-intel.mjs --company=Panopto --refresh
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INTEL_DIR = join(ROOT, 'data', 'company-intel');
const MAX_AGE_DAYS = 30;

// --- Arg parsing ---
const args = process.argv.slice(2);
const getFlag = (name) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const companyRaw = getFlag('company');
const refresh = hasFlag('refresh');

if (!companyRaw) {
  console.error('Usage: node scripts/company-intel.mjs --company=<name> [--refresh]');
  process.exit(1);
}

// --- Slug ---
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const slug = slugify(companyRaw);
const outPath = join(INTEL_DIR, `${slug}.md`);

// --- Staleness check ---
function isStale(filePath) {
  if (!existsSync(filePath)) return true;
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(/last_updated:\s*(\d{4}-\d{2}-\d{2})/);
  if (!match) return true;
  const updated = new Date(match[1]);
  const ageMs = Date.now() - updated.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > MAX_AGE_DAYS;
}

if (existsSync(outPath) && !refresh && !isStale(outPath)) {
  console.log(`[company-intel] Cache hit: ${outPath}`);
  console.log(`Use --refresh to regenerate.`);
  process.exit(0);
}

// --- Search query builders ---
function glassdoorQuery(company) {
  return `site:glassdoor.com "${company}" reviews rating`;
}
function crunchbaseQuery(company) {
  return `site:crunchbase.com "${company}" funding stage investors`;
}
function newsQuery(company) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const dateStr = cutoff.toISOString().slice(0, 10);
  return `"${company}" after:${dateStr} (announcement OR funding OR layoffs OR acquisition OR product OR expansion)`;
}
function headcountQuery(company) {
  return `"${company}" employees headcount size LinkedIn OR Glassdoor OR Craft.co OR ZoomInfo`;
}
function salaryQuery(company, role = 'data analyst OR data engineer OR analytics engineer') {
  return `"${company}" salary "${role}" Glassdoor OR Levels.fyi OR Blind OR Glassdoor OR Payscale`;
}

// --- Template ---
const now = new Date();
const dateStr = now.toISOString().slice(0, 10);

const template = `---
company: ${companyRaw}
slug: ${slug}
last_updated: ${dateStr}
source: company-intel.mjs (generated template)
---

# Company Intel: ${companyRaw}

> Generated ${dateStr}. Sections marked \`<!-- TODO: Fill from search -->\` require manual or WebSearch completion.
> Re-generate with: \`node scripts/company-intel.mjs --company=${slug} --refresh\`

---

## 1. Company Overview

| Field | Value |
|-------|-------|
| Full Name | ${companyRaw} |
| Website | <!-- TODO: Fill from search --> |
| Industry | <!-- TODO: Fill from search --> |
| Founded | <!-- TODO: Fill from search --> |
| HQ Location | <!-- TODO: Fill from search --> |
| Stage | <!-- TODO: Fill from search --> |
| Public / Private | <!-- TODO: Fill from search --> |

**Search query:**
\`\`\`
${companyRaw} company overview site:crunchbase.com OR site:linkedin.com/company
\`\`\`

---

## 2. Glassdoor

| Field | Value |
|-------|-------|
| Overall Rating | <!-- TODO: Fill from search --> |
| Review Count | <!-- TODO: Fill from search --> |
| CEO Approval | <!-- TODO: Fill from search --> |
| Recommend to Friend | <!-- TODO: Fill from search --> |
| Culture & Values | <!-- TODO: Fill from search --> |
| Work/Life Balance | <!-- TODO: Fill from search --> |
| Top Pros | <!-- TODO: Fill from search --> |
| Top Cons | <!-- TODO: Fill from search --> |

**Search query:**
\`\`\`
${glassdoorQuery(companyRaw)}
\`\`\`

---

## 3. Funding & Financial Health

| Field | Value |
|-------|-------|
| Total Raised | <!-- TODO: Fill from search --> |
| Last Round | <!-- TODO: Fill from search --> |
| Last Round Date | <!-- TODO: Fill from search --> |
| Lead Investors | <!-- TODO: Fill from search --> |
| Revenue (est.) | <!-- TODO: Fill from search --> |
| Profitability | <!-- TODO: Fill from search --> |

**Search query:**
\`\`\`
${crunchbaseQuery(companyRaw)}
\`\`\`

---

## 4. Headcount & Growth

| Field | Value |
|-------|-------|
| Current Employees | <!-- TODO: Fill from search --> |
| YoY Growth | <!-- TODO: Fill from search --> |
| Hiring Trend | <!-- TODO: Fill from search --> |
| Recent Layoffs | <!-- TODO: Fill from search --> |
| Key Departments | <!-- TODO: Fill from search --> |

**Search query:**
\`\`\`
${headcountQuery(companyRaw)}
\`\`\`

---

## 5. Compensation

| Role | Low | Mid | High | Source |
|------|-----|-----|------|--------|
| Data Analyst | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> |
| Data Engineer | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> |
| Analytics Engineer | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> |
| Senior / Staff | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> |

**Search query:**
\`\`\`
${salaryQuery(companyRaw)}
\`\`\`

**Notes:**
<!-- TODO: Fill from search — equity, bonus structure, 401k match, stock options -->

---

## 6. Recent News (last 90 days)

<!-- TODO: Fill from search — paste 3-5 headlines with dates and URLs -->

| Date | Headline | URL |
|------|----------|-----|
| <!-- TODO --> | <!-- TODO --> | <!-- TODO --> |

**Search query:**
\`\`\`
${newsQuery(companyRaw)}
\`\`\`

---

## 7. Interview Intel

<!-- TODO: Fill from Glassdoor interviews tab, Blind, or LinkedIn contacts -->

- Interview process: <!-- TODO -->
- Typical rounds: <!-- TODO -->
- Known technical screens: <!-- TODO -->
- Culture signals: <!-- TODO -->

---

## 8. Red Flags / Green Flags

| Type | Signal | Source |
|------|--------|--------|
| <!-- Green/Red --> | <!-- TODO --> | <!-- TODO --> |

---

## Notes

<!-- Free-form notes added during research -->
`;

// --- Write ---
mkdirSync(INTEL_DIR, { recursive: true });
writeFileSync(outPath, template, 'utf8');
console.log(`[company-intel] Created: ${outPath}`);
