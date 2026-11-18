import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { readFiretreeJson, sha256Text } from '../src/lib/artifacts.js';
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

async function prepare(workspace, files = ['services/billing/charge.mjs'], change = 'chg-auto') {
  const ctx = contextFor(workspace.root);
  const assess = createAssessTool(ctx);
  await assess.execute({
    base: '1111111111111111111111111111111111111111',
    head: '2222222222222222222222222222222222222222',
    files,
    change,
  }, EXEC);
  await mkdir(join(workspace.root, 'evidence'), { recursive: true });
  await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="1" failures="0"><testcase name="x"/></testsuite>\n', 'utf8');
  return ctx;
}

function buildArgs(overrides = {}) {
  return {
    action: 'build',
    mode: 'autonomous',
    change: 'chg-auto',
    intent: { spec: 'specs/billing.md', sha256: HASH },
    classification: { subsystem: 'billing', kind: 'large', method: 'decompose', dossier_sha256: HASH },
    evidence: [{
      kind: 'test',
      producer: 'ci:github-actions',
      run_ref: 'evidence/junit.xml',
      produced_at: '2026-11-08T00:00:00Z',
    }],
    expires_at: '2026-12-08T00:00:00Z',
    assurance: 'A2',
    ...overrides,
  };
}

test('autonomous technical evidence builds and checks without human signoff', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await prepare(workspace);
    const tool = createReceiptTool(ctx);
    const built = await tool.execute(buildArgs(), EXEC);
    assert.equal(built.ok, true);
    assert.equal(built.technical_evidence.schema, 'firetree.technical-evidence/v1');
    assert.equal(built.technical_evidence.mode, 'autonomous');
    assert.equal(built.technical_evidence.human_signoff, false);
    assert.equal(built.technical_evidence.completion_claim, false);
    assert.equal(built.technical_evidence.milestone_claim, false);
    assert.equal(built.technical_evidence.assurance, 'A2');
    assert.equal(built.technical_evidence.evidence[0].sha256, sha256Text('<testsuite tests="1" failures="0"><testcase name="x"/></testsuite>\n'));

    const checked = await tool.execute({ action: 'check', mode: 'autonomous', change: 'chg-auto' }, EXEC);
    assert.equal(checked.ok, true);
    assert.equal(checked.technical_evidence.schema, 'firetree.technical-evidence/v1');

    const record = await readFiretreeJson(workspace.root, '.firetree/evidence/chg-auto.json', { verifyHash: true });
    assert.equal(record.value.human_signoff, false);
  } finally {
    await workspace.cleanup();
  }
});

test('analysis-only autonomous evidence is explicitly scoped', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await prepare(workspace, ['services/billing/charge.mjs'], 'chg-auto-analysis');
    await writeFile(join(workspace.root, 'evidence', 'analysis.json'), '{"tier":"L1"}\n', 'utf8');
    const tool = createReceiptTool(ctx);
    const built = await tool.execute(buildArgs({
      change: 'chg-auto-analysis',
      assurance: 'A1',
      evidence: [{
        kind: 'analysis',
        producer: 'tool:firetree-pilot-assess',
        run_ref: 'evidence/analysis.json',
        produced_at: '2026-11-08T00:00:00Z',
      }],
    }), EXEC);
    assert.equal(built.ok, true);
    assert.equal(built.technical_evidence.scope, 'analysis-only');
    assert.equal(built.technical_evidence.assurance, 'A1');
  } finally {
    await workspace.cleanup();
  }
});

test('autonomous evidence rejects human signoff, review, and agent evidence', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await prepare(workspace);
    const tool = createReceiptTool(ctx);
    await assert.rejects(
      tool.execute(buildArgs({ signoff: { by: 'human', identity: 'human:a', at: '2026-11-08T00:00:00Z', scope: 'x' } }), EXEC),
      (error) => error.code === 'INVALID_ARGS',
    );
    await assert.rejects(
      tool.execute(buildArgs({ review: { rounds: 1, new_findings: [0], dissent: 0, verdict: 'ready' } }), EXEC),
      (error) => error.code === 'INVALID_ARGS',
    );
    const agent = await tool.execute(buildArgs({
      evidence: [{ ...buildArgs().evidence[0], producer: 'agent:bot' }],
    }), EXEC);
    assert.equal(agent.ok, false);
    assert.ok(agent.gaps.some((gap) => gap.includes('producer')));
  } finally {
    await workspace.cleanup();
  }
});

test('autonomous L2 evidence does not require review, synthesis, or a correctness case', async () => {
  const workspace = await createM1Workspace();
  try {
    const ctx = await prepare(workspace, ['contracts/billing/openapi.yaml'], 'chg-auto-l2');
    const tool = createReceiptTool(ctx);
    const built = await tool.execute(buildArgs({ change: 'chg-auto-l2' }), EXEC);
    assert.equal(built.ok, true);
    assert.equal(built.technical_evidence.tier, 'L2');
    assert.equal(built.technical_evidence.assurance, 'A2');
    const checked = await tool.execute({ action: 'check', mode: 'autonomous', change: 'chg-auto-l2' }, EXEC);
    assert.equal(checked.ok, true);
  } finally {
    await workspace.cleanup();
  }
});
