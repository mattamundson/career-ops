#!/usr/bin/env node
/**
 * ATS Keyword Scorer
 * Usage: node scripts/ats-score.mjs --jd=jds/job.txt [--cv=cv.md]
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.join('=')];
    })
);

const cvPath  = resolve(ROOT, args.cv  ?? 'cv.md');
const jdPath  = resolve(ROOT, args.jd  ?? '');

if (!args.jd) {
  console.error('Error: --jd=<path> is required');
  process.exit(1);
}

// ── Stop words ────────────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  // provided by spec
  'team', 'company', 'experience', 'ability', 'strong', 'excellent',
  'work', 'role', 'position', 'candidate', 'required', 'preferred',
  'including', 'working', 'responsible', 'opportunity', 'join',
  // common English fillers
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'that', 'this', 'these',
  'those', 'from', 'by', 'not', 'we', 'our', 'you', 'your', 'their',
  'its', 'it', 'they', 'them', 'us', 'all', 'any', 'each', 'more',
  'such', 'also', 'both', 'about', 'across', 'through', 'into', 'within',
  'between', 'while', 'when', 'where', 'who', 'which', 'how', 'what',
  'up', 'out', 'new', 'other', 'than', 'then', 'so', 'if', 'well',
  'build', 'ensure', 'help', 'provide', 'support', 'drive', 'manage',
  'develop', 'use', 'using', 'make', 'get', 'set',
  // JD boilerplate verbs/nouns that add no keyword signal
  'years', 'designing', 'deploying', 'solutions', 'hands', 'proven',
  'track', 'record', 'deep', 'multiple', 'including', 'across', 'level',
  'familiarity', 'context', 'least', 'scale', 'large', 'global', 'senior',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalise(text) {
  return text
    .toLowerCase()
    // strip markdown headings (##, ###, etc.) and bullet markers
    .replace(/^#+\s*/gm, ' ')
    .replace(/^\s*[-*•]\s*/gm, ' ')
    .replace(/[''`]/g, "'")
    // keep alphanumeric, spaces, hyphens, slashes, +, #, .
    .replace(/[^a-z0-9\s'\-\/+#.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(text) {
  return normalise(text).split(' ').filter(t => t.length > 1);
}

/**
 * Detect which sections of the JD are "requirements/qualifications".
 * Returns an array of { start, end } character offsets.
 */
function requirementRanges(text) {
  const lower = text.toLowerCase();
  const headingRe = /(?:^|\n)#+?\s*(requirements?|qualifications?|what you['']?ll need|what we['']?re looking for|must[- ]have)[^\n]*/gi;
  const nextHeadingRe = /(?:^|\n)#+?\s/g;

  const ranges = [];
  let m;
  while ((m = headingRe.exec(lower)) !== null) {
    const start = m.index;
    // find next heading after this one
    nextHeadingRe.lastIndex = start + m[0].length;
    const next = nextHeadingRe.exec(lower);
    const end = next ? next.index : lower.length;
    ranges.push({ start, end });
  }
  return ranges;
}

function inRequirementsSection(pos, ranges) {
  return ranges.some(r => pos >= r.start && pos <= r.end);
}

/**
 * Extract candidate terms from the JD.
 * Returns Map<term, rawScore> where rawScore reflects:
 *   - base count (1 per occurrence)
 *   - ×2 for multi-word phrases (bigrams/trigrams)
 *   - ×1.5 for appearances in requirements/qualifications sections
 */
function extractTerms(jdText) {
  const reqRanges = requirementRanges(jdText);
  const lines = jdText.split('\n');
  const scores = new Map(); // term → cumulative score

  function addScore(term, delta) {
    scores.set(term, (scores.get(term) ?? 0) + delta);
  }

  let charOffset = 0;
  for (const line of lines) {
    const lineStart = charOffset;
    charOffset += line.length + 1; // +1 for \n

    // Split on clause boundaries (commas, semicolons, colons, em-dashes)
    // so n-grams don't straddle list items or punctuation-separated phrases.
    const clauses = line.split(/[,;:()\u2014\/]/);
    const inReq = inRequirementsSection(lineStart, reqRanges);
    const reqMult = inReq ? 1.5 : 1.0;

    for (const clause of clauses) {
    const tokens = tokenise(clause);

    // Trigrams — require ALL three tokens to be non-stop-words, no repeats
    for (let i = 0; i <= tokens.length - 3; i++) {
      const t0 = tokens[i], t1 = tokens[i + 1], t2 = tokens[i + 2];
      if (STOP_WORDS.has(t0) || STOP_WORDS.has(t1) || STOP_WORDS.has(t2)) continue;
      if (/^\d/.test(t0)) continue;
      // Reject phrases with duplicate tokens (artifact from stripped punctuation)
      if (t0 === t1 || t1 === t2 || t0 === t2) continue;
      const phrase = `${t0} ${t1} ${t2}`;
      addScore(phrase, 2 * reqMult);
    }

    // Bigrams — require BOTH tokens to be non-stop-words, no repeats
    for (let i = 0; i <= tokens.length - 2; i++) {
      const t0 = tokens[i], t1 = tokens[i + 1];
      if (STOP_WORDS.has(t0) || STOP_WORDS.has(t1)) continue;
      if (/^\d/.test(t0)) continue;
      if (t0 === t1) continue;
      const phrase = `${t0} ${t1}`;
      addScore(phrase, 2 * reqMult);
    }

    // Unigrams — skip section heading words and very short tokens
    const HEADING_WORDS = new Set(['requirements', 'qualifications', 'about', 'role', 'overview']);
    for (const tok of tokens) {
      if (STOP_WORDS.has(tok) || HEADING_WORDS.has(tok) || tok.length <= 2) continue;
      if (/^\d/.test(tok)) continue;
      addScore(tok, 1 * reqMult);
    }
    } // end clause loop
  } // end line loop

  return scores;
}

/**
 * Pick top N terms, de-duplicating sub-phrases that are already covered by a
 * longer phrase present in the list.
 */
function topTerms(scores, n = 20) {
  const sorted = [...scores.entries()]
    .sort((a, b) => b[1] - a[1]);

  const selected = [];

  for (const [term] of sorted) {
    if (selected.length >= n) break;

    const words = term.split(' ');

    // Skip noise: terms that look like markdown artefacts or pure numbers
    if (/^\d+[+\-]?$/.test(term)) continue;
    if (term.startsWith('#') || term.startsWith('-')) continue;

    // A shorter term is "dominated" if ANY longer already-selected phrase
    // contains ALL its words as a contiguous subsequence.
    const dominated = selected.some(s => {
      if (s === term) return true;
      const sWords = s.split(' ');
      if (sWords.length <= words.length) return false;
      // check for contiguous subsequence
      for (let i = 0; i <= sWords.length - words.length; i++) {
        if (words.every((w, j) => sWords[i + j] === w)) return true;
      }
      return false;
    });

    if (!dominated) selected.push(term);
  }

  // Pad to n if dedup trimmed too aggressively (allow dominated terms back in)
  if (selected.length < n) {
    for (const [term] of sorted) {
      if (selected.length >= n) break;
      if (!selected.includes(term) && !/^\d+[+\-]?$/.test(term)) {
        selected.push(term);
      }
    }
  }

  return selected.slice(0, n);
}

/**
 * Count how many times `term` appears in CV text (case-insensitive).
 * Returns true if at least one match is found.
 */
function matchesInCV(term, cvLower) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(cvLower);
}

/**
 * Heuristic: where in the CV to add a missing keyword.
 */
function addSuggestion(term) {
  const t = term.toLowerCase();
  if (/\b(python|node|sql|dax|typescript|javascript|api|rest|rl|mlops|aiops|databricks|synapse|fabric|adf|rag|rbac|etl|elt|tableau|power bi|llm)\b/i.test(t)) {
    return 'add to Core Technical Skills';
  }
  if (/\b(architect|roadmap|governance|strategy|platform|design|system)\b/i.test(t)) {
    return 'add to Professional Summary or GMS/FirstEnergy bullet';
  }
  if (/\b(compliance|gdpr|hipaa|audit|regulation)\b/i.test(t)) {
    return 'add to FirstEnergy bullet (regulated environment)';
  }
  return 'add to competency grid or summary';
}

// ── Main ──────────────────────────────────────────────────────────────────────
let jdText, cvText;
try {
  jdText = readFileSync(jdPath, 'utf8');
} catch {
  console.error(`Error: Cannot read JD file: ${jdPath}`);
  process.exit(1);
}
try {
  cvText = readFileSync(cvPath, 'utf8');
} catch {
  console.error(`Error: Cannot read CV file: ${cvPath}`);
  process.exit(1);
}

const termScores = extractTerms(jdText);
const keywords   = topTerms(termScores, 20);
const cvLower    = cvText.toLowerCase();

const matched  = keywords.filter(k => matchesInCV(k, cvLower));
const missing  = keywords.filter(k => !matchesInCV(k, cvLower));

const pct  = Math.round((matched.length / keywords.length) * 100);
const line = '─'.repeat(60);

console.log('');
console.log(line);
console.log(`ATS Keyword Match: ${pct}% (${matched.length}/${keywords.length})`);
console.log(line);

if (matched.length > 0) {
  console.log(`\nMATCHED (${matched.length}):`);
  console.log('  ' + matched.join(', '));
}

if (missing.length > 0) {
  console.log(`\nMISSING (${missing.length}):`);
  missing.forEach((term, i) => {
    console.log(`  ${i + 1}. ${term} — ${addSuggestion(term)}`);
  });
}

console.log('');
if (pct >= 70) {
  console.log(`RECOMMENDATION: Good coverage at ${pct}%. Review missing terms for quick wins.`);
} else if (pct >= 50) {
  const top3 = missing.slice(0, 3).map(t => `"${t}"`).join(', ');
  console.log(`RECOMMENDATION: Score below 70%. Add top 3 missing keywords: ${top3}`);
} else {
  const top5 = missing.slice(0, 5).map(t => `"${t}"`).join(', ');
  console.log(`RECOMMENDATION: Score below 50% — significant gaps. Prioritize: ${top5}`);
}
console.log(line);
console.log('');
