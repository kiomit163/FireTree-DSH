import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { readFiretreeJson, sha256Text } from '../src/lib/artifacts.js';
import { validateJsonSchema } from '../src/lib/schema.js';
import { createAssessTool } from '../src/tools/assess.js';
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

function assessArgs(overrides = {}) {
  return {
    base: '1111111111111111111111111111111111111111',
    head: '2222222222222222222222222222222222222222',
    files: ['docs/README.md'],
    change: 'change-docs',
    ...overrides,
  };
}

test('L0 docs assessment records impact, sampling, and a hashed artifact', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createAssessTool(contextFor(workspace.root));
    const output = await tool.execute(assessArgs(), EXEC);

    assert.equal(output.ok, true);
    assert.equal(output.tier, 'L0');
    assert.equal(output.auto_tier, 'L0');
    assert.equal(output.confidence, 'high');
    assert.equal(output.signoff_required, 'none');
    assert.deepEqual(output.required_artifacts.slice(0, 2), ['test_evidence', 'receipt']);
    assert.equal(output.required_artifacts.includes('light_review'), output.sampling.selected);
    assert.equal(output.sampling.rate, 0.1);
    assert.equal(output.sampling.tier, 'L0');
    const fraction = Number.parseInt(sha256Text(`change-docs\ndocs/README.md`).slice(0, 8), 16) / 0x100000000;
    assert.equal(output.sampling.selected, fraction < 0.1);
    assert.deepEqual(validateJsonSchema(output, tool.output.schema), []);

    const record = await readFiretreeJson(workspace.root, output.artifact.path, { verifyHash: true });
    assert.equal(record.sha256, output.artifact.sha256);
    assert.equal(record.value.schema, 'firetree.assessment/v1');
    const { ok, artifact, ...artifactValue } = output;
    assert.deepEqual(record.value, artifactValue);
  } finally {
    await workspace.cleanup();
  }
});

test('L1 code assessment requires hypotheses and peer review', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createAssessTool(contextFor(workspace.root));
    const output = await tool.execute(assessArgs({ files: ['services/billing/charge.mjs'], change: 'change-code' }), EXEC);
    assert.equal(output.tier, 'L1');
    assert.equal(output.signoff_required, 'peer');
    assert.equal(output.sampling.selected, true);
    assert.ok(output.required_artifacts.includes('hypotheses'));
    assert.equal(output.impact.subsystems[0], 'billing');
  } finally {
    await workspace.cleanup();
  }
});

test('L2 interface assessment requires correctness case and human sign-off', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createAssessTool(contextFor(workspace.root));
    const output = await tool.execute(assessArgs({
      files: ['contracts/billing/openapi.yaml'],
      change: 'change-interface',
    }), EXEC);
    assert.equal(output.tier, 'L2');
    assert.equal(output.signoff_required, 'human');
    assert.ok(output.required_artifacts.includes('correctness_case'));
    assert.ok(output.required_artifacts.includes('seven_step_review'));
    assert.deepEqual(output.impact.interfaces, ['billing.api']);
    assert.ok(output.reasons.includes('interface changed: billing.api'));
  } finally {
    await workspace.cleanup();
  }
});

test('unknown paths force L2 with low confidence and no traversal claim', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createAssessTool(contextFor(workspace.root));
    const output = await tool.execute(assessArgs({
      files: ['tools/legacy/unknown.py'],
      change: 'change-unknown',
    }), EXEC);
    assert.equal(output.auto_tier, 'L2');
    assert.equal(output.confidence, 'low');
    assert.equal(output.impact.traversed, false);
    assert.deepEqual(output.impact.unknown, ['tools/legacy/unknown.py']);
  } finally {
    await workspace.cleanup();
  }
});

test('declared tier cannot be lower than automatic tier', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createAssessTool(contextFor(workspace.root));
    await assert.rejects(
      tool.execute(assessArgs({ files: ['services/billing/charge.mjs'], declared_tier: 'L0' }), EXEC),
      (error) => error.code === 'TIER_DOWNGRADE_REJECTED',
    );
  } finally {
    await workspace.cleanup();
  }
});

test('declared higher tier is allowed and recorded', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createAssessTool(contextFor(workspace.root));
    const output = await tool.execute(assessArgs({ declared_tier: 'L2', change: 'change-raised' }), EXEC);
    assert.equal(output.auto_tier, 'L0');
    assert.equal(output.tier, 'L2');
    assert.equal(output.declared_tier, 'L2');
    assert.ok(output.reasons.includes('declared tier raised to L2'));
    assert.equal(output.signoff_required, 'human');
  } finally {
    await workspace.cleanup();
  }
});

test('assess falls back to OWNERS when CODEOWNERS is absent', async () => {
  const workspace = await createM1Workspace();
  try {
    await rm(join(workspace.root, 'CODEOWNERS'));
    await writeFile(join(workspace.root, 'OWNERS'), 'approvers:\n  - alice\nreviewers:\n  - bob\n', 'utf8');
    const tool = createAssessTool(contextFor(workspace.root));
    const output = await tool.execute(assessArgs({
      change: 'change-owners',
      files: ['services/billing/charge.mjs'],
    }), EXEC);
    assert.equal(output.ok, true);
    assert.ok(output.impact.owners.includes('@alice'));
    assert.ok(output.impact.owners.includes('@bob'));
    assert.ok(!output.impact.owners.includes('@team-billing'));
    const artifact = await readFiretreeJson(workspace.root, '.firetree/changes/change-owners/assessment.json', { verifyHash: true });
    assert.ok(artifact.value.impact.owners.includes('@alice'));
    assert.ok(artifact.value.impact.owners.includes('@bob'));
  } finally {
    await workspace.cleanup();
  }
});

test('missing policy, empty files, invalid path, and missing agent fail closed', async () => {
  const workspace = await createM1Workspace();
  try {
    const tool = createAssessTool(contextFor(workspace.root));
    await assert.rejects(tool.execute(assessArgs({ files: [] }), EXEC), (error) => error.code === 'INVALID_ARGS');
    await assert.rejects(tool.execute(assessArgs({ files: ['../escape.mjs'] }), EXEC), (error) => error.code === 'INVALID_ARGS');
    await assert.rejects(tool.execute(assessArgs(), { signal: new AbortController().signal }), (error) => error.code === 'AGENT_REQUIRED');

    await rm(join(workspace.root, '.firetree', 'policy.json'));
    await assert.rejects(tool.execute(assessArgs({ change: 'change-no-policy' }), EXEC), (error) => error.code === 'POLICY_MISSING');
  } finally {
    await workspace.cleanup();
  }
});

