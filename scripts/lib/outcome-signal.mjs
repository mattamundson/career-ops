/**
 * outcome-signal.mjs — per-company + per-portal outcome-based priority multiplier.
 *
 * Task 2 of the 2026-04-17 top-10 ROI plan. Every application is a data point:
 * companies that ghost get downweighted, companies that interview/offer get
 * upweighted. Early-noise-safe: confidence-gated at 3+ samples and capped at
 * ±15% swing.
 *
 * Inputs:
 *   - responses.md rows (parsed): { app_id, company, ats, status, ... }
 *   - applications.md rows (parsed): { id, company, status, ... }
 *
 * Semantics:
 *   Positive signals (per company/portal): offer, interview, phone_screen,
 *     recruiter_reply, acknowledged (weak-positive)
 *   Negative signals: rejected, ghosted
 *   Ignored (in-flight): submitted, in_progress, withdrew
 *
 * Output shape (per key):
 *   { samples, posRate, negRate, raw, multiplier, confidence }
 *   - multiplier in [0.85, 1.15]
 *   - confidence in [0, 1] scaled on samples vs minSamples
 */

const POSITIVE_RESPONSE_STATUSES = new Set([
  'recruiter_reply', 'phone_screen', 'interview', 'offer',
]);
const WEAK_POSITIVE_RESPONSE_STATUSES = new Set(['acknowledged']);
const NEGATIVE_RESPONSE_STATUSES = new Set(['rejected', 'ghosted']);

// applications.md status column — company-level rollup complements the
// per-submission responses.md grain.
const POSITIVE_APP_STATUSES = new Set([
  'Interview', 'Offer', 'Responded', 'Contact',
]);
const NEGATIVE_APP_STATUSES = new Set(['Rejected']);

export const DEFAULT_MIN_SAMPLES = 3;
export const DEFAULT_CAP = 0.15;

export function slugifyCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Aggregates per-company + per-portal counts from responses + applications.
 * Returns a Map keyed by `${type}:${slug}` → { samples, pos, weakPos, neg }.
 */
export function aggregateOutcomes(responses = [], applications = []) {
  const buckets = new Map();

  const bump = (key, field) => {
    const entry = buckets.get(key) || { samples: 0, pos: 0, weakPos: 0, neg: 0 };
    entry.samples += 1;
    entry[field] += 1;
    buckets.set(key, entry);
  };

  // responses.md — per-submission grain, status is lowercase event type
  for (const row of responses) {
    const status = String(row.status || '').trim().toLowerCase();
    const companySlug = slugifyCompany(row.company);
    const portalSlug = slugifyCompany(row.ats);

    let field = null;
    if (POSITIVE_RESPONSE_STATUSES.has(status)) field = 'pos';
    else if (WEAK_POSITIVE_RESPONSE_STATUSES.has(status)) field = 'weakPos';
    else if (NEGATIVE_RESPONSE_STATUSES.has(status)) field = 'neg';
    if (!field) continue;

    if (companySlug) bump(`company:${companySlug}`, field);
    if (portalSlug) bump(`portal:${portalSlug}`, field);
  }

  // applications.md — rollup for cases where responses.md is sparse
  for (const row of applications) {
    const status = String(row.status || '').trim();
    const companySlug = slugifyCompany(row.company);
    if (!companySlug) continue;

    let field = null;
    if (POSITIVE_APP_STATUSES.has(status)) field = 'pos';
    else if (NEGATIVE_APP_STATUSES.has(status)) field = 'neg';
    if (!field) continue;

    bump(`company:${companySlug}`, field);
  }

  return buckets;
}

function computeMultiplier(bucket, { minSamples, cap }) {
  const { samples, pos, weakPos, neg } = bucket;
  if (samples < minSamples) {
    return { multiplier: 1.0, confidence: samples / minSamples, raw: 1.0 };
  }
  // Weak-positive (auto-ack) is 1/2 weight — ack alone isn't real signal
  const weightedPos = pos + 0.5 * weakPos;
  const posRate = weightedPos / samples;
  const negRate = neg / samples;
  const raw = 1.0 + cap * (posRate - negRate);
  const clamped = Math.max(1.0 - cap, Math.min(1.0 + cap, raw));
  // Confidence asymptotes to 1 as samples grow beyond 2 * minSamples
  const confidence = Math.min(1.0, samples / (minSamples * 2));
  return {
    multiplier: Number(clamped.toFixed(3)),
    confidence: Number(confidence.toFixed(2)),
    raw: Number(raw.toFixed(3)),
  };
}

/**
 * Build the signal map — `{ company: Map<slug, result>, portal: Map<slug, result> }`.
 * `result` includes the full bucket + computed multiplier.
 */
export function computeOutcomeSignal(
  responses = [],
  applications = [],
  { minSamples = DEFAULT_MIN_SAMPLES, cap = DEFAULT_CAP } = {},
) {
  const buckets = aggregateOutcomes(responses, applications);
  const company = new Map();
  const portal = new Map();

  for (const [key, bucket] of buckets) {
    const [type, slug] = key.split(':');
    const computed = computeMultiplier(bucket, { minSamples, cap });
    const result = { ...bucket, ...computed };
    if (type === 'company') company.set(slug, result);
    else if (type === 'portal') portal.set(slug, result);
  }

  return { company, portal };
}

/**
 * Look up the combined multiplier for an application. Combines company and
 * portal multiplicatively, then re-clamps to ±cap to prevent compounding.
 */
export function outcomeSignalFor(
  signalMap,
  { company, portal } = {},
  { cap = DEFAULT_CAP } = {},
) {
  if (!signalMap) return { multiplier: 1.0, companyMultiplier: 1.0, portalMultiplier: 1.0, confidence: 0 };
  const companySlug = slugifyCompany(company);
  const portalSlug = slugifyCompany(portal);
  const companyEntry = signalMap.company?.get(companySlug) ?? null;
  const portalEntry = signalMap.portal?.get(portalSlug) ?? null;
  const companyMultiplier = companyEntry?.multiplier ?? 1.0;
  const portalMultiplier = portalEntry?.multiplier ?? 1.0;
  const combined = companyMultiplier * portalMultiplier;
  const clamped = Math.max(1.0 - cap, Math.min(1.0 + cap, combined));
  const confidence = Math.max(companyEntry?.confidence ?? 0, portalEntry?.confidence ?? 0);
  return {
    multiplier: Number(clamped.toFixed(3)),
    companyMultiplier,
    portalMultiplier,
    confidence: Number(confidence.toFixed(2)),
  };
}
