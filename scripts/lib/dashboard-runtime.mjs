import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function createDirectoryEntryCache({
  existsSyncFn,
  readdirSyncFn,
} = {}) {
  const existsSync = existsSyncFn ?? (() => false);
  const readdirSync = readdirSyncFn ?? (() => []);
  const cache = new Map();

  return function listDirectoryEntries(dirPath) {
    if (cache.has(dirPath)) {
      return cache.get(dirPath);
    }
    if (!existsSync(dirPath)) {
      cache.set(dirPath, []);
      return [];
    }
    const entries = readdirSync(dirPath);
    cache.set(dirPath, entries);
    return entries;
  };
}

export async function runOptionalJsonCommand({
  label,
  command = process.execPath,
  args = [],
  cwd,
  execFileImpl = execFileAsync,
} = {}) {
  try {
    const { stdout } = await execFileImpl(command, args, {
      cwd,
      encoding: 'utf8',
    });
    return {
      data: JSON.parse((stdout || '').trim()),
      warning: null,
    };
  } catch (err) {
    return {
      data: null,
      warning: `[dashboard] ${label} unavailable: ${err.message}`,
    };
  }
}
