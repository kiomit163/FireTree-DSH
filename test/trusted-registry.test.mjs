import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createAssessTool } from '../src/tools/assess.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

test('assess can load policy/registry from a trusted base root', async () => {
  const workspace = await createM1Workspace();
  const trusted = await mkdtemp(join(tmpdir(), 'firetree-trusted-'));
  try {
    await cp(join(workspace.root, '.firetree'), join(trusted, '.firetree'), { recursive: true });
    await cp(join(workspace.root, 'CODEOWNERS'), join(trusted, 'CODEOWNERS'));

    // The PR tree tries to remove billing from its own registry. The trusted
    // base registry must still classify the file as billing/L1.
    const billingPath = join(workspace.root, '.firetree', 'subsystems', 'billing.json');
    const billing = JSON.parse(await readFile(billingPath, 'utf8'));
    billing.paths = ['never/**'];
    await writeFile(billingPath, `${JSON.stringify(billing, null, 2)}\n`, 'utf8');

    const tool = createAssessTool({ workingDirectory: { async ensure() { return workspace.root; } } });
    const result = await tool.execute({
      base: '1111111111111111111111111111111111111111',
      head: '2222222222222222222222222222222222222222',
      files: ['services/billing/charge.mjs'],
      change: 'trusted-registry',
      registry_root: trusted,
    }, { agent: { id: 'agent-1' }, signal: new AbortController().signal });

    assert.equal(result.tier, 'L1');
    assert.deepEqual(result.impact.subsystems, ['billing']);
    assert.equal(result.impact.unknown.length, 0);
  } finally {
    await workspace.cleanup();
    await rm(trusted, { recursive: true, force: true });
  }
});
