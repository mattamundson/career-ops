import test from 'node:test';
import assert from 'node:assert/strict';

import { expandDirectJobBoardScans } from '../scripts/lib/direct-board-config.mjs';

test('expandDirectJobBoardScans preserves legacy single-location entries', () => {
  const scans = expandDirectJobBoardScans([
    { name: 'indeed', script: 'scan-indeed.mjs', location: 'Minneapolis, MN', enabled: true },
  ]);

  assert.equal(scans.length, 1);
  assert.equal(scans[0].name, 'indeed');
  assert.equal(scans[0].location, 'Minneapolis, MN');
  assert.equal(scans[0].baseName, 'indeed');
});

test('expandDirectJobBoardScans explodes locations arrays into location-specific variants', () => {
  const scans = expandDirectJobBoardScans([
    {
      name: 'linkedin-mcp',
      script: 'scan-linkedin-mcp.mjs',
      locations: [
        { value: 'Minneapolis, Minnesota, United States', name_suffix: 'msp', enabled: true },
        { value: 'Remote', name_suffix: 'remote', enabled: false },
      ],
    },
  ]);

  assert.deepEqual(
    scans.map((scan) => ({ name: scan.name, location: scan.location, enabled: scan.enabled, baseName: scan.baseName })),
    [
      {
        name: 'linkedin-mcp-msp',
        location: 'Minneapolis, Minnesota, United States',
        enabled: true,
        baseName: 'linkedin-mcp',
      },
      {
        name: 'linkedin-mcp-remote',
        location: 'Remote',
        enabled: false,
        baseName: 'linkedin-mcp',
      },
    ],
  );
});

test('expandDirectJobBoardScans supports scalar location arrays', () => {
  const scans = expandDirectJobBoardScans([
    {
      name: 'indeed',
      script: 'scan-indeed.mjs',
      enabled: true,
      locations: ['Minneapolis, MN', 'Remote'],
    },
  ]);

  assert.equal(scans.length, 2);
  assert.equal(scans[0].name, 'indeed-minneapolis-mn');
  assert.equal(scans[1].name, 'indeed-remote');
});
