#!/usr/bin/env node

import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeApplicationIndex } from './lib/career-data.mjs';
import { appendAutomationEvent } from './lib/automation-events.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const { filePath, snapshot } = writeApplicationIndex(ROOT);

console.log(`[application-index] wrote ${snapshot.records.length} records to ${filePath}`);

appendAutomationEvent(ROOT, {
  type: 'application.index.rebuilt',
  status: 'success',
  summary: `Application index: ${snapshot.records.length} record(s).`,
  details: { path: relative(ROOT, filePath).split('\\').join('/') },
});
