/**
 * resume-selector.mjs — Auto-select best resume variant for a JD
 *
 * Scans output/ directory for PDF resume files, infers focus area from filename,
 * and scores each against the JD using semantic matching.
 *
 * Resume naming convention: cv-matt-{company}-{date}.pdf
 */

import { readdirSync, existsSync, readFileSync } from 'fs';
import { resolve, basename } from 'path';
import { computeSemanticScore } from './semantic-match.mjs';

/**
 * Extract a focus description from a resume filename
 * e.g., "cv-matt-agility-robotics-2026-04-09.pdf" → "agility robotics"
 */
function inferFocusFromFilename(filename) {
  const base = basename(filename, '.pdf');
  // Remove cv-matt- prefix and date suffix
  const stripped = base
    .replace(/^cv-matt-/i, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-/g, ' ')
    .trim();
  return stripped || 'general';
}

/**
 * Select the best resume variant for a given JD
 *
 * @param {string} jdText - Full job description text
 * @param {string} resumeDir - Directory containing PDF files (default: output/)
 * @param {object} options - { apiKey?: string, cvText?: string }
 * @returns {object[]} Ranked list: [{ path, focus, score, reason }]
 */
export async function selectBestResume(jdText, resumeDir, options = {}) {
  if (!existsSync(resumeDir)) return [];

  const pdfs = readdirSync(resumeDir).filter(f => f.endsWith('.pdf') && f.startsWith('cv-'));
  if (pdfs.length === 0) return [];
  if (pdfs.length === 1) {
    return [{
      path: resolve(resumeDir, pdfs[0]),
      focus: inferFocusFromFilename(pdfs[0]),
      score: 1.0,
      reason: 'Only resume variant available',
    }];
  }

  const results = [];

  for (const pdf of pdfs) {
    const focus = inferFocusFromFilename(pdf);

    // Use the focus area + any associated report as the "resume content"
    // for matching (since we can't easily read PDF text in Node.js)
    const reportSlug = focus.replace(/\s+/g, '-');
    const possibleReports = [
      resolve(resumeDir, '..', 'reports', `*${reportSlug}*.md`),
    ];

    // Try to find a matching report for richer content
    let resumeProxy = `Resume focused on: ${focus}. `;
    const reportsDir = resolve(resumeDir, '..', 'reports');
    if (existsSync(reportsDir)) {
      const matchingReports = readdirSync(reportsDir)
        .filter(f => f.includes(reportSlug) && f.endsWith('.md'));
      if (matchingReports.length > 0) {
        const reportText = readFileSync(resolve(reportsDir, matchingReports[0]), 'utf8');
        resumeProxy += reportText.slice(0, 3000);
      }
    }

    // If we have the canonical CV text, use focus + CV
    if (options.cvText) {
      resumeProxy = `Focus: ${focus}\n\n${options.cvText.slice(0, 3000)}`;
    }

    try {
      const semantic = await computeSemanticScore(jdText, resumeProxy, options);
      results.push({
        path: resolve(resumeDir, pdf),
        focus,
        score: semantic.overallScore,
        reason: semantic.topMatches.length > 0
          ? `Matches: ${semantic.topMatches.slice(0, 5).join(', ')}`
          : `Semantic score: ${semantic.overallScore.toFixed(3)}`,
      });
    } catch (err) {
      results.push({
        path: resolve(resumeDir, pdf),
        focus,
        score: 0.5,
        reason: `Scoring failed: ${err.message}`,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}
