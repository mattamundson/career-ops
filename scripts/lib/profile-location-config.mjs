/**
 * profile-location-config.mjs — loads location priority from config/profile.yml
 * and produces a config object for scoring-core.mjs.
 *
 * Usage:
 *   import { loadLocationConfig } from './profile-location-config.mjs';
 *   import { focusSortKey } from './scoring-core.mjs';
 *   const config = loadLocationConfig();
 *   focusSortKey(score, fields, config);
 *
 * If `profile.yml` is missing or doesn't declare `location.work_modes`, the
 * loader returns the default on-site > hybrid > remote multipliers so callers
 * don't need to branch.
 */

import fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deriveLocationPriority, DEFAULT_WORK_MODES } from './scoring-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROFILE_PATH = resolve(ROOT, 'config', 'profile.yml');

/**
 * Minimal YAML extractor: read `location.work_modes` array without pulling a
 * YAML dep. The profile.yml schema is stable and this lookup is one key deep.
 */
function readWorkModesFromProfile(profilePath = PROFILE_PATH) {
  if (!fs.existsSync(profilePath)) return null;
  const text = fs.readFileSync(profilePath, 'utf8');
  const lines = text.split('\n');
  let inLocation = false;
  let inWorkModes = false;
  const modes = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (/^location:\s*$/.test(line)) {
      inLocation = true;
      continue;
    }
    if (inLocation && /^[a-zA-Z_]+:/.test(line) && !/^\s/.test(line)) {
      // Hit a new top-level key
      inLocation = false;
      inWorkModes = false;
    }
    if (!inLocation) continue;

    if (/^\s{2}work_modes:\s*(\[.*\])?\s*$/.test(line)) {
      // Inline array `work_modes: [a, b, c]` or block start
      const inlineMatch = line.match(/^\s{2}work_modes:\s*\[(.*)\]\s*$/);
      if (inlineMatch) {
        inlineMatch[1].split(',').forEach((item) => {
          const v = item.trim().replace(/^["']|["']$/g, '');
          if (v) modes.push(v);
        });
        return modes;
      }
      inWorkModes = true;
      continue;
    }

    if (inWorkModes) {
      const listItem = line.match(/^\s{4}-\s+["']?([^"'\n]+?)["']?\s*$/);
      if (listItem) {
        modes.push(listItem[1].trim());
        continue;
      }
      // Any non-indented line ends the list
      if (/^\s{0,2}\S/.test(line)) {
        inWorkModes = false;
      }
    }
  }
  return modes.length === 3 ? modes : null;
}

export function loadLocationConfig({ profilePath = PROFILE_PATH } = {}) {
  const workModes = readWorkModesFromProfile(profilePath) || DEFAULT_WORK_MODES;
  return {
    workModes,
    ...deriveLocationPriority(workModes),
  };
}

export { readWorkModesFromProfile };
