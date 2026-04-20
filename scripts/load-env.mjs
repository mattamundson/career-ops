import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load .env into process.env. The project-local .env is canonical by default
 * (overrides shell env), since stale shell vars from prior sessions of other
 * projects (e.g. another tool's GOOGLE_CLIENT_ID) silently break OAuth
 * handshakes when the wrong client_id is paired with this project's tokens.
 *
 * Pass { override: false } in the rare case where shell-level overrides
 * should win (e.g. CI injecting a per-build secret).
 */
export function loadProjectEnv(rootDir, opts = {}) {
  const envPath = resolve(rootDir, '.env');
  if (!existsSync(envPath)) return;
  const override = opts.override !== false;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    if (!override && process.env[key]) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}
