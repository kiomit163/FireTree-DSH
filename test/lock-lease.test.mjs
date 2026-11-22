import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { withFileLock } from '../src/lib/lock.js';

test('lock lease does not steal a live owner and reclaims a dead owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-lock-'));
  const live = join(root, 'live.lock');
  const dead = join(root, 'dead.lock');
  const stale = new Date(Date.now() - 11 * 60 * 1000);
  try {
    await writeFile(live, `${process.pid}\n${stale.toISOString()}\n`, 'utf8');
    await utimes(live, stale, stale);
    await assert.rejects(
      withFileLock(live, async () => 'never', { timeoutMs: 80, retryMs: 10 }),
      /timed out waiting for lock/,
    );

    await writeFile(dead, '999999\n2020-01-01T00:00:00Z\n', 'utf8');
    await utimes(dead, stale, stale);
    const value = await withFileLock(dead, async () => 'acquired', { timeoutMs: 500 });
    assert.equal(value, 'acquired');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
