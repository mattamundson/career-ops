#!/usr/bin/env node
/**
 * remediate-scheduled-task.mjs
 *
 * Exports a patched Windows Task Scheduler XML for common Career-Ops failures.
 * Default target is "Career-Ops Dashboard" because repeated 267014 exits often
 * mean the scheduler killed the task at its ExecutionTimeLimit.
 *
 * Safe default: write patched XML to output/scheduled-task-fixes/ only.
 * Use --apply to re-register the task with schtasks /create /f.
 *
 * Usage:
 *   node scripts/remediate-scheduled-task.mjs
 *   node scripts/remediate-scheduled-task.mjs --task="Career-Ops Dashboard" --execution-limit=PT10M
 *   node scripts/remediate-scheduled-task.mjs --apply
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

const args = process.argv.slice(2);
const taskName = getArg('task') || 'Career-Ops Dashboard';
const executionLimit = getArg('execution-limit') || 'PT10M';
const outDir = resolve(ROOT, getArg('out-dir') || 'output/scheduled-task-fixes');
const APPLY = args.includes('--apply');

if (platform() !== 'win32') {
  console.log('[remediate-scheduled-task] Windows only.');
  process.exit(0);
}

function getArg(name) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : null;
}

function exportTaskXml(name) {
  const r = spawnSync('schtasks', ['/query', '/tn', name, '/xml'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  if (r.error) {
    throw new Error(`schtasks query failed to complete: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `schtasks query exited ${r.status}`).trim());
  }
  return r.stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function safeName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
}

function upsertSimpleTag(xml, tag, value) {
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`);
  if (re.test(xml)) return xml.replace(re, `<${tag}>${value}</${tag}>`);
  return xml.replace(/<\/Settings>/, `    <${tag}>${value}</${tag}>\n  </Settings>`);
}

function patchXml(xml) {
  let out = xml;
  out = upsertSimpleTag(out, 'ExecutionTimeLimit', executionLimit);
  out = upsertSimpleTag(out, 'MultipleInstancesPolicy', 'IgnoreNew');
  out = upsertSimpleTag(out, 'StartWhenAvailable', 'true');
  out = upsertSimpleTag(out, 'AllowStartOnDemand', 'true');
  out = upsertSimpleTag(out, 'DisallowStartIfOnBatteries', 'false');
  out = upsertSimpleTag(out, 'StopIfGoingOnBatteries', 'false');
  return out;
}

function writeUtf16Xml(filePath, xml) {
  const normalized = xml.startsWith('<?xml')
    ? xml.replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0" encoding="UTF-16"?>')
    : `<?xml version="1.0" encoding="UTF-16"?>\n${xml}`;
  const bom = Buffer.from([0xff, 0xfe]);
  const body = Buffer.from(normalized, 'utf16le');
  writeFileSync(filePath, Buffer.concat([bom, body]));
}

try {
  mkdirSync(outDir, { recursive: true });
  const exported = exportTaskXml(taskName);
  if (!exported.trim()) throw new Error(`Task not found or empty export: ${taskName}`);

  const patched = patchXml(exported);
  const outPath = join(outDir, `${safeName(taskName)}-patched.xml`);
  writeUtf16Xml(outPath, patched);

  console.log(`[remediate-scheduled-task] Exported patched XML: ${outPath}`);
  console.log(`[remediate-scheduled-task] Patch summary:`);
  console.log(`  - ExecutionTimeLimit → ${executionLimit}`);
  console.log(`  - MultipleInstancesPolicy → IgnoreNew`);
  console.log(`  - StartWhenAvailable / AllowStartOnDemand → true`);
  console.log(`  - Battery stop/start blocks → false`);

  if (!APPLY) {
    console.log('');
    console.log('[remediate-scheduled-task] Dry-run only. To re-register:');
    console.log(`  schtasks /create /xml "${outPath}" /tn "${taskName}" /f`);
    console.log('  or: pnpm run tasks:remediate -- --apply');
    process.exit(0);
  }

  if (!existsSync(outPath)) throw new Error(`Patched XML missing: ${outPath}`);
  const r = spawnSync('schtasks', ['/create', '/xml', outPath, '/tn', taskName, '/f'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `schtasks exited ${r.status}`).trim());
  }
  console.log(`[remediate-scheduled-task] Re-registered task: ${taskName}`);
  console.log((r.stdout || '').trim());
} catch (e) {
  console.error(`[remediate-scheduled-task] ${e.message}`);
  process.exit(1);
}

