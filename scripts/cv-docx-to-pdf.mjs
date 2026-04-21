#!/usr/bin/env node
/**
 * cv-docx-to-pdf.mjs — DOCX-based CV generation (the trustworthy path)
 *
 * The HTML-template path at generate-pdf.mjs has been broken for a while
 * (empty sections, stale content — see memory feedback_pdf_generation_broken).
 * Matt's professionally-designed master at output/Matt_Amundson_TOP_2026.docx
 * renders correctly via Word — we tailor it per role and convert via docx2pdf.
 *
 * Usage:
 *   node scripts/cv-docx-to-pdf.mjs \
 *     --headline "Data Architect | Snowflake · dbt · Airflow" \
 *     --summary  "Data & analytics leader with 10+ years..." \
 *     --out output/cv-acme-data-architect
 *
 *   # From a report file (pulls headline/summary from YAML frontmatter):
 *   node scripts/cv-docx-to-pdf.mjs --from-report reports/123-acme-2026-04-20.md
 *
 *   # Skip PDF conversion (useful in CI where Word COM isn't available):
 *   node scripts/cv-docx-to-pdf.mjs ... --docx-only
 *
 * Outputs both {out}.docx and {out}.pdf.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { isMainEntry } from './lib/main-entry.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const PY_HELPER = resolve(ROOT, 'scripts', 'lib', 'cv_docx_tailor.py');

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { headline: null, summary: null, out: null, docxOnly: false, fromReport: null, master: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = a.indexOf('=');
    const [k, v] = eq >= 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, args[i + 1]];
    if (k === '--headline')      { out.headline = v; if (eq < 0) i++; }
    else if (k === '--summary')   { out.summary = v; if (eq < 0) i++; }
    else if (k === '--out')       { out.out = v; if (eq < 0) i++; }
    else if (k === '--master')    { out.master = v; if (eq < 0) i++; }
    else if (k === '--from-report') { out.fromReport = v; if (eq < 0) i++; }
    else if (k === '--docx-only') { out.docxOnly = true; }
    else if (k === '--help' || k === '-h') { out.help = true; }
  }
  return out;
}

// Extract headline + summary from a report YAML frontmatter.
// Reports live at reports/{NNN}-{slug}-{date}.md. Expected frontmatter keys:
//   cv_headline: "..."
//   cv_summary: "..."
// Falls back to the report's "Headline" and "Summary" sections if present.
function extractFromReport(path) {
  const content = readFileSync(path, 'utf-8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  let headline = null;
  let summary = null;
  if (fmMatch) {
    const fm = fmMatch[1];
    const hm = fm.match(/^cv_headline:\s*["']?(.*?)["']?\s*$/m);
    const sm = fm.match(/^cv_summary:\s*["']?([\s\S]*?)["']?\s*$/m);
    if (hm) headline = hm[1].trim();
    if (sm) summary = sm[1].trim();
  }
  return { headline, summary };
}

function resolvePython() {
  // Prefer engine/.venv on Matt's setup, fall back to system python.
  const candidates = [
    resolve(ROOT, 'engine', '.venv', 'Scripts', 'python.exe'),
    resolve(ROOT, '.venv', 'Scripts', 'python.exe'),
    'python',
  ];
  for (const c of candidates) {
    if (c.includes('.venv') && !existsSync(c)) continue;
    return c;
  }
  return 'python';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.out) {
    console.error('Usage: node scripts/cv-docx-to-pdf.mjs --headline "..." --summary "..." --out output/cv-foo');
    console.error('       node scripts/cv-docx-to-pdf.mjs --from-report reports/123-foo-2026-04-20.md --out output/cv-foo');
    process.exit(args.help ? 0 : 1);
  }

  let { headline, summary } = args;
  if (args.fromReport) {
    const extracted = extractFromReport(args.fromReport);
    headline = headline ?? extracted.headline;
    summary = summary ?? extracted.summary;
    if (!headline && !summary) {
      console.warn(`[cv-docx-to-pdf] report ${args.fromReport} has no cv_headline or cv_summary frontmatter; using master unchanged`);
    }
  }

  const py = resolvePython();
  const cliArgs = [PY_HELPER, '--out', args.out];
  if (headline) cliArgs.push('--headline', headline);
  if (summary)  cliArgs.push('--summary',  summary);
  if (args.master) cliArgs.push('--master', args.master);
  if (args.docxOnly) cliArgs.push('--docx-only');

  const result = spawnSync(py, cliArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf-8',
  });

  if (result.error) {
    console.error(`[cv-docx-to-pdf] python spawn failed: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (isMainEntry(import.meta.url)) {
  main().catch((err) => {
    console.error('[cv-docx-to-pdf] Fatal:', err.message);
    process.exit(1);
  });
}

export { parseArgs, extractFromReport };
