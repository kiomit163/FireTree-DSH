import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { sha256Text } from '../src/lib/artifacts.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createReceiptTool } from '../src/tools/receipt.js';
import { createReviewTool } from '../src/tools/review.js';
import { createStateTool } from '../src/tools/state.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const EXEC = { agent: { id: 'agent-1' }, signal: new AbortController().signal };
const HASH = 'a'.repeat(64);
const NOW = '2026-11-18T00:00:00Z';

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

async function setSampleRate(workspace, rate) {
  const path = join(workspace.root, '.firetree', 'policy.json');
  const policy = JSON.parse(await readFile(path, 'utf8'));
  policy.tiers.L0.sample_rate = rate;
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}

async function writeEvidence(workspace) {
  await mkdir(join(workspace.root, 'evidence'), { recursive: true });
  await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="1" failures="0"><testcase name="x"/></testsuite>\n', 'utf8');
}

function buildArgs(change, overrides = {}) {
  return {
    action: 'build',
    change,
    intent: { spec: 'docs/README.md', sha256: HASH },
    evidence: [{
      kind: 'test',
      producer: 'local:node-test',
      run_ref: 'evidence/junit.xml',
      produced_at: NOW,
    }],
    expires_at: '2026-12-18T00:00:00Z',
    assurance: 'A1',
    ...overrides,
  };
}

test('L0 unsampled receipt builds and checks without a review artifact', async () => {
  const workspace = await createM1Workspace();
  try {
    await setSampleRate(workspace, 0);
    await writeEvidence(workspace);
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '1111111111111111111111111111111111111111',
      head: '2222222222222222222222222222222222222222',
      files: ['docs/README.md'],
      change: 'chg-l0-unsampled',
    }, EXEC);

    const receipt = createReceiptTool(ctx);
    const built = await receipt.execute(buildArgs('chg-l0-unsampled'), EXEC);
    assert.equal(built.ok, true, built.gaps?.join('; '));
    assert.equal(built.receipt.review, null);
    assert.equal(built.receipt.tier, 'L0');
    assert.deepEqual(built.receipt.impact.unknown, []);

    const checked = await receipt.execute({ action: 'check', change: 'chg-l0-unsampled' }, EXEC);
    assert.equal(checked.ok, true, checked.gaps?.join('; '));

    const state = await createStateTool(ctx).execute({ change: 'chg-l0-unsampled' }, EXEC);
    assert.equal(state.counts.pending, 0);
    assert.equal(state.counts.expiring, 0);
    assert.equal(state.counts.blocked, 0);
  } finally {
    await workspace.cleanup();
  }
});

test('L0 sampled receipt requires a human spot-check; agent cannot self-review', async () => {
  const workspace = await createM1Workspace();
  try {
    await setSampleRate(workspace, 1);
    await writeEvidence(workspace);
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '3333333333333333333333333333333333333333',
      head: '4444444444444444444444444444444444444444',
      files: ['docs/README.md'],
      change: 'chg-l0-sampled',
    }, EXEC);

    const receipt = createReceiptTool(ctx);
    const missing = await receipt.execute(buildArgs('chg-l0-sampled'), EXEC);
    assert.equal(missing.ok, false);
    assert.ok(missing.gaps.some((gap) => /review verdict/.test(gap)));

    const review = createReviewTool(ctx);
    await review.execute({
      action: 'open',
      change: 'chg-l0-sampled',
      diff_sha256: HASH,
      spec_sha256: HASH,
      criteria: ['docs links'],
      evidence: ['evidence/junit.xml'],
      seats: [{ id: 's1', owner: '@team-docs' }],
    }, EXEC);
    await review.execute({
      action: 'round',
      change: 'chg-l0-sampled',
      findings: [],
      checked: ['README links checked by human sampler'],
    }, EXEC);

    await assert.rejects(
      review.execute({
        action: 'verdict',
        change: 'chg-l0-sampled',
        steps: [
          { id: 'criteria', evidence: 'package' },
          { id: 'review', evidence: 'round-1' },
          { id: 'conclusion', evidence: 'spot-check' },
        ],
        dissent: 1,
        decision: 'ready',
      }, EXEC),
      (error) => error.code === 'HUMAN_SPOT_CHECK_REQUIRED',
    );

    await review.execute({
      action: 'verdict',
      change: 'chg-l0-sampled',
      steps: [
        { id: 'criteria', evidence: 'package' },
        { id: 'review', evidence: 'round-1' },
        { id: 'conclusion', evidence: 'spot-check' },
      ],
      dissent: 1,
      human_spot_check: {
        by: 'human:sampler',
        identity: 'human:sampler',
        at: NOW,
        source: 'manual',
        ref: 'spot-check-2026-11-18',
      },
      decision: 'ready',
    }, EXEC);

    const built = await receipt.execute(buildArgs('chg-l0-sampled'), EXEC);
    assert.equal(built.ok, true, built.gaps?.join('; '));
    assert.equal(built.receipt.review.mode, 'light');
    assert.equal(built.receipt.review.human_spot_check.by, 'human:sampler');

    const checked = await receipt.execute({ action: 'check', change: 'chg-l0-sampled' }, EXEC);
    assert.equal(checked.ok, true, checked.gaps?.join('; '));
  } finally {
    await workspace.cleanup();
  }
});

test('L2 with only unknown paths can build a receipt and carries the unknown list', async () => {
  const workspace = await createM1Workspace();
  try {
    await writeEvidence(workspace);
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '5555555555555555555555555555555555555555',
      head: '6666666666666666666666666666666666666666',
      files: ['tools/legacy/x.py'],
      change: 'chg-l2-unknown',
    }, EXEC);

    const review = createReviewTool(ctx);
    await review.execute({
      action: 'open',
      change: 'chg-l2-unknown',
      diff_sha256: HASH,
      spec_sha256: HASH,
      criteria: ['unknown path risk'],
      evidence: ['evidence/junit.xml'],
      seats: [{ id: 's1', owner: '@team-core' }, { id: 's2', owner: '@team-security' }],
    }, EXEC);
    await review.execute({ action: 'round', change: 'chg-l2-unknown', findings: [], checked: ['path inventory reviewed'] }, EXEC);
    await review.execute({ action: 'round', change: 'chg-l2-unknown', findings: [], checked: ['consumer inventory reviewed'] }, EXEC);
    await review.execute({
      action: 'verdict',
      change: 'chg-l2-unknown',
      steps: ['criteria', 'data', 'seats', 'pre_read', 'discussion', 'written_conclusion', 'notify']
        .map((id) => ({ id, evidence: id })),
      dissent: 1,
      signoff: { by: 'human', identity: 'human:architect-01', at: NOW, scope: 'unknown path' },
      decision: 'ready',
    }, EXEC);

    const casePath = '.firetree/changes/chg-l2-unknown/correctness-case.json';
    await writeFile(join(workspace.root, casePath), `${JSON.stringify({
      schema: 'firetree.correctness-case/v1',
      claims: [{ id: 'c1', statement: 'Unknown path is quarantined until owned.', kind: 'safety', owner: 'human:owner' }],
      invariants: [{ id: 'i1', statement: 'Unknown paths require an owner.', enforced_by: 'config', evidence_ref: 'evidence/junit.xml' }],
      mapping: [{ claim_id: 'c1', invariant_ids: ['i1'], tests: ['unknown-path'], evidence_refs: ['evidence/junit.xml'] }],
      residual: [],
    }, null, 2)}\n`, 'utf8');

    const receipt = createReceiptTool(ctx);
    const built = await receipt.execute(buildArgs('chg-l2-unknown', {
      classification: undefined,
      evidence: [{ kind: 'test', producer: 'ci:github-actions', run_ref: 'evidence/junit.xml', produced_at: NOW }],
      review: { rounds: 2, new_findings: [0, 0], dissent: 1, verdict: 'ready' },
      signoff: { by: 'human', identity: 'human:architect-01', at: NOW, scope: 'unknown path' },
      correctness_case: casePath,
      assurance: 'A2',
    }), EXEC);
    assert.equal(built.ok, true, built.gaps?.join('; '));
    assert.deepEqual(built.receipt.impact.subsystems, []);
    assert.deepEqual(built.receipt.impact.unknown, ['tools/legacy/x.py']);

    const checked = await receipt.execute({ action: 'check', change: 'chg-l2-unknown' }, EXEC);
    assert.equal(checked.ok, true, checked.gaps?.join('; '));
  } finally {
    await workspace.cleanup();
  }
});
