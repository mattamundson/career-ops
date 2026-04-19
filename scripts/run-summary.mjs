import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function safeName(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/\..+/, 'Z');
}

function renderMarkdown(summary) {
  const lines = [
    `# Run Summary — ${summary.job}`,
    '',
    `- Status: ${summary.status}`,
    `- Started At: ${summary.startedAt}`,
    `- Finished At: ${summary.finishedAt}`,
    `- Duration Ms: ${summary.durationMs}`,
  ];

  if (summary.stats && Object.keys(summary.stats).length > 0) {
    lines.push('- Stats:');
    for (const [key, value] of Object.entries(summary.stats)) {
      lines.push(`  - ${key}: ${value}`);
    }
  }

  if (summary.warnings?.length) {
    lines.push('- Warnings:');
    for (const warning of summary.warnings) lines.push(`  - ${warning}`);
  }

  if (summary.artifacts?.length) {
    lines.push('- Artifacts:');
    for (const artifact of summary.artifacts) lines.push(`  - ${artifact}`);
  }

  if (summary.error) {
    lines.push(`- Error: ${summary.error}`);
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function createRunSummaryContext(rootDir, job, extra = {}) {
  const startedAt = new Date().toISOString();
  return {
    rootDir,
    job,
    startedAt,
    warnings: [...(extra.warnings || [])],
    stats: { ...(extra.stats || {}) },
    artifacts: [...(extra.artifacts || [])],
  };
}

export function finalizeRunSummary(ctx, status, extra = {}) {
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, new Date(finishedAt) - new Date(ctx.startedAt));
  const summary = {
    job: ctx.job,
    status,
    startedAt: ctx.startedAt,
    finishedAt,
    durationMs,
    stats: { ...ctx.stats, ...(extra.stats || {}) },
    warnings: [...ctx.warnings, ...(extra.warnings || [])],
    artifacts: [...ctx.artifacts, ...(extra.artifacts || [])],
    error: extra.error || null,
  };

  const dir = resolve(ctx.rootDir, 'data', 'run-summaries');
  mkdirSync(dir, { recursive: true });
  const base = `${safeName(ctx.job)}-${timestampForFile()}`;
  const jsonPath = resolve(dir, `${base}.json`);
  const mdPath = resolve(dir, `${base}.md`);

  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, renderMarkdown(summary), 'utf8');

  return { summary, jsonPath, mdPath };
}
