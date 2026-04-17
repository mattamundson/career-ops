const STOP_TOKENS = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'your', 'this', 'that', 'will',
  'have', 'has', 'our', 'you', 'are', 'job', 'role', 'team', 'work', 'remote',
  'full', 'time', 'part', 'day', 'days', 'week', 'weeks', 'new', 'senior',
]);

/**
 * Priority multipliers derived from an ordered `work_modes` array. Index 0 is
 * the highest-priority bucket; the last entry is the lowest. Callers that load
 * `config/profile.yml.location.work_modes` at runtime can override the defaults
 * by calling `deriveLocationPriority(workModes)`.
 *
 * The 3 ordered buckets are: on_site, hybrid, remote. The `unknown` bucket
 * (non-MSP physical postings, unreachable for a MN-based candidate) always
 * sits just above `remote` to keep the existing behavior.
 *
 * Keep in sync with dashboard/internal/data/work_arrangement.go.
 */
export const PRIORITY_RANK_MULTIPLIERS = [1.20, 1.10, 0.85];
export const UNKNOWN_MULTIPLIER = 0.95;
export const DEFAULT_WORK_MODES = ['on_site', 'hybrid', 'remote'];

export function deriveLocationPriority(workModes = DEFAULT_WORK_MODES) {
  const order = Array.isArray(workModes) && workModes.length === 3
    ? workModes
    : DEFAULT_WORK_MODES;
  const multiplierFor = (mode) => {
    const idx = order.indexOf(mode);
    return idx >= 0 ? PRIORITY_RANK_MULTIPLIERS[idx] : UNKNOWN_MULTIPLIER;
  };
  return {
    onsiteMspMultiplier: multiplierFor('on_site'),
    hybridMspMultiplier: multiplierFor('hybrid'),
    remoteMultiplier:    multiplierFor('remote'),
    unknownMultiplier:   UNKNOWN_MULTIPLIER,
  };
}

// Default config — preserved as the prior frozen export so existing imports keep working.
export const LOCATION_PRIORITY = deriveLocationPriority(DEFAULT_WORK_MODES);

const STATUS_PRIORITY_MULTIPLIER = {
  Evaluating: 1.0,
  Evaluated: 0.95,
  'Conditional GO': 0.95,
  GO: 0.95,
  'Ready to Submit': 0.92,
  Applied: 0.82,
  Contact: 0.75,
  Responded: 0.64,
  'In Progress': 0.58,
  Interview: 0.52,
  Offer: 0.25,
  Rejected: 0.0,
  Discarded: 0.0,
  SKIP: 0.0,
};

export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+/.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeText(value) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token));
}

export function parseFivePointScore(value) {
  const match = String(value || '').match(/([\d.]+)\s*\/\s*5/);
  if (match) return Number.parseFloat(match[1]);
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function daysSince(dateLike, fallback = 30) {
  if (!dateLike) return fallback;
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return fallback;
  const delta = Date.now() - date.getTime();
  return Math.max(0, Math.round(delta / 86400000));
}

/**
 * Classify work arrangement from apply-queue remote line, role title, tracker notes,
 * and optional report snippets (TL;DR / why). Priority order:
 *   1. MSP-local + hybrid → hybrid_msp
 *   2. MSP-local (any or no mode) → onsite_msp
 *   3. Strong-remote keywords (fully remote / 100% remote / anywhere) → remote
 *   4. Non-MSP on-site/hybrid → unknown (physically unreachable for MN-based candidate)
 *   5. Weak-remote keywords (remote / wfh) → remote
 *   6. else → unknown
 * @param {object} fields
 * @returns {'onsite_msp'|'hybrid_msp'|'remote'|'unknown'}
 */
export function classifyWorkArrangement(fields = {}) {
  const blob = String([
    fields.remote,
    fields.reportRemote,
    fields.role,
    fields.notes,
    fields.tldr,
    fields.why,
  ]
    .filter(Boolean)
    .join(' '))
    .toLowerCase();

  if (!blob.trim()) return 'unknown';

  const hasHybrid = blob.includes('hybrid');
  const hasOnsite = blob.includes('on-site') || blob.includes('onsite')
    || blob.includes('in-office') || blob.includes('in office')
    || blob.includes('office-based') || blob.includes('office based')
    || blob.includes('in person') || blob.includes('on site');
  const mspLocal = blob.includes('minneapolis') || blob.includes('st. paul') || blob.includes('st paul')
    || blob.includes('twin cities') || blob.includes('eden prairie') || blob.includes('plymouth')
    || blob.includes('golden valley') || blob.includes('bloomington');
  const strongRemote = blob.includes('100% remote') || blob.includes('fully remote')
    || blob.includes('fully-remote') || blob.includes('remote only')
    || blob.includes('work from anywhere') || blob.includes('verified remote')
    || blob.includes('verifiable remote');
  const weakRemote = blob.includes('remote') || blob.includes('wfh') || blob.includes('work from home');

  if (mspLocal && hasHybrid) return 'hybrid_msp';
  if (mspLocal) return 'onsite_msp';
  if (strongRemote) return 'remote';
  if (hasHybrid || hasOnsite) return 'unknown';
  if (weakRemote) return 'remote';
  return 'unknown';
}

export function locationPriorityMultiplier(arrangement, config = LOCATION_PRIORITY) {
  if (arrangement === 'onsite_msp') return config.onsiteMspMultiplier;
  if (arrangement === 'hybrid_msp') return config.hybridMspMultiplier;
  if (arrangement === 'remote') return config.remoteMultiplier;
  return config.unknownMultiplier;
}

/** Sort key: headline score × location multiplier (high remote can still beat mid hybrid). */
export function focusSortKey(scoreNum, fields = {}, config = LOCATION_PRIORITY) {
  if (!Number.isFinite(scoreNum) || scoreNum <= 0) return 0;
  const a = classifyWorkArrangement(fields);
  return scoreNum * locationPriorityMultiplier(a, config);
}

function dedupe(list) {
  return [...new Set(list)];
}

function tokenOverlapRatio(left, right) {
  const leftTokens = new Set(tokenizeText(left));
  const rightTokens = new Set(tokenizeText(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function collapsePhraseMatches(matches) {
  const collapsed = [];
  for (const match of matches) {
    const overlaps = collapsed.some((existing) =>
      tokenOverlapRatio(existing.phrase, match.phrase) >= 0.75
    );
    if (!overlaps) collapsed.push(match);
  }
  return collapsed;
}

function scorePositivePhrase(titleLower, phrase) {
  const phraseLower = normalizeText(phrase);
  if (!phraseLower) return null;

  if (titleLower.includes(phraseLower)) {
    const words = phraseLower.split(' ').length;
    return {
      phrase,
      kind: 'exact',
      score: words >= 3 ? 8 : words === 2 ? 6 : 4,
    };
  }

  const phraseTokens = tokenizeText(phraseLower);
  if (phraseTokens.length < 2) return null;

  const titleTokens = new Set(tokenizeText(titleLower));
  const overlap = phraseTokens.filter((token) => titleTokens.has(token));
  const ratio = overlap.length / phraseTokens.length;

  if (overlap.length >= 2 && ratio >= 0.66) {
    return {
      phrase,
      kind: 'partial',
      score: overlap.length * 2,
    };
  }

  return null;
}

export function scoreTitleAgainstFilter(title, filter = {}) {
  const titleLower = normalizeText(title);
  const positive = Array.isArray(filter.positive) ? filter.positive : [];
  const negative = Array.isArray(filter.negative) ? filter.negative : [];
  const seniorityBoost = filter.seniority_boost && typeof filter.seniority_boost === 'object'
    ? filter.seniority_boost
    : {};

  const blockedBy = dedupe(
    negative.filter((phrase) => titleLower.includes(normalizeText(phrase)))
  );
  if (blockedBy.length > 0) {
    return {
      match: false,
      reason: 'negative_match',
      fitTitle: 0,
      confidence: 0.15,
      matchedPhrases: [],
      blockedBy,
      score: 0,
    };
  }

  const phraseMatches = collapsePhraseMatches(positive
    .map((phrase) => scorePositivePhrase(titleLower, phrase))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score));

  const exactMatches = phraseMatches.filter((match) => match.kind === 'exact');
  const partialMatches = phraseMatches.filter((match) => match.kind === 'partial');

  let score = phraseMatches.reduce((sum, match) => sum + match.score, 0);

  const titleTokens = tokenizeText(titleLower);
  const positiveTokens = new Map();
  for (const phrase of positive) {
    for (const token of tokenizeText(phrase)) {
      positiveTokens.set(token, (positiveTokens.get(token) || 0) + 1);
    }
  }

  const matchedTokens = dedupe(titleTokens.filter((token) => positiveTokens.has(token)));
  let tokenScore = matchedTokens.reduce(
    (sum, token) => sum + Math.min(positiveTokens.get(token), 3),
    0,
  );
  // Cap token-only inflation (many generic overlaps without a real phrase hit).
  tokenScore = Math.min(tokenScore, 20);
  score += tokenScore;

  let seniorityScore = 0;
  const seniorityMatches = [];
  for (const [token, weight] of Object.entries(seniorityBoost)) {
    if (titleLower.includes(normalizeText(token))) {
      seniorityMatches.push(token);
      seniorityScore += Number(weight) || 0;
    }
  }
  score += seniorityScore * 2;

  const phraseBacked =
    exactMatches.length > 0 || partialMatches.length > 0;
  // Pure token overlap can approve weak titles; keep "match" but dampen score when no phrase hit.
  if (!phraseBacked && matchedTokens.length >= 2) {
    score = Math.min(score, 26 + Math.min(matchedTokens.length, 6) * 1.25);
  }

  const match = phraseBacked || matchedTokens.length >= 2;
  const fitTitle = Math.max(0, Math.min(100, Math.round(score * 4.5)));
  const confidence = Math.max(
    0.2,
    Math.min(
      0.98,
      (exactMatches.length * 0.18) +
      (partialMatches.length * 0.1) +
      (matchedTokens.length * 0.04) +
      (seniorityMatches.length * 0.03) +
      (match ? 0.3 : 0)
    )
  );

  return {
    match,
    reason: match ? 'matched' : 'no_positive',
    fitTitle,
    confidence: Number(confidence.toFixed(2)),
    matchedPhrases: dedupe(phraseMatches.map((entry) => entry.phrase)).slice(0, 8),
    matchedTokens: matchedTokens.slice(0, 10),
    seniorityMatches,
    blockedBy,
    score: Number(score.toFixed(2)),
  };
}

export function computeApplicationPriority(application = {}) {
  const baseFivePoint = parseFivePointScore(application.score);
  const fit = baseFivePoint !== null
    ? Math.max(0, Math.min(100, Math.round((baseFivePoint / 5) * 100)))
    : 45;
  const ageDays = daysSince(application.date, 14);
  const freshnessDecay = Math.exp(-0.08 * ageDays);
  const statusMultiplier = STATUS_PRIORITY_MULTIPLIER[application.status] ?? 0.72;
  const confidence = baseFivePoint !== null
    ? (application.reportPath ? 0.88 : 0.76)
    : 0.58;

  const workArrangement = classifyWorkArrangement({
    remote: application.remote,
    reportRemote: application.reportRemote,
    role: application.role,
    notes: application.notes,
    tldr: application.tldr,
    why: application.why,
  });
  const locationMultiplier = locationPriorityMultiplier(workArrangement);

  const priorityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        fit * freshnessDecay * statusMultiplier * (0.7 + 0.3 * confidence) * locationMultiplier,
      ),
    ),
  );

  const band = priorityScore >= 75
    ? 'High'
    : priorityScore >= 50
      ? 'Medium'
      : 'Low';

  return {
    fit,
    ageDays,
    freshnessDecay: Number(freshnessDecay.toFixed(3)),
    statusMultiplier,
    confidence: Number(confidence.toFixed(2)),
    workArrangement,
    locationMultiplier,
    priorityScore,
    band,
  };
}

export function scoreMessageAgainstApplication(application, message) {
  const haystack = normalizeText([
    message?.subject,
    message?.from,
    message?.snippet,
    message?.bodyText,
  ].join(' '));

  const company = normalizeText(application?.company);
  const role = normalizeText(application?.role);
  let score = 0;
  const evidence = [];

  if (company && haystack.includes(company)) {
    score += 30;
    evidence.push(`company:${company}`);
  }

  const companyTokens = tokenizeText(company).filter((token) => token.length >= 4);
  for (const token of companyTokens) {
    if (haystack.includes(token)) {
      score += 6;
      evidence.push(`company_token:${token}`);
    }
  }

  const roleTokens = tokenizeText(role).filter((token) => token.length >= 4);
  for (const token of roleTokens.slice(0, 6)) {
    if (haystack.includes(token)) {
      score += 4;
      evidence.push(`role_token:${token}`);
    }
  }

  const appDate = new Date(application?.date || '');
  const messageDate = new Date(Number(message?.internalDate || Date.now()));
  if (!Number.isNaN(appDate.getTime()) && messageDate >= appDate) {
    score += 2;
  }

  return {
    score,
    confidence: Math.max(0, Math.min(0.99, Number((score / 60).toFixed(2)))),
    evidence,
  };
}

export function selectBestApplicationMatch(applications, message, options = {}) {
  const minScore = options.minScore ?? 18;
  const ambiguityDelta = options.ambiguityDelta ?? 6;

  const ranked = applications
    .map((application) => ({
      application,
      ...scoreMessageAgainstApplication(application, message),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] || null;
  const second = ranked[1] || null;
  if (!best) {
    return { match: null, confidence: 0, ranked };
  }
  if (best.score < minScore) {
    return { match: null, confidence: best.confidence, ranked };
  }
  if (second && best.score - second.score < ambiguityDelta) {
    return { match: null, confidence: best.confidence, ranked };
  }

  return {
    match: best.application,
    confidence: best.confidence,
    evidence: best.evidence,
    ranked,
  };
}
