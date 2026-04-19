/**
 * semantic-match.mjs — Semantic JD-to-CV matching using embeddings
 *
 * Uses OpenAI text-embedding-3-small for cost-efficient vector comparison.
 * Caches embeddings to data/embeddings/ to avoid repeat API calls.
 *
 * Requires: OPENAI_API_KEY in .env
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..', '..');
const CACHE_DIR = resolve(ROOT, 'data', 'embeddings');

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function getCachedEmbedding(hash) {
  const path = resolve(CACHE_DIR, `${hash}.json`);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch { return null; }
  }
  return null;
}

function setCachedEmbedding(hash, embedding) {
  ensureCacheDir();
  writeFileSync(resolve(CACHE_DIR, `${hash}.json`), JSON.stringify(embedding), 'utf8');
}

/**
 * Get embedding from OpenAI API
 */
async function getEmbedding(text, apiKey) {
  const hash = hashText(text);
  const cached = getCachedEmbedding(hash);
  if (cached) return cached;

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000), // Truncate to ~8K chars for token limit
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const embedding = data.data[0].embedding;
  setCachedEmbedding(hash, embedding);
  return embedding;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Split text into meaningful sections for granular matching
 */
function splitIntoSections(text) {
  const sections = {};
  const lower = text.toLowerCase();

  // Extract skills section
  const skillsMatch = text.match(/(?:skills|technologies|tools|stack)[:\s]*([\s\S]*?)(?=\n(?:experience|education|projects|certifications|\#)|$)/i);
  sections.skills = skillsMatch ? skillsMatch[1].trim() : '';

  // Extract experience section
  const expMatch = text.match(/(?:experience|work history|employment)[:\s]*([\s\S]*?)(?=\n(?:education|skills|projects|certifications|\#)|$)/i);
  sections.experience = expMatch ? expMatch[1].trim() : '';

  // Extract requirements section (for JDs)
  const reqMatch = text.match(/(?:requirements|qualifications|must have|nice to have|what you)[:\s]*([\s\S]*?)(?=\n(?:benefits|about|salary|perks|responsibilities|\#)|$)/i);
  sections.requirements = reqMatch ? reqMatch[1].trim() : '';

  // Full text as fallback
  sections.full = text;

  return sections;
}

/**
 * Compute semantic score between a job description and CV
 * @param {string} jdText - Full job description text
 * @param {string} cvText - Full CV/resume text
 * @param {object} options - { apiKey?: string }
 * @returns {object} { overallScore, sectionScores, topMatches, gaps }
 */
export async function computeSemanticScore(jdText, cvText, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      overallScore: 0,
      sectionScores: {},
      topMatches: [],
      gaps: ['OPENAI_API_KEY not configured — semantic matching disabled'],
      error: 'no-api-key',
    };
  }

  try {
    const jdSections = splitIntoSections(jdText);
    const cvSections = splitIntoSections(cvText);

    // Get embeddings for each section pair
    const sectionScores = {};
    const sectionPairs = ['skills', 'experience', 'requirements'];

    for (const section of sectionPairs) {
      const jdSection = jdSections[section] || jdSections.full;
      const cvSection = cvSections[section === 'requirements' ? 'skills' : section] || cvSections.full;

      if (jdSection.length < 20 || cvSection.length < 20) {
        sectionScores[section] = 0.5; // Default for missing sections
        continue;
      }

      const jdEmb = await getEmbedding(jdSection, apiKey);
      const cvEmb = await getEmbedding(cvSection, apiKey);
      sectionScores[section] = cosineSimilarity(jdEmb, cvEmb);
    }

    // Overall score: weighted average
    const weights = { skills: 0.4, experience: 0.35, requirements: 0.25 };
    let overallScore = 0;
    let totalWeight = 0;
    for (const [section, weight] of Object.entries(weights)) {
      if (sectionScores[section] !== undefined) {
        overallScore += sectionScores[section] * weight;
        totalWeight += weight;
      }
    }
    overallScore = totalWeight > 0 ? overallScore / totalWeight : 0;

    // Extract top matches and gaps from text analysis
    const topMatches = [];
    const gaps = [];

    // Simple keyword overlap analysis
    const jdKeywords = new Set(jdText.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);
    const cvKeywords = new Set(cvText.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);

    const techTerms = [
      'python', 'sql', 'javascript', 'typescript', 'react', 'tableau',
      'power bi', 'fabric', 'dbt', 'snowflake', 'databricks', 'azure',
      'aws', 'gcp', 'docker', 'kubernetes', 'terraform', 'airflow',
      'spark', 'kafka', 'redis', 'postgresql', 'mongodb', 'excel',
    ];

    for (const term of techTerms) {
      const inJd = jdText.toLowerCase().includes(term);
      const inCv = cvText.toLowerCase().includes(term);
      if (inJd && inCv) topMatches.push(term);
      else if (inJd && !inCv) gaps.push(term);
    }

    return {
      overallScore: Math.round(overallScore * 1000) / 1000,
      sectionScores,
      topMatches: topMatches.slice(0, 10),
      gaps: gaps.slice(0, 10),
    };
  } catch (err) {
    return {
      overallScore: 0,
      sectionScores: {},
      topMatches: [],
      gaps: [`Semantic matching error: ${err.message}`],
      error: err.message,
    };
  }
}
