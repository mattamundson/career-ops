#!/usr/bin/env node
/**
 * F8.2 — JD Semantic Matcher
 * Computes cosine similarity between a job description and stored profile embeddings.
 *
 * Usage:
 *   node scripts/match-jd.mjs --jd=jds/valtech-sample.txt
 *   node scripts/match-jd.mjs --jd=jds/valtech-sample.txt --json
 *   node scripts/match-jd.mjs --batch   # reads all - [ ] URLs from data/pipeline.md
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const EMB_FILE  = resolve(ROOT, 'data/embeddings/profile-embeddings.json');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.join('=') || true];
    })
);

const BATCH_MODE  = args.batch === true || args.batch === 'true';
const JSON_OUTPUT = args.json  === true || args.json  === 'true';
const JD_PATH     = args.jd ? resolve(ROOT, args.jd) : null;

if (!BATCH_MODE && !JD_PATH) {
  console.error('Usage:');
  console.error('  node scripts/match-jd.mjs --jd=jds/valtech-sample.txt');
  console.error('  node scripts/match-jd.mjs --jd=jds/valtech-sample.txt --json');
  console.error('  node scripts/match-jd.mjs --batch');
  process.exit(1);
}

// ── Ensure embeddings exist ───────────────────────────────────────────────────
if (!existsSync(EMB_FILE)) {
  console.error(`No embeddings found at ${EMB_FILE}`);
  console.error('Run: node scripts/embed-profile.mjs');
  process.exit(1);
}

// ── Stop words + stemmer (must match embed-profile.mjs) ──────────────────────
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

function termFreq(terms) {
  const counts = {};
  for (const t of terms) counts[t] = (counts[t] ?? 0) + 1;
  const total = terms.length || 1;
  const tf = {};
  for (const [t, c] of Object.entries(counts)) tf[t] = c / total;
  return tf;
}

function tfidfVector(tf, idf) {
  const vec = {};
  for (const [term, tfVal] of Object.entries(tf)) {
    if (idf[term]) vec[term] = tfVal * idf[term];
  }
  return vec;
}

function l2Normalise(vec) {
  const mag = Math.sqrt(Object.values(vec).reduce((s, v) => s + v * v, 0));
  if (mag === 0) return vec;
  const out = {};
  for (const [k, v] of Object.entries(vec)) out[k] = v / mag;
  return out;
}

/** Cosine similarity between two sparse unit vectors */
function cosine(vecA, vecB) {
  let dot = 0;
  for (const [term, val] of Object.entries(vecA)) {
    if (vecB[term]) dot += val * vecB[term];
  }
  return dot; // already unit vectors — no need to divide by magnitudes
}

/** Return top N terms that appear in both JD vector and a profile vector */
function sharedTerms(jdVec, profileVec, n = 5) {
  const shared = [];
  for (const [term, val] of Object.entries(jdVec)) {
    if (profileVec[term]) {
      shared.push({ term, score: val * profileVec[term] });
    }
  }
  return shared.sort((a, b) => b.score - a.score).slice(0, n);
}

// ── Load embeddings ───────────────────────────────────────────────────────────
const store = JSON.parse(readFileSync(EMB_FILE, 'utf8'));
const { idf, vocab } = store.meta;

/** Embed a raw JD text using the stored IDF */
function embedJD(text) {
  const terms = getTerms(text);
  const tf    = termFreq(terms);
  return l2Normalise(tfidfVector(tf, idf));
}

// ── Archetype detection helpers ───────────────────────────────────────────────
const ARCHETYPES = [
  'Operational Data Architect',
  'AI Automation / Workflow Engineer',
  'BI & Analytics Lead',
  'Business Systems / ERP Specialist',
  'Applied AI / Solutions Architect',
  'Operations Technology Leader',
];

/** Match a JD vector against all stored vectors */
function matchJD(jdVec) {
  const results = store.vectors.map(v => ({
    id:     v.id,
    label:  v.label,
    score:  cosine(jdVec, v.vector),
    vector: v.vector,
  }));
  return results.sort((a, b) => b.score - a.score);
}

// ── Single JD report ─────────────────────────────────────────────────────────
function reportSingle(jdText, jdLabel = 'Job Description') {
  const jdVec   = embedJD(jdText);
  const results = matchJD(jdVec);

  // Overall match = cosine against full CV
  const cvResult = results.find(r => r.id === 'cv');
  const overallScore = cvResult ? Math.round(cvResult.score * 100) : 0;

  // Best archetype
  const archetypeResults = results.filter(r => r.id.startsWith('archetype:'));
  const bestArchetype = archetypeResults[0];
  const bestArchetypeScore = bestArchetype
    ? Math.round(bestArchetype.score * 100)
    : 0;

  // Top 3 proof points (article sections)
  const articleResults = results
    .filter(r => r.id.startsWith('article:'))
    .slice(0, 3);

  // Top shared terms for transparency
  const topTermsList = cvResult
    ? sharedTerms(jdVec, cvResult.vector, 8).map(t => t.term)
    : [];

  if (JSON_OUTPUT) {
    return {
      label:          jdLabel,
      overallScore,
      bestArchetype:  bestArchetype ? { name: bestArchetype.label, score: bestArchetypeScore } : null,
      top3ProofPoints: articleResults.map(r => ({
        section: r.label,
        score:   Math.round(r.score * 100),
      })),
      topTerms: topTermsList,
    };
  }

  const line  = '─'.repeat(64);
  const line2 = '━'.repeat(64);

  let out = '\n';
  out += line2 + '\n';
  out += `Semantic Match: ${jdLabel}\n`;
  out += line2 + '\n';

  out += `\nOverall Match Score   : ${overallScore}%\n`;

  if (bestArchetype) {
    out += `Best Archetype Match  : ${bestArchetype.label}  (${bestArchetypeScore}%)\n`;
  }

  out += `\nTop 3 Proof Points by Relevance:\n`;
  articleResults.forEach((r, i) => {
    out += `  ${i + 1}. ${r.label}  —  ${Math.round(r.score * 100)}%\n`;
  });

  if (topTermsList.length > 0) {
    out += `\nTop Overlapping Terms:\n  ${topTermsList.join(', ')}\n`;
  }

  out += '\n' + line + '\n';
  out += 'All Archetype Scores:\n';
  archetypeResults.forEach(r => {
    const bar   = '█'.repeat(Math.round(r.score * 20));
    const score = String(Math.round(r.score * 100)).padStart(3);
    out += `  ${score}%  ${bar.padEnd(20)}  ${r.label}\n`;
  });

  out += '\n' + line + '\n';
  out += 'All Article Section Scores:\n';
  results
    .filter(r => r.id.startsWith('article:'))
    .forEach(r => {
      const score = String(Math.round(r.score * 100)).padStart(3);
      out += `  ${score}%  ${r.label}\n`;
    });

  out += line2 + '\n';
  return out;
}

// ── Batch mode ────────────────────────────────────────────────────────────────
function runBatch() {
  const pipelinePath = resolve(ROOT, 'data/pipeline.md');
  if (!existsSync(pipelinePath)) {
    console.error(`data/pipeline.md not found at ${pipelinePath}`);
    process.exit(1);
  }

  const content = readFileSync(pipelinePath, 'utf8');
  const entries = [];

  for (const line of content.split('\n')) {
    const m = line.match(/^\s*-\s*\[\s*\]\s*(https?:\/\/\S+)(?:\s*\|\s*(.+))?/);
    if (m) {
      const url   = m[1].trim();
      const label = m[2] ? m[2].trim() : url;
      entries.push({ url, label });
    }
  }

  if (entries.length === 0) {
    console.log('No pending entries (- [ ] URLs) found in data/pipeline.md');
    process.exit(0);
  }

  console.log(`\nBatch mode — ${entries.length} entries found in data/pipeline.md`);
  console.log('Note: batch mode scores labels/titles only (cannot fetch live URLs).');
  console.log('For full scoring, save JD text to jds/ and use --jd=<path>\n');

  const scored = entries.map(entry => {
    // Use label as proxy text (title + company)
    const jdVec   = embedJD(entry.label);
    const results = matchJD(jdVec);

    const cvResult     = results.find(r => r.id === 'cv');
    const overallScore = cvResult ? Math.round(cvResult.score * 100) : 0;

    const bestArch = results.filter(r => r.id.startsWith('archetype:'))[0];

    return {
      score:     overallScore,
      archetype: bestArch?.label ?? 'Unknown',
      label:     entry.label,
      url:       entry.url,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const line = '─'.repeat(80);
  console.log(line);
  console.log(`${'SCORE'.padEnd(7)} ${'ARCHETYPE'.padEnd(36)} LABEL`);
  console.log(line);
  for (const item of scored) {
    const score    = `${item.score}%`.padEnd(7);
    const archtype = item.archetype.slice(0, 34).padEnd(36);
    console.log(`${score} ${archtype} ${item.label}`);
  }
  console.log(line);
  console.log(`\n${scored.length} entries ranked. Top match: "${scored[0]?.label}" at ${scored[0]?.score}%\n`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
if (BATCH_MODE) {
  runBatch();
} else {
  if (!existsSync(JD_PATH)) {
    console.error(`Error: JD file not found: ${JD_PATH}`);
    process.exit(1);
  }

  const jdText  = readFileSync(JD_PATH, 'utf8');
  const jdLabel = JD_PATH.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
  const report  = reportSingle(jdText, jdLabel);

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(report);
  }
}
