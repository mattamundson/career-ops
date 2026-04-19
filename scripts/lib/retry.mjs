// Generic exponential-backoff retry with jitter for transient failures.
//
// Designed for the kinds of errors that recur during scheduled scan/embed/
// submit runs: OpenAI 429 rate limits, Playwright timeouts, transient DNS,
// and "fetch failed" wraparounds. Permanent failures (4xx other than 429,
// schema errors, missing files) are not retried.
//
// Usage:
//   import { retry, isTransient } from './lib/retry.mjs';
//
//   const result = await retry(
//     () => openai.embeddings.create({ ... }),
//     { label: 'openai-embed', maxAttempts: 5 }
//   );
//
//   // Custom retry predicate:
//   await retry(fn, { shouldRetry: (err, attempt) => err.status === 503 });

const DEFAULTS = {
  maxAttempts: 4,
  baseMs: 500,
  maxMs: 30_000,
  jitter: true,
  label: 'op',
  onRetry: null, // (err, attempt, delayMs) => void
  shouldRetry: null, // (err, attempt) => boolean — overrides isTransient
};

export async function retry(fn, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let lastErr;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const last = attempt === cfg.maxAttempts;
      const retryable = cfg.shouldRetry
        ? cfg.shouldRetry(err, attempt)
        : isTransient(err);

      if (last || !retryable) {
        // Annotate the error so callers can tell retries were exhausted.
        err.retryAttempts = attempt;
        err.retryLabel = cfg.label;
        throw err;
      }

      const delay = backoffMs(attempt, cfg);
      if (cfg.onRetry) cfg.onRetry(err, attempt, delay);
      else logRetry(cfg.label, attempt, cfg.maxAttempts, err, delay);

      await sleep(delay);
    }
  }

  throw lastErr; // unreachable
}

export function isTransient(err) {
  if (!err) return false;

  // OpenAI / Anthropic SDK style
  if (err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504) return true;
  if (err.status >= 500 && err.status < 600) return true;

  // Node fetch / undici
  const code = err.code || err.cause?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
  if (code === 'UND_ERR_SOCKET' || code === 'UND_ERR_CONNECT_TIMEOUT') return true;

  // Playwright / Puppeteer timeouts
  const name = err.name || '';
  if (name === 'TimeoutError') return true;
  const msg = String(err.message || '');
  if (/Navigation timeout/i.test(msg)) return true;
  if (/Target.*closed/i.test(msg)) return true;
  if (/net::ERR_(NETWORK_CHANGED|CONNECTION_RESET|TIMED_OUT|EMPTY_RESPONSE)/i.test(msg)) return true;

  // Generic "rate limit" / "try again"
  if (/rate.?limit/i.test(msg)) return true;
  if (/temporarily unavailable/i.test(msg)) return true;

  return false;
}

function backoffMs(attempt, { baseMs, maxMs, jitter }) {
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  if (!jitter) return exp;
  // Full jitter (AWS recommendation): random in [0, exp]
  return Math.floor(Math.random() * exp);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logRetry(label, attempt, maxAttempts, err, delayMs) {
  const code = err.status || err.code || err.name || 'error';
  const msg = String(err.message || err).slice(0, 120);
  process.stderr.write(
    `[retry] ${label} attempt ${attempt}/${maxAttempts} failed (${code}: ${msg}); waiting ${delayMs}ms\n`
  );
}
