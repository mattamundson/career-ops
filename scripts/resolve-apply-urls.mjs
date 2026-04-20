#!/usr/bin/env node
/**
 * resolve-apply-urls.mjs
 *
 * For every GO/Conditional GO app whose `**URL:**` field is a LinkedIn or
 * Indeed proxy, open the URL in headless Playwright, hunt for the underlying
 * "Apply on company site" link, and write the resolved URL back into the
 * report file as `**Apply URL:** <resolved>` (separate from `**URL:**`).
 *
 * Why: most queued apps came from LinkedIn auto-scan and have linkedin.com
 * URLs that the dispatcher can't route. Resolving them once turns 17
 * unrouteable apps into ~10-15 direct-ATS apps that apply-review can prep
 * automatically.
 *
 * Usage:
 *   node scripts/resolve-apply-urls.mjs               → dry-run, report only
 *   node scripts/resolve-apply-urls.mjs --apply       → write resolutions back to reports
 *   node scripts/resolve-apply-urls.mjs --id 032      → just one app
 *   node scripts/resolve-apply-urls.mjs --limit 5     → top N by score
 *
 * Classification of resolved URLs:
 *   - external (workable/lever/ashby/greenhouse/icims/workday/etc) → direct-ats
 *   - linkedin-easyapply (only EasyApply available) → flag, no resolve possible
 *   - none-found → log, leave URL field unchanged
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplicationIndex } from './lib/career-data.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
function getArg(name) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = args[i + 1];
  return (v && !v.startsWith('--')) ? v : null;
}
const APPLY = args.includes('--apply');
const ID_ONLY = getArg('id');
const LIMIT = (() => {
  const v = getArg('limit');
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

const QUEUE_STATUSES = new Set(['GO', 'Conditional GO', 'Ready to Submit']);
const PROXY_HOSTS = /linkedin\.com|indeed\.com/i;
const KNOWN_ATS = /workable\.com|lever\.co|ashbyhq\.com|greenhouse\.io|smartrecruiters\.com|workday\.com|icims\.com|myworkdayjobs|taleo|jobvite|breezy\.hr|recruitee\.com|bamboohr\.com|paylocity|adp\.com|smartrecruiters/i;

function urlsFromReport(reportPath) {
  if (!reportPath) return { url: null, applyUrl: null };
  const full = resolve(ROOT, reportPath);
  if (!existsSync(full)) return { url: null, applyUrl: null };
  const body = readFileSync(full, 'utf8');
  const url = body.match(/^\*\*URL:\*\*\s+(https?:\/\/\S+)/m)?.[1] || null;
  const applyUrl = body.match(/^\*\*Apply URL:\*\*\s+(https?:\/\/\S+)/m)?.[1] || null;
  return { url, applyUrl };
}

function writeResolvedUrl(reportPath, resolved, source) {
  const full = resolve(ROOT, reportPath);
  let body = readFileSync(full, 'utf8');
  const line = `**Apply URL:** ${resolved}  <!-- resolved-from: ${source} on ${new Date().toISOString().slice(0, 10)} -->`;
  if (/^\*\*Apply URL:\*\*/m.test(body)) {
    body = body.replace(/^\*\*Apply URL:\*\*.*$/m, line);
  } else {
    // Insert right after the URL line if present, else after first heading
    if (/^\*\*URL:\*\*.+$/m.test(body)) {
      body = body.replace(/^(\*\*URL:\*\*.+)$/m, `$1\n${line}`);
    } else {
      body = body.replace(/^# .+$/m, (h) => `${h}\n\n${line}`);
    }
  }
  writeFileSync(full, body, 'utf8');
}

async function scrapeDomForAts(page) {
  return page.evaluate((atsRegexSrc) => {
    const re = new RegExp(atsRegexSrc, 'i');
    const seen = new Set();
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('http')) return;
      if (!re.test(href)) return;
      if (seen.has(href)) return;
      seen.add(href);
      out.push({ href, text: (a.innerText || '').trim().slice(0, 80) });
    });
    return out;
  }, KNOWN_ATS.source);
}

async function webSearchForAts(page, company, role) {
  // DuckDuckGo HTML endpoint — direct links, no redirector wrappers.
  const q = encodeURIComponent(`"${company}" ${role} apply`);
  const searchUrl = `https://duckduckgo.com/html/?q=${q}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(1500);
  const hits = await page.evaluate((atsRegexSrc) => {
    const re = new RegExp(atsRegexSrc, 'i');
    const out = [];
    // DDG HTML: result links in <a class="result__a"> with raw href, but
    // the href is a redirect like /l/?uddg=<encoded-url>. Decode it.
    document.querySelectorAll('a.result__a, a.result__url').forEach((a) => {
      let href = a.getAttribute('href');
      if (!href) return;
      if (href.startsWith('//')) href = 'https:' + href;
      try {
        const u = new URL(href);
        const uddg = u.searchParams.get('uddg');
        const target = uddg ? decodeURIComponent(uddg) : href;
        if (re.test(target)) out.push(target);
      } catch {
        if (re.test(href)) out.push(href);
      }
    });
    return [...new Set(out)].slice(0, 8);
  }, KNOWN_ATS.source);
  return hits;
}

async function resolveOne(url, company, role) {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { return { state: 'error', reason: 'playwright_unavailable' }; }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(2500);

    // Tier 1: scrape original page DOM for external ATS anchors
    const candidates = await scrapeDomForAts(page);
    if (candidates.length > 0) {
      const preferred = candidates.find((c) => /apply/i.test(c.text)) || candidates[0];
      return { state: 'resolved', url: preferred.href, source: 'dom' };
    }

    // Tier 2: detect LinkedIn EasyApply for honest classification
    const easyApply = await page.evaluate(() => /easy apply/i.test(document.body.innerText || ''));

    // Tier 3: web search fallback. Many LinkedIn job pages won't show external
    // CTAs unauthenticated, but the company's actual ATS posting is usually on
    // the first page of Bing for the right query.
    if (company && role) {
      try {
        const hits = await webSearchForAts(page, company, role);
        if (hits.length > 0) {
          return { state: 'resolved', url: hits[0], source: 'ddg-search' };
        }
      } catch (e) {
        // search failure is non-fatal
      }
    }

    if (easyApply) return { state: 'easyapply-only', reason: 'LinkedIn EasyApply, no DDG ATS hit' };
    return { state: 'none-found', reason: 'DOM + web search both turned up no ATS URL' };
  } catch (e) {
    return { state: 'error', reason: e.message.slice(0, 100) };
  } finally {
    if (browser) try { await browser.close(); } catch {}
  }
}

const snapshot = buildApplicationIndex(ROOT);
let queue = snapshot.records
  .filter((a) => QUEUE_STATUSES.has(a.status))
  .map((a) => {
    const { url, applyUrl } = urlsFromReport(a.reportPath);
    return { ...a, _url: url, _applyUrl: applyUrl };
  })
  .filter((a) => a._url && PROXY_HOSTS.test(a._url) && !a._applyUrl)  // skip already-resolved
  .sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0));

if (ID_ONLY) {
  const norm = String(ID_ONLY).padStart(3, '0');
  queue = queue.filter((a) => a.id === norm);
}
if (LIMIT) queue = queue.slice(0, LIMIT);

console.log(`[resolve-apply-urls] Resolving ${queue.length} apps with proxy URLs (LinkedIn/Indeed) and no Apply URL yet.`);
console.log(`[resolve-apply-urls] Mode: ${APPLY ? 'WRITE-BACK to reports' : 'DRY-RUN (no writes)'}\n`);

const results = [];
for (const app of queue) {
  process.stdout.write(`  #${app.id} ${app.company.padEnd(30).slice(0, 30)} `);
  const r = await resolveOne(app._url, app.company, app.role);
  results.push({ id: app.id, company: app.company, role: app.role, source_url: app._url, ...r });

  if (r.state === 'resolved') {
    console.log(`✅ ${r.url}`);
    if (APPLY && app.reportPath) {
      try {
        writeResolvedUrl(app.reportPath, r.url, app._url);
        console.log(`     → wrote to ${app.reportPath}`);
      } catch (e) {
        console.warn(`     ⚠️ write failed: ${e.message}`);
      }
    }
  } else {
    console.log(`❌ ${r.state} (${r.reason})`);
  }
}

const summary = results.reduce((acc, r) => {
  acc[r.state] = (acc[r.state] || 0) + 1;
  return acc;
}, {});
console.log(`\n[resolve-apply-urls] Summary: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' · ')}`);

// Write a markdown report regardless
const today = new Date().toISOString().slice(0, 10);
const reportPath = resolve(ROOT, 'data', `apply-url-resolve-${today}.md`);
mkdirSync(dirname(reportPath), { recursive: true });
const md = [
  `# Apply URL Resolution — ${today}`,
  '',
  `Mode: ${APPLY ? 'WRITE-BACK' : 'DRY-RUN'}`,
  `Probed ${results.length} apps. Summary: ${JSON.stringify(summary)}.`,
  '',
  '| # | Company | State | Resolved URL or Reason |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.company} | ${r.state} | ${r.state === 'resolved' ? `<${r.url}>` : r.reason} |`),
].join('\n') + '\n';
writeFileSync(reportPath, md, 'utf8');
console.log(`[resolve-apply-urls] Report: ${reportPath}`);

appendAutomationEvent(ROOT, {
  type: 'apply-url-resolve.run.completed',
  apply_mode: APPLY,
  totals: summary,
  probed: results.length,
});
