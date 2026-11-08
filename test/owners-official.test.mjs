/**
 * Differential cases adapted from
 * https://github.com/kubernetes-sigs/prow/blob/main/pkg/repoowners/repoowners_test.go
 * (TestGetApprovers / TestExpandAliases). Expected owner sets are the official
 * "all approvers" sets unless no_parent_owners stops traversal.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { loadOwners } from '../src/lib/owners.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'firetree-owners-official-'));
  const files = {
    'OWNERS': 'approvers:\n- alice\n- bob\n',
    'leaf/OWNERS': 'approvers:\n- carl\n- dave\n',
    'leaf-filter/OWNERS': 'filters:\n  "\\.md$":\n    approvers:\n    - carl\n    - dave\n  "\\.txt$":\n    approvers:\n    - elic\n',
    'no-parent/OWNERS': 'options:\n  no_parent_owners: true\napprovers:\n- mml\n',
    'no-parent-filter/OWNERS': 'options:\n  no_parent_owners: true\nfilters:\n  "\\.txt$":\n    approvers:\n    - flex\n',
    'aliases/OWNERS': 'approvers:\n- Team/T1\n',
    'OWNERS_ALIASES': 'aliases:\n  team/t1:\n  - u1\n  - u2\n',
  };
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
  return root;
}

test('official Prow approver cases match all-parent and no_parent_owners semantics', async () => {
  const root = await fixture();
  try {
    const owners = await loadOwners(root);
    assert.ok(owners);
    const cases = [
      ['base/test.md', ['@alice', '@bob']],
      ['leaf/test.md', ['@alice', '@bob', '@carl', '@dave']],
      ['leaf-filter/test.md', ['@alice', '@bob', '@carl', '@dave']],
      ['leaf-filter/test.dat', ['@alice', '@bob']],
      ['no-parent/test.go', ['@mml']],
      ['no-parent-filter/test.txt', ['@flex']],
      ['no-parent-filter/test.go_to_parent', ['@alice', '@bob']],
      ['aliases/test.go', ['@alice', '@bob', '@u1', '@u2']],
    ];
    for (const [path, expected] of cases) {
      assert.deepEqual(owners.resolve(path).owners, expected, path);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
