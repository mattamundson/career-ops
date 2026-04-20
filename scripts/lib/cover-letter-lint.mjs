// scripts/lib/cover-letter-lint.mjs
// Quality lints for AI-generated cover letters. Catches the patterns Matt
// flagged as "this is bot output, redo it":
//   - Em-dashes (system prompt forbids; generators slip them in)
//   - Buzzwords (passionate, synergy, results-driven, etc.)
//   - Generic openers ("I am writing to apply for...")
//   - Wrong paragraph count (must be 3)
//   - No concrete numbers / proof points
//
// Returns { errors: [], warnings: [], score: 0..1 } so callers can decide:
// errors → block write, warnings → flag in metadata.json for human review.

const FORBIDDEN_BUZZWORDS = [
  /passionate/i,
  /synergy/i,
  /results[- ]driven/i,
  /detail[- ]oriented/i,
  /team player/i,
  /go[- ]getter/i,
  /game[- ]changer/i,
  /best[- ]in[- ]class/i,
  /world[- ]class/i,
  /thought leader/i,
  /move the needle/i,
  /low[- ]hanging fruit/i,
  /leverage (?:my|our|your)/i,
  /ecosystem/i,
  /unique opportunity/i,
  /perfect (?:fit|match)/i,
  /seamless(?:ly)?/i,
  /paradigm/i,
  /robust solution/i,
];

const GENERIC_OPENERS = [
  /^\s*i am writing to (?:apply|express)/i,
  /^\s*i am excited to (?:apply|submit)/i,
  /^\s*it is with great (?:enthusiasm|interest)/i,
  /^\s*please accept (?:my|this) (?:application|letter)/i,
  /^\s*as a (?:passionate|driven|results)/i,
];

const NUMBER_RE = /\$?\d[\d,]*(?:\.\d+)?(?:%|[KMB]?\b|\s*million|\s*billion)?/;

export function lintCoverLetter(text, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!text || typeof text !== 'string') {
    return { errors: ['empty cover letter'], warnings: [], score: 0 };
  }

  // Em-dashes (system prompt forbids; generators slip them in)
  const emDashCount = (text.match(/—/g) || []).length;
  if (emDashCount > 0) {
    (strict ? errors : warnings).push(`em-dash detected ${emDashCount}× (system prompt forbids)`);
  }

  // Buzzwords
  for (const re of FORBIDDEN_BUZZWORDS) {
    const m = text.match(re);
    if (m) errors.push(`buzzword: "${m[0]}"`);
  }

  // Generic openers — check first 200 chars
  const head = text.slice(0, 250);
  for (const re of GENERIC_OPENERS) {
    if (re.test(head)) {
      errors.push(`generic opener detected: matches /${re.source}/`);
      break;
    }
  }

  // Paragraph count: split on blank lines, expect 3 substantive paragraphs.
  // Some letters have a greeting + body + signature added by caller; we lint
  // only the body if it's a multi-paragraph block.
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 40);
  if (paragraphs.length < 3) warnings.push(`only ${paragraphs.length} substantive paragraph(s); expected 3`);
  if (paragraphs.length > 4) warnings.push(`${paragraphs.length} paragraphs; max 3-4 expected`);

  // Concrete proof points: at least one number per paragraph (rough heuristic)
  const paragraphsWithNumbers = paragraphs.filter((p) => NUMBER_RE.test(p));
  if (paragraphsWithNumbers.length === 0) warnings.push('no concrete numbers / proof points found anywhere');

  // Word count — 3 paragraphs at 3-5 sentences each ≈ 200-400 words
  const words = text.trim().split(/\s+/).length;
  if (words < 150) warnings.push(`only ${words} words; expected 200-400`);
  if (words > 500) warnings.push(`${words} words; expected 200-400, this reads long`);

  // Em-dash, buzzword, generic opener weighted heavier; warnings light.
  const score = Math.max(0, 1 - (errors.length * 0.25) - (warnings.length * 0.05));

  return { errors, warnings, score };
}

export function formatLintReport(result) {
  const lines = [`Cover-letter lint score: ${result.score.toFixed(2)} / 1.00`];
  if (result.errors.length === 0 && result.warnings.length === 0) {
    lines.push('  ✅ No issues');
  } else {
    for (const e of result.errors) lines.push(`  ❌ ${e}`);
    for (const w of result.warnings) lines.push(`  ⚠️  ${w}`);
  }
  return lines.join('\n');
}
