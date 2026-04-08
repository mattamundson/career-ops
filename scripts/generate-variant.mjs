#!/usr/bin/env node

/**
 * generate-variant.mjs — Archetype CV variant generator
 *
 * Usage:
 *   node scripts/generate-variant.mjs --variant=operational-data-architect
 *   node scripts/generate-variant.mjs --all
 *   node scripts/generate-variant.mjs --all --pdf
 *
 * Reads:
 *   - cv.md                          (resume source)
 *   - config/profile.yml             (candidate identity)
 *   - config/archetype-variants.yml  (variant definitions)
 *   - templates/cv-template.html     (HTML template with {{placeholders}})
 *
 * Outputs: output/cv-matt-{slug}.html (and .pdf if --pdf)
 *
 * No external deps — YAML parsed manually, pure ESM.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const doAll  = flags.all  === true;
const doPdf  = flags.pdf  === true;
const slug   = typeof flags.variant === 'string' ? flags.variant : null;

if (!doAll && !slug) {
  console.error('Error: supply --variant=<slug> or --all');
  console.error('  node scripts/generate-variant.mjs --variant=operational-data-architect');
  console.error('  node scripts/generate-variant.mjs --all');
  console.error('  node scripts/generate-variant.mjs --all --pdf');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal YAML parser — handles the archetype-variants.yml structure:
//   top-level key: value
//   list items:    "- item" or "  - item"
//   nested blocks identified by indentation
//
// Returns: { variants: [ { slug, name, lead_summary, competency_tags[], keyword_families[], summary_angle } ] }
// ---------------------------------------------------------------------------

function parseVariantsYaml(text) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  let current = null;
  let inField = null; // name of array field currently being collected

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const stripped = raw.trimEnd();
    if (!stripped || stripped.trimStart().startsWith('#')) continue;

    const indent = raw.match(/^(\s*)/)[1].length;

    // Top-level variant block starts with "- slug:" at indent 0 or 2
    const variantStart = stripped.match(/^\s*-\s+slug:\s*(.+)$/);
    if (variantStart) {
      if (current) variants.push(current);
      current = {
        slug: variantStart[1].trim().replace(/^['"]|['"]$/g, ''),
        name: '',
        lead_summary: '',
        competency_tags: [],
        keyword_families: [],
        summary_angle: '',
      };
      inField = null;
      continue;
    }

    if (!current) continue;

    // Simple scalar fields (name, lead_summary, summary_angle)
    const scalarMatch = stripped.match(/^\s+(name|lead_summary|summary_angle):\s*(.*)$/);
    if (scalarMatch) {
      inField = null;
      const fieldName = scalarMatch[1];
      let val = scalarMatch[2].trim().replace(/^['"]|['"]$/g, '');

      // Multi-line scalar: value may be empty — check for continuation lines
      if (val === '' || val === '|' || val === '>') {
        // Collect indented continuation lines
        const baseIndent = indent;
        const parts = [];
        let j = i + 1;
        while (j < lines.length) {
          const nextRaw = lines[j];
          const nextStripped = nextRaw.trimEnd();
          if (!nextStripped) { parts.push(''); j++; continue; }
          const nextIndent = nextRaw.match(/^(\s*)/)[1].length;
          if (nextIndent <= baseIndent && nextStripped.trim() !== '') break;
          parts.push(nextStripped.trim());
          j++;
        }
        val = parts.join(' ').trim();
        i = j - 1; // skip consumed lines
      }

      current[fieldName] = val;
      continue;
    }

    // Array field headers: "competency_tags:" or "keyword_families:"
    const arrayHeaderMatch = stripped.match(/^\s+(competency_tags|keyword_families):\s*$/);
    if (arrayHeaderMatch) {
      inField = arrayHeaderMatch[1];
      continue;
    }

    // Array items under current inField
    if (inField) {
      const itemMatch = stripped.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        current[inField].push(itemMatch[1].trim().replace(/^['"]|['"]$/g, ''));
        continue;
      } else {
        // Non-item line signals end of array
        inField = null;
      }
    }
  }

  if (current) variants.push(current);
  return variants;
}

// ---------------------------------------------------------------------------
// Simple key:value YAML reader for profile.yml
// ---------------------------------------------------------------------------

function parseProfileYaml(text) {
  const profile = {};
  const lines = text.split(/\r?\n/);
  let section = null;

  for (const line of lines) {
    const stripped = line.trimEnd();
    if (!stripped || stripped.trimStart().startsWith('#')) continue;

    // Top-level section
    const sectionMatch = stripped.match(/^(\w[\w_]*):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      profile[section] = {};
      continue;
    }

    // Indented key: value
    if (section) {
      const kvMatch = stripped.match(/^\s+([\w_]+):\s*"?([^"]*)"?\s*$/);
      if (kvMatch) {
        profile[section][kvMatch[1]] = kvMatch[2].trim();
      }
    }
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Extract professional summary from cv.md
// ---------------------------------------------------------------------------

function extractSummaryFromMd(md) {
  const match = md.match(/##\s+Professional Summary\s*\n+([\s\S]+?)(?:\n##|\n---)/);
  if (!match) return '';
  return match[1].trim();
}

// ---------------------------------------------------------------------------
// Build HTML from template + variant data
// ---------------------------------------------------------------------------

function buildHtml(template, profile, variant) {
  const c = profile.candidate || {};

  const fullName    = c.full_name    || 'Matthew M. Amundson';
  const email       = c.email        || '';
  const phone       = c.phone        || '';
  const location    = c.location     || '';
  const linkedin    = c.linkedin     || '';
  const github      = c.github       || '';

  // Competency tags HTML
  const competencyHtml = variant.competency_tags
    .map(tag => `      <span class="competency-tag">${escapeHtml(tag)}</span>`)
    .join('\n');

  // Contact line: phone | email | linkedin | github | location
  // Template already has individual placeholders — fill them
  let html = template;

  html = html.replace(/\{\{NAME\}\}/g,              escapeHtml(fullName));
  html = html.replace(/\{\{FULL_NAME\}\}/g,         escapeHtml(fullName));
  html = html.replace(/\{\{EMAIL\}\}/g,             escapeHtml(email));
  html = html.replace(/\{\{PHONE\}\}/g,             escapeHtml(phone));
  html = html.replace(/\{\{LOCATION\}\}/g,          escapeHtml(location));
  html = html.replace(/\{\{LANG\}\}/g,              'en');
  html = html.replace(/\{\{PAGE_WIDTH\}\}/g,        '816px');

  // LinkedIn
  const linkedinUrl = linkedin.startsWith('http') ? linkedin : `https://${linkedin}`;
  html = html.replace(/\{\{LINKEDIN_URL\}\}/g,      linkedinUrl);
  html = html.replace(/\{\{LINKEDIN_DISPLAY\}\}/g,  escapeHtml(linkedin));

  // Portfolio / GitHub — template uses PORTFOLIO_URL / PORTFOLIO_DISPLAY
  const githubUrl = github.startsWith('http') ? github : `https://${github}`;
  html = html.replace(/\{\{PORTFOLIO_URL\}\}/g,     githubUrl);
  html = html.replace(/\{\{PORTFOLIO_DISPLAY\}\}/g, escapeHtml(github));

  // Summary — variant lead_summary takes priority
  const summaryText = variant.lead_summary || '';
  html = html.replace(/\{\{SUMMARY_TEXT\}\}/g,      summaryText);
  html = html.replace(/\{\{SUMMARY\}\}/g,           summaryText);
  html = html.replace(/\{\{CONTACT_LINE\}\}/g,      buildContactLine(c));

  // Competencies
  html = html.replace(/\{\{COMPETENCIES\}\}/g,      competencyHtml);
  html = html.replace(/\{\{COMPETENCY_TAGS\}\}/g,   competencyHtml);

  // Section labels (defaults — template already has these hardcoded in most cases)
  html = html.replace(/\{\{SECTION_SUMMARY\}\}/g,       'Professional Summary');
  html = html.replace(/\{\{SECTION_COMPETENCIES\}\}/g,  'Core Competencies');
  html = html.replace(/\{\{SECTION_EXPERIENCE\}\}/g,    'Professional Experience');
  html = html.replace(/\{\{SECTION_PROJECTS\}\}/g,      'Selected Projects');
  html = html.replace(/\{\{SECTION_EDUCATION\}\}/g,     'Education');
  html = html.replace(/\{\{SECTION_CERTIFICATIONS\}\}/g,'Certifications');
  html = html.replace(/\{\{SECTION_SKILLS\}\}/g,        'Technical Skills');

  // Remaining block placeholders — leave empty (these sections are rendered
  // by the full cv-builder; this script only handles the archetype overrides)
  html = html.replace(/\{\{EXPERIENCE\}\}/g,        '<!-- experience populated by full builder -->');
  html = html.replace(/\{\{PROJECTS\}\}/g,          '<!-- projects populated by full builder -->');
  html = html.replace(/\{\{EDUCATION\}\}/g,         '<!-- education populated by full builder -->');
  html = html.replace(/\{\{CERTIFICATIONS\}\}/g,    '<!-- certifications populated by full builder -->');
  html = html.replace(/\{\{SKILLS\}\}/g,            '<!-- skills populated by full builder -->');

  // Variant metadata comment at top of <body> for debugging
  const meta = `<!-- variant: ${variant.slug} | ${variant.name} | ${new Date().toISOString().slice(0,10)} -->\n`;
  html = html.replace(/(<body>)/, `$1\n${meta}`);

  return html;
}

function buildContactLine(c) {
  const parts = [c.phone, c.email, c.linkedin, c.github, c.location].filter(Boolean);
  return parts.join(' · ');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// PDF generation — calls generate-pdf.mjs as a child process
// ---------------------------------------------------------------------------

function generatePdf(htmlPath, slugStr) {
  const pdfPath = htmlPath.replace(/\.html$/, '.pdf');
  const genPdf  = resolve(ROOT, 'generate-pdf.mjs');
  const cmd     = `node "${genPdf}" "${htmlPath}" "${pdfPath}" --format=letter`;
  console.log(`  PDF: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
  } catch (err) {
    console.error(`  PDF generation failed for ${slugStr}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Paths
  const profilePath  = resolve(ROOT, 'config', 'profile.yml');
  const variantsPath = resolve(ROOT, 'config', 'archetype-variants.yml');
  const templatePath = resolve(ROOT, 'templates', 'cv-template.html');
  const cvMdPath     = resolve(ROOT, 'cv.md');
  const outputDir    = resolve(ROOT, 'output');

  // Validate required files
  for (const [label, p] of [
    ['config/profile.yml',            profilePath],
    ['templates/cv-template.html',    templatePath],
    ['cv.md',                         cvMdPath],
  ]) {
    if (!existsSync(p)) {
      console.error(`Error: required file not found: ${label} (${p})`);
      process.exit(1);
    }
  }

  if (!existsSync(variantsPath)) {
    console.error(`Error: config/archetype-variants.yml not found.`);
    console.error(`  Expected: ${variantsPath}`);
    console.error(`  This file is created by the archetype-variants agent.`);
    console.error(`  Once it exists, re-run this script.`);
    process.exit(1);
  }

  // Read inputs
  const [profileRaw, variantsRaw, templateRaw, cvMd] = await Promise.all([
    readFile(profilePath,  'utf-8'),
    readFile(variantsPath, 'utf-8'),
    readFile(templatePath, 'utf-8'),
    readFile(cvMdPath,     'utf-8'),
  ]);

  const profile  = parseProfileYaml(profileRaw);
  const variants = parseVariantsYaml(variantsRaw);

  if (variants.length === 0) {
    console.error('Error: no variants found in config/archetype-variants.yml');
    console.error('  Expected at least one block starting with "- slug: <name>"');
    process.exit(1);
  }

  console.log(`Loaded ${variants.length} variant(s): ${variants.map(v => v.slug).join(', ')}`);

  // Ensure output dir exists
  await mkdir(outputDir, { recursive: true });

  // Determine which variants to generate
  let targets;
  if (doAll) {
    targets = variants;
  } else {
    const found = variants.find(v => v.slug === slug);
    if (!found) {
      console.error(`Error: variant "${slug}" not found in archetype-variants.yml`);
      console.error(`  Available slugs: ${variants.map(v => v.slug).join(', ')}`);
      process.exit(1);
    }
    targets = [found];
  }

  // Generate each variant
  for (const variant of targets) {
    const outName = `cv-matt-${variant.slug}.html`;
    const outPath = resolve(outputDir, outName);

    console.log(`\nGenerating: ${outName}`);
    console.log(`  Name:    ${variant.name}`);
    console.log(`  Tags:    ${variant.competency_tags.slice(0, 4).join(', ')}${variant.competency_tags.length > 4 ? '...' : ''}`);
    console.log(`  Summary: ${variant.lead_summary.slice(0, 80)}...`);

    const html = buildHtml(templateRaw, profile, variant);
    await writeFile(outPath, html, 'utf-8');
    console.log(`  Written: ${outPath}`);

    if (doPdf) {
      generatePdf(outPath, variant.slug);
    }
  }

  console.log(`\nDone. ${targets.length} variant(s) generated.`);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
