import { fileURLToPath } from 'url';
import { resolve } from 'path';

export function isMainEntry(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return resolve(fileURLToPath(importMetaUrl)) === resolve(process.argv[1]);
  } catch {
    return false;
  }
}
