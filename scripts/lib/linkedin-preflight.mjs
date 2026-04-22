import { readdirSync, statSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const SOURCE = 'linkedin-mcp';
const MCP_HOME = join(homedir(), '.linkedin-mcp');
const KEEP_SNAPSHOTS = 1;

function dirSizeBytes(path) {
  let total = 0;
  try {
    for (const name of readdirSync(path)) {
      const p = join(path, name);
      const st = statSync(p);
      total += st.isDirectory() ? dirSizeBytes(p) : st.size;
    }
  } catch { /* advisory only */ }
  return total;
}

export function killStaleLinkedInChrome() {
  if (process.platform !== 'win32') return { killed: 0, skipped: true };
  try {
    // Avoid nested quote parsing issues by filtering in PowerShell instead of -Filter.
    const psCmd = [
      "Get-CimInstance -ClassName Win32_Process",
      "  | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*linkedin-mcp*' }",
      "  | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }",
      '  | Measure-Object',
      '  | Select-Object -ExpandProperty Count',
    ].join(' ');
    const out = execSync(`powershell.exe -NoProfile -Command "${psCmd}"`, { encoding: 'utf-8', timeout: 15000 });
    const killed = parseInt(out.trim()) || 0;
    if (killed > 0) {
      console.error(`[${SOURCE}] preflight: killed ${killed} stale Chrome process(es) on linkedin-mcp profile`);
    }
    return { killed, skipped: false };
  } catch (err) {
    console.error(`[${SOURCE}] preflight: kill-stale-chrome failed (non-fatal): ${err.message}`);
    return { killed: 0, skipped: false, error: err.message };
  }
}

export function pruneInvalidStateSnapshots() {
  if (!existsSync(MCP_HOME)) return { pruned: 0, bytes: 0 };
  try {
    const entries = readdirSync(MCP_HOME)
      .filter((n) => n.startsWith('invalid-state-'))
      .map((n) => ({ name: n, path: join(MCP_HOME, n), mtime: statSync(join(MCP_HOME, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const toDelete = entries.slice(KEEP_SNAPSHOTS);
    let bytes = 0;
    for (const e of toDelete) {
      try {
        const size = dirSizeBytes(e.path);
        rmSync(e.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        bytes += size;
      } catch (err) {
        console.error(`[${SOURCE}] preflight: could not remove ${e.name}: ${err.message}`);
      }
    }
    if (toDelete.length > 0) {
      console.error(`[${SOURCE}] preflight: pruned ${toDelete.length} invalid-state snapshot(s) (${(bytes / 1e6).toFixed(0)}MB reclaimed, kept ${Math.min(KEEP_SNAPSHOTS, entries.length)})`);
    }
    return { pruned: toDelete.length, bytes };
  } catch (err) {
    console.error(`[${SOURCE}] preflight: snapshot prune failed (non-fatal): ${err.message}`);
    return { pruned: 0, bytes: 0, error: err.message };
  }
}

export function linkedinPreflight() {
  const killed = killStaleLinkedInChrome();
  const pruned = pruneInvalidStateSnapshots();
  return { killed, pruned };
}
