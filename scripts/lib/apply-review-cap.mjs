import { existsSync, readFileSync, readdirSync } from 'node:fs';

export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function todayConfirmCount(applyRunsDir, now = new Date()) {
  if (!existsSync(applyRunsDir)) return 0;

  const today = todayUtc(now);
  let count = 0;

  for (const name of readdirSync(applyRunsDir)) {
    if (!name.startsWith('confirm-') || !name.includes(today) || !name.endsWith('.json')) {
      continue;
    }

    const path = `${applyRunsDir}/${name}`;
    try {
      const artifact = JSON.parse(readFileSync(path, 'utf8'));
      if (artifact.status === 'submitted' || artifact.status === 'in-progress') {
        count += 1;
      }
    } catch {
      count += 1;
    }
  }

  return count;
}
