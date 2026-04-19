/**
 * Load job identity keys from tracker-linked evaluation reports (`**URL:**`).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { jobKeysFromUrl } from './job-url-keys.mjs';

function parseApplications(appsPath) {
  if (!existsSync(appsPath)) return [];
  const lines = readFileSync(appsPath, 'utf8').split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 9) continue;
    const num = parseInt(parts[1], 10);
    if (Number.isNaN(num)) continue;
    entries.push({
      num,
      company: parts[3],
      report: parts[8],
    });
  }
  return entries;
}

function reportPathFromCell(root, reportCell) {
  const m = reportCell.match(/\]\(([^)]+)\)/);
  if (!m) return null;
  const rel = m[1].replace(/^\.\//, '');
  return join(root, rel);
}

function extractUrlFromReportBody(md) {
  const m = md.match(/^\*\*URL:\*\*\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * @param {string} root — repo root
 * @param {string} [appsPath] — default data/applications.md under root
 * @returns {{ keyTo: Map<string, { appNums: number[], firstCompany: string }>, missingReport: number, noUrlInReport: number, entryCount: number }}
 */
export function loadTrackedKeyMap(root, appsPath) {
  const APPS = appsPath ?? join(root, 'data', 'applications.md');
  const keyTo = new Map();
  const entries = parseApplications(APPS);

  let missingReport = 0;
  let noUrlInReport = 0;

  for (const e of entries) {
    const rp = reportPathFromCell(root, e.report);
    if (!rp || !existsSync(rp)) {
      missingReport++;
      continue;
    }
    const head = readFileSync(rp, 'utf8').slice(0, 12000);
    const jobUrl = extractUrlFromReportBody(head);
    if (!jobUrl) {
      noUrlInReport++;
      continue;
    }
    const keys = jobKeysFromUrl(jobUrl);
    for (const k of keys) {
      if (!keyTo.has(k)) {
        keyTo.set(k, { appNums: [], firstCompany: e.company });
      }
      const row = keyTo.get(k);
      if (!row.appNums.includes(e.num)) row.appNums.push(e.num);
    }
  }

  return { keyTo, missingReport, noUrlInReport, entryCount: entries.length };
}
