import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function appendAutomationEvent(rootPath, event) {
  const date = new Date().toISOString().slice(0, 10);
  const eventsDir = resolve(rootPath, 'data', 'events');
  ensureDir(eventsDir);

  const payload = {
    recorded_at: new Date().toISOString(),
    ...event,
  };

  appendFileSync(
    resolve(eventsDir, `${date}.jsonl`),
    `${JSON.stringify(payload)}\n`,
    'utf8'
  );
}
