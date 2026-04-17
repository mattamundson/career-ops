import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import { join } from 'path';

import { createScanOutput } from '../scripts/lib/scan-output.mjs';

test('appendScanResults writes canonical history rows and pending pipeline entries', () => {
  const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'career-ops-scan-output-'));
  const historyPath = join(tempDir, 'scan-history.tsv');
  const pipelinePath = join(tempDir, 'pipeline.md');

  const output = createScanOutput({ historyPath, pipelinePath });
  output.appendScanResults([
    {
      url: 'https://example.com/job-1',
      company: 'Example Co',
      title: 'Senior Data Engineer',
      location: 'Minneapolis, MN',
    },
    {
      url: 'https://example.com/job-2',
      company: 'Example\tCo 2',
      title: 'Analytics\nEngineer',
    },
  ], { portal: 'direct/example' });

  const history = fs.readFileSync(historyPath, 'utf8');
  const pipeline = fs.readFileSync(pipelinePath, 'utf8');

  assert.match(history, /^url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n/);
  assert.match(history, /https:\/\/example\.com\/job-1\t\d{4}-\d{2}-\d{2}\tdirect\/example\tSenior Data Engineer\tExample Co\tnew\tMinneapolis, MN/);
  assert.match(history, /https:\/\/example\.com\/job-2\t\d{4}-\d{2}-\d{2}\tdirect\/example\tAnalytics Engineer\tExample Co 2\tnew\t\n/);
  assert.match(pipeline, /## Pending\n- \[ \] https:\/\/example\.com\/job-1 \| Example Co \| Senior Data Engineer \| Minneapolis, MN/);
  assert.match(pipeline, /- \[ \] https:\/\/example\.com\/job-2 \| Example Co 2 \| Analytics Engineer/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
