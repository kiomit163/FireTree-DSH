import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { validateJsonSchema } from '../src/lib/schema.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createClassifyTool } from '../src/tools/classify.js';
import { createReceiptTool } from '../src/tools/receipt.js';
import { createStateTool } from '../src/tools/state.js';
import { createSynthesizeTool } from '../src/tools/synthesize.js';
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

const classifyArgs = {
  action: 'set',
  subsystem: 'billing',
  kind: 'large',
  layers_known: ['api'],
  layers_unknown: [],
  coupling_evidence: [],
  reducibility_test: { command: 'node test-support/reducibility.mjs', result: 'reducible' },
  method: 'decompose',
  owner_of_unknowns: [],
  learning_plan: [],
};

test('state returns an explicit empty projection without a query', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createStateTool(contextFor(workspace.root));
    const state = await tool.execute({}, EXEC);
    assert.equal(state.ok, true);
    assert.equal(state.mode, 'empty');
    assert.deepEqual(state.counts, { pending: 0, expiring: 0, blocked: 0 });
    assert.deepEqual(state.entries, []);
    assert.deepEqual(validateJsonSchema(state, tool.output.schema), []);
  } finally {
    await workspace.cleanup();
  }
});

test('subsystem state reports a missing dossier and then reads a real one', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const stateTool = createStateTool(ctx);
    const before = await stateTool.execute({ subsystem: 'billing' }, EXEC);
    assert.equal(before.mode, 'subsystem');
    assert.equal(before.counts.pending, 1);
    assert.equal(before.entries.find((entry) => entry.kind === 'dossier').status, 'missing');
    assert.equal(before.entries.find((entry) => entry.kind === 'subsystem').status, 'present');

    const classifyTool = createClassifyTool(ctx);
    await classifyTool.execute(classifyArgs, EXEC);

    const after = await stateTool.execute({ subsystem: 'billing' }, EXEC);
    assert.equal(after.counts.pending, 0);
    assert.equal(after.entries.find((entry) => entry.kind === 'dossier').status, 'present');
    assert.equal(typeof after.entries.find((entry) => entry.kind === 'dossier').updated_at, 'string');
  } finally {
    await workspace.cleanup();
  }
});

test('change state reports assessment present and the remaining M1 artifacts missing', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assessTool = createAssessTool(ctx);
    await assessTool.execute({
      base: '1111111111111111111111111111111111111111',
      head: '2222222222222222222222222222222222222222',
      files: ['services/billing/charge.mjs'],
      change: 'chg-state',
    }, EXEC);

    const stateTool = createStateTool(ctx);
    const state = await stateTool.execute({ change: 'chg-state' }, EXEC);
    assert.equal(state.mode, 'change');
    assert.equal(state.counts.pending, 3);
    assert.equal(state.entries.find((entry) => entry.kind === 'assessment').status, 'present');
    assert.equal(state.entries.find((entry) => entry.kind === 'hypotheses').status, 'missing');
    assert.equal(state.entries.find((entry) => entry.kind === 'review').status, 'missing');
    assert.equal(state.entries.find((entry) => entry.kind === 'receipt').status, 'missing');
    assert.ok(state.next_actions.some((action) => action.includes('Record hypotheses')));
    assert.deepEqual(validateJsonSchema(state, stateTool.output.schema), []);
  } finally {
    await workspace.cleanup();
  }
});

test('change state projects synthesis plan and rounds for L2', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '3333333333333333333333333333333333333333',
      head: '4444444444444444444444444444444444444444',
      files: ['contracts/billing/openapi.yaml'],
      change: 'chg-state-l2',
    }, EXEC);

    const before = await createStateTool(ctx).execute({ change: 'chg-state-l2' }, EXEC);
    // v0.1: synthesis is advisory, not a pending prerequisite.
    assert.equal(before.entries.some((entry) => entry.kind === 'synthesis_plan'), false);
    assert.ok(!before.next_actions.some((action) => action.includes('synthesis')));

    const synthesize = createSynthesizeTool(ctx);
    await synthesize.execute({ action: 'plan', change: 'chg-state-l2', question: 'q' }, EXEC);
    await synthesize.execute({
      action: 'record',
      change: 'chg-state-l2',
      seats: [
        { id: 'data-1', kind: 'data', provider: 'ci', model: 'coverage', claim: 'Coverage is 0.8.', evidence: 'coverage', confidence: 0.9, objections: [], data: { command: 'coverage', value: 0.8 } },
        { id: 'model-1', kind: 'model', provider: 'deepseek', model: 'a', claim: 'Design is safe.', evidence: 'spec', confidence: 0.8, objections: [] },
        { id: 'model-2', kind: 'model', provider: 'openai', model: 'b', claim: 'Design may race.', evidence: 'code', confidence: 0.7, objections: [] },
      ],
      synthesizer: { responded_to: [], converged: true, elapsed_minutes: 5 },
    }, EXEC);

    const after = await createStateTool(ctx).execute({ change: 'chg-state-l2' }, EXEC);
    assert.equal(after.entries.find((entry) => entry.kind === 'synthesis_plan').status, 'present');
    assert.equal(after.entries.find((entry) => entry.kind === 'synthesis_round').status, 'present');
    assert.equal(after.counts.pending, 3); // hypotheses, review, receipt
  } finally {
    await workspace.cleanup();
  }
});

test('change state projects autonomous technical evidence', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '1111111111111111111111111111111111111111',
      head: '2222222222222222222222222222222222222222',
      files: ['services/billing/charge.mjs'],
      change: 'chg-state-auto',
    }, EXEC);
    await mkdir(join(workspace.root, 'evidence'), { recursive: true });
    await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="1" failures="0"/>\n', 'utf8');
    const receipt = createReceiptTool(ctx);
    const built = await receipt.execute({
      action: 'build',
      mode: 'autonomous',
      change: 'chg-state-auto',
      intent: { spec: 'specs/billing.md', sha256: 'a'.repeat(64) },
      classification: { subsystem: 'billing', kind: 'large', method: 'decompose', dossier_sha256: 'a'.repeat(64) },
      evidence: [{ kind: 'test', producer: 'ci:github-actions', run_ref: 'evidence/junit.xml', produced_at: '2026-11-08T00:00:00Z' }],
      expires_at: '2026-12-08T00:00:00Z',
      assurance: 'A2',
    }, EXEC);
    assert.equal(built.ok, true);

    const state = await createStateTool(ctx).execute({ change: 'chg-state-auto' }, EXEC);
    assert.equal(state.entries.find((entry) => entry.kind === 'technical_evidence').status, 'present');
    assert.equal(state.counts.pending, 0);
    assert.deepEqual(validateJsonSchema(state, createStateTool(ctx).output.schema), []);
  } finally {
    await workspace.cleanup();
  }
});

test('missing change artifacts and input guards fail closed', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const tool = createStateTool(ctx);
    const missing = await tool.execute({ change: 'chg-missing' }, EXEC);
    assert.equal(missing.counts.pending, 4);

    await assert.rejects(tool.execute({ change: 'c1', subsystem: 'billing' }, EXEC), TypeError);
    await assert.rejects(tool.execute({ change: 'c1' }, { signal: new AbortController().signal }), TypeError);
    await assert.rejects(tool.execute({ unknown: 'x' }, EXEC), TypeError);
    await assert.rejects(tool.execute({ change: '../escape' }, EXEC), (error) => error.code === 'INVALID_ID');
  } finally {
    await workspace.cleanup();
  }
});

test('tampered assessment hash is rejected', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assessTool = createAssessTool(ctx);
    const assessed = await assessTool.execute({
      base: '1111111111111111111111111111111111111111',
      head: '2222222222222222222222222222222222222222',
      files: ['services/billing/charge.mjs'],
      change: 'chg-tamper',
    }, EXEC);
    await writeFile(join(workspace.root, assessed.artifact.path), '{"tampered":true}\n', 'utf8');

    const stateTool = createStateTool(ctx);
    await assert.rejects(
      stateTool.execute({ change: 'chg-tamper' }, EXEC),
      (error) => error.code === 'HASH_MISMATCH',
    );
  } finally {
    await workspace.cleanup();
  }
});
