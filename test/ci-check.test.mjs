import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { readFiretreeJson, writeFiretreeJson } from '../src/lib/artifacts.js';
import { buildBundleManifest } from '../src/lib/bundle.js';
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
    await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="1" failures="0"><testcase name="x"/></testsuite>\n', 'utf8');

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

    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key';
    jwk.alg = 'RS256';
    const jwksPath = join(workspace.root, 'jwks.json');
    await writeFile(jwksPath, `${JSON.stringify({ keys: [jwk] }, null, 2)}\n`, 'utf8');
    const jwtPath = join(workspace.root, 'oidc.jwt');
    const jwt = await new SignJWT({
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
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://token.actions.githubusercontent.com')
      .setAudience('firetree')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    await writeFile(jwtPath, jwt, 'utf8');

    const a2 = await cli([
      '--mode', 'governed',
      '--change', 'chg-cli-a2',
      '--root', workspace.root,
      '--jwt', jwtPath,
      '--jwks', jwksPath,
      '--repository', 'owner/repo',
      '--require', 'A2',
    ]);
    assert.equal(a2.code, 0, a2.stdout + a2.stderr);
    const parsed = JSON.parse(a2.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.assurance, 'A2');

    const a3Missing = await cli([
      '--mode', 'governed',
      '--change', 'chg-cli-a2',
      '--root', workspace.root,
      '--jwt', jwtPath,
      '--jwks', jwksPath,
      '--repository', 'owner/repo',
      '--require', 'A3',
    ]);
    assert.equal(a3Missing.code, 1);
    assert.ok(JSON.parse(a3Missing.stdout).gaps.some((gap) => /required assurance A3/.test(gap)));

    const { publicKey: edPublicKey, privateKey: edPrivateKey } = generateKeyPairSync('ed25519');
    const bundle = await buildBundleManifest(join(workspace.root, '.firetree'));
    await writeFile(join(workspace.root, '.firetree', 'bundle-manifest.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    const signaturePath = join(workspace.root, 'signature.json');
    await writeFile(signaturePath, `${JSON.stringify({
      schema: 'firetree.signature/v1',
      algorithm: 'ed25519',
      digest: bundle.digest,
      signature: sign(null, Buffer.from(bundle.digest, 'utf8'), edPrivateKey).toString('base64'),
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(workspace.root, 'public.pem'), edPublicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
    const approvalPath = join(workspace.root, 'approval.json');
    const assessmentRecord = await readFiretreeJson(
      workspace.root,
      '.firetree/changes/chg-cli-a2/assessment.json',
      { verifyHash: true },
    );
    await writeFile(approvalPath, `${JSON.stringify({
      schema: 'firetree.approval/v1',
      change: {
        id: 'chg-cli-a2',
        head: assessment.change.head,
        assessment_sha256: assessmentRecord.sha256,
      },
      reviewer: 'github:alice',
      source: 'github-review',
      decision: 'approved',
      submitted_at: '2026-11-18T01:00:00Z',
      ref: 'pull/1#review-1',
    }, null, 2)}\n`, 'utf8');

    const a3 = await cli([
      '--mode', 'governed',
      '--change', 'chg-cli-a2',
      '--root', workspace.root,
      '--jwt', jwtPath,
      '--jwks', jwksPath,
      '--repository', 'owner/repo',
      '--bundle', join(workspace.root, '.firetree'),
      '--approval', approvalPath,
      '--signature', signaturePath,
      '--public-key', join(workspace.root, 'public.pem'),
      '--require', 'A3',
    ]);
    assert.equal(a3.code, 0, a3.stdout + a3.stderr);
    assert.equal(JSON.parse(a3.stdout).assurance, 'A3');

    await writeFiretreeJson(workspace.root, '.firetree/ai-reviews/chg-cli-a2.json', {
      schema: 'firetree.ai-review/v1',
      change: {
        id: 'chg-cli-a2',
        head: assessment.change.head,
        assessment_sha256: assessmentRecord.sha256,
      },
      mode: 'single-provider',
      author: { provider: 'deepseek-account', model: 'deepseek-flash' },
      seats: [
        {
          id: 'seat-1', provider: 'deepseek-account', model: 'deepseek-flash',
          context_sha256: '1'.repeat(64), prompt_sha256: '2'.repeat(64), transcript_sha256: '3'.repeat(64),
          verdict: 'ready', findings: [],
        },
        {
          id: 'seat-2', provider: 'deepseek-account', model: 'deepseek-flash',
          context_sha256: '4'.repeat(64), prompt_sha256: '5'.repeat(64), transcript_sha256: '6'.repeat(64),
          verdict: 'ready', findings: [],
        },
      ],
      unresolved: 0,
      converged: true,
      created_at: '2026-11-18T02:00:00Z',
    });
    const aiBundle = await buildBundleManifest(join(workspace.root, '.firetree'));
    await writeFile(join(workspace.root, '.firetree', 'bundle-manifest.json'), `${JSON.stringify(aiBundle, null, 2)}\n`, 'utf8');
    const aiSignaturePath = join(workspace.root, 'signature-ai.json');
    await writeFile(aiSignaturePath, `${JSON.stringify({
      schema: 'firetree.signature/v1',
      algorithm: 'ed25519',
      digest: aiBundle.digest,
      signature: sign(null, Buffer.from(aiBundle.digest, 'utf8'), edPrivateKey).toString('base64'),
    }, null, 2)}\n`, 'utf8');
    const ai = await cli([
      '--mode', 'governed',
      '--change', 'chg-cli-a2',
      '--root', workspace.root,
      '--jwt', jwtPath,
      '--jwks', jwksPath,
      '--repository', 'owner/repo',
      '--bundle', join(workspace.root, '.firetree'),
      '--ai-review', '.firetree/ai-reviews/chg-cli-a2.json',
      '--signature', aiSignaturePath,
      '--public-key', join(workspace.root, 'public.pem'),
      '--require', 'A3-AI-S',
    ]);
    assert.equal(ai.code, 0, ai.stdout + ai.stderr);
    assert.equal(JSON.parse(ai.stdout).assurance, 'A3-AI-S');

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
