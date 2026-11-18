import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { readFiretreeJson, sha256Text } from '../src/lib/artifacts.js';
import { validateJsonSchema } from '../src/lib/schema.js';
import { createHypothesisTool } from '../src/tools/hypothesis.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const EXEC = { agent: { id: 'agent-1' }, signal: new AbortController().signal };
const EVIDENCE_TEXT = '<testsuite tests="1" failures="0"><testcase name="x"/></testsuite>\n';
const EVIDENCE_HASH = sha256Text(EVIDENCE_TEXT);

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

function addArgs(overrides = {}) {
  return {
    action: 'add',
    change: 'chg-hyp',
    statement: 'Retrying the same idempotency key returns the original result.',
    kind: 'assumption',
    detection: {
      method: 'test',
      command: 'node --test test/billing.test.mjs',
      pass_criterion: 'BillingRetryTest passes',
      evidence_kind: 'junit',
    },
    ...overrides,
  };
}

async function workspaceWithEvidence() {
  const workspace = await createM1Workspace();
  await mkdir(join(workspace.root, 'evidence'), { recursive: true });
  await writeFile(join(workspace.root, 'evidence', 'junit.xml'), EVIDENCE_TEXT, 'utf8');
  return workspace;
}

test('add records a detected hypothesis and list reports coverage', async () => {
  const workspace = await workspaceWithEvidence();
  try {
    const tool = createHypothesisTool(contextFor(workspace.root));
    const added = await tool.execute(addArgs(), EXEC);
    assert.equal(added.ok, true);
    assert.equal(added.action, 'add');
    assert.equal(added.total, 1);
    assert.equal(added.verified, 0);
    assert.equal(added.untested, 1);
    assert.equal(added.coverage, 0);
    assert.equal(added.hypotheses[0].id, 'h1');
    assert.equal(added.hypotheses[0].status, 'untested');
    assert.deepEqual(validateJsonSchema(added, tool.output.schema), []);

    const artifact = await readFiretreeJson(workspace.root, added.artifact.path, { verifyHash: true });
    assert.equal(artifact.value.hypotheses.length, 1);
    assert.equal(artifact.value.hypotheses[0].detection.pass_criterion, 'BillingRetryTest passes');

    const listed = await tool.execute({ action: 'list', change: 'chg-hyp' }, EXEC);
    assert.equal(listed.exists, true);
    assert.equal(listed.total, 1);
    assert.equal(listed.coverage, 0);
  } finally {
    await workspace.cleanup();
  }
});

test('verify requires external evidence and updates coverage', async () => {
  const workspace = await workspaceWithEvidence();
  try {
    const tool = createHypothesisTool(contextFor(workspace.root));
    await tool.execute(addArgs(), EXEC);
    await tool.execute(addArgs({
      statement: 'Duplicate requests never capture twice.',
      kind: 'claim',
    }), EXEC);

    const verified = await tool.execute({
      action: 'verify',
      change: 'chg-hyp',
      id: 'h1',
      result: 'verified',
      evidence_ref: {
        producer: 'ci:github-actions',
        run_ref: 'evidence/junit.xml',
        sha256: EVIDENCE_HASH,
        produced_at: '2026-11-07T00:00:00Z',
      },
    }, EXEC);
    assert.equal(verified.verified, 1);
    assert.equal(verified.untested, 1);
    assert.equal(verified.coverage, 0.5);
    assert.equal(verified.hypotheses.find((hypothesis) => hypothesis.id === 'h1').status, 'verified');

    const falsified = await tool.execute({
      action: 'verify',
      change: 'chg-hyp',
      id: 'h2',
      result: 'falsified',
      evidence_ref: {
        producer: 'local:node-test',
        run_ref: 'evidence/junit.xml',
        sha256: EVIDENCE_HASH,
        produced_at: '2026-11-07T00:00:00Z',
      },
    }, EXEC);
    assert.equal(falsified.falsified, 1);
    assert.equal(falsified.coverage, 0.5);
  } finally {
    await workspace.cleanup();
  }
});

test('add rejects missing detection; verify rejects agent, missing evidence, and hash mismatch', async () => {
  const workspace = await workspaceWithEvidence();
  try {
    const tool = createHypothesisTool(contextFor(workspace.root));
    await assert.rejects(tool.execute({ action: 'add', change: 'chg-hyp', statement: 'x', kind: 'claim' }, EXEC), (error) => error.code === 'DETECTION_REQUIRED');

    await tool.execute(addArgs(), EXEC);
    await assert.rejects(
      tool.execute({ action: 'verify', change: 'chg-hyp', id: 'h1', result: 'verified' }, EXEC),
      (error) => error.code === 'EVIDENCE_REQUIRED',
    );
    await assert.rejects(
      tool.execute({
        action: 'verify',
        change: 'chg-hyp',
        id: 'h1',
        result: 'verified',
        evidence_ref: { producer: 'agent:bot', run_ref: 'evidence/junit.xml', sha256: EVIDENCE_HASH, produced_at: '2026-11-07T00:00:00Z' },
      }, EXEC),
      (error) => error.code === 'AGENT_EVIDENCE_REJECTED',
    );
    await assert.rejects(
      tool.execute({
        action: 'verify',
        change: 'chg-hyp',
        id: 'h1',
        result: 'verified',
        evidence_ref: { producer: 'ci:ci', run_ref: 'evidence/missing.xml', sha256: EVIDENCE_HASH, produced_at: '2026-11-07T00:00:00Z' },
      }, EXEC),
      (error) => error.code === 'EVIDENCE_MISSING',
    );
    await assert.rejects(
      tool.execute({
        action: 'verify',
        change: 'chg-hyp',
        id: 'h1',
        result: 'verified',
        evidence_ref: { producer: 'ci:ci', run_ref: 'evidence/junit.xml', sha256: '0'.repeat(64), produced_at: '2026-11-07T00:00:00Z' },
      }, EXEC),
      (error) => error.code === 'EVIDENCE_HASH_MISMATCH',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('list of an absent ledger is explicit and verify requires an existing change', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createHypothesisTool(contextFor(workspace.root));
    const listed = await tool.execute({ action: 'list', change: 'chg-none' }, EXEC);
    assert.equal(listed.exists, false);
    assert.equal(listed.total, 0);
    assert.equal(listed.coverage, 0);

    await assert.rejects(
      tool.execute({
        action: 'verify',
        change: 'chg-none',
        id: 'h1',
        result: 'verified',
        evidence_ref: { producer: 'ci:ci', run_ref: 'https://ci.example/1', sha256: 'a'.repeat(64), produced_at: '2026-11-07T00:00:00Z' },
      }, EXEC),
      (error) => error.code === 'HYPOTHESES_NOT_FOUND',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('hypothesis requires an owning agent session', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createHypothesisTool(contextFor(workspace.root));
    await assert.rejects(tool.execute(addArgs(), { signal: new AbortController().signal }), (error) => error.code === 'AGENT_REQUIRED');
  } finally {
    await workspace.cleanup();
  }
});
