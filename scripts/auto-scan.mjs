#!/usr/bin/env node
/**
 * auto-scan.mjs — Automated Greenhouse portal scanner
 * Usage: node scripts/auto-scan.mjs [--greenhouse-only] [--dry-run] [--since=Nd]
 *
 * Reads portals.yml, hits Greenhouse boards API for companies that have `api:` configured,
 * filters by title_filter keywords, deduplicates against scan-history.tsv + applications.md
 * + pipeline.md, and appends new matches to pipeline.md + scan-history.tsv.
 *
 * No external dependencies — ESM only, native fetch().
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env for FIRECRAWL_API_KEY (simple parser, no extra dependency)
{
  const envCandidate = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  if (existsSync(envCandidate)) {
    for (const line of readFileSync(envCandidate, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const PORTALS_YML    = resolve(ROOT, 'portals.yml');
const HISTORY_TSV    = resolve(ROOT, 'data', 'scan-history.tsv');
const APPLICATIONS   = resolve(ROOT, 'data', 'applications.md');
const PIPELINE       = resolve(ROOT, 'data', 'pipeline.md');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const DRY_RUN         = argv.includes('--dry-run');
const GREENHOUSE_ONLY = argv.includes('--greenhouse-only');
const JOBSPY_ONLY     = argv.includes('--jobspy-only');

function getSinceDays() {
  const flag = argv.find(a => a.startsWith('--since='));
  if (!flag) return 7;
  const val = flag.split('=')[1];
  const n = parseInt(val, 10);
  if (isNaN(n)) { console.error(`Invalid --since value: ${val}`); process.exit(1); }
  return n;
}
const SINCE_DAYS = getSinceDays();

// ---------------------------------------------------------------------------
// Minimal YAML parser — handles only the subset used in portals.yml
// Supports: top-level keys, list items (- key: val / - "string"), nested maps,
// inline block scalars, quoted strings, booleans.
// ---------------------------------------------------------------------------
function parseYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  function currentCtx() { return stack[stack.length - 1]; }

  function parseValue(raw) {
    const s = raw.trim();
    if (s === 'true')  return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    // strip quotes
    if ((s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    // inline comment strip
    return s.replace(/\s+#.*$/, '').trim();
  }

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    i++;

    // blank / comment
    const stripped = raw.replace(/\s*#.*$/, '');
    if (!stripped.trim()) continue;

    const indent = stripped.length - stripped.trimStart().length;
    const trimmed = stripped.trimStart();

    // pop stack to matching indent
    while (stack.length > 1 && indent <= currentCtx().indent) {
      stack.pop();
    }

    const ctx = currentCtx();

    if (trimmed.startsWith('- ')) {
      // list item
      const body = trimmed.slice(2).trim();

      // ensure parent has an array
      if (!Array.isArray(ctx.listTarget)) {
        // find the key that owns this list
        ctx.listTarget = null; // set below
      }

      if (body.includes(':')) {
        // map item inside a list
        const newMap = {};
        const [k, ...rest] = body.split(':');
        const v = rest.join(':').trim();
        if (v) newMap[k.trim()] = parseValue(v);

        // attach to parent array
        let arr = ctx.currentArray;
        if (!arr) {
          // shouldn't happen in well-formed YAML, but guard
          arr = [];
          ctx.currentArray = arr;
        }
        arr.push(newMap);

        // push new context for more keys on this map item
        stack.push({ indent, obj: newMap, isListItem: true, currentArray: arr });
      } else {
        // scalar list item
        let arr = ctx.currentArray;
        if (!arr) {
          arr = [];
          ctx.currentArray = arr;
        }
        arr.push(parseValue(body));
      }
    } else if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const rest = trimmed.slice(colonIdx + 1).trim();

      if (rest === '' || rest === '|' || rest === '>') {
        // nested map or list — value determined by next lines
        const newMap = {};
        const newArr = [];
        // we won't know if it's map or list until we see the next line
        // store both, resolve lazily
        const sentinel = { __map: newMap, __arr: newArr, __resolved: false };

        if (ctx.isListItem) {
          ctx.obj[key] = sentinel;
        } else if (Array.isArray(ctx.obj)) {
          ctx.obj[ctx.obj.length - 1][key] = sentinel;
        } else {
          ctx.obj[key] = sentinel;
        }

        stack.push({ indent, obj: newMap, currentArray: newArr, sentinel, key, parentObj: ctx.obj });
      } else {
        // scalar value
        const val = parseValue(rest);
        if (ctx.isListItem) {
          ctx.obj[key] = val;
        } else {
          ctx.obj[key] = val;
        }
      }
    }
  }

  // Resolve sentinels — walk the tree and replace sentinel objects
  function resolveSentinels(node) {
    if (node === null || typeof node !== 'object') return node;

    if (node.__map !== undefined && node.__arr !== undefined) {
      // if array has items, it's a list; else it's a map
      if (node.__arr.length > 0) return node.__arr.map(resolveSentinels);
      return resolveSentinels(node.__map);
    }

    if (Array.isArray(node)) return node.map(resolveSentinels);

    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = resolveSentinels(v);
    }
    return out;
  }

  return resolveSentinels(root);
}

// ---------------------------------------------------------------------------
// Better YAML parser — second pass, simpler and more reliable
// The above gets complex. Use a clean line-by-line state machine instead.
// ---------------------------------------------------------------------------
function parsePortalsYaml(text) {
  /**
   * Handles the specific structure of portals.yml:
   *   key: value
   *   key:
   *     - item
   *     - key: val
   *       key2: val2
   *   list:
   *     - subkey: val
   */
  const lines = text.split('\n');
  const result = {};

  // We track a "path" of (indent, container) pairs
  // container is either an object or an array
  const stack = [{ indent: -2, container: result, key: null }];

  function top() { return stack[stack.length - 1]; }

  function setInParent(key, value) {
    const t = top();
    if (Array.isArray(t.container)) {
      // shouldn't happen for key:value lines
      t.container[t.container.length - 1][key] = value;
    } else {
      t.container[key] = value;
    }
  }

  function parseScalar(s) {
    s = s.trim();
    // strip inline comment
    s = s.replace(/\s+#.*$/, '').trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '') return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    if ((s[0] === '"' && s[s.length-1] === '"') ||
        (s[0] === "'" && s[s.length-1] === "'")) {
      return s.slice(1, -1);
    }
    return s;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // strip inline comment but preserve quoted strings
    const commentStripped = rawLine.replace(/(["'])(?:(?=(\\?))\2.)*?\1|(\s+#.*)$/g,
      (m, q) => q ? m : '');
    const line = commentStripped;
    if (!line.trim()) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trimStart();

    // Pop stack for dedent
    while (stack.length > 1 && indent <= top().indent) {
      stack.pop();
    }

    if (trimmed.startsWith('- ')) {
      const body = trimmed.slice(2);
      const t = top();

      // Ensure we have an array at this level
      let arr;
      if (Array.isArray(t.container)) {
        arr = t.container;
      } else {
        // The current top is a map — the array should be the value of t.key
        // but we need the parent to have already created the array
        // This happens when a key: line was followed by list items
        arr = t.listArr;
        if (!arr) {
          // Shouldn't happen in valid YAML but handle gracefully
          arr = [];
          t.listArr = arr;
        }
      }

      const colonIdx = body.indexOf(':');
      if (colonIdx > 0 && body[colonIdx - 1] !== ' ' || (colonIdx > 0 && !body.slice(colonIdx + 1).trim().startsWith(' '))) {
        // Could be a map item starting with key:val
      }

      if (colonIdx !== -1) {
        const k = body.slice(0, colonIdx).trim();
        const v = body.slice(colonIdx + 1).trim();
        // Map item
        const newObj = {};
        if (v) newObj[k] = parseScalar(v);
        arr.push(newObj);
        // Push context: more keys may be added to newObj
        stack.push({ indent, container: arr, key: null, currentItem: newObj, isListItemMap: true });
      } else {
        // Scalar list item
        arr.push(parseScalar(body));
      }
    } else {
      // key: value or key: (nested)
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const valRaw = trimmed.slice(colonIdx + 1).trim();

      const t = top();

      if (t.isListItemMap && t.currentItem) {
        // Adding more keys to the current list item map
        if (valRaw === '') {
          const newContainer = {};
          t.currentItem[key] = newContainer;
          stack.push({ indent, container: t.container, key, currentItem: t.currentItem, parentObj: newContainer });
        } else {
          t.currentItem[key] = parseScalar(valRaw);
        }
      } else if (valRaw === '') {
        // Nested: could be map or list — decide when we see next line
        const placeholder = {};
        const arr = [];
        if (Array.isArray(t.container)) {
          t.container[t.container.length - 1][key] = placeholder;
        } else {
          t.container[key] = placeholder;
        }
        // push — next lines will populate
        stack.push({ indent, container: placeholder, key, listArr: arr, ownerKey: key, ownerObj: Array.isArray(t.container) ? t.container[t.container.length-1] : t.container });
      } else {
        // Scalar
        if (Array.isArray(t.container)) {
          t.container[t.container.length - 1][key] = parseScalar(valRaw);
        } else {
          t.container[key] = parseScalar(valRaw);
        }
      }
    }
  }

  // Second pass: replace any placeholder objects that should be arrays
  function fixPlaceholders(node, parent, parentKey) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, idx) => fixPlaceholders(item, node, idx));
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      fixPlaceholders(v, node, k);
    }
  }
  fixPlaceholders(result, null, null);

  return result;
}

// ---------------------------------------------------------------------------
// Actually, let's use a clean, well-tested recursive-descent YAML parser
// tailored to portals.yml's exact structure.
// ---------------------------------------------------------------------------
function loadPortalsYml(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return parsePortalsYmlClean(text);
}

function parsePortalsYmlClean(text) {
  // Tokenize: (indent, type, key, value)
  // Types: MAPPING_KEY, LIST_ITEM_SCALAR, LIST_ITEM_MAP_START
  const lines = text.split('\n');
  const out = {};
  let i = 0;

  function peekIndent() {
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '' || l.trimStart().startsWith('#')) { i++; continue; }
      return l.length - l.trimStart().length;
    }
    return -1;
  }

  function parseScalar(s) {
    s = s.trim();
    if (!s) return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if ((s[0] === '"' && s[s.length-1] === '"') ||
        (s[0] === "'" && s[s.length-1] === "'")) {
      return s.slice(1, -1);
    }
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    return s;
  }

  function nextLine() {
    while (i < lines.length) {
      const l = lines[i];
      i++;
      if (l.trim() === '' || l.trimStart().startsWith('#')) continue;
      return l;
    }
    return null;
  }

  function parseMap(baseIndent) {
    const obj = {};
    while (true) {
      const ind = peekIndent();
      if (ind < baseIndent || ind === -1) break;
      const line = nextLine();
      if (!line) break;
      const lind = line.length - line.trimStart().length;
      if (lind < baseIndent) { i--; break; } // put back — handled by caller? No, nextLine consumed it
      // We can't "put back" easily — check indent first
      const trimmed = line.trimStart();
      if (trimmed.startsWith('- ')) {
        // Shouldn't be here in a map context — abort
        // Actually this means this is a list, not a map
        // We need to "unread" this line
        i--;
        break;
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const valRaw = trimmed.slice(colonIdx + 1);
      // strip inline comment
      const valClean = valRaw.replace(/\s+#[^"']*$/, '').trim();

      if (valClean === '') {
        // nested
        const nextInd = peekIndent();
        if (nextInd > lind) {
          const nextTrimmed = lines[i] ? lines[i].trimStart() : '';
          if (nextTrimmed.startsWith('- ')) {
            obj[key] = parseList(nextInd);
          } else {
            obj[key] = parseMap(nextInd);
          }
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(valClean);
      }
    }
    return obj;
  }

  function parseList(baseIndent) {
    const arr = [];
    while (true) {
      const ind = peekIndent();
      if (ind < baseIndent || ind === -1) break;
      const line = nextLine();
      if (!line) break;
      const lind = line.length - line.trimStart().length;
      if (lind < baseIndent) { i--; break; }
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('- ')) {
        i--;
        break;
      }
      const body = trimmed.slice(2).trim();
      if (body === '') {
        // next lines are map keys at deeper indent
        const nextInd = peekIndent();
        arr.push(parseMap(nextInd));
      } else if (body.includes(':')) {
        // inline map start: "- key: val"
        const colonIdx = body.indexOf(':');
        const k = body.slice(0, colonIdx).trim();
        const v = body.slice(colonIdx + 1).replace(/\s+#[^"']*$/, '').trim();
        const itemObj = {};
        if (v) itemObj[k] = parseScalar(v);
        else itemObj[k] = null;
        // more keys may follow at same or deeper indent
        const nextInd = peekIndent();
        if (nextInd > lind) {
          const more = parseMap(nextInd);
          Object.assign(itemObj, more);
        }
        arr.push(itemObj);
      } else {
        arr.push(parseScalar(body));
      }
    }
    return arr;
  }

  return parseMap(0);
}

// ---------------------------------------------------------------------------
// Load and validate portals.yml
// ---------------------------------------------------------------------------
function loadConfig() {
  const cfg = loadPortalsYml(PORTALS_YML);
  return cfg;
}

// ---------------------------------------------------------------------------
// Load scan-history.tsv — returns a Set of URLs already seen
// ---------------------------------------------------------------------------
function loadHistory() {
  if (!existsSync(HISTORY_TSV)) return new Set();
  const lines = readFileSync(HISTORY_TSV, 'utf8').split('\n');
  const urls = new Set();
  for (const line of lines.slice(1)) { // skip header
    if (!line.trim()) continue;
    const url = line.split('\t')[0].trim();
    if (url) urls.add(url);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Load URLs from pipeline.md (## Pending and ## Processed sections)
// ---------------------------------------------------------------------------
function loadPipelineUrls() {
  if (!existsSync(PIPELINE)) return new Set();
  const text = readFileSync(PIPELINE, 'utf8');
  const urls = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/https?:\/\/[^\s|)]+/);
    if (m) urls.add(m[0].trim());
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Load company+role combos from applications.md
// Normalizes: lowercase, strip punctuation
// ---------------------------------------------------------------------------
function loadApplicationKeys() {
  if (!existsSync(APPLICATIONS)) return new Set();
  const text = readFileSync(APPLICATIONS, 'utf8');
  const keys = new Set();
  for (const line of text.split('\n')) {
    // Markdown table row: | # | Date | Company | Role | ...
    const cols = line.split('|').map(c => c.trim());
    if (cols.length >= 5) {
      const company = cols[3];
      const role    = cols[4];
      if (company && role && company !== 'Company') {
        keys.add(normalizeKey(`${company}:${role}`));
      }
    }
  }
  return keys;
}

function normalizeKey(s) {
  return s.toLowerCase().replace(/[^a-z0-9:]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Title filter
// ---------------------------------------------------------------------------
function matchesFilter(title, filter) {
  const lower = title.toLowerCase();
  const pos   = filter.positive  || [];
  const neg   = filter.negative  || [];

  // Must match at least 1 positive keyword
  const hasPositive = pos.some(kw => lower.includes(kw.toLowerCase()));
  if (!hasPositive) return { match: false, reason: 'no_positive' };

  // Must not match any negative keyword
  const hasNegative = neg.some(kw => lower.includes(kw.toLowerCase()));
  if (hasNegative) return { match: false, reason: 'negative_match' };

  return { match: true };
}

// ---------------------------------------------------------------------------
// Greenhouse API fetch
// ---------------------------------------------------------------------------
async function fetchGreenhouse(apiUrl, companyName) {
  try {
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'career-ops-auto-scan/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.error(`  [WARN] ${companyName}: HTTP ${resp.status} from ${apiUrl}`);
      return [];
    }
    const data = await resp.json();
    const jobs = data.jobs || [];
    return jobs.map(j => ({
      title:   j.title || '',
      url:     j.absolute_url || j.url || '',
      company: companyName,
      source:  'greenhouse-api',
      updatedAt: j.updated_at || null,
    }));
  } catch (err) {
    console.error(`  [ERROR] ${companyName}: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ashby ATS API
// GET https://jobs.ashbyhq.com/api/non-admin/job-board?organizationHostedJobsPageName={slug}
// Returns: { jobPostings: [{title, jobUrl, publishedDate, location}] }
// ---------------------------------------------------------------------------
// Ashby via Playwright — JSON API returns 404 for all slugs; page scrape works.
// Launches ONE browser instance shared across all companies to minimise overhead.
// URL pattern: jobs.ashbyhq.com/{slug}/{uuid} (not /jobs/)
// Link text: "Title • Location • Type" — we take everything before the first •
async function fetchAshbyPlaywright(companies) {
  if (!companies.length) return [];
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const results = []; // [{ company, jobs[] }]
  try {
    for (const { slug, name } of companies) {
      const page = await browser.newPage();
      try {
        await page.goto(`https://jobs.ashbyhq.com/${slug}`, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
        const raw = await page.$$eval(
          'a[href]',
          (anchors, slug) => anchors
            .map(a => ({ text: a.textContent?.trim() || '', href: a.getAttribute('href') || '' }))
            // URL shape: /{slug}/{uuid} — exclude homepage /{slug} and external links
            .filter(j => j.href.startsWith(`/${slug}/`) && j.href.length > slug.length + 2),
          slug
        );
        const jobs = raw.map(j => ({
          title:     j.text.split('•')[0].trim(),
          url:       `https://jobs.ashbyhq.com${j.href}`,
          company:   name,
          source:    'ashby-playwright',
          updatedAt: null,
        })).filter(j => j.title);
        results.push({ company: { slug, name }, jobs });
      } catch (err) {
        console.warn(`  [WARN] ${name} (Ashby Playwright): ${err.message}`);
        results.push({ company: { slug, name }, jobs: [] });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

// ---------------------------------------------------------------------------
// Lever ATS API
// GET https://api.lever.co/v0/postings/{slug}?mode=json
// Returns: [{text: title, hostedUrl: url, createdAt: ms-timestamp}]
// ---------------------------------------------------------------------------
async function fetchLever(slug, companyName) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'career-ops-auto-scan/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.error(`  [WARN] ${companyName} (Lever): HTTP ${resp.status}`);
      return [];
    }
    const postings = await resp.json();
    if (!Array.isArray(postings)) return [];
    return postings.map(p => ({
      title:     p.text || '',
      url:       p.hostedUrl || '',
      company:   companyName,
      source:    'lever-api',
      updatedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    }));
  } catch (err) {
    console.error(`  [ERROR] ${companyName} (Lever): ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// SmartRecruiters ATS API
// GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?q={query}&limit=100
// Returns: { content: [{id, name, releasedDate, location}] }
// Public job URL: https://jobs.smartrecruiters.com/{slug}/{id}
// ---------------------------------------------------------------------------
async function fetchSmartRecruiters(slug, companyName, query = '') {
  const qs   = query ? `?q=${encodeURIComponent(query)}&limit=100` : '?limit=100';
  const url  = `https://api.smartrecruiters.com/v1/companies/${slug}/postings${qs}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'career-ops-auto-scan/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.error(`  [WARN] ${companyName} (SmartRecruiters): HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return (data.content || []).map(p => ({
      title:     p.name || '',
      url:       `https://jobs.smartrecruiters.com/${slug}/${p.id}`,
      company:   companyName,
      source:    'smartrecruiters-api',
      updatedAt: p.releasedDate || null,
    }));
  } catch (err) {
    console.error(`  [ERROR] ${companyName} (SmartRecruiters): ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// WorkDay ATS via Playwright
// URL varies per company — portals.yml must supply full `url` field.
// e.g. https://netflix.wd5.myworkdayjobs.com/en-US/External
// WorkDay is a heavy SPA: wait for job-title elements before extraction.
// Standard DOM: [data-automation-id="job-title"] inside an <a> link card.
// Shares one browser instance across all companies.
// ---------------------------------------------------------------------------
async function fetchWorkday(companies) {
  if (!companies.length) return [];
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const { url: boardUrl, name } of companies) {
      const page = await browser.newPage();
      try {
        await page.goto(boardUrl, { waitUntil: 'networkidle', timeout: 45000 });
        // Wait for job cards to render (WorkDay SPA needs explicit wait)
        await page.waitForSelector('[data-automation-id="job-title"]', { timeout: 15000 })
          .catch(() => null); // graceful — page may have 0 results

        const jobs = await page.$$eval('[data-automation-id="job-title"]', (els, boardUrl) => {
          const origin = new URL(boardUrl).origin;
          return els.map(el => {
            const anchor = el.closest('a') || el.querySelector('a') || el;
            const href   = anchor.getAttribute('href') || '';
            return {
              title: el.textContent?.trim() || '',
              url:   href.startsWith('http') ? href : origin + href,
            };
          }).filter(j => j.title && j.url);
        }, boardUrl);

        results.push({ company: { url: boardUrl, name }, jobs: jobs.map(j => ({
          ...j, company: name, source: 'workday-playwright', updatedAt: null,
        })) });
      } catch (err) {
        console.warn(`  [WARN] ${name} (WorkDay Playwright): ${err.message.slice(0, 80)}`);
        results.push({ company: { url: boardUrl, name }, jobs: [] });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

// ---------------------------------------------------------------------------
// iCIMS ATS (Playwright) — added v14
// iCIMS careers pages live at https://careers-{slug}.icims.com/jobs/search?...
// They render server-side but job results load dynamically via XHR.
// Pattern: scrape the job search results page and extract links + titles.
// ---------------------------------------------------------------------------
async function fetchICIMS(companies) {
  if (!companies.length) return [];
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const { slug, name, searchKeyword } of companies) {
      const page = await browser.newPage();
      try {
        // iCIMS public search URL — no auth required
        // Note: iCIMS uses long-polling XHRs; use 'load' not 'networkidle' to avoid timeout
        const kw = encodeURIComponent(searchKeyword || 'data');
        const url = `https://careers-${slug}.icims.com/jobs/search?ss=1&searchKeyword=${kw}&hashed=-435693945`;
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(3000); // give iframe time to load content
        // iCIMS loads listings into an iframe
        const frameHandle = await page.$('iframe#icims_content_iframe').catch(() => null);
        const frame = frameHandle ? await frameHandle.contentFrame() : page.mainFrame();
        if (!frame) {
          results.push({ company: { slug, name }, jobs: [] });
          continue;
        }
        await frame.waitForSelector('a[href*="/jobs/"]', { timeout: 15000 }).catch(() => null);
        const jobs = await frame.$$eval('a[href*="/jobs/"]', (els, slug) => {
          return els.map(el => {
            // iCIMS wraps titles with a "Job Title" header row — strip it
            let title = el.textContent?.trim() || '';
            title = title.replace(/^Job Title\s*/i, '').trim();
            const href = el.getAttribute('href') || '';
            const url = href.startsWith('http') ? href : `https://careers-${slug}.icims.com${href}`;
            return { title, url };
          }).filter(j => j.title && j.url && !j.url.includes('/search') && !j.url.includes('/intro') && j.title.length > 3);
        }, slug);
        // De-dupe by URL within the company's results
        const seen = new Set();
        const unique = jobs.filter(j => seen.has(j.url) ? false : seen.add(j.url));
        results.push({ company: { slug, name }, jobs: unique.map(j => ({
          ...j, company: name, source: 'icims-playwright', updatedAt: null,
        })) });
      } catch (err) {
        console.warn(`  [WARN] ${name} (iCIMS Playwright): ${err.message.slice(0, 80)}`);
        results.push({ company: { slug, name }, jobs: [] });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

// ---------------------------------------------------------------------------
// Workable ATS (REST API) — added v14
// Public API: GET https://apply.workable.com/api/v3/accounts/{slug}/jobs
// Returns JSON with jobs array: each job has id, title, full_title, url
// ---------------------------------------------------------------------------
async function fetchWorkable(slug, companyName) {
  const url = `https://apply.workable.com/api/v3/accounts/${slug}/jobs`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      console.warn(`  [WARN] ${companyName} (Workable): HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const jobs = Array.isArray(data.results) ? data.results : (Array.isArray(data.jobs) ? data.jobs : []);
    return jobs.map(j => ({
      title:     j.title || j.full_title || '',
      url:       j.url || `https://apply.workable.com/${slug}/j/${j.shortcode || j.id}/`,
      company:   companyName,
      source:    'workable-api',
      updatedAt: j.published_on || j.updated_at || null,
    })).filter(j => j.title && j.url);
  } catch (err) {
    console.warn(`  [WARN] ${companyName} (Workable): ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Built In (Playwright) — added v14
// Built In: https://builtin.com/jobs?search={q}&city={city}
// Aggregates tech startup jobs, good Minneapolis coverage
// ---------------------------------------------------------------------------
async function fetchBuiltIn(queries) {
  if (!queries.length) return [];
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const { query, city, name } of queries) {
      const page = await browser.newPage();
      try {
        const cityParam = city ? `&city=${encodeURIComponent(city)}` : '';
        const url = `https://builtin.com/jobs?search=${encodeURIComponent(query)}${cityParam}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForSelector('a[data-id="job-card-title"], a[href*="/job/"]', { timeout: 15000 }).catch(() => null);
        const jobs = await page.$$eval('a[href*="/job/"]', (els) => {
          return els.map(el => {
            const title = el.textContent?.trim() || '';
            const href = el.getAttribute('href') || '';
            const url = href.startsWith('http') ? href : `https://builtin.com${href}`;
            return { title, url };
          }).filter(j => j.title && j.url && j.title.length > 5);
        });
        const seen = new Set();
        const unique = jobs.filter(j => seen.has(j.url) ? false : seen.add(j.url));
        results.push({ query: { query, city, name }, jobs: unique.map(j => ({
          ...j, company: 'BuiltIn', source: 'builtin-playwright', updatedAt: null,
        })) });
      } catch (err) {
        console.warn(`  [WARN] BuiltIn "${query}": ${err.message.slice(0, 80)}`);
        results.push({ query: { query, city, name }, jobs: [] });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

// ---------------------------------------------------------------------------
// Date filter — keep only jobs updated within SINCE_DAYS
// Greenhouse updated_at format: "2026-03-15T00:00:00.000Z"
// ---------------------------------------------------------------------------
function isWithinWindow(job, sinceDays) {
  if (!job.updatedAt) return true; // no date info — include
  const d = new Date(job.updatedAt);
  if (isNaN(d)) return true;
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return d >= cutoff;
}

// ---------------------------------------------------------------------------
// Append to pipeline.md under ## Pending
// ---------------------------------------------------------------------------
function appendToPipeline(entries) {
  if (!existsSync(PIPELINE)) {
    writeFileSync(PIPELINE, '# Job Pipeline — URL Inbox\n\nAdd job URLs here.\n\n## Pending\n\n## Processed\n');
  }
  let text = readFileSync(PIPELINE, 'utf8');

  const pendingMarker = '## Pending';
  const idx = text.indexOf(pendingMarker);
  if (idx === -1) {
    text += `\n${pendingMarker}\n`;
  }

  const lines = entries.map(e => `- [ ] ${e.url} | ${e.company} | ${e.title}`);
  const insertAfter = idx + pendingMarker.length;

  text = text.slice(0, insertAfter) + '\n' + lines.join('\n') + '\n' + text.slice(insertAfter);
  writeFileSync(PIPELINE, text, 'utf8');
}

// ---------------------------------------------------------------------------
// Append rows to scan-history.tsv
// ---------------------------------------------------------------------------
function appendHistory(rows) {
  let header = '';
  let existing = '';
  if (existsSync(HISTORY_TSV)) {
    existing = readFileSync(HISTORY_TSV, 'utf8');
    if (!existing.startsWith('url\t')) {
      header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n';
    }
  } else {
    header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n';
  }

  const today = new Date().toISOString().slice(0, 10);
  const newLines = rows.map(r =>
    `${r.url}\t${today}\t${r.portal}\t${r.title}\t${r.company}\t${r.status}`
  ).join('\n') + '\n';

  writeFileSync(HISTORY_TSV, header + existing + newLines, 'utf8');
}

// ---------------------------------------------------------------------------
// Job board queries via Firecrawl Search (Level 4 discovery)
// Reads job_board_queries from portals.yml, executes via @mendable/firecrawl-js SDK.
// Requires FIRECRAWL_API_KEY in .env. Skips gracefully if key is absent.
// ---------------------------------------------------------------------------
async function runJobBoardQueries(cfg) {
  const queries = (cfg.job_board_queries || []).filter(q => q.enabled !== false);
  const apiKey  = process.env.FIRECRAWL_API_KEY;

  if (!queries.length) {
    console.log('[job-boards] No job_board_queries configured — skipping.');
    return [];
  }
  if (!apiKey || apiKey === 'your_key_here') {
    console.log('[job-boards] Skipped — set FIRECRAWL_API_KEY in .env to enable.');
    return [];
  }

  const { default: FirecrawlApp } = await import('@mendable/firecrawl-js');
  const firecrawl = new FirecrawlApp({ apiKey });

  console.log(`  Running ${queries.length} Firecrawl queries in parallel...`);
  const settled = await Promise.allSettled(
    queries.map(q =>
      firecrawl.search(q.query, { limit: 20, lang: 'en', country: 'us' })
        .then(result => ({ q, result }))
    )
  );

  const allResults = [];
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      console.warn(`  [firecrawl] query failed: ${outcome.reason?.message}`);
      continue;
    }
    const { q, result } = outcome.value;
    const hits = (result.web ?? result.data ?? []).map(r => ({
      url:     r.url,
      title:   (r.title ?? '').replace(/\s+/g, ' ').trim(),
      company: inferBoardName(r.url),
      portal:  `firecrawl/${q.name}`,
    }));
    console.log(`  [firecrawl] ${q.name} → ${hits.length} results`);
    allResults.push(...hits);
  }

  return allResults;
}

function inferBoardName(url) {
  if (/indeed\.com/i.test(url))        return 'Indeed';
  if (/linkedin\.com/i.test(url))      return 'LinkedIn';
  if (/ziprecruiter\.com/i.test(url))  return 'ZipRecruiter';
  if (/monster\.com/i.test(url))       return 'Monster';
  if (/careerbuilder\.com/i.test(url)) return 'CareerBuilder';
  if (/glassdoor\.com/i.test(url))     return 'Glassdoor';
  return 'Unknown';
}

// ---------------------------------------------------------------------------
// Auto-promote: scan prefilter-results/*.md for score >= 4.0 still in pipeline.md
// Appends promoted entries to applications.md and marks them [x] in pipeline.md
// ---------------------------------------------------------------------------
async function autoPromoteHighScores() {
  const { readdirSync } = await import('fs');
  const prefilterDir = resolve(ROOT, 'data', 'prefilter-results');
  if (!existsSync(prefilterDir)) return;

  const PROMOTE_THRESHOLD = 4.0;
  const files = readdirSync(prefilterDir).filter(f => f.endsWith('.md'));
  if (!files.length) return;

  // Parse all cards for score and metadata
  const candidates = [];
  for (const file of files) {
    const text = readFileSync(resolve(prefilterDir, file), 'utf8');
    const scoreMatch   = text.match(/\*\*Quick Score:\*\*\s*([\d.]+)/);
    const statusMatch  = text.match(/\*\*status:\*\*\s*(\w+)/);
    const urlMatch     = text.match(/\*\*url:\*\*\s*(https?:\/\/\S+)/);
    const companyMatch = text.match(/\*\*company:\*\*\s*(.+)/);
    const titleMatch   = text.match(/\*\*title:\*\*\s*(.+)/);

    if (!scoreMatch || !urlMatch) continue;
    const score  = parseFloat(scoreMatch[1]);
    const status = statusMatch ? statusMatch[1].trim() : 'pending';
    if (score < PROMOTE_THRESHOLD) continue;
    if (status === 'promoted') continue; // already promoted

    candidates.push({
      score,
      url:     urlMatch[1].trim(),
      company: companyMatch ? companyMatch[1].trim() : '',
      title:   titleMatch   ? titleMatch[1].trim()   : '',
      file:    resolve(prefilterDir, file),
    });
  }

  if (!candidates.length) return;

  // Check which candidates are still pending in pipeline.md (not yet in applications.md)
  const appsText     = existsSync(APPLICATIONS) ? readFileSync(APPLICATIONS, 'utf8') : '';
  const pipelineText = existsSync(PIPELINE)     ? readFileSync(PIPELINE,     'utf8') : '';

  const toPromote = candidates.filter(c =>
    pipelineText.includes(c.url) && !appsText.includes(c.url)
  );

  if (!toPromote.length) return;

  console.log(`Auto-promoting ${toPromote.length} high-score entrie(s) (score >= ${PROMOTE_THRESHOLD}):`);

  // Determine next application number
  const numMatches = [...appsText.matchAll(/^\|\s*(\d+)\s*\|/gm)];
  const maxNum = numMatches.length > 0
    ? Math.max(...numMatches.map(m => parseInt(m[1], 10)))
    : 0;

  const today = new Date().toISOString().slice(0, 10);

  // Append rows to applications.md
  const newRows = toPromote.map((c, i) => {
    const num = String(maxNum + i + 1).padStart(3, '0');
    const role = c.title.length > 50 ? c.title.slice(0, 47) + '...' : c.title;
    console.log(`  → [${num}] ${c.company} | ${c.title} (${c.score}/5)`);
    return `| ${num} | ${today} | ${c.company} | ${role} | ${c.score}/5 | Evaluating | — | — | Auto-promoted (score ${c.score}) |`;
  });

  const appsLines = appsText.trimEnd().split('\n');
  const updatedApps = [...appsLines, ...newRows, ''].join('\n');
  writeFileSync(APPLICATIONS, updatedApps);

  // Mark pipeline entries as [x]
  let updatedPipeline = pipelineText;
  for (const c of toPromote) {
    updatedPipeline = updatedPipeline.replace(
      new RegExp(`^- \\[ \\] ${c.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'),
      `- [x] ${c.url}`
    );
  }
  writeFileSync(PIPELINE, updatedPipeline);

  // Update card status to "promoted" + auto-generate outreach template if archetype is set
  const { execFileSync: execSync } = await import('child_process');
  const outreachDir = resolve(ROOT, 'data', 'outreach');
  const { mkdirSync } = await import('fs');
  mkdirSync(outreachDir, { recursive: true });

  for (const c of toPromote) {
    const text    = readFileSync(c.file, 'utf8');
    const archetypeMatch = text.match(/\*\*Archetype:\*\*\s*(.+)/i);
    const archetype = archetypeMatch ? archetypeMatch[1].trim() : null;

    // Write updated card status
    writeFileSync(c.file, text.replace(/\*\*status:\*\*\s*\w+/, '**status:** promoted'));

    // Auto-generate outreach template when archetype is filled in (not "_pending_")
    if (archetype && !archetype.startsWith('_')) {
      const outreachSlug = `${c.company}-${c.title}`
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
      const outreachPath = resolve(outreachDir, `${outreachSlug}.md`);
      try {
        const templateOut = execSync(process.execPath, [
          resolve(__dir, 'select-template.mjs'),
          '--scenario=recruiter',
          `--archetype=${archetype}`,
          '--channel=linkedin',
          `--company=${c.company}`,
          `--role=${c.title}`,
        ], { cwd: ROOT, encoding: 'utf8' });
        writeFileSync(outreachPath, `# Outreach Template — ${c.company}: ${c.title}\n\n` + templateOut);
        console.log(`  Outreach template → ${outreachPath.replace(ROOT, '').replace(/\\/g, '/')}`);
        // Append link to the prefilter card
        const updatedCard = readFileSync(c.file, 'utf8');
        if (!updatedCard.includes('Outreach Template')) {
          writeFileSync(c.file, updatedCard.trimEnd() + `\n\n**Outreach Template:** [View](../outreach/${outreachSlug}.md)\n`);
        }
      } catch (e) {
        console.warn(`  [WARN] select-template failed for ${c.company}: ${e.message.slice(0, 60)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// JobSpy Python scanner — spawns scan-jobspy.py as a child process
// Returns number of new jobs found (parsed from summary line), or 0 on error.
// ---------------------------------------------------------------------------
async function runJobSpyScan() {
  console.log('');
  console.log('Running JobSpy Python scan...');
  console.log('━'.repeat(40));

  const { spawn } = await import('child_process');

  const scriptPath = resolve(__dir, 'scan-jobspy.py');
  const spawnArgs  = [scriptPath];
  if (DRY_RUN) spawnArgs.push('--dry-run');

  return new Promise(resolve_ => {
    let proc;
    try {
      proc = spawn('python', spawnArgs, {
        cwd:   ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env:   { ...process.env },
      });
    } catch (err) {
      console.warn(`[jobspy] Failed to launch Python: ${err.message}`);
      console.warn('[jobspy] Skipping JobSpy scan — install python and python-jobspy to enable.');
      return resolve_(0);
    }

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk; });
    proc.stderr.on('data', chunk => { stderr += chunk; });

    proc.on('error', err => {
      console.warn(`[jobspy] Python process error: ${err.message}`);
      console.warn('[jobspy] Skipping JobSpy scan.');
      resolve_(0);
    });

    proc.on('close', code => {
      // Print all stdout from JobSpy (it has its own summary lines)
      for (const line of stdout.split('\n')) {
        if (line.trim()) console.log(`  ${line}`);
      }
      if (stderr.trim()) {
        // Filter out noisy library log lines (INFO/WARNING/ERROR from jobspy logger)
        // Only surface Python tracebacks and import errors
        const stderrLines = stderr.split('\n').filter(line => {
          const t = line.trim();
          if (!t) return false;
          // Skip standard jobspy logging output (INFO, WARNING, ERROR lines from the logging module)
          if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} - (INFO|WARNING|ERROR|DEBUG)/.test(t)) return false;
          if (t.includes('DeprecationWarning') || t.includes('UserWarning')) return false;
          return true;
        });
        for (const line of stderrLines) {
          console.warn(`  [jobspy stderr] ${line}`);
        }
      }
      if (code !== 0 && code !== null) {
        console.warn(`[jobspy] scan-jobspy.py exited with code ${code} — continuing.`);
      }

      // Parse "Total new: N" from the summary output
      const match = stdout.match(/Total new:\s*(\d+)/);
      const newCount = match ? parseInt(match[1], 10) : 0;
      console.log('');
      resolve_(newCount);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // --jobspy-only: run ONLY the JobSpy Python scan and exit
  if (JOBSPY_ONLY) {
    const newCount = await runJobSpyScan();
    if (newCount > 0) {
      console.log(`→ Run /career-ops pipeline to evaluate the ${newCount} new offer(s).`);
    } else {
      console.log('→ No new JobSpy offers found.');
    }
    return;
  }

  console.log('');
  console.log(`Portal Scan — ${new Date().toISOString().slice(0, 10)}`);
  console.log('━'.repeat(40));
  console.log(`  Mode:     ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Filter:   greenhouse-only=${GREENHOUSE_ONLY}`);
  console.log(`  Window:   last ${SINCE_DAYS} day(s)`);
  console.log('');

  // Load config
  const cfg = loadConfig();
  const titleFilter  = cfg.title_filter || {};
  const companies    = (cfg.tracked_companies || []).filter(c => c.enabled !== false);

  // Greenhouse companies with api: defined
  const ghCompanies = companies.filter(c => c.api);

  console.log(`  Tracked companies (enabled): ${companies.length}`);
  console.log(`  Greenhouse API targets:      ${ghCompanies.length}`);
  console.log('');

  // Load dedup sets
  const historyUrls  = loadHistory();
  const pipelineUrls = loadPipelineUrls();
  const appliedKeys  = loadApplicationKeys();

  const seenUrls = new Set([...historyUrls, ...pipelineUrls]);

  // Fetch all Greenhouse companies in parallel
  console.log('Fetching Greenhouse APIs...');
  const fetchResults = await Promise.all(
    ghCompanies.map(c => fetchGreenhouse(c.api, c.name))
  );

  let totalFound    = 0;
  let totalFiltered = 0;  // passed title filter (before dedup)
  let totalNew      = 0;
  let totalDup      = 0;
  let totalSkipped  = 0;

  const toAdd     = [];  // entries to write to pipeline.md
  const historyRows = []; // all rows to append to scan-history.tsv

  for (let idx = 0; idx < ghCompanies.length; idx++) {
    const company = ghCompanies[idx];
    const jobs    = fetchResults[idx];

    console.log(`  ${company.name}: ${jobs.length} jobs returned`);
    totalFound += jobs.length;

    for (const job of jobs) {
      if (!job.url || !job.title) continue;

      // Date window
      if (!isWithinWindow(job, SINCE_DAYS)) continue;

      // Title filter
      const filterResult = matchesFilter(job.title, titleFilter);
      if (!filterResult.match) {
        historyRows.push({
          url:     job.url,
          portal:  `greenhouse/${company.name}`,
          title:   job.title,
          company: company.name,
          status:  'skipped_title',
        });
        totalSkipped++;
        continue;
      }

      totalFiltered++;

      // Dedup: URL already in history or pipeline
      if (seenUrls.has(job.url)) {
        historyRows.push({
          url:     job.url,
          portal:  `greenhouse/${company.name}`,
          title:   job.title,
          company: company.name,
          status:  'skipped_dup',
        });
        totalDup++;
        continue;
      }

      // Dedup: company+role already applied
      const appKey = normalizeKey(`${company.name}:${job.title}`);
      if (appliedKeys.has(appKey)) {
        historyRows.push({
          url:     job.url,
          portal:  `greenhouse/${company.name}`,
          title:   job.title,
          company: company.name,
          status:  'skipped_dup',
        });
        totalDup++;
        continue;
      }

      // New match
      seenUrls.add(job.url); // prevent intra-run duplicates
      toAdd.push(job);
      historyRows.push({
        url:     job.url,
        portal:  `greenhouse/${company.name}`,
        title:   job.title,
        company: company.name,
        status:  'added',
      });
      totalNew++;
    }
  }

  // --- Ashby ATS companies via Playwright (skipped when --greenhouse-only) ---
  if (!GREENHOUSE_ONLY) {
    const ashbyCompanies = (cfg.ashby_companies || []).filter(c => c.enabled !== false);
    if (ashbyCompanies.length > 0) {
      console.log(`Fetching Ashby (Playwright) (${ashbyCompanies.length} companies)...`);
      const ashbyResults = await fetchAshbyPlaywright(ashbyCompanies);
      for (const { company, jobs } of ashbyResults) {
        console.log(`  ${company.name}: ${jobs.length} jobs`);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          const filterResult = matchesFilter(job.title, titleFilter);
          if (!filterResult.match) {
            historyRows.push({ url: job.url, portal: `ashby/${company.name}`, title: job.title, company: company.name, status: 'skipped_title' });
            totalSkipped++;
            continue;
          }
          totalFiltered++;
          if (seenUrls.has(job.url)) {
            historyRows.push({ url: job.url, portal: `ashby/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          const appKey = normalizeKey(`${company.name}:${job.title}`);
          if (appliedKeys.has(appKey)) {
            historyRows.push({ url: job.url, portal: `ashby/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          seenUrls.add(job.url);
          toAdd.push(job);
          historyRows.push({ url: job.url, portal: `ashby/${company.name}`, title: job.title, company: company.name, status: 'added' });
          totalNew++;
        }
      }
      console.log('');
    }
  }

  // --- Lever ATS companies (skipped when --greenhouse-only) ---
  if (!GREENHOUSE_ONLY) {
    const leverCompanies = (cfg.lever_companies || []).filter(c => c.enabled !== false);
    if (leverCompanies.length > 0) {
      console.log(`Fetching Lever APIs (${leverCompanies.length} companies)...`);
      const leverResults = await Promise.all(
        leverCompanies.map(c => fetchLever(c.slug, c.name))
      );
      for (let idx = 0; idx < leverCompanies.length; idx++) {
        const company = leverCompanies[idx];
        const jobs    = leverResults[idx];
        console.log(`  ${company.name}: ${jobs.length} jobs returned`);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          if (!isWithinWindow(job, SINCE_DAYS)) continue;
          const filterResult = matchesFilter(job.title, titleFilter);
          if (!filterResult.match) {
            historyRows.push({ url: job.url, portal: `lever/${company.name}`, title: job.title, company: company.name, status: 'skipped_title' });
            totalSkipped++;
            continue;
          }
          totalFiltered++;
          if (seenUrls.has(job.url)) {
            historyRows.push({ url: job.url, portal: `lever/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          const appKey = normalizeKey(`${company.name}:${job.title}`);
          if (appliedKeys.has(appKey)) {
            historyRows.push({ url: job.url, portal: `lever/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          seenUrls.add(job.url);
          toAdd.push(job);
          historyRows.push({ url: job.url, portal: `lever/${company.name}`, title: job.title, company: company.name, status: 'added' });
          totalNew++;
        }
      }
      console.log('');
    }
  }

  // --- SmartRecruiters ATS companies (skipped when --greenhouse-only) ---
  if (!GREENHOUSE_ONLY) {
    const srCompanies = (cfg.smartrecruiters_companies || []).filter(c => c.enabled !== false);
    if (srCompanies.length > 0) {
      console.log(`Fetching SmartRecruiters APIs (${srCompanies.length} companies)...`);
      const srResults = await Promise.all(
        srCompanies.map(c => fetchSmartRecruiters(c.slug, c.name, c.query || ''))
      );
      for (let idx = 0; idx < srCompanies.length; idx++) {
        const company = srCompanies[idx];
        const jobs    = srResults[idx];
        console.log(`  ${company.name}: ${jobs.length} jobs returned`);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          if (!isWithinWindow(job, SINCE_DAYS)) continue;
          const filterResult = matchesFilter(job.title, titleFilter);
          if (!filterResult.match) {
            historyRows.push({ url: job.url, portal: `smartrecruiters/${company.name}`, title: job.title, company: company.name, status: 'skipped_title' });
            totalSkipped++;
            continue;
          }
          totalFiltered++;
          if (seenUrls.has(job.url)) {
            historyRows.push({ url: job.url, portal: `smartrecruiters/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          const appKey = normalizeKey(`${company.name}:${job.title}`);
          if (appliedKeys.has(appKey)) {
            historyRows.push({ url: job.url, portal: `smartrecruiters/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          seenUrls.add(job.url);
          toAdd.push(job);
          historyRows.push({ url: job.url, portal: `smartrecruiters/${company.name}`, title: job.title, company: company.name, status: 'added' });
          totalNew++;
        }
      }
      console.log('');
    }
  }

  // --- WorkDay ATS companies via Playwright (skipped when --greenhouse-only) ---
  // Wrapped in try/catch — WorkDay browser crashes should not kill the whole scan (v14 safety)
  if (!GREENHOUSE_ONLY) {
    const wdCompanies = (cfg.workday_companies || []).filter(c => c.enabled !== false);
    if (wdCompanies.length > 0) {
      console.log(`Fetching WorkDay (Playwright) (${wdCompanies.length} companies)...`);
      let wdResults = [];
      try {
        wdResults = await fetchWorkday(wdCompanies);
      } catch (err) {
        console.warn(`  [FATAL recovered] WorkDay scan crashed: ${err.message.slice(0, 100)}`);
        console.warn(`  Continuing with other scanners...`);
        wdResults = [];
      }
      for (const { company, jobs } of wdResults) {
        console.log(`  ${company.name}: ${jobs.length} jobs`);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          const filterResult = matchesFilter(job.title, titleFilter);
          if (!filterResult.match) {
            historyRows.push({ url: job.url, portal: `workday/${company.name}`, title: job.title, company: company.name, status: 'skipped_title' });
            totalSkipped++;
            continue;
          }
          totalFiltered++;
          if (seenUrls.has(job.url)) {
            historyRows.push({ url: job.url, portal: `workday/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          const appKey = normalizeKey(`${company.name}:${job.title}`);
          if (appliedKeys.has(appKey)) {
            historyRows.push({ url: job.url, portal: `workday/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          seenUrls.add(job.url);
          toAdd.push(job);
          historyRows.push({ url: job.url, portal: `workday/${company.name}`, title: job.title, company: company.name, status: 'added' });
          totalNew++;
        }
      }
      console.log('');
    }
  }

  // --- iCIMS ATS companies via Playwright (v14) ---
  if (!GREENHOUSE_ONLY) {
    const icimsCompanies = (cfg.icims_companies || []).filter(c => c.enabled !== false);
    if (icimsCompanies.length > 0) {
      console.log(`Fetching iCIMS (Playwright) (${icimsCompanies.length} companies)...`);
      const icimsResults = await fetchICIMS(icimsCompanies);
      for (const { company, jobs } of icimsResults) {
        console.log(`  ${company.name}: ${jobs.length} jobs`);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          const filterResult = matchesFilter(job.title, titleFilter);
          if (!filterResult.match) {
            historyRows.push({ url: job.url, portal: `icims/${company.name}`, title: job.title, company: company.name, status: 'skipped_title' });
            totalSkipped++;
            continue;
          }
          totalFiltered++;
          if (seenUrls.has(job.url)) {
            historyRows.push({ url: job.url, portal: `icims/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          const appKey = normalizeKey(`${company.name}:${job.title}`);
          if (appliedKeys.has(appKey)) {
            historyRows.push({ url: job.url, portal: `icims/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          seenUrls.add(job.url);
          toAdd.push(job);
          historyRows.push({ url: job.url, portal: `icims/${company.name}`, title: job.title, company: company.name, status: 'added' });
          totalNew++;
        }
      }
      console.log('');
    }
  }

  // --- Workable ATS companies (v14) ---
  if (!GREENHOUSE_ONLY) {
    const workableCompanies = (cfg.workable_companies || []).filter(c => c.enabled !== false);
    if (workableCompanies.length > 0) {
      console.log(`Fetching Workable APIs (${workableCompanies.length} companies)...`);
      const workableResults = await Promise.all(
        workableCompanies.map(c => fetchWorkable(c.slug, c.name))
      );
      for (let idx = 0; idx < workableCompanies.length; idx++) {
        const company = workableCompanies[idx];
        const jobs = workableResults[idx];
        console.log(`  ${company.name}: ${jobs.length} jobs returned`);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          if (!isWithinWindow(job, SINCE_DAYS)) continue;
          const filterResult = matchesFilter(job.title, titleFilter);
          if (!filterResult.match) {
            historyRows.push({ url: job.url, portal: `workable/${company.name}`, title: job.title, company: company.name, status: 'skipped_title' });
            totalSkipped++;
            continue;
          }
          totalFiltered++;
          if (seenUrls.has(job.url)) {
            historyRows.push({ url: job.url, portal: `workable/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          const appKey = normalizeKey(`${company.name}:${job.title}`);
          if (appliedKeys.has(appKey)) {
            historyRows.push({ url: job.url, portal: `workable/${company.name}`, title: job.title, company: company.name, status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          seenUrls.add(job.url);
          toAdd.push(job);
          historyRows.push({ url: job.url, portal: `workable/${company.name}`, title: job.title, company: company.name, status: 'added' });
          totalNew++;
        }
      }
      console.log('');
    }
  }

  // --- Built In queries via Playwright (v14) ---
  if (!GREENHOUSE_ONLY) {
    const builtinQueries = cfg.builtin_queries || [];
    if (builtinQueries.length > 0) {
      console.log(`Fetching Built In (Playwright) (${builtinQueries.length} queries)...`);
      const builtinResults = await fetchBuiltIn(builtinQueries);
      for (const { query, jobs } of builtinResults) {
        console.log(`  "${query.query}" (${query.city || 'any'}): ${jobs.length} jobs`);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          const filterResult = matchesFilter(job.title, titleFilter);
          if (!filterResult.match) {
            historyRows.push({ url: job.url, portal: `builtin/${query.name || query.query}`, title: job.title, company: 'BuiltIn', status: 'skipped_title' });
            totalSkipped++;
            continue;
          }
          totalFiltered++;
          if (seenUrls.has(job.url)) {
            historyRows.push({ url: job.url, portal: `builtin/${query.name || query.query}`, title: job.title, company: 'BuiltIn', status: 'skipped_dup' });
            totalDup++;
            continue;
          }
          seenUrls.add(job.url);
          toAdd.push(job);
          historyRows.push({ url: job.url, portal: `builtin/${query.name || query.query}`, title: job.title, company: 'BuiltIn', status: 'added' });
          totalNew++;
        }
      }
      console.log('');
    }
  }

  // --- Job board queries via Firecrawl (skipped when --greenhouse-only) ---
  if (!GREENHOUSE_ONLY) {
    console.log('Fetching job board queries via Firecrawl...');
    const boardJobs = await runJobBoardQueries(cfg);

    for (const job of boardJobs) {
      if (!job.url || !job.title) continue;
      totalFound++;

      const filterResult = matchesFilter(job.title, titleFilter);
      if (!filterResult.match) {
        historyRows.push({ url: job.url, portal: job.portal, title: job.title, company: job.company, status: 'skipped_title' });
        totalSkipped++;
        continue;
      }
      totalFiltered++;

      if (seenUrls.has(job.url)) {
        historyRows.push({ url: job.url, portal: job.portal, title: job.title, company: job.company, status: 'skipped_dup' });
        totalDup++;
        continue;
      }

      const appKey = normalizeKey(`${job.company}:${job.title}`);
      if (appliedKeys.has(appKey)) {
        historyRows.push({ url: job.url, portal: job.portal, title: job.title, company: job.company, status: 'skipped_dup' });
        totalDup++;
        continue;
      }

      seenUrls.add(job.url);
      toAdd.push(job);
      historyRows.push({ url: job.url, portal: job.portal, title: job.title, company: job.company, status: 'added' });
      totalNew++;
    }
    console.log('');
  }

  // --- JobSpy Python scan (skipped when --greenhouse-only) ---
  let jobspyNewCount = 0;
  if (!GREENHOUSE_ONLY) {
    jobspyNewCount = await runJobSpyScan();
    totalNew += jobspyNewCount;
  }

  // Summary
  console.log('');
  console.log('━'.repeat(40));
  console.log(`Offers found (all):       ${totalFound}`);
  console.log(`Filtered by title:        ${totalSkipped} skipped`);
  console.log(`Title-matched:            ${totalFiltered}`);
  console.log(`Duplicates (deduped):     ${totalDup}`);
  console.log(`New added to pipeline:    ${totalNew - jobspyNewCount} (ATS) + ${jobspyNewCount} (JobSpy) = ${totalNew} total`);
  console.log('');

  if (toAdd.length > 0) {
    console.log('New matches:');
    for (const e of toAdd) {
      const boost = (titleFilter.seniority_boost || []).some(kw =>
        e.title.toLowerCase().includes(kw.toLowerCase())
      ) ? ' [BOOST]' : '';
      console.log(`  + ${e.company} | ${e.title}${boost}`);
      console.log(`    ${e.url}`);
    }
    console.log('');
  }

  if (!DRY_RUN) {
    if (toAdd.length > 0) {
      appendToPipeline(toAdd);
      console.log(`Written ${toAdd.length} entries to pipeline.md`);

      // Auto-generate prefilter cards for newly-added entries
      console.log('Generating prefilter cards...');
      const { execFileSync } = await import('child_process');
      try {
        execFileSync(process.execPath, [resolve(__dir, 'prefilter-pipeline.mjs')], {
          stdio: 'inherit',
          cwd:   ROOT,
        });
      } catch (e) {
        console.warn(`[WARN] prefilter-pipeline.mjs failed: ${e.message}`);
      }
    }
    if (historyRows.length > 0) {
      appendHistory(historyRows);
      console.log(`Written ${historyRows.length} rows to scan-history.tsv`);
    }

    // Auto-promote: scan ALL prefilter cards for score >= 4.0, promote to applications.md
    await autoPromoteHighScores();
  } else {
    console.log('[DRY RUN] No files written.');
    if (historyRows.length > 0) {
      console.log(`[DRY RUN] Would write ${historyRows.length} rows to scan-history.tsv`);
    }
  }

  // Write daily scan summary (live runs only)
  if (!DRY_RUN) {
    const today = new Date().toISOString().slice(0, 10);
    const summaryPath = resolve(ROOT, 'data', `scan-summary-${today}.md`);
    const summaryLines = [
      `# Scan Summary ${today}`,
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Total found | ${totalFound} |`,
      `| Title-filtered (skipped) | ${totalSkipped} |`,
      `| Title-matched | ${totalFiltered} |`,
      `| Duplicates | ${totalDup} |`,
      `| **New added** | **${totalNew}** |`,
      '',
    ];
    if (toAdd.length > 0) {
      summaryLines.push('## New Matches', '');
      for (const j of toAdd) {
        summaryLines.push(`- [${j.title}](${j.url}) — ${j.company}`);
      }
      summaryLines.push('');
    }
    writeFileSync(summaryPath, summaryLines.join('\n'));
    console.log(`Summary written: ${summaryPath}`);
  }

  console.log('');
  if (totalNew > 0) {
    console.log(`→ Run /career-ops pipeline to evaluate the ${totalNew} new offer(s).`);
  } else {
    console.log('→ No new offers found. Nothing to evaluate.');
  }
  console.log('');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
