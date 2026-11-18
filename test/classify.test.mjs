import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { readFiretreeJson } from '../src/lib/artifacts.js';
import { validateJsonSchema } from '../src/lib/schema.js';
import { createClassifyTool } from '../src/tools/classify.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const EXEC = { agent: { id: 'agent-1' }, signal: new AbortController().signal };

function contextFor(root) {
  return {
    workingDirectory: {
      async ensure(agent) {
        assert.ok(agent);
        return root;
      },
    },
  };
}

function baseArgs(overrides = {}) {
  return {
    action: 'set',
    subsystem: 'billing',
    kind: 'large',
    layers_known: ['api', 'persistence'],
    layers_unknown: [],
    coupling_evidence: ['charge writes idempotency key'],
    reducibility_test: { command: 'node scripts/reducibility.mjs billing', result: 'reducible' },
    method: 'decompose',
    owner_of_unknowns: [],
    learning_plan: [],
    ...overrides,
  };
}

test('classify set writes a hashed dossier and show reads it back', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createClassifyTool(contextFor(workspace.root));
    const result = await tool.execute(baseArgs(), EXEC);

    assert.equal(result.ok, true);
    assert.equal(result.action, 'set');
    assert.equal(result.subsystem, 'billing');
    assert.equal(result.dossier.schema, 'firetree.oid/v1');
    assert.equal(result.allowed.decomposition_autonomy, true);
    assert.equal(result.allowed.requires_human_signoff, false);
    assert.deepEqual(validateJsonSchema(result, tool.output.schema), []);

    const record = await readFiretreeJson(workspace.root, result.artifact.path, { verifyHash: true });
    assert.equal(record.sha256, result.artifact.sha256);
    assert.deepEqual(record.value, result.dossier);

    const shown = await tool.execute({ action: 'show', subsystem: 'billing' }, EXEC);
    assert.equal(shown.action, 'show');
    assert.deepEqual(shown.dossier, result.dossier);
    assert.equal(shown.artifact.sha256, result.artifact.sha256);

    const raw = await readFile(join(workspace.root, '.firetree', 'oid', 'billing.json.sha256'), 'utf8');
    assert.equal(raw.trim(), result.artifact.sha256);
  } finally {
    await workspace.cleanup();
  }
});

test('OCG metasynthesis records no decomposition autonomy and human sign-off', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createClassifyTool(contextFor(workspace.root));
    const result = await tool.execute(baseArgs({
      subsystem: 'open-system',
      kind: 'open-complex-giant',
      layers_known: ['shell'],
      layers_unknown: ['middle-layer'],
      reducibility_test: { command: 'node scripts/reducibility.mjs open-system', result: 'not-reducible' },
      method: 'metasynthesis',
      owner_of_unknowns: ['human:architect-01'],
      learning_plan: ['interview domain owners'],
    }), EXEC);

    assert.equal(result.allowed.decomposition_autonomy, false);
    assert.equal(result.allowed.requires_human_signoff, true);
    assert.ok(result.allowed.constraints.includes('no decomposition autonomy'));
    assert.ok(result.allowed.constraints.includes('human sign-off required'));
  } finally {
    await workspace.cleanup();
  }
});

test('classify rejects reducible claims while layers are unknown', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createClassifyTool(contextFor(workspace.root));
    await assert.rejects(
      tool.execute(baseArgs({
        layers_unknown: ['legacy-adapter'],
        reducibility_test: { command: 'node scripts/reducibility.mjs', result: 'reducible' },
        owner_of_unknowns: ['human:architect-01'],
      }), EXEC),
      (error) => error.code === 'REDUCIBILITY_CLAIM_REJECTED',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('classify rejects metasynthesis without an owner', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createClassifyTool(contextFor(workspace.root));
    await assert.rejects(
      tool.execute(baseArgs({ kind: 'open-complex-giant', method: 'metasynthesis', owner_of_unknowns: [] }), EXEC),
      (error) => error.code === 'OWNER_REQUIRED',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('classify rejects unknown without a learning plan, OCG decompose, and unowned unknowns', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createClassifyTool(contextFor(workspace.root));

    await assert.rejects(
      tool.execute(baseArgs({ kind: 'unknown', method: 'metasynthesis', owner_of_unknowns: ['human:architect-01'], learning_plan: [] }), EXEC),
      (error) => error.code === 'LEARNING_PLAN_REQUIRED',
    );

    await assert.rejects(
      tool.execute(baseArgs({ kind: 'open-complex-giant', method: 'decompose', owner_of_unknowns: ['human:architect-01'] }), EXEC),
      (error) => error.code === 'OCG_DECOMPOSITION_REJECTED',
    );

    await assert.rejects(
      tool.execute(baseArgs({
        layers_unknown: ['missing'],
        reducibility_test: { command: 'node scripts/reducibility.mjs', result: 'not-reducible' },
        owner_of_unknowns: [],
        learning_plan: [],
      }), EXEC),
      (error) => error.code === 'OWNER_REQUIRED',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('classify show fails closed when the dossier is absent', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createClassifyTool(contextFor(workspace.root));
    await assert.rejects(
      tool.execute({ action: 'show', subsystem: 'missing' }, EXEC),
      (error) => error.code === 'DOSSIER_NOT_FOUND',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('classify requires an owning agent session', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createClassifyTool(contextFor(workspace.root));
    await assert.rejects(
      tool.execute(baseArgs(), { signal: new AbortController().signal }),
      (error) => error.code === 'AGENT_REQUIRED',
    );
  } finally {
    await workspace.cleanup();
  }
});
