#!/usr/bin/env node
/**
 * F8.1 — Profile Embeddings Generator
 * Builds TF-IDF vectors for CV, archetypes, and article-digest sections.
 *
 * Usage:
 *   node scripts/embed-profile.mjs           # skip if up-to-date
 *   node scripts/embed-profile.mjs --refresh  # force regenerate
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const OUT_FILE  = resolve(ROOT, 'data/embeddings/profile-embeddings.json');

const args = new Set(process.argv.slice(2));
const FORCE_REFRESH = args.has('--refresh');

// ── Stop words (merged from ats-score.mjs + extras) ─────────────────────────
const STOP_WORDS = new Set([
  'team','company','experience','ability','strong','excellent',
  'work','role','position','candidate','required','preferred',
  'including','working','responsible','opportunity','join',
  'the','a','an','and','or','but','in','on','at','to','for',
  'of','with','as','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','that','this','these',
  'those','from','by','not','we','our','you','your','their',
  'its','it','they','them','us','all','any','each','more',
  'such','also','both','about','across','through','into','within',
  'between','while','when','where','who','which','how','what',
  'up','out','new','other','than','then','so','if','well',
  'build','ensure','help','provide','support','drive','manage',
  'develop','use','using','make','get','set',
  'years','designing','deploying','solutions','hands','proven',
  'track','record','deep','multiple','including','across','level',
  'familiarity','context','least','scale','large','global','senior',
  'i','my','me','they','their','he','she','his','her',
  'key','decisions','architecture','proof','points','metrics',
]);

// ── Text helpers ─────────────────────────────────────────────────────────────
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/^#+\s*/gm, ' ')
    .replace(/^\s*[-*•]\s*/gm, ' ')
    .replace(/[''`]/g, "'")
    .replace(/[^a-z0-9\s'\-\/+#.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(text) {
  return normalise(text)
    .split(' ')
    .filter(t => t.length > 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

/** Stem — simple suffix-stripping (Porter-lite, good enough for TF-IDF signal) */
function stem(word) {
  return word
    .replace(/ings?$/, '')
    .replace(/ations?$/, 'ate')
    .replace(/tion$/, 'te')
    .replace(/ers?$/, '')
    .replace(/ness$/, '')
    .replace(/ment$/, '')
    .replace(/ity$/, '')
    .replace(/ies$/, 'y')
    .replace(/ly$/, '')
    .replace(/s$/, '');
}

function getTerms(text) {
  return tokenise(text).map(stem).filter(t => t.length > 2);
}

/** Term-frequency map (normalised by document length) */
function termFreq(terms) {
  const counts = {};
  for (const t of terms) counts[t] = (counts[t] ?? 0) + 1;
  const total = terms.length || 1;
  const tf = {};
  for (const [t, c] of Object.entries(counts)) tf[t] = c / total;
  return tf;
}

/** Build a unified vocabulary from all TF maps */
function buildVocab(tfMaps) {
  const vocab = new Set();
  for (const tf of tfMaps) for (const t of Object.keys(tf)) vocab.add(t);
  return [...vocab].sort();
}

/** Compute IDF across a set of TF maps */
function computeIDF(vocab, tfMaps) {
  const N = tfMaps.length;
  const idf = {};
  for (const term of vocab) {
    const df = tfMaps.filter(tf => term in tf).length;
    idf[term] = Math.log((N + 1) / (df + 1)) + 1; // smoothed IDF
  }
  return idf;
}

/** Sparse TF-IDF vector */
function tfidfVector(tf, idf) {
  const vec = {};
  for (const [term, tfVal] of Object.entries(tf)) {
    if (idf[term]) vec[term] = tfVal * idf[term];
  }
  return vec;
}

/** L2 normalise a sparse vector (unit vector) */
function l2Normalise(vec) {
  const mag = Math.sqrt(Object.values(vec).reduce((s, v) => s + v * v, 0));
  if (mag === 0) return vec;
  const out = {};
  for (const [k, v] of Object.entries(vec)) out[k] = v / mag;
  return out;
}

// ── Source parsing ────────────────────────────────────────────────────────────

/** Extract 6 archetype blocks from _shared.md.
 *  Looks for the Adaptive Framing table and returns one text blob per row. */
function extractArchetypes(sharedMd) {
  const archetypes = [
    {
      name: 'Operational Data Architect',
      keywords: 'ERP BI AI pipelines data modeling semantic layers Paradigm API Inventory Health Index Power BI DAX SQL Microsoft Fabric ETL end-to-end pipeline reorder triggers purchasing intelligence',
    },
    {
      name: 'AI Automation / Workflow Engineer',
      keywords: 'n8n LLM workflows agents agentic systems automation zero manual handoffs Jarvis Trader closed-loop monitoring reliable AI scale integration fabric webhook event triggers',
    },
    {
      name: 'BI & Analytics Lead',
      keywords: 'Power BI DAX SQL executive dashboards risk dashboards Pretium distressed debt analytics Fortune 200 FirstEnergy reporting semantic model KPI storytelling data visualization predictive analytics',
    },
    {
      name: 'Business Systems / ERP Specialist',
      keywords: 'ERP integrations barcode scanning Android Node.js Zebra label printing ops-to-tech translation COO Paradigm REST API lifecycle tracking inventory reconciliation business systems CRM architecture',
    },
    {
      name: 'Applied AI / Solutions Architect',
      keywords: 'system design LLM-powered solutions enterprise-ready AI Jarvis Trader 5-layer regime detection Walk-Forward Efficiency architecture observability fallbacks production reliability integrations',
    },
    {
      name: 'Operations Technology Leader',
      keywords: 'COO operational transformation cross-functional delivery change management Fortune 200 scale full-stack operational tech stack zero contractors builder builder operator systems thinking',
    },
  ];
  return archetypes;
}

/** Split article-digest.md into per-section blobs (one per ## heading) */
function extractArticleSections(digestMd) {
  const sections = [];
  const lines = digestMd.split('\n');
  let current = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { name: line.replace(/^##\s+/, '').trim(), text: line + '\n' };
    } else if (current) {
      current.text += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

// ── Hash helpers for cache invalidation ──────────────────────────────────────
function fileHash(path) {
  try {
    const content = readFileSync(path, 'utf8');
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function currentInputHash(cvPath, digestPath) {
  const h1 = fileHash(cvPath) ?? '';
  const h2 = fileHash(digestPath) ?? '';
  return createHash('sha256').update(h1 + h2).digest('hex').slice(0, 16);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const cvPath      = resolve(ROOT, 'cv.md');
const sharedPath  = resolve(ROOT, 'modes/_shared.md');
const digestPath  = resolve(ROOT, 'article-digest.md');

// Check cache
const inputHash = currentInputHash(cvPath, digestPath);

if (!FORCE_REFRESH && existsSync(OUT_FILE)) {
  const existing = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  if (existing.meta?.inputHash === inputHash) {
    console.log('Profile embeddings are up-to-date. Use --refresh to force regeneration.');
    console.log(`File: ${OUT_FILE}`);
    process.exit(0);
  }
  console.log('Input files changed — regenerating embeddings...');
} else {
  console.log(`Generating profile embeddings${FORCE_REFRESH ? ' (--refresh)' : ''}...`);
}

// Read sources
const cvText     = readFileSync(cvPath, 'utf8');
const sharedMd   = readFileSync(sharedPath, 'utf8');
const digestMd   = existsSync(digestPath) ? readFileSync(digestPath, 'utf8') : '';

// Build documents
const archetypes       = extractArchetypes(sharedMd);
const articleSections  = extractArticleSections(digestMd);

const allDocs = [
  { id: 'cv', label: 'Full CV', text: cvText },
  ...archetypes.map(a => ({ id: `archetype:${a.name}`, label: a.name, text: a.keywords })),
  ...articleSections.map(s => ({ id: `article:${s.name}`, label: s.name, text: s.text })),
];

// Compute TF for each document
const tfMaps = allDocs.map(doc => termFreq(getTerms(doc.text)));

// Build shared vocabulary + IDF
const vocab = buildVocab(tfMaps);
const idf   = computeIDF(vocab, tfMaps);

// Compute normalised TF-IDF vectors
const vectors = allDocs.map((doc, i) => ({
  id: doc.id,
  label: doc.label,
  vector: l2Normalise(tfidfVector(tfMaps[i], idf)),
}));

// Persist
const output = {
  meta: {
    generatedAt: new Date().toISOString(),
    inputHash,
    vocabSize: vocab.length,
    documentCount: allDocs.length,
    idf,             // needed by match-jd.mjs to score new documents
    vocab,
  },
  vectors,
};

mkdirSync(resolve(ROOT, 'data/embeddings'), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

console.log(`\nEmbeddings saved → ${OUT_FILE}`);
console.log(`  Documents : ${vectors.length}`);
console.log(`  Vocabulary: ${vocab.length} terms`);
console.log('\nDocuments embedded:');
for (const v of vectors) {
  const dims = Object.keys(v.vector).length;
  console.log(`  [${v.id}]  ${dims} active dims`);
}
console.log('');
