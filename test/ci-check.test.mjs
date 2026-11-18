import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { createAssessTool } from '../src/tools/assess.js';
import { createReceiptTool } from '../src/tools/receipt.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const run = promisify(execFile);

async function cli(args) {
  try {
    const result = await run(process.execPath, ['bin/firetree-check.mjs', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('CI check returns a gap and exit 1 for a missing change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-ci-check-'));
  try {
    const result = await cli(['--mode', 'autonomous', '--change', 'missing-change', '--root', root]);
    assert.equal(result.code, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.ok(output.gaps.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CI check rejects invalid mode', async () => {
  const result = await cli(['--mode', 'invalid', '--change', 'x']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--mode must be governed or autonomous/);
});

test('CI check derives A2 from OIDC claims and refuses A3 without a signature', async () => {
  const workspace = await createM1Workspace();
  try {
    const policyPath = join(workspace.root, '.firetree', 'policy.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    policy.tiers.L0.sample_rate = 0;
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
    await mkdir(join(workspace.root, 'evidence'), { recursive: true });
    await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="1" failures="0"/>\n', 'utf8');

    const ctx = { workingDirectory: { async ensure() { return workspace.root; } } };
    const exec = { agent: { id: 'agent-1' }, signal: new AbortController().signal };
    const assess = createAssessTool(ctx);
    const assessment = await assess.execute({
      base: '1111111111111111111111111111111111111111',
      head: '2222222222222222222222222222222222222222',
      files: ['docs/README.md'],
      change: 'chg-cli-a2',
    }, exec);
    const receipt = createReceiptTool(ctx);
    const built = await receipt.execute({
      action: 'build',
      change: 'chg-cli-a2',
      intent: { spec: 'docs/README.md', sha256: 'a'.repeat(64) },
      evidence: [{
        kind: 'test',
        producer: 'ci:github-actions',
        run_ref: 'evidence/junit.xml',
        produced_at: '2026-11-18T00:00:00Z',
      }],
      expires_at: '2026-12-18T00:00:00Z',
      assurance: 'A2',
    }, exec);
    assert.equal(built.ok, true, built.gaps?.join('; '));

    const claimsPath = join(workspace.root, 'claims.json');
    await writeFile(claimsPath, `${JSON.stringify({
      iss: 'https://token.actions.githubusercontent.com',
      aud: 'firetree',
      repository: 'owner/repo',
      workflow_ref: 'owner/repo/.github/workflows/firetree.yml@refs/heads/main',
      ref: 'refs/pull/1/merge',
      sha: assessment.change.head,
      event_name: 'pull_request',
      run_id: '12345',
      run_attempt: '1',
      actor: 'alice',
    }, null, 2)}\n`, 'utf8');

    const a2 = await cli([
      '--mode', 'governed',
      '--change', 'chg-cli-a2',
      '--root', workspace.root,
      '--claims', claimsPath,
      '--repository', 'owner/repo',
      '--require', 'A2',
    ]);
    assert.equal(a2.code, 0, a2.stdout + a2.stderr);
    const parsed = JSON.parse(a2.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.assurance, 'A2');

    const a3 = await cli([
      '--mode', 'governed',
      '--change', 'chg-cli-a2',
      '--root', workspace.root,
      '--claims', claimsPath,
      '--repository', 'owner/repo',
      '--require', 'A3',
    ]);
    assert.equal(a3.code, 1);
    assert.ok(JSON.parse(a3.stdout).gaps.some((gap) => /A3 verification is not implemented/.test(gap)));

    const noClaims = await cli([
      '--mode', 'governed',
      '--change', 'chg-cli-a2',
      '--root', workspace.root,
      '--require', 'A2',
    ]);
    assert.equal(noClaims.code, 1);
    assert.ok(JSON.parse(noClaims.stdout).gaps.some((gap) => /required assurance A2/.test(gap)));
  } finally {
    await workspace.cleanup();
  }
});
