import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { todayConfirmCount } from '../scripts/lib/apply-review-cap.mjs';

test('todayConfirmCount counts submitted and in-progress artifacts, not failed attempts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apply-review-cap-'));
  const now = new Date('2026-04-23T12:00:00.000Z');

  writeFileSync(join(dir, 'confirm-019-2026-04-23T08-05-48-129Z.json'), '{"status":"submitted"}\n');
  writeFileSync(join(dir, 'confirm-016-2026-04-23T08-30-05-022Z.json'), '{"status":"failed"}\n');
  writeFileSync(join(dir, 'confirm-016-2026-04-23T08-30-47-218Z.json'), '{"status":"failed"}\n');
  writeFileSync(join(dir, 'confirm-012-2026-04-23T08-18-10-714Z.json'), '{"status":"failed"}\n');
  writeFileSync(join(dir, 'confirm-004-2026-04-23T08-28-32-475Z.json'), '{"status":"in-progress"}\n');
  writeFileSync(join(dir, 'confirm-004-2026-04-22T08-28-32-475Z.json'), '{"status":"submitted"}\n');

  assert.equal(todayConfirmCount(dir, now), 2);
});
