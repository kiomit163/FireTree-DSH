import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFiretreeJson } from '../src/lib/artifacts.js';
import { validateJsonSchema } from '../src/lib/schema.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createReviewTool } from '../src/tools/review.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const EXEC = { agent: { id: 'agent-1' }, signal: new AbortController().signal };
const HASH = 'a'.repeat(64);

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

function openArgs(overrides = {}) {
  return {
    action: 'open',
    change: 'chg-r1',
    diff_sha256: HASH,
    spec_sha256: HASH,
    criteria: ['correctness', 'tests'],
    evidence: [],
    seats: [{ id: 's1', owner: '@team-billing', role: 'reviewer' }],
    ...overrides,
  };
}

const finding = {
  location: 'services/billing/charge.mjs:42',
  claim: 'Charge may capture twice.',
  evidence: 'test output shows duplicate capture',
  verdict: 'open',
  route: 'blocker',
  lens: 'correctness',
};
const resolvedFinding = { ...finding, verdict: 'resolved' };
const nonBlockerOpen = { ...finding, route: 'non-blocker' };

async function assessL1(workspace, change = 'chg-r1') {
  const assess = createAssessTool(contextFor(workspace.root));
  await assess.execute({
    base: '1111111111111111111111111111111111111111',
    head: '2222222222222222222222222222222222222222',
    files: ['services/billing/charge.mjs'],
    change,
  }, EXEC);
}

test('L1 review runs open, two rounds, and a three-step verdict', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    await assessL1(workspace);
    const tool = createReviewTool(ctx);

    const opened = await tool.execute(openArgs(), EXEC);
    assert.equal(opened.tier, 'L1');
    assert.equal(opened.record.schema, 'firetree.review-package/v1');
    assert.deepEqual(validateJsonSchema(opened, tool.output.schema), []);

    await tool.execute({ action: 'round', change: 'chg-r1', findings: [resolvedFinding] }, EXEC);
    const emptyRound = await tool.execute({
      action: 'round',
      change: 'chg-r1',
      findings: [],
      checked: ['reviewed the charge path and retry test'],
    }, EXEC);
    assert.equal(emptyRound.record.round, 2);

    const verdict = await tool.execute({
      action: 'verdict',
      change: 'chg-r1',
      steps: [
        { id: 'criteria', evidence: 'criteria recorded in package' },
        { id: 'review', evidence: 'rounds 1-2' },
        { id: 'conclusion', evidence: 'zero findings in round 2' },
      ],
      dissent: 1,
      signoff: { by: 'human', identity: 'human:reviewer-01', at: '2026-11-07T00:00:00Z', scope: 'L1 review' },
      decision: 'ready',
    }, EXEC);
    assert.equal(verdict.record.schema, 'firetree.review-verdict/v1');
    assert.deepEqual(verdict.record.new_findings, [1, 0]);
    assert.equal(verdict.record.decision, 'ready');

    for (const path of ['.firetree/changes/chg-r1/package.json', '.firetree/changes/chg-r1/round-1.json', '.firetree/changes/chg-r1/round-2.json', '.firetree/changes/chg-r1/verdict.json']) {
      const record = await readFiretreeJson(workspace.root, path, { verifyHash: true });
      assert.ok(record);
    }
  } finally {
    await workspace.cleanup();
  }
});

test('L2 review requires two seats, two rounds, seven steps, and human sign-off', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '3333333333333333333333333333333333333333',
      head: '4444444444444444444444444444444444444444',
      files: ['contracts/billing/openapi.yaml'],
      change: 'chg-r2',
    }, EXEC);
    const tool = createReviewTool(ctx);

    await tool.execute(openArgs({
      change: 'chg-r2',
      seats: [
        { id: 's1', owner: '@team-billing', role: 'owner' },
        { id: 's2', owner: '@team-checkout', role: 'reviewer' },
      ],
    }), EXEC);
    await tool.execute({ action: 'round', change: 'chg-r2', findings: [resolvedFinding] }, EXEC);
    await tool.execute({ action: 'round', change: 'chg-r2', findings: [], checked: ['contract diff and consumer impact reviewed'] }, EXEC);

    const verdict = await tool.execute({
      action: 'verdict',
      change: 'chg-r2',
      steps: [
        { id: 'criteria', evidence: 'criteria in package' },
        { id: 'data', evidence: 'coverage + junit' },
        { id: 'seats', evidence: 'two independent owners' },
        { id: 'pre_read', evidence: 'pre-read notes' },
        { id: 'discussion', evidence: 'rounds 1-2' },
        { id: 'written_conclusion', evidence: 'verdict' },
        { id: 'notify', evidence: 'notified both owners' },
      ],
      dissent: 1,
      signoff: { by: 'human', identity: 'human:architect-01', at: '2026-11-07T00:00:00Z', scope: 'L2 review' },
      decision: 'ready',
    }, EXEC);
    assert.equal(verdict.record.schema, 'firetree.review-verdict/v1');
    assert.deepEqual(verdict.record.new_findings, [1, 0]);
  } finally {
    await workspace.cleanup();
  }
});

test('L2 verdict rejects too few rounds, CI/agent sign-off, and non-convergence', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '7777777777777777777777777777777777777777',
      head: '8888888888888888888888888888888888888888',
      files: ['contracts/billing/openapi.yaml'],
      change: 'chg-r4',
    }, EXEC);
    const tool = createReviewTool(ctx);
    await tool.execute(openArgs({
      change: 'chg-r4',
      seats: [
        { id: 's1', owner: '@team-billing' },
        { id: 's2', owner: '@team-checkout' },
      ],
    }), EXEC);
    await tool.execute({ action: 'round', change: 'chg-r4', findings: [] , checked: ['pre-read complete'] }, EXEC);

    const sevenSteps = [
      { id: 'criteria', evidence: 'x' },
      { id: 'data', evidence: 'x' },
      { id: 'seats', evidence: 'x' },
      { id: 'pre_read', evidence: 'x' },
      { id: 'discussion', evidence: 'x' },
      { id: 'written_conclusion', evidence: 'x' },
      { id: 'notify', evidence: 'x' },
    ];
    await assert.rejects(
      tool.execute({ action: 'verdict', change: 'chg-r4', steps: sevenSteps, dissent: 1, signoff: { by: 'human', identity: 'human:a', at: '2026-11-07T00:00:00Z', scope: 'L2' }, decision: 'ready' }, EXEC),
      (error) => error.code === 'L2_ROUNDS_REQUIRED',
    );

    await tool.execute({ action: 'round', change: 'chg-r4', findings: [] , checked: ['discussion complete'] }, EXEC);
    await assert.rejects(
      tool.execute({ action: 'verdict', change: 'chg-r4', steps: sevenSteps, dissent: 1, signoff: { by: 'ci', identity: 'ci:bot', at: '2026-11-07T00:00:00Z', scope: 'L2' }, decision: 'ready' }, EXEC),
      (error) => error.code === 'HUMAN_SIGNOFF_REQUIRED',
    );
    await assert.rejects(
      tool.execute({ action: 'verdict', change: 'chg-r4', steps: sevenSteps, dissent: 1, signoff: { by: 'agent', identity: 'agent:bot', at: '2026-11-07T00:00:00Z', scope: 'L2' }, decision: 'ready' }, EXEC),
      (error) => error.code === 'INVALID_ARGS',
    );

    await tool.execute({ action: 'round', change: 'chg-r4', findings: [nonBlockerOpen] }, EXEC);
    await assert.rejects(
      tool.execute({ action: 'verdict', change: 'chg-r4', steps: sevenSteps, dissent: 1, signoff: { by: 'human', identity: 'human:a', at: '2026-11-07T00:00:00Z', scope: 'L2' }, decision: 'ready' }, EXEC),
      (error) => error.code === 'REVIEW_NOT_CONVERGED',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('review rejects a ready verdict with an open blocker', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '9999999999999999999999999999999999999999',
      head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      files: ['contracts/billing/openapi.yaml'],
      change: 'chg-r5',
    }, EXEC);
    const tool = createReviewTool(ctx);
    await tool.execute(openArgs({
      change: 'chg-r5',
      seats: [
        { id: 's1', owner: '@team-billing' },
        { id: 's2', owner: '@team-checkout' },
      ],
    }), EXEC);
    await tool.execute({ action: 'round', change: 'chg-r5', findings: [finding] }, EXEC);
    await tool.execute({ action: 'round', change: 'chg-r5', findings: [], checked: ['discussed blocker'] }, EXEC);
    await assert.rejects(
      tool.execute({
        action: 'verdict',
        change: 'chg-r5',
        steps: [
          { id: 'criteria', evidence: 'x' },
          { id: 'data', evidence: 'x' },
          { id: 'seats', evidence: 'x' },
          { id: 'pre_read', evidence: 'x' },
          { id: 'discussion', evidence: 'x' },
          { id: 'written_conclusion', evidence: 'x' },
          { id: 'notify', evidence: 'x' },
        ],
        dissent: 1,
        signoff: { by: 'human', identity: 'human:a', at: '2026-11-07T00:00:00Z', scope: 'L2' },
        decision: 'ready',
      }, EXEC),
      (error) => error.code === 'OPEN_BLOCKER',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('review rejects missing assessment, duplicate open, and L2 with one seat', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const tool = createReviewTool(ctx);
    await assert.rejects(tool.execute(openArgs(), EXEC), (error) => error.code === 'ASSESSMENT_REQUIRED');

    await assessL1(workspace);
    await tool.execute(openArgs(), EXEC);
    await assert.rejects(tool.execute(openArgs(), EXEC), (error) => error.code === 'REVIEW_ALREADY_OPEN');

    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '5555555555555555555555555555555555555555',
      head: '6666666666666666666666666666666666666666',
      files: ['contracts/billing/openapi.yaml'],
      change: 'chg-r3',
    }, EXEC);
    await assert.rejects(tool.execute(openArgs({ change: 'chg-r3' }), EXEC), (error) => error.code === 'L2_SEATS_REQUIRED');
  } finally {
    await workspace.cleanup();
  }
});

test('review rejects empty rounds without checked, round overflow, and bad verdicts', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    await assessL1(workspace);
    const tool = createReviewTool(ctx);
    await tool.execute(openArgs(), EXEC);

    await assert.rejects(
      tool.execute({ action: 'round', change: 'chg-r1', findings: [] }, EXEC),
      (error) => error.code === 'ZERO_FINDINGS_CHECK_REQUIRED',
    );
    await tool.execute({ action: 'round', change: 'chg-r1', findings: [resolvedFinding] }, EXEC);
    await tool.execute({ action: 'round', change: 'chg-r1', findings: [], checked: ['checked'] }, EXEC);
    await assert.rejects(
      tool.execute({ action: 'round', change: 'chg-r1', findings: [], checked: ['checked again'] }, EXEC),
      (error) => error.code === 'ROUND_LIMIT',
    );

    await assert.rejects(
      tool.execute({
        action: 'verdict',
        change: 'chg-r1',
        steps: [{ id: 'criteria', evidence: 'x' }],
        dissent: 1,
        decision: 'ready',
      }, EXEC),
      (error) => error.code === 'MISSING_STEP',
    );
    await assert.rejects(
      tool.execute({
        action: 'verdict',
        change: 'chg-r1',
        steps: [
          { id: 'criteria', evidence: 'x' },
          { id: 'review', evidence: 'x' },
          { id: 'conclusion', evidence: 'x' },
        ],
        dissent: 0,
        decision: 'ready',
      }, EXEC),
      (error) => error.code === 'ZERO_DISSENT_CHECK_REQUIRED',
    );
  } finally {
    await workspace.cleanup();
  }
});
