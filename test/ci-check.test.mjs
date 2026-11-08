import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const run = promisify(execFile);

async function cli(args) {
  try {
    const result = await run(process.execPath, ['bin/firetree-check.mjs', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('CI check returns a gap and exit 1 for a missing change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-ci-check-'));
  try {
    const result = await cli(['--mode', 'autonomous', '--change', 'missing-change', '--root', root]);
    assert.equal(result.code, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.ok(output.gaps.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CI check rejects invalid mode', async () => {
  const result = await cli(['--mode', 'invalid', '--change', 'x']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--mode must be governed or autonomous/);
});
