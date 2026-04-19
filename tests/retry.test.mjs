// tests/retry.test.mjs
// Coverage for scripts/lib/retry.mjs

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { retry, isTransient } from '../scripts/lib/retry.mjs';

test('retry succeeds on first attempt without retrying', async () => {
  let calls = 0;
  const result = await retry(() => {
    calls += 1;
    return 'ok';
  }, { label: 'test-success', maxAttempts: 3 });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('retry succeeds on second attempt after transient error', async () => {
  let calls = 0;
  const result = await retry(
    () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('rate limit hit');
        err.status = 429;
        throw err;
      }
      return 'recovered';
    },
    { label: 'test-recover', maxAttempts: 3, baseMs: 1, jitter: false }
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
});

test('retry exhausts maxAttempts and throws annotated error', async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      () => {
        calls += 1;
        const err = new Error('always 503');
        err.status = 503;
        throw err;
      },
      { label: 'test-exhaust', maxAttempts: 3, baseMs: 1, jitter: false }
    ),
    (err) => {
      assert.equal(err.retryAttempts, 3);
      assert.equal(err.retryLabel, 'test-exhaust');
      return true;
    }
  );
  assert.equal(calls, 3);
});

test('retry does NOT retry permanent errors (4xx other than 429)', async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      () => {
        calls += 1;
        const err = new Error('not found');
        err.status = 404;
        throw err;
      },
      { label: 'test-permanent', maxAttempts: 5, baseMs: 1, jitter: false }
    ),
    (err) => err.status === 404
  );
  assert.equal(calls, 1);
});

test('isTransient: HTTP status', () => {
  assert.equal(isTransient({ status: 429 }), true);
  assert.equal(isTransient({ status: 503 }), true);
  assert.equal(isTransient({ status: 502 }), true);
  assert.equal(isTransient({ status: 504 }), true);
  assert.equal(isTransient({ status: 500 }), true);
  assert.equal(isTransient({ status: 404 }), false);
  assert.equal(isTransient({ status: 401 }), false);
  assert.equal(isTransient({ status: 200 }), false);
});

test('isTransient: network error codes', () => {
  assert.equal(isTransient({ code: 'ECONNRESET' }), true);
  assert.equal(isTransient({ code: 'ETIMEDOUT' }), true);
  assert.equal(isTransient({ code: 'ENOTFOUND' }), true);
  assert.equal(isTransient({ code: 'EAI_AGAIN' }), true);
  assert.equal(isTransient({ code: 'EACCES' }), false);
});

test('isTransient: Playwright TimeoutError', () => {
  const err = new Error('Navigation timeout of 30000 ms exceeded');
  err.name = 'TimeoutError';
  assert.equal(isTransient(err), true);
});

test('isTransient: rate-limit message', () => {
  assert.equal(isTransient(new Error('Rate limit exceeded')), true);
  assert.equal(isTransient(new Error('temporarily unavailable')), true);
  assert.equal(isTransient(new Error('completely fine')), false);
});

test('retry honors custom shouldRetry predicate', async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      () => {
        calls += 1;
        const err = new Error('weird error');
        err.status = 418;
        throw err;
      },
      {
        label: 'test-custom',
        maxAttempts: 3,
        baseMs: 1,
        jitter: false,
        shouldRetry: (err) => err.status === 418,
      }
    )
  );
  assert.equal(calls, 3);
});

test('retry calls onRetry hook with err, attempt, delay', async () => {
  const observed = [];
  await assert.rejects(
    retry(
      () => {
        const err = new Error('boom');
        err.status = 500;
        throw err;
      },
      {
        label: 'test-hook',
        maxAttempts: 2,
        baseMs: 1,
        jitter: false,
        onRetry: (err, attempt, delay) => {
          observed.push({ status: err.status, attempt, delay });
        },
      }
    )
  );
  // Only 1 retry observation: between attempts 1 and 2; final failure does not call onRetry.
  assert.equal(observed.length, 1);
  assert.equal(observed[0].status, 500);
  assert.equal(observed[0].attempt, 1);
});
