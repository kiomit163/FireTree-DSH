import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { atLeast, deriveAssurance } from '../src/lib/assurance.js';
import { buildBundleManifest, verifyBundleManifest } from '../src/lib/bundle.js';
import { IdentityError, parseOidcClaims, producerFromClaims, verifyClaims } from '../src/lib/identity.js';

const SHA = 'a'.repeat(40);

function claims(overrides = {}) {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'firetree',
    repository: 'owner/repo',
    workflow_ref: 'owner/repo/.github/workflows/firetree.yml@refs/heads/main',
    ref: 'refs/pull/1/merge',
    sha: SHA,
    event_name: 'pull_request',
    run_id: '12345',
    run_attempt: '1',
    actor: 'alice',
    ...overrides,
  };
}

test('OIDC claims parse and verify against expected policy', () => {
  const parsed = parseOidcClaims(claims());
  assert.equal(parsed.repository, 'owner/repo');
  assert.deepEqual(parsed.aud, ['firetree']);
  const result = verifyClaims(parsed, {
    issuer: 'https://token.actions.githubusercontent.com',
    audience: 'firetree',
    repository: 'owner/repo',
    sha: SHA,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.failures, []);
  assert.match(result.claimsSha256, /^[a-f0-9]{64}$/);
  assert.equal(producerFromClaims(parsed).claims_sha256, result.claimsSha256);
});

test('OIDC claims reject wrong issuer, audience, repository, sha, and event', () => {
  const parsed = parseOidcClaims(claims({ event_name: 'issues' }));
  const result = verifyClaims(parsed, {
    issuer: 'https://evil.example',
    audience: 'other',
    repository: 'other/repo',
    sha: 'b'.repeat(40),
  });
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => /issuer/.test(failure)));
  assert.ok(result.failures.some((failure) => /audience/.test(failure)));
  assert.ok(result.failures.some((failure) => /repository/.test(failure)));
  assert.ok(result.failures.some((failure) => /sha/.test(failure)));
  assert.ok(result.failures.some((failure) => /event_name/.test(failure)));
});

test('OIDC claims reject malformed input', () => {
  assert.throws(() => parseOidcClaims({}), (error) => error instanceof IdentityError);
  assert.throws(() => parseOidcClaims(claims({ sha: 'short' })), (error) => error instanceof IdentityError);
  assert.throws(() => parseOidcClaims(claims({ repository: 'not-a-repo' })), (error) => error instanceof IdentityError);
});

test('assurance is derived rather than declared', () => {
  assert.deepEqual(deriveAssurance({}).level, 'A0');
  assert.equal(deriveAssurance({ evidence: [{ producer: 'local:node-test' }] }).level, 'A1');
  assert.equal(deriveAssurance({
    claimsValid: true,
    claims: claims(),
    evidence: [{ producer: 'ci:github-actions' }],
  }).level, 'A2');
  assert.equal(deriveAssurance({
    claimsValid: true,
    claims: claims(),
    evidence: [{ producer: 'ci:github-actions' }],
    approval: { verified: true },
    signed: true,
  }).level, 'A3');
  assert.equal(deriveAssurance({
    claimsValid: true,
    claims: claims(),
    evidence: [{ producer: 'local:node-test' }],
  }).level, 'A1');
  assert.equal(atLeast('A2', 'A1'), true);
  assert.equal(atLeast('A1', 'A2'), false);
});

test('bundle manifest verifies content and detects tampering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-bundle-'));
  try {
    await mkdir(join(root, '.firetree', 'evidence'), { recursive: true });
    await writeFile(join(root, '.firetree', 'receipt.json'), '{"ok":true}\n', 'utf8');
    await writeFile(join(root, '.firetree', 'evidence', 'junit.xml'), '<testsuite tests="1"/>\n', 'utf8');
    const manifest = await buildBundleManifest(join(root, '.firetree'));
    assert.equal(manifest.schema, 'firetree.bundle/v1');
    assert.equal(manifest.files.length, 2);
    assert.match(manifest.digest, /^[a-f0-9]{64}$/);

    const good = await verifyBundleManifest(join(root, '.firetree'), manifest);
    assert.deepEqual(good.gaps, []);

    await writeFile(join(root, '.firetree', 'evidence', 'junit.xml'), '<testsuite tests="2"/>\n', 'utf8');
    const bad = await verifyBundleManifest(join(root, '.firetree'), manifest);
    assert.equal(bad.valid, false);
    assert.ok(bad.gaps.some((gap) => /hash mismatch/.test(gap)));

    const manifestText = await readFile(join(root, '.firetree', 'bundle-manifest.json'), 'utf8').catch(() => null);
    assert.equal(manifestText, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
