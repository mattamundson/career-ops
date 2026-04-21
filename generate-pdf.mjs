#!/usr/bin/env node

/**
 * generate-pdf.mjs — HTML → PDF via Playwright
 *
 * ⚠️  NOT THE PRIMARY CV PATH anymore. The HTML template at
 * templates/cv-template.html has known issues producing empty sections and
 * stale content. For the canonical role-tailored CV → PDF flow, use:
 *
 *   node scripts/cv-docx-to-pdf.mjs --headline "..." --summary "..." --out ...
 *
 * That path tailors output/Matt_Amundson_TOP_2026.docx (Matt's professionally
 * designed master) via python-docx + docx2pdf — trustworthy visual output.
 *
 * This file is preserved for:
 *   - scripts/generate-variant.mjs (HTML variant pipeline)
 *   - Ad-hoc HTML-to-PDF rendering
 *
 * Usage:
 *   node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]
 *
 * Requires: @playwright/test (or playwright) installed.
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { runChromePreflight } from './scripts/lib/chrome-preflight.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const toFileURL = (p) => 'file:///' + p.replace(/\\/g, '/');

async function generatePDF() {
  const args = process.argv.slice(2);

  // Parse arguments
  let inputPath, outputPath, format = 'a4', variant = null;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--variant=')) {
      variant = arg.split('=')[1];
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  // --variant mode: generate HTML first, then derive paths
  if (variant) {
    const genVariant = resolve(__dirname, 'scripts', 'generate-variant.mjs');
    console.log(`Generating variant HTML for: ${variant}`);
    execSync(`node "${genVariant}" --variant=${variant}`, { stdio: 'inherit', cwd: __dirname });
    inputPath  = resolve(__dirname, 'output', `cv-matt-${variant}.html`);
    outputPath = resolve(__dirname, 'output', `cv-matt-${variant}.pdf`);
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]');
    console.error('       node generate-pdf.mjs --variant=<slug> [--format=letter|a4]');
    process.exit(1);
  }

  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  // Validate format
  const validFormats = ['a4', 'letter'];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format "${format}". Use: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  console.log(`📄 Input:  ${inputPath}`);
  console.log(`📁 Output: ${outputPath}`);
  console.log(`📏 Format: ${format.toUpperCase()}`);

  // Read HTML to inject font paths as absolute file:// URLs
  let html = await readFile(inputPath, 'utf-8');

  // Resolve font paths relative to career-ops/fonts/
  const fontsDir = resolve(__dirname, 'fonts');
  html = html.replace(
    /url\(['"]?\.\/fonts\//g,
    `url('${toFileURL(fontsDir)}/`
  );
  // Close any unclosed quotes from the replacement
  html = html.replace(
    /file:\/\/([^'")]+)\.woff2['"]\)/g,
    `file://$1.woff2')`
  );

  runChromePreflight('generate-pdf');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Set content with file base URL for any relative resources
  await page.setContent(html, {
    waitUntil: 'networkidle',
    baseURL: `${toFileURL(dirname(inputPath))}/`,
  });

  // Wait for fonts to load
  await page.evaluate(() => document.fonts.ready);

  // Generate PDF
  const pdfBuffer = await page.pdf({
    format: format,
    printBackground: true,
    margin: {
      top: '0.6in',
      right: '0.6in',
      bottom: '0.6in',
      left: '0.6in',
    },
    preferCSSPageSize: false,
  });

  // Write PDF
  const { writeFile } = await import('fs/promises');
  await writeFile(outputPath, pdfBuffer);

  // Count pages (approximate from PDF structure)
  const pdfString = pdfBuffer.toString('latin1');
  const pageCount = (pdfString.match(/\/Type\s*\/Page[^s]/g) || []).length;

  await browser.close();

  console.log(`✅ PDF generated: ${outputPath}`);
  console.log(`📊 Pages: ${pageCount}`);
  console.log(`📦 Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

  return { outputPath, pageCount, size: pdfBuffer.length };
}

generatePDF().catch((err) => {
  console.error('❌ PDF generation failed:', err.message);
  process.exit(1);
});
