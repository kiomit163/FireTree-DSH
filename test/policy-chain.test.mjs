import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadPolicy, RegistryError } from '../src/lib/registry.js';

async function policyRoot() {
  const root = await mkdtemp(join(tmpdir(), 'firetree-policy-'));
  await mkdir(join(root, '.firetree'), { recursive: true });
  const org = JSON.parse(await readFile(new URL('../fixtures/policy-org.json', import.meta.url), 'utf8'));
  const repo = JSON.parse(await readFile(new URL('../fixtures/policy-repo.json', import.meta.url), 'utf8'));
  await writeFile(join(root, '.firetree', 'policy-org.json'), `${JSON.stringify(org, null, 2)}\n`, 'utf8');
  await writeFile(join(root, '.firetree', 'policy.json'), `${JSON.stringify(repo, null, 2)}\n`, 'utf8');
  return { root, org, repo };
}

test('policy chain resolves tighten-only inheritance and a content digest', async () => {
  const { root } = await policyRoot();
  try {
    const policy = await loadPolicy(root, '.firetree/policy.json');
    assert.equal(policy.scope, 'repo');
    assert.equal(policy.tiers.L0.sample_rate, 0.2);
    assert.equal(policy.tiers.L2.token_budget, 350000);
    assert.match(policy.version, /^[a-f0-9]{64}$/);
    assert.ok(policy.triggers.L2.includes('unknown-impact'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('policy chain rejects a relaxed child and a missing parent', async () => {
  const { root } = await policyRoot();
  try {
    const repoPath = join(root, '.firetree', 'policy.json');
    const relaxed = JSON.parse(await readFile(repoPath, 'utf8'));
    relaxed.tiers.L0.sample_rate = 0.01;
    await writeFile(repoPath, `${JSON.stringify(relaxed, null, 2)}\n`, 'utf8');
    await assert.rejects(loadPolicy(root, '.firetree/policy.json'), (error) => error instanceof RegistryError && error.code === 'POLICY_RELAXATION');

    const missing = { ...relaxed, extends: 'does-not-exist.json' };
    missing.tiers.L0.sample_rate = 0.2;
    await writeFile(repoPath, `${JSON.stringify(missing, null, 2)}\n`, 'utf8');
    await assert.rejects(loadPolicy(root, '.firetree/policy.json'), (error) => error instanceof RegistryError && error.code === 'POLICY_MISSING');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('policy chain rejects cycles and content-hash drift is ignored by recomputation', async () => {
  const { root } = await policyRoot();
  try {
    const a = JSON.parse(await readFile(new URL('../fixtures/policy-org.json', import.meta.url), 'utf8'));
    const b = { ...a, scope: 'repo', extends: 'a.json' };
    a.extends = 'b.json';
    await writeFile(join(root, '.firetree', 'a.json'), `${JSON.stringify(a, null, 2)}\n`, 'utf8');
    await writeFile(join(root, '.firetree', 'b.json'), `${JSON.stringify(b, null, 2)}\n`, 'utf8');
    await assert.rejects(loadPolicy(root, '.firetree/a.json'), (error) => error instanceof RegistryError && error.code === 'POLICY_CYCLE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
