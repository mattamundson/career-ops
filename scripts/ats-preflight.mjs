#!/usr/bin/env node
/**
 * ATS preflight: run ats-score --write-json, then ats-gate --score-file (cached path).
 * Single entry point for step 6b in modes/pdf.md — avoids double trigram work.
 *
 *   node scripts/ats-preflight.mjs --jd=jds/acme.txt --write-json=output/ats-score-acme.json
 *   node scripts/ats-preflight.mjs --jd=... --write-json=... --cv=cv.md --threshold=60 --json
 *
 * Any args other than --jd, --cv, --write-json are passed through to ats-gate.mjs only.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntry } from './lib/main-entry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function parsePreflightArgs(argv) {
  let jd = null;
  let cv = 'cv.md';
  let writeJson = null;
  const scoreExtra = []; // extra flags routed to ats-score only (company/location/exclude-structural)
  const gateRest = [];
  for (const a of argv) {
    if (a.startsWith('--jd=')) jd = a.slice(5);
    else if (a.startsWith('--cv=')) cv = a.slice(5);
    else if (a.startsWith('--write-json=')) writeJson = a.slice(13);
    else if (a === '--exclude-structural' || a.startsWith('--exclude-structural=')) {
      scoreExtra.push(a);
    } else if (a.startsWith('--company=') || a.startsWith('--location=')) {
      // Forward to BOTH score (for exclude set) and gate (for metadata logging)
      scoreExtra.push(a);
      gateRest.push(a);
    } else gateRest.push(a);
  }
  return { jd, cv, writeJson, scoreExtra, gateRest };
}

function main() {
  const { jd, cv, writeJson, scoreExtra, gateRest } = parsePreflightArgs(process.argv.slice(2));
  if (!jd || !writeJson) {
    console.error(
      'Usage: node scripts/ats-preflight.mjs --jd=<path> --write-json=<path> [--cv=cv.md] [--exclude-structural --company=X --location=Y] [ats-gate args...]\n' +
        '  Runs: ats-score --write-json, then ats-gate with --score-file (cached fast path).'
    );
    process.exit(2);
  }

  const score = spawnSync(
    process.execPath,
    [
      'scripts/ats-score.mjs',
      `--jd=${jd}`,
      `--cv=${cv}`,
      `--write-json=${writeJson}`,
      ...scoreExtra,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );
  if (score.status !== 0) {
    process.exit(score.status ?? 1);
  }

  const gate = spawnSync(
    process.execPath,
    [
      'scripts/ats-gate.mjs',
      `--jd=${jd}`,
      `--cv=${cv}`,
      `--score-file=${writeJson}`,
      ...gateRest,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );
  process.exit(gate.status === null ? 1 : gate.status);
}

if (isMainEntry(import.meta.url)) {
  main();
}

export { parsePreflightArgs };
