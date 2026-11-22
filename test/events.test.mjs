import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendEvent, readEvents } from '../src/lib/events.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

test('event append ignores caller-supplied chain fields and stays valid', async () => {
  const workspace = await createM1Workspace();
  try {
    const first = await appendEvent(workspace.root, {
      change: 'chg-events',
      tool: 'test',
      action: 'one',
      seq: 99,
      prev: 'forged',
      hash: 'forged',
    });
    const second = await appendEvent(workspace.root, {
      change: 'chg-events',
      tool: 'test',
      action: 'two',
    });
    assert.equal(first.seq, 1);
    assert.equal(first.prev, null);
    assert.equal(second.seq, 2);
    assert.equal(second.prev, first.hash);
    const read = await readEvents(workspace.root);
    assert.equal(read.valid, true, read.gaps.join('; '));
    assert.equal(read.events.length, 2);
  } finally {
    await workspace.cleanup();
  }
});

test('concurrent event appends are serialized', async () => {
  const workspace = await createM1Workspace();
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => appendEvent(workspace.root, {
      change: 'chg-concurrent',
      tool: 'test',
      action: `append-${index}`,
    })));
    const read = await readEvents(workspace.root);
    assert.equal(read.valid, true, read.gaps.join('; '));
    assert.deepEqual(read.events.map((event) => event.seq), Array.from({ length: 20 }, (_, index) => index + 1));
  } finally {
    await workspace.cleanup();
  }
});
