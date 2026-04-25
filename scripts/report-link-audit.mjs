#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditReportLinks, renderReportLinkAudit } from './lib/report-link-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shouldWrite = process.argv.includes('--write');
const outPath = join(ROOT, 'data', 'report-link-audit.md');

const result = auditReportLinks(ROOT);
const rendered = renderReportLinkAudit(result);

if (shouldWrite) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered, 'utf8');
  console.log(`[report-link-audit] wrote ${outPath}`);
}

console.log(
  `[report-link-audit] ${result.missing.length} missing / ${result.totalLinked} linked reports ` +
    `across ${result.totalEntries} tracker rows`,
);

if (!shouldWrite) {
  console.log('Run with --write to save data/report-link-audit.md');
}

process.exit(0);
