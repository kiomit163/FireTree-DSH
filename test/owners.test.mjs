import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadOwners, parseOwnersAliases } from '../src/lib/owners.js';

test('OWNERS resolves nearest directory, filters, and aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-owners-'));
  try {
    await mkdir(join(root, 'pkg', 'foo'), { recursive: true });
    await mkdir(join(root, 'pkg', 'other'), { recursive: true });
    await writeFile(join(root, 'OWNERS'), [
      'filters:',
      '  ".*":',
      '    reviewers:',
      '      - default-reviewers',
      '    approvers:',
      '      - default-approvers',
      '  "go\\\\.(mod|sum)$":',
      '    approvers:',
      '      - dep-approvers',
      '',
    ].join('\n'));
    await writeFile(join(root, 'OWNERS_ALIASES'), [
      'aliases:',
      '  default-reviewers:',
      '    - reviewer-a',
      '    - reviewer-b',
      '  default-approvers:',
      '    - approver-a',
      '  dep-approvers:',
      '    - dep-a',
      '',
    ].join('\n'));
    await writeFile(join(root, 'pkg', 'foo', 'OWNERS'), [
      'approvers:',
      '  - foo-approver',
      'reviewers:',
      '  - foo-reviewer',
      '',
    ].join('\n'));
    await writeFile(join(root, 'pkg', 'foo', 'x.go'), 'package foo\n');
    await writeFile(join(root, 'pkg', 'other', 'x.go'), 'package other\n');
    await writeFile(join(root, 'go.mod'), 'module example.test\n');
    await writeFile(join(root, 'README.md'), '# test\n');

    const owners = await loadOwners(root);
    assert.ok(owners);
    assert.equal(owners.source, 'OWNERS');
    assert.deepEqual(owners.resolve('pkg/foo/x.go').owners, ['@foo-approver', '@foo-reviewer']);
    assert.deepEqual(owners.resolve('pkg/other/x.go').owners, ['@approver-a', '@reviewer-a', '@reviewer-b']);
    assert.deepEqual(owners.resolve('go.mod').owners, ['@dep-a']);
    assert.deepEqual(owners.resolve('README.md').owners, ['@approver-a', '@reviewer-a', '@reviewer-b']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OWNERS_ALIASES expands recursively and malformed aliases do not widen owners', async () => {
  const aliases = parseOwnersAliases([
    'aliases:',
    '  team:',
    '    - alice',
    '  nested:',
    '    - team',
    '',
  ].join('\n'));
  assert.deepEqual(aliases.get('nested'), ['@team']);
  assert.deepEqual(aliases.get('team'), ['@alice']);
});

test('loadOwners returns null when no OWNERS file exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-owners-empty-'));
  try {
    assert.equal(await loadOwners(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
