import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { sha256Text } from '../src/lib/artifacts.js';
import { validateJsonSchema } from '../src/lib/schema.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createReceiptTool } from '../src/tools/receipt.js';
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

async function prepareL1(workspace) {
  const ctx = contextFor(workspace.root);
  const assess = createAssessTool(ctx);
  await assess.execute({
    base: '1111111111111111111111111111111111111111',
    head: '2222222222222222222222222222222222222222',
    files: ['services/billing/charge.mjs'],
    change: 'chg-l1',
  }, EXEC);
  await mkdir(join(workspace.root, 'evidence'), { recursive: true });
  await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="1" failures="0"/>\n', 'utf8');
  return ctx;
}

function l1BuildArgs() {
  return {
    action: 'build',
    change: 'chg-l1',
    intent: { spec: 'specs/billing.md', sha256: HASH },
    classification: { subsystem: 'billing', kind: 'large', method: 'decompose', dossier_sha256: HASH },
    evidence: [
      {
        kind: 'test',
        producer: 'ci:github-actions',
        run_ref: 'evidence/junit.xml',
        produced_at: '2026-11-07T00:00:00Z',
      },
    ],
    review: { rounds: 2, new_findings: [2, 0], dissent: 1, verdict: 'ready' },
    signoff: { by: 'human', identity: 'human:reviewer-01', at: '2026-11-07T01:00:00Z', scope: 'L1 peer review' },
    expires_at: '2026-12-07T00:00:00Z',
    assurance: 'A2',
  };
}

test('build assembles an L1 receipt from external evidence and check accepts it', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await prepareL1(workspace);
    const tool = createReceiptTool(ctx);
    const built = await tool.execute(l1BuildArgs(), EXEC);

    assert.equal(built.ok, true);
    assert.deepEqual(built.gaps, []);
    assert.equal(built.receipt.schema, 'firetree.receipt/v0');
    assert.equal(built.receipt.tier, 'L1');
    assert.equal(built.receipt.evidence[0].producer, 'ci:github-actions');
    assert.equal(built.receipt.evidence[0].sha256, sha256Text('<testsuite tests="1" failures="0"/>\n'));
    assert.equal(built.receipt.correctness_case, null);
    assert.deepEqual(validateJsonSchema(built, tool.output.schema), []);

    const checked = await tool.execute({ action: 'check', change: 'chg-l1' }, EXEC);
    assert.equal(checked.ok, true);
    assert.equal(checked.artifact.path, built.artifact.path);
    assert.equal(checked.artifact.sha256, built.artifact.sha256);
  } finally {
    await workspace.cleanup();
  }
});

test('build and check enforce L2 correctness case and human sign-off', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = contextFor(workspace.root);
    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '3333333333333333333333333333333333333333',
      head: '4444444444444444444444444444444444444444',
      files: ['contracts/billing/openapi.yaml'],
      change: 'chg-l2',
    }, EXEC);

    await mkdir(join(workspace.root, 'evidence'), { recursive: true });
    await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="2" failures="0"/>\n', 'utf8');
    await mkdir(join(workspace.root, '.firetree', 'changes', 'chg-l2'), { recursive: true });
    const caseText = await readFile(new URL('../fixtures/correctness-case-l2.json', import.meta.url), 'utf8');
    await writeFile(join(workspace.root, '.firetree', 'changes', 'chg-l2', 'correctness-case.json'), caseText, 'utf8');

    const tool = createReceiptTool(ctx);
    const built = await tool.execute({
      action: 'build',
      change: 'chg-l2',
      intent: { spec: 'specs/billing-idempotency.md', sha256: HASH },
      classification: { subsystem: 'billing', kind: 'large', method: 'decompose', dossier_sha256: HASH },
      evidence: [
        {
          kind: 'test',
          producer: 'ci:github-actions',
          run_ref: 'evidence/junit.xml',
          produced_at: '2026-11-07T00:00:00Z',
        },
      ],
      review: { rounds: 2, new_findings: [3, 0], dissent: 2, verdict: 'ready' },
      signoff: { by: 'human', identity: 'human:architect-01', at: '2026-11-07T02:00:00Z', scope: 'L2 interface change' },
      correctness_case: '.firetree/changes/chg-l2/correctness-case.json',
      expires_at: '2026-12-07T00:00:00Z',
      assurance: 'A2',
    }, EXEC);

    assert.equal(built.ok, true);
    assert.equal(built.receipt.correctness_case.claims, 2);
    assert.equal(built.receipt.correctness_case.mapped_claims, 2);
    assert.equal(built.receipt.signoff.by, 'human');
    const checked = await tool.execute({ action: 'check', change: 'chg-l2' }, EXEC);
    assert.equal(checked.ok, true);

    const withoutCase = await tool.execute({
      action: 'build',
      change: 'chg-l2',
      intent: { spec: 'specs/billing-idempotency.md', sha256: HASH },
      classification: { subsystem: 'billing', kind: 'large', method: 'decompose', dossier_sha256: HASH },
      evidence: [{
        kind: 'test',
        producer: 'ci:github-actions',
        run_ref: 'evidence/junit.xml',
        produced_at: '2026-11-07T00:00:00Z',
      }],
      review: { rounds: 2, new_findings: [3, 0], dissent: 2, verdict: 'ready' },
      signoff: { by: 'human', identity: 'human:architect-01', at: '2026-11-07T02:00:00Z', scope: 'L2 interface change' },
      expires_at: '2026-12-07T00:00:00Z',
      assurance: 'A2',
    }, EXEC);
    assert.equal(withoutCase.ok, false);
    assert.ok(withoutCase.gaps.some((gap) => /correctness.case/.test(gap)));
  } finally {
    await workspace.cleanup();
  }
});

test('build fails closed on agent evidence, missing file, and expiry', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await prepareL1(workspace);
    const tool = createReceiptTool(ctx);

    const base = l1BuildArgs();
    const agentEvidence = await tool.execute({
      ...base,
      evidence: [{ ...base.evidence[0], producer: 'agent:bot' }],
    }, EXEC);
    assert.equal(agentEvidence.ok, false);
    assert.ok(agentEvidence.gaps.some((gap) => gap.includes('producer')));

    const missing = await tool.execute({
      ...base,
      evidence: [{ ...base.evidence[0], run_ref: 'evidence/missing.xml' }],
    }, EXEC);
    assert.equal(missing.ok, false);
    assert.ok(missing.gaps.some((gap) => gap.includes('missing')));

    const expired = await tool.execute({ ...base, expires_at: '2020-01-01T00:00:00Z' }, EXEC);
    assert.equal(expired.ok, false);
    assert.ok(expired.gaps.some((gap) => gap.includes('expired')));
  } finally {
    await workspace.cleanup();
  }
});

test('check returns gaps for missing or tampered receipts', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await prepareL1(workspace);
    const tool = createReceiptTool(ctx);

    const missing = await tool.execute({ action: 'check', change: 'chg-none' }, EXEC);
    assert.equal(missing.ok, false);
    assert.ok(missing.gaps.includes('receipt is missing'));

    const built = await tool.execute(l1BuildArgs(), EXEC);
    assert.equal(built.ok, true);
    await writeFile(join(workspace.root, built.artifact.path), '{"tampered":true}\n', 'utf8');
    const tampered = await tool.execute({ action: 'check', change: 'chg-l1' }, EXEC);
    assert.equal(tampered.ok, false);
    assert.ok(tampered.gaps.length > 0);
  } finally {
    await workspace.cleanup();
  }
});

test('receipt requires an owning agent session', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await prepareL1(workspace);
    const tool = createReceiptTool(ctx);
    await assert.rejects(tool.execute(l1BuildArgs(), { signal: new AbortController().signal }), (error) => error.code === 'AGENT_REQUIRED');
  } finally {
    await workspace.cleanup();
  }
});
