import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadInterfaces, loadPolicy, loadRegistry, loadSubsystems, RegistryError } from '../src/lib/registry.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

test('loads policy, subsystems, and interfaces from .firetree', async () => {
  const workspace = await createM1Workspace();
  try {
    const policy = await loadPolicy(workspace.root);
    assert.equal(policy.schema, 'firetree.policy/v0');
    assert.equal(policy.scope, 'org');

    const subsystems = await loadSubsystems(workspace.root);
    assert.deepEqual(subsystems.map((subsystem) => subsystem.id), ['billing', 'checkout', 'docs']);

    const interfaces = await loadInterfaces(workspace.root);
    assert.deepEqual(interfaces.map((entry) => entry.id), ['billing.api']);

    const registry = await loadRegistry(workspace.root);
    assert.equal(registry.policy.schema, 'firetree.policy/v0');
    assert.equal(registry.subsystems.length, 3);
    assert.equal(registry.interfaces.length, 1);
  } finally {
    await workspace.cleanup();
  }
});

test('missing policy fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-registry-'));
  try {
    await assert.rejects(loadPolicy(root), (error) => error instanceof RegistryError && error.code === 'POLICY_MISSING');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid registry entry fails with schema errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-registry-'));
  try {
    await mkdir(join(root, '.firetree', 'subsystems'), { recursive: true });
    await writeFile(join(root, '.firetree', 'subsystems', 'bad.json'), '{"schema":"firetree.subsystem/v0"}\n', 'utf8');
    await assert.rejects(
      loadSubsystems(root),
      (error) => error instanceof RegistryError && error.code === 'SCHEMA_INVALID' && error.errors.length > 0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('duplicate registry ids fail closed', async () => {
  const workspace = await createM1Workspace();
  try {
    await writeFile(
      join(workspace.root, '.firetree', 'subsystems', 'duplicate.json'),
      JSON.stringify({
        ...JSON.parse(await readFile(join(workspace.root, '.firetree', 'subsystems', 'billing.json'), 'utf8')),
        name: 'Duplicate billing',
      }, null, 2),
      'utf8',
    );
    await assert.rejects(loadSubsystems(workspace.root), (error) => error instanceof RegistryError && error.code === 'DUPLICATE_ID');
  } finally {
    await workspace.cleanup();
  }
});
