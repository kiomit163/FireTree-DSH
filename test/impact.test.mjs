import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadCodeowners } from '../src/lib/codeowners.js';
import { analyzeImpact, ImpactError, isDependencyPath, isL0Path } from '../src/lib/impact.js';
import { loadRegistry } from '../src/lib/registry.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

async function analyze(workspace, files) {
  const registry = await loadRegistry(workspace.root);
  const codeowners = await loadCodeowners(workspace.root);
  return analyzeImpact({
    files,
    subsystems: registry.subsystems,
    interfaces: registry.interfaces,
    codeowners,
  });
}

test('docs-only change is L0 when mapped and owner-resolved', async () => {
  const workspace = await createM1Workspace();
  try {
    const result = await analyze(workspace, ['docs/README.md']);
    assert.equal(result.auto_tier, 'L0');
    assert.equal(result.confidence, 'high');
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.impact.subsystems, ['docs']);
    assert.deepEqual(result.impact.owners, ['@team-docs']);
    assert.equal(result.impact.traversed, true);
  } finally {
    await workspace.cleanup();
  }
});

test('docs/config/test files do not create a cross-subsystem L2 by themselves', async () => {
  const workspace = await createM1Workspace();
  try {
    const docsOnly = await analyze(workspace, ['docs/README.md', 'services/billing/README.md']);
    assert.equal(docsOnly.auto_tier, 'L0');
    assert.deepEqual(docsOnly.reasons, []);
    assert.equal(docsOnly.impact.traversed, true);

    const codeWithDocs = await analyze(workspace, ['services/billing/charge.mjs', 'docs/README.md']);
    assert.equal(codeWithDocs.auto_tier, 'L1');
    assert.ok(!codeWithDocs.reasons.some((reason) => reason.startsWith('cross-subsystem:')));
  } finally {
    await workspace.cleanup();
  }
});

test('regular code change is L1 with subsystem tests and owners', async () => {
  const workspace = await createM1Workspace();
  try {
    const result = await analyze(workspace, ['services/billing/charge.mjs']);
    assert.equal(result.auto_tier, 'L1');
    assert.deepEqual(result.impact.subsystems, ['billing']);
    assert.deepEqual(result.impact.owners, ['@team-billing']);
    assert.deepEqual(result.impact.tests, ['billing/contract', 'billing/unit']);
    assert.equal(result.impact.traversed, true);
  } finally {
    await workspace.cleanup();
  }
});

test('interface change is L2 and pulls consumers into the impact set', async () => {
  const workspace = await createM1Workspace();
  try {
    const result = await analyze(workspace, ['contracts/billing/openapi.yaml']);
    assert.equal(result.auto_tier, 'L2');
    assert.deepEqual(result.impact.interfaces, ['billing.api']);
    assert.deepEqual(result.impact.subsystems, ['billing', 'checkout']);
    assert.ok(result.reasons.includes('interface changed: billing.api'));
    assert.ok(!result.reasons.some((reason) => reason.startsWith('cross-subsystem:')));
  } finally {
    await workspace.cleanup();
  }
});

test('unknown paths force L2 and low confidence', async () => {
  const workspace = await createM1Workspace();
  try {
    const result = await analyze(workspace, ['tools/legacy/unknown.py']);
    assert.equal(result.auto_tier, 'L2');
    assert.equal(result.confidence, 'low');
    assert.equal(result.impact.traversed, false);
    assert.deepEqual(result.impact.unknown, ['tools/legacy/unknown.py']);
    assert.ok(result.reasons.includes('unknown path: tools/legacy/unknown.py'));
  } finally {
    await workspace.cleanup();
  }
});

test('cross-subsystem and dependency changes are L2', async () => {
  const workspace = await createM1Workspace();
  try {
    const cross = await analyze(workspace, ['services/billing/charge.mjs', 'services/checkout/cart.mjs']);
    assert.equal(cross.auto_tier, 'L2');
    assert.ok(cross.reasons.some((reason) => reason.startsWith('cross-subsystem:')));

    const dependency = await analyze(workspace, ['package.json']);
    assert.equal(dependency.auto_tier, 'L2');
    assert.equal(isDependencyPath('package.json'), true);
    assert.ok(dependency.reasons.includes('dependency changed: package.json'));
  } finally {
    await workspace.cleanup();
  }
});

test('security-sensitive code is L2 while test/docs paths remain L0', async () => {
  const workspace = await createM1Workspace();
  try {
    const security = await analyze(workspace, ['services/billing/auth/token.mjs']);
    assert.equal(security.auto_tier, 'L2');
    assert.ok(security.reasons.includes('sensitive path: services/billing/auth/token.mjs'));

    assert.equal(isL0Path('docs/security/policy.md'), true);
    assert.equal(isL0Path('tests/auth/token.test.mjs'), true);
    assert.equal(isL0Path('staging/oidc/testdata/mldsa_1.pem'), true);
    assert.equal(isL0Path('services/billing/auth/token.mjs'), false);

    const testdataPem = await analyze(workspace, ['services/billing/testdata/cert.pem']);
    assert.equal(testdataPem.auto_tier, 'L0');
    assert.ok(!testdataPem.reasons.some((reason) => reason.startsWith('sensitive path:')));
  } finally {
    await workspace.cleanup();
  }
});

test('empty file sets fail closed', () => {
  assert.throws(
    () => analyzeImpact({ files: [], subsystems: [], interfaces: [] }),
    (error) => error instanceof ImpactError && error.code === 'NO_FILES',
  );
});
