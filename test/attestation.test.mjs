import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { deriveAssurance } from '../src/lib/assurance.js';
import { AttestationError, parseAttestationVerification, verifyGithubAttestation } from '../src/lib/attestation.js';
import { sha256File } from '../src/lib/artifacts.js';

test('GitHub attestation JSON is bound to the artifact digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-attest-'));
  try {
    const artifact = join(root, 'artifact.bin');
    const bundle = join(root, 'attestation.jsonl');
    await writeFile(artifact, 'firetree-artifact\n', 'utf8');
    await writeFile(bundle, '{}\n', 'utf8');
    const digest = await sha256File(artifact);
    const output = JSON.stringify([{
      verificationResult: { statement: { subject: [{ digest: { sha256: digest } }] } },
    }]);
    const calls = [];
    const result = await verifyGithubAttestation({
      artifact,
      bundle,
      repository: 'owner/repo',
      signerWorkflow: 'owner/repo/.github/workflows/attest.yml@refs/heads/main',
      runner: (command, args) => {
        calls.push({ command, args });
        return output;
      },
    });
    assert.equal(result.valid, true);
    assert.equal(result.digest, digest);
    assert.equal(calls[0].args.includes('--bundle'), true);
    assert.equal(calls[0].args.includes('--signer-workflow'), true);

    const wrong = parseAttestationVerification(JSON.parse(output), '0'.repeat(64));
    assert.equal(wrong.valid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GitHub attestation verifier fails closed on gh errors and empty output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-attest-'));
  try {
    const artifact = join(root, 'artifact.bin');
    const bundle = join(root, 'attestation.jsonl');
    await writeFile(artifact, 'x', 'utf8');
    await writeFile(bundle, '{}', 'utf8');
    await assert.rejects(
      verifyGithubAttestation({
        artifact, bundle, repository: 'owner/repo',
        runner: () => { const error = new Error('gh failed'); error.stderr = 'certificate mismatch'; throw error; },
      }),
      (error) => error instanceof AttestationError && error.code === 'ATTESTATION_FAILED',
    );
    const empty = await verifyGithubAttestation({
      artifact, bundle, repository: 'owner/repo',
      runner: () => '[]',
    });
    assert.equal(empty.valid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('attested provenance does not raise A2 to human A3', () => {
  const base = {
    claimsValid: true,
    claims: { repository: 'owner/repo' },
    evidence: [{ producer: 'ci:github-actions' }],
    attested: true,
  };
  assert.equal(deriveAssurance(base).level, 'A2');
  assert.equal(deriveAssurance({ ...base, approval: { verified: true } }).level, 'A2');
  assert.equal(deriveAssurance({
    ...base, aiReview: { valid: true, mode: 'single-provider' }, attested: true,
  }).level, 'A3-AI-S');
  assert.equal(deriveAssurance({
    ...base, aiReview: { valid: true, mode: 'multi-provider' }, attested: true,
  }).level, 'A3-AI');
  assert.equal(deriveAssurance({
    ...base, attested: false, aiReview: { valid: true, mode: 'single-provider' },
  }).level, 'A2');
});
