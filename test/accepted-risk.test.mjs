import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { readFiretreeJson, sha256Text } from '../src/lib/artifacts.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createHypothesisTool } from '../src/tools/hypothesis.js';
import { createReceiptTool } from '../src/tools/receipt.js';
import { createReviewTool } from '../src/tools/review.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const EXEC = { agent: { id: 'agent-1' }, signal: new AbortController().signal };
const HASH = 'a'.repeat(64);
const NOW = '2026-11-18T00:00:00Z';

function contextFor(root) {
  return { workingDirectory: { async ensure(agent) { assert.ok(agent); return root; } } };
}

async function setup(workspace) {
  const ctx = contextFor(workspace.root);
  const assess = createAssessTool(ctx);
  await assess.execute({
    base: '1111111111111111111111111111111111111111',
    head: '2222222222222222222222222222222222222222',
    files: ['services/billing/charge.mjs'],
    change: 'chg-risk',
  }, EXEC);
  await mkdir(join(workspace.root, 'evidence'), { recursive: true });
  await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="1" failures="0"><testcase name="x"/></testsuite>\n', 'utf8');
  const hypothesis = createHypothesisTool(ctx);
  await hypothesis.execute({
    action: 'add',
    change: 'chg-risk',
    statement: 'The retry path keeps the idempotency key.',
    kind: 'assumption',
    detection: { method: 'test', pass_criterion: 'retry test passes', evidence_kind: 'junit' },
  }, EXEC);
  return { ctx, hypothesis };
}

async function reviewL1(ctx) {
  const review = createReviewTool(ctx);
  await review.execute({
    action: 'open',
    change: 'chg-risk',
    diff_sha256: HASH,
    spec_sha256: HASH,
    criteria: ['correctness'],
    evidence: ['evidence/junit.xml'],
    seats: [{ id: 's1', owner: '@team-billing' }],
  }, EXEC);
  await review.execute({ action: 'round', change: 'chg-risk', findings: [], checked: ['charge path reviewed'] }, EXEC);
  await review.execute({
    action: 'verdict',
    change: 'chg-risk',
    steps: [
      { id: 'criteria', evidence: 'package' },
      { id: 'review', evidence: 'round-1' },
      { id: 'conclusion', evidence: 'zero findings' },
    ],
    dissent: 1,
    decision: 'ready',
  }, EXEC);
}

function buildArgs() {
  return {
    action: 'build',
    change: 'chg-risk',
    intent: { spec: 'specs/billing.md', sha256: HASH },
    evidence: [{
      kind: 'test',
      producer: 'local:node-test',
      run_ref: 'evidence/junit.xml',
      produced_at: NOW,
    }],
    expires_at: '2026-12-18T00:00:00Z',
    assurance: 'A1',
  };
}

test('accept records a human risk acceptance and receipt counts it', async () => {
  const workspace = await createM1Workspace();
  try {
    const { ctx, hypothesis } = await setup(workspace);
    await reviewL1(ctx);
    const before = await createReceiptTool(ctx).execute(buildArgs(), EXEC);
    assert.equal(before.ok, false);
    assert.ok(before.gaps.some((gap) => /untested hypotheses exceed accepted risk/.test(gap)));

    const accepted = await hypothesis.execute({
      action: 'accept',
      change: 'chg-risk',
      id: 'h1',
      reason: 'Retry path is covered by a manual review for this release.',
      accepted_by: 'human:architect-01',
      approval_ref: 'approval-2026-11-18',
      expires_at: '2026-12-18T00:00:00Z',
    }, EXEC);
    assert.equal(accepted.action, 'accept');
    const ledger = await readFiretreeJson(workspace.root, '.firetree/changes/chg-risk/hypotheses.json', { verifyHash: true });
    assert.equal(ledger.value.accepted_risks.length, 1);
    assert.equal(ledger.value.accepted_risks[0].accepted_by, 'human:architect-01');

    const built = await createReceiptTool(ctx).execute(buildArgs(), EXEC);
    assert.equal(built.ok, true, built.gaps?.join('; '));
    assert.equal(built.receipt.hypotheses.total, 1);
    assert.equal(built.receipt.hypotheses.verified, 0);
    assert.equal(built.receipt.hypotheses.accepted_risk, 1);

    const checked = await createReceiptTool(ctx).execute({ action: 'check', change: 'chg-risk' }, EXEC);
    assert.equal(checked.ok, true, checked.gaps?.join('; '));
  } finally {
    await workspace.cleanup();
  }
});

test('accept rejects agent acceptance, expired acceptance, and already verified hypotheses', async () => {
  const workspace = await createM1Workspace();
  try {
    const { hypothesis } = await setup(workspace);
    await assert.rejects(
      hypothesis.execute({
        action: 'accept', change: 'chg-risk', id: 'h1', reason: 'x',
        accepted_by: 'agent:bot', approval_ref: 'a', expires_at: '2026-12-18T00:00:00Z',
      }, EXEC),
      (error) => error.code === 'INVALID_ARGS',
    );
    await assert.rejects(
      hypothesis.execute({
        action: 'accept', change: 'chg-risk', id: 'h1', reason: 'x',
        accepted_by: 'human:a', approval_ref: 'a', expires_at: '2020-01-01T00:00:00Z',
      }, EXEC),
      (error) => error.code === 'INVALID_ARGS',
    );
    const evidenceText = '<testsuite tests="1" failures="0"><testcase name="x"/></testsuite>\n';
    await hypothesis.execute({
      action: 'verify', change: 'chg-risk', id: 'h1', result: 'verified',
      evidence_ref: {
        producer: 'ci:github-actions',
        run_ref: 'evidence/junit.xml',
        sha256: sha256Text(evidenceText),
        produced_at: NOW,
      },
    }, EXEC);
    await assert.rejects(
      hypothesis.execute({
        action: 'accept', change: 'chg-risk', id: 'h1', reason: 'x',
        accepted_by: 'human:a', approval_ref: 'a', expires_at: '2026-12-18T00:00:00Z',
      }, EXEC),
      (error) => error.code === 'ALREADY_VERIFIED',
    );
  } finally {
    await workspace.cleanup();
  }
});
