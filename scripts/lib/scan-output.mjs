import fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HISTORY_PATH = resolve(ROOT, 'data', 'scan-history.tsv');
const PIPELINE_PATH = resolve(ROOT, 'data', 'pipeline.md');
const HISTORY_HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n';
const PIPELINE_SKELETON = '# Job Pipeline — URL Inbox\n\nAdd job URLs here.\n\n## Pending\n\n## Processed\n';

function sanitizeField(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function readSeenUrls(historyPath) {
  if (!fs.existsSync(historyPath)) {
    return new Set();
  }
  return new Set(
    fs.readFileSync(historyPath, 'utf8')
      .split('\n')
      .map(line => line.split('\t')[0])
      .filter(Boolean)
  );
}

function ensurePipelineFile(pipelinePath) {
  if (!fs.existsSync(pipelinePath)) {
    fs.writeFileSync(pipelinePath, PIPELINE_SKELETON, 'utf8');
  }
}

function appendToPipeline(entries, pipelinePath) {
  ensurePipelineFile(pipelinePath);
  let text = fs.readFileSync(pipelinePath, 'utf8');
  const pendingMarker = '## Pending';
  let idx = text.indexOf(pendingMarker);

  if (idx === -1) {
    text += `\n${pendingMarker}\n`;
    idx = text.indexOf(pendingMarker);
  }

  // Schema: `- [ ] URL | Company | Title | Location`. Location appended when
  // present; legacy 3-column rows (no Location) remain readable.
  const lines = entries.map(entry => {
    const base = `- [ ] ${sanitizeField(entry.url)} | ${sanitizeField(entry.company || 'Unknown')} | ${sanitizeField(entry.title || 'Untitled')}`;
    const loc = sanitizeField(entry.location);
    return loc ? `${base} | ${loc}` : base;
  });
  const insertAfter = idx + pendingMarker.length;
  text = text.slice(0, insertAfter) + '\n' + lines.join('\n') + '\n' + text.slice(insertAfter);
  fs.writeFileSync(pipelinePath, text, 'utf8');
}

function appendToHistory(entries, portal, status, historyPath) {
  const today = new Date().toISOString().slice(0, 10);
  const needsHeader = !fs.existsSync(historyPath) || !fs.readFileSync(historyPath, 'utf8').startsWith('url\t');
  const lines = entries.map(entry =>
    `${sanitizeField(entry.url)}\t${today}\t${sanitizeField(portal)}\t${sanitizeField(entry.title || 'Untitled')}\t${sanitizeField(entry.company || 'Unknown')}\t${sanitizeField(status)}\t${sanitizeField(entry.location)}`
  ).join('\n');

  if (needsHeader) {
    const existing = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, 'utf8') : '';
    fs.writeFileSync(historyPath, HISTORY_HEADER + existing + (lines ? `${lines}\n` : ''), 'utf8');
    return;
  }

  if (lines) {
    fs.appendFileSync(historyPath, `${lines}\n`);
  }
}

export function createScanOutput({ historyPath = HISTORY_PATH, pipelinePath = PIPELINE_PATH } = {}) {
  return {
    loadSeenUrls() {
      return readSeenUrls(historyPath);
    },
    appendScanResults(entries, { portal, status = 'new' }) {
      if (!entries.length) {
        return;
      }
      appendToHistory(entries, portal, status, historyPath);
      appendToPipeline(entries, pipelinePath);
    },
  };
}

const defaultOutput = createScanOutput();

export function loadSeenUrls() {
  return defaultOutput.loadSeenUrls();
}

export function appendScanResults(entries, options) {
  return defaultOutput.appendScanResults(entries, options);
}
