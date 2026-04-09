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
async function fetchAshby(slug, companyName) {
  const url = `https://jobs.ashbyhq.com/api/non-admin/job-board?organizationHostedJobsPageName=${slug}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'career-ops-auto-scan/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.error(`  [WARN] ${companyName} (Ashby): HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    const postings = data.jobPostings || [];
    return postings.map(p => ({
      title:     p.title || '',
      url:       p.jobUrl || `https://jobs.ashbyhq.com/${slug}/${p.id}`,
      company:   companyName,
      source:    'ashby-api',
      updatedAt: p.publishedDate || null,
    }));
  } catch (err) {
    console.error(`  [ERROR] ${companyName} (Ashby): ${err.message}`);
    return [];
  }
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
  const allResults = [];

  for (const q of queries) {
    console.log(`  [firecrawl] ${q.name}...`);
    try {
      const result = await firecrawl.search(q.query, { limit: 20, lang: 'en', country: 'us' });
      const hits = (result.data ?? []).map(r => ({
        url:     r.url,
        title:   (r.title ?? '').replace(/\s+/g, ' ').trim(),
        company: inferBoardName(r.url),
        portal:  `firecrawl/${q.name}`,
      }));
      console.log(`    → ${hits.length} results`);
      allResults.push(...hits);
    } catch (e) {
      console.warn(`  [firecrawl] ${q.name} failed: ${e.message}`);
    }
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
// Main
// ---------------------------------------------------------------------------
async function main() {
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

  // --- Ashby ATS companies (skipped when --greenhouse-only) ---
  if (!GREENHOUSE_ONLY) {
    const ashbyCompanies = (cfg.ashby_companies || []).filter(c => c.enabled !== false);
    if (ashbyCompanies.length > 0) {
      console.log(`Fetching Ashby APIs (${ashbyCompanies.length} companies)...`);
      const ashbyResults = await Promise.all(
        ashbyCompanies.map(c => fetchAshby(c.slug, c.name))
      );
      for (let idx = 0; idx < ashbyCompanies.length; idx++) {
        const company = ashbyCompanies[idx];
        const jobs    = ashbyResults[idx];
        console.log(`  ${company.name}: ${jobs.length} jobs returned`);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!job.url || !job.title) continue;
          if (!isWithinWindow(job, SINCE_DAYS)) continue;
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

  // Summary
  console.log('');
  console.log('━'.repeat(40));
  console.log(`Offers found (all):       ${totalFound}`);
  console.log(`Filtered by title:        ${totalSkipped} skipped`);
  console.log(`Title-matched:            ${totalFiltered}`);
  console.log(`Duplicates (deduped):     ${totalDup}`);
  console.log(`New added to pipeline:    ${totalNew}`);
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
    }
    if (historyRows.length > 0) {
      appendHistory(historyRows);
      console.log(`Written ${historyRows.length} rows to scan-history.tsv`);
    }
  } else {
    console.log('[DRY RUN] No files written.');
    if (historyRows.length > 0) {
      console.log(`[DRY RUN] Would write ${historyRows.length} rows to scan-history.tsv`);
    }
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
