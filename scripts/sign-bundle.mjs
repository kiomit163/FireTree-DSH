#!/usr/bin/env node`n// Tested by test/sign-bundle.test.mjs.
/** Sign a bundle manifest digest with the trusted Ed25519 key. */

import { createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = { bundle: '.firetree', out: '.firetree/bundle-signature.json' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!['--bundle', '--out'].includes(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: sign-bundle [--bundle .firetree] [--out .firetree/bundle-signature.json]');
    return;
  }
  const privatePem = process.env.FIRE_TREE_BUNDLE_SIGNING_KEY;
  if (typeof privatePem !== 'string' || privatePem.length === 0) throw new Error('FIRE_TREE_BUNDLE_SIGNING_KEY is not configured');
  const manifestPath = resolve(args.bundle, 'bundle-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (typeof manifest.digest !== 'string') throw new Error('bundle manifest has no digest');
  const signature = sign(null, Buffer.from(manifest.digest, 'utf8'), createPrivateKey(privatePem)).toString('base64');
  const artifact = {
    schema: 'firetree.signature/v1',
    algorithm: 'ed25519',
    digest: manifest.digest,
    signature,
  };
  await writeFile(resolve(args.out), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`bundle signature written: ${args.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
