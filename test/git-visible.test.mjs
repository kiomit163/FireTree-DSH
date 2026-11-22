import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { changedFiles, diffSha256 } from '../src/lib/git.js';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('tracked .firetree policy changes are visible to git assessment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-visible-'));
  try {
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'test@example.invalid']);
    git(root, ['config', 'user.name', 'FireTree Test']);
    await mkdir(join(root, '.firetree'), { recursive: true });
    await writeFile(join(root, '.firetree', 'policy.json'), '{"v":1}\n', 'utf8');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'base']);
    const base = git(root, ['rev-parse', 'HEAD']);

    await writeFile(join(root, '.firetree', 'policy.json'), '{"v":2}\n', 'utf8');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'policy']);
    const head = git(root, ['rev-parse', 'HEAD']);

    assert.deepEqual(changedFiles(root, base, head), ['.firetree/policy.json']);
    assert.match(diffSha256(root, base, head), /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
