import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CodeownersError, loadCodeowners, parseCodeowners, resolveCodeowners } from '../src/lib/codeowners.js';
import { globToRegExp, matchesGlob, normalizeGlob } from '../src/lib/glob.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

test('globs support **, *, and ? without crossing path separators', () => {
  assert.equal(matchesGlob('services/billing/charge.mjs', 'services/billing/**'), true);
  assert.equal(matchesGlob('services/billing/a/charge.mjs', 'services/billing/**'), true);
  assert.equal(matchesGlob('services/billing/charge.mjs', 'services/*/charge.mjs'), true);
  assert.equal(matchesGlob('services/billing/a/charge.mjs', 'services/*/charge.mjs'), false);
  assert.equal(matchesGlob('a/b/charge.test.mjs', '**/*.test.mjs'), true);
  assert.equal(matchesGlob('charge.test.mjs', '**/*.test.mjs'), true);
  assert.equal(matchesGlob('docs/a/b.md', 'docs/*'), false);
  assert.equal(matchesGlob('docs/a.md', 'docs/*'), true);
  assert.equal(matchesGlob('docs/', 'docs/'), true);
  assert.equal(normalizeGlob('/services/billing/'), 'services/billing/**');
  assert.equal(globToRegExp('a/?.js').test('a/b.js'), true);
  assert.equal(globToRegExp('a/?.js').test('a/bb.js'), false);
});

test('CODEOWNERS uses last-match-wins and unanchored names match at any depth', () => {
  const parsed = parseCodeowners([
    '* @team-core',
    '*.md @team-docs',
    '/services/billing/ @team-billing',
    'services/billing/** @team-billing',
    'services/checkout/** @team-checkout',
  ].join('\n'));

  assert.deepEqual(resolveCodeowners('services/billing/charge.mjs', parsed), {
    owners: ['@team-billing'],
    pattern: 'services/billing/**',
  });
  assert.deepEqual(resolveCodeowners('README.md', parsed), {
    owners: ['@team-docs'],
    pattern: '**/*.md',
  });
  assert.deepEqual(resolveCodeowners('docs/a.md', parsed).owners, ['@team-docs']);
  assert.deepEqual(resolveCodeowners('other/file.go', parsed).owners, ['@team-core']);
  assert.deepEqual(resolveCodeowners('services/billing/charge.mjs', null), { owners: [], pattern: null });
});

test('loads CODEOWNERS from the M1 workspace', async () => {
  const workspace = await createM1Workspace();
  try {
    const parsed = await loadCodeowners(workspace.root);
    assert.equal(parsed.patterns.length, 5);
    assert.deepEqual(resolveCodeowners('services/checkout/cart.mjs', parsed).owners, ['@team-checkout']);
  } finally {
    await workspace.cleanup();
  }
});

test('CODEOWNERS prefers .github/CODEOWNERS over root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-codeowners-'));
  try {
    await mkdir(join(root, '.github'), { recursive: true });
    await writeFile(join(root, 'CODEOWNERS'), '* @root\n', 'utf8');
    await writeFile(join(root, '.github', 'CODEOWNERS'), '* @github\n', 'utf8');
    const parsed = await loadCodeowners(root);
    assert.deepEqual(resolveCodeowners('src/a.ts', parsed).owners, ['@github']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid CODEOWNERS lines fail closed', () => {
  assert.throws(() => parseCodeowners('services/**\n'), (error) => error instanceof CodeownersError && error.code === 'INVALID_LINE');
  assert.throws(() => parseCodeowners('* not-an-owner\n'), (error) => error instanceof CodeownersError && error.code === 'INVALID_OWNER');
});
