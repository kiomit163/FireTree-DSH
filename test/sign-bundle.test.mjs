import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { parseSignature, verifySignature } from '../src/lib/signature.js';

const run = promisify(execFile);

test('sign-bundle signs the manifest digest with Ed25519', async () => {
  const root = await mkdtemp(join(tmpdir(), 'firetree-sign-'));
  const bundle = join(root, '.firetree');
  try {
    await mkdir(bundle, { recursive: true });
    const digest = 'a'.repeat(64);
    await writeFile(join(bundle, 'bundle-manifest.json'), `${JSON.stringify({ schema: 'firetree.bundle/v1', digest })}\n`, 'utf8');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
    const signaturePath = join(root, 'bundle-signature.json');
    await run(process.execPath, [
      'scripts/sign-bundle.mjs',
      '--bundle', bundle,
      '--out', signaturePath,
    ], { cwd: process.cwd(), env: { ...process.env, FIRE_TREE_BUNDLE_SIGNING_KEY: privatePem }, encoding: 'utf8' });
    const signature = parseSignature(JSON.parse(await readFile(signaturePath, 'utf8')));
    assert.equal(signature.digest, digest);
    assert.equal(verifySignature(signature, digest, publicPem).valid, true);
    assert.equal(verifySignature(signature, 'b'.repeat(64), publicPem).valid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
