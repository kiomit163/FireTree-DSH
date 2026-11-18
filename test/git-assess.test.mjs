import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { createAssessTool } from '../src/tools/assess.js';
import { createReviewTool } from '../src/tools/review.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const EXEC = { agent: { id: 'agent-1' }, signal: new AbortController().signal };
const HASH = 'a'.repeat(64);

function contextFor(root) {
  return { workingDirectory: { async ensure(agent) { assert.ok(agent); return root; } } };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=FireTree Test', '-c', 'user.email=firetree@example.invalid', 'commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

async function setupGitWorkspace() {
  const workspace = await createM1Workspace();
  git(workspace.root, ['init', '-q']);
  const first = commit(workspace.root, 'base');
  await writeFile(join(workspace.root, 'services', 'billing', 'charge.mjs'), 'export const charge = "v2";\n', 'utf8');
  const second = commit(workspace.root, 'change charge');
  return { workspace, first, second };
}

test('verify_git binds assessment to git tree/diff and rejects a mismatched file set', async () => {
  const { workspace, first, second } = await setupGitWorkspace();
  try {
    const assess = createAssessTool(contextFor(workspace.root));
    await assert.rejects(
      assess.execute({
        base: first,
        head: second,
        files: ['docs/README.md'],
        change: 'chg-git-bad',
        verify_git: true,
      }, EXEC),
      (error) => error.code === 'FILES_MISMATCH',
    );

    const output = await assess.execute({
      base: first,
      head: second,
      files: ['services/billing/charge.mjs'],
      change: 'chg-git',
      verify_git: true,
    }, EXEC);
    assert.equal(output.ok, true);
    assert.match(output.change.base, /^[a-f0-9]{40}$/);
    assert.match(output.change.head, /^[a-f0-9]{40}$/);
    assert.match(output.git.tree_sha, /^[a-f0-9]{40}$/);
    assert.match(output.git.diff_sha256, /^[a-f0-9]{64}$/);
    assert.equal(output.revision, 1);
  } finally {
    await workspace.cleanup();
  }
});

test('review binds to the assessment and rejects a different diff', async () => {
  const { workspace, first, second } = await setupGitWorkspace();
  try {
    const assess = createAssessTool(contextFor(workspace.root));
    const output = await assess.execute({
      base: first,
      head: second,
      files: ['services/billing/charge.mjs'],
      change: 'chg-git-review',
      verify_git: true,
    }, EXEC);

    const review = createReviewTool(contextFor(workspace.root));
    await assert.rejects(
      review.execute({
        action: 'open',
        change: 'chg-git-review',
        diff_sha256: HASH,
        spec_sha256: HASH,
        criteria: ['correctness'],
        evidence: [],
        seats: [{ id: 's1', owner: '@team-billing' }],
      }, EXEC),
      (error) => error.code === 'DIFF_MISMATCH',
    );

    const opened = await review.execute({
      action: 'open',
      change: 'chg-git-review',
      diff_sha256: output.git.diff_sha256,
      spec_sha256: HASH,
      criteria: ['correctness'],
      evidence: [],
      seats: [{ id: 's1', owner: '@team-billing' }],
    }, EXEC);
    assert.equal(opened.ok, true);
    assert.equal(opened.record.assessment_sha256, output.artifact.sha256);
    assert.equal(opened.record.diff_sha256, output.git.diff_sha256);
  } finally {
    await workspace.cleanup();
  }
});

test('a reviewed change is immutable; unreviewed re-assessment keeps a revision', async () => {
  const { workspace, first, second } = await setupGitWorkspace();
  try {
    const assess = createAssessTool(contextFor(workspace.root));
    await assess.execute({
      base: first,
      head: second,
      files: ['services/billing/charge.mjs'],
      change: 'chg-git-immutable',
      verify_git: true,
    }, EXEC);

    const review = createReviewTool(contextFor(workspace.root));
    const assessment = JSON.parse(await readFile(join(workspace.root, '.firetree', 'changes', 'chg-git-immutable', 'assessment.json'), 'utf8'));
    await review.execute({
      action: 'open',
      change: 'chg-git-immutable',
      diff_sha256: assessment.git.diff_sha256,
      spec_sha256: HASH,
      criteria: ['correctness'],
      evidence: [],
      seats: [{ id: 's1', owner: '@team-billing' }],
    }, EXEC);

    await writeFile(join(workspace.root, 'services', 'checkout', 'cart.mjs'), 'export const cart = "v2";\n', 'utf8');
    const third = commit(workspace.root, 'change cart');
    await assert.rejects(
      assess.execute({
        base: second,
        head: third,
        files: ['services/checkout/cart.mjs'],
        change: 'chg-git-immutable',
        verify_git: true,
      }, EXEC),
      (error) => error.code === 'CHANGE_IMMUTABLE',
    );

    await assess.execute({
      base: first,
      head: second,
      files: ['services/billing/charge.mjs'],
      change: 'chg-git-revisions',
      verify_git: true,
    }, EXEC);
    const revised = await assess.execute({
      base: second,
      head: third,
      files: ['services/checkout/cart.mjs'],
      change: 'chg-git-revisions',
      verify_git: true,
    }, EXEC);
    assert.equal(revised.revision, 2);
    const archive = JSON.parse(await readFile(join(workspace.root, '.firetree', 'changes', 'chg-git-revisions', 'revisions', '1.json'), 'utf8'));
    assert.equal(archive.revision, 1);
    assert.deepEqual(archive.change.files, ['services/billing/charge.mjs']);
  } finally {
    await workspace.cleanup();
  }
});
