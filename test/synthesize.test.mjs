import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFiretreeJson } from '../src/lib/artifacts.js';
import { validateJsonSchema } from '../src/lib/schema.js';
import { createAssessTool } from '../src/tools/assess.js';
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

function seats(overrides = {}) {
  return [
    {
      id: 'data-1',
      kind: 'data',
      provider: 'ci',
      model: 'coverage',
      claim: 'Coverage is 0.82 on the idempotency path.',
      evidence: 'coverage report',
      confidence: 0.9,
      objections: ['p95 latency under load is not covered'],
      data: { command: 'pnpm test --coverage', value: 0.82 },
    },
    {
      id: 'model-1',
      kind: 'model',
      provider: 'deepseek',
      model: 'deepseek-chat',
      claim: 'The idempotency key prevents duplicate captures.',
      evidence: 'spec and junit',
      confidence: 0.8,
      objections: ['cross-region partition is not covered'],
    },
    {
      id: 'model-2',
      kind: 'model',
      provider: 'openai',
      model: 'gpt-x',
      claim: 'Duplicate requests may still race under partition.',
      evidence: 'code review',
      confidence: 0.7,
      objections: [],
    },
    {
      id: 'experience-1',
      kind: 'experience',
      provider: 'human',
      model: 'architect-01',
      claim: 'The contract test covers duplicate keys.',
      evidence: 'contract test',
      confidence: 0.8,
      objections: [],
      ...overrides,
    },
  ];
}

function synthesizer(overrides = {}) {
  return {
    responded_to: [
      { objection: 'p95 latency under load is not covered', decision: 'accepted', evidence: 'acknowledged in residual risk' },
      { objection: 'cross-region partition is not covered', decision: 'accepted', evidence: 'acknowledged in residual risk' },
    ],
    converged: false,
    elapsed_minutes: 5,
    ...overrides,
  };
}

async function setupL2(workspace, change = 'chg-s1') {
  const ctx = contextFor(workspace.root);
  const assess = createAssessTool(ctx);
  await assess.execute({
    base: '1111111111111111111111111111111111111111',
    head: '2222222222222222222222222222222222222222',
    files: ['contracts/billing/openapi.yaml'],
    change,
  }, EXEC);
  return ctx;
}

test('synthesis plan and two rounds record independent seats and convergence', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await setupL2(workspace);
    const tool = createSynthesizeTool(ctx);
    const planned = await tool.execute({
      action: 'plan',
      change: 'chg-s1',
      risk_tier: 'L2',
      question: 'Does the idempotency design cover concurrent and cross-region retries?',
    }, EXEC);
    assert.equal(planned.record.schema, 'firetree.synthesis-plan/v0');
    assert.equal(planned.record.max_rounds, 3);
    assert.equal(planned.record.seats.length, 4);
    assert.equal(planned.record.timebox_minutes, 20);
    assert.deepEqual(validateJsonSchema(planned, tool.output.schema), []);

    const first = await tool.execute({
      action: 'record',
      change: 'chg-s1',
      seats: seats(),
      synthesizer: synthesizer(),
    }, EXEC);
    assert.equal(first.record.round, 1);
    assert.equal(first.record.metrics.new_objections, 2);
    assert.equal(first.record.metrics.unresolved_objections, 0);
    assert.equal(first.record.metrics.converged, false);
    assert.equal(first.record.metrics.timed_out, false);
    assert.ok(first.record.metrics.overlap >= 0 && first.record.metrics.overlap <= 1);

    const second = await tool.execute({
      action: 'record',
      change: 'chg-s1',
      seats: seats(),
      synthesizer: synthesizer({ converged: true, elapsed_minutes: 8 }),
    }, EXEC);
    assert.equal(second.record.round, 2);
    assert.equal(second.record.metrics.new_objections, 0);
    assert.equal(second.record.metrics.converged, true);

    for (const path of [
      '.firetree/changes/chg-s1/synthesis/plan.json',
      '.firetree/changes/chg-s1/synthesis/round-1.json',
      '.firetree/changes/chg-s1/synthesis/round-2.json',
    ]) {
      const record = await readFiretreeJson(workspace.root, path, { verifyHash: true });
      assert.ok(record);
    }
  } finally {
    await workspace.cleanup();
  }
});

test('synthesis rejects L1 plans, duplicate plans, and record without plan', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '3333333333333333333333333333333333333333',
      head: '4444444444444444444444444444444444444444',
      files: ['services/billing/charge.mjs'],
      change: 'chg-l1',
    }, EXEC);
    const tool = createSynthesizeTool(ctx);
    await assert.rejects(
      tool.execute({ action: 'plan', change: 'chg-l1', question: 'q' }, EXEC),
      (error) => error.code === 'L2_ONLY',
    );

    await setupL2(workspace, 'chg-s2');
    await tool.execute({ action: 'plan', change: 'chg-s2', question: 'q' }, EXEC);
    await assert.rejects(
      tool.execute({ action: 'plan', change: 'chg-s2', question: 'q2' }, EXEC),
      (error) => error.code === 'PLAN_EXISTS',
    );
    await setupL2(workspace, 'chg-s2b');
    await assert.rejects(
      tool.execute({ action: 'record', change: 'chg-s2b', seats: seats(), synthesizer: synthesizer() }, EXEC),
      (error) => error.code === 'PLAN_REQUIRED',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('synthesis rejects independence, data, convergence, timeout, and round-limit violations', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await setupL2(workspace, 'chg-s3');
    const tool = createSynthesizeTool(ctx);
    await tool.execute({ action: 'plan', change: 'chg-s3', question: 'q' }, EXEC);

    const sameModels = seats();
    sameModels[2].provider = 'deepseek';
    sameModels[2].model = 'deepseek-chat';
    await assert.rejects(
      tool.execute({ action: 'record', change: 'chg-s3', seats: sameModels, synthesizer: synthesizer() }, EXEC),
      (error) => error.code === 'INDEPENDENT_SEATS_REQUIRED',
    );

    const noData = seats().filter((seat) => seat.kind !== 'data');
    await assert.rejects(
      tool.execute({ action: 'record', change: 'chg-s3', seats: noData, synthesizer: synthesizer() }, EXEC),
      (error) => error.code === 'DATA_SEAT_REQUIRED',
    );

    const badData = seats();
    delete badData[0].data;
    await assert.rejects(
      tool.execute({ action: 'record', change: 'chg-s3', seats: badData, synthesizer: synthesizer() }, EXEC),
      (error) => error.code === 'DATA_SEAT_INVALID',
    );

    await assert.rejects(
      tool.execute({
        action: 'record',
        change: 'chg-s3',
        seats: seats(),
        synthesizer: synthesizer({ converged: true, responded_to: [] }),
      }, EXEC),
      (error) => error.code === 'FALSE_CONVERGENCE',
    );

    await assert.rejects(
      tool.execute({
        action: 'record',
        change: 'chg-s3',
        seats: seats(),
        synthesizer: synthesizer({ converged: true, elapsed_minutes: 25 }),
      }, EXEC),
      (error) => error.code === 'FALSE_CONVERGENCE',
    );

    await tool.execute({ action: 'record', change: 'chg-s3', seats: seats(), synthesizer: synthesizer() }, EXEC);
    await tool.execute({ action: 'record', change: 'chg-s3', seats: seats(), synthesizer: synthesizer() }, EXEC);
    await tool.execute({ action: 'record', change: 'chg-s3', seats: seats(), synthesizer: synthesizer() }, EXEC);
    await assert.rejects(
      tool.execute({ action: 'record', change: 'chg-s3', seats: seats(), synthesizer: synthesizer() }, EXEC),
      (error) => error.code === 'ROUND_LIMIT',
    );
  } finally {
    await workspace.cleanup();
  }
});
