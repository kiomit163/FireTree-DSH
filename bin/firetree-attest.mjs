#!/usr/bin/env node
/** Verify a GitHub artifact attestation bundle against an artifact. */

import { resolve } from 'node:path';

import { verifyGithubAttestation } from '../src/lib/attestation.js';

function usage() {
  return [
    'Usage: firetree-attest --artifact <file> --bundle <file> --repo <owner/repo> [options]',
    '',
    'Options:',
    '  --signer-workflow <ref>  Expected signer workflow identity',
    '  --source-digest <sha>    Expected source digest',
    '  --gh <path>              GitHub CLI path (default: gh)',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  const values = new Set(['--artifact', '--bundle', '--repo', '--signer-workflow', '--source-digest', '--gh']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['artifact', 'bundle', 'repo']) {
    if (typeof args[required] !== 'string' || args[required].length === 0) throw new Error(`--${required} is required`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await verifyGithubAttestation({
    artifact: resolve(args.artifact),
    bundle: resolve(args.bundle),
    repository: args.repo,
    ...(args['signer-workflow'] === undefined ? {} : { signerWorkflow: args['signer-workflow'] }),
    ...(args['source-digest'] === undefined ? {} : { sourceDigest: args['source-digest'] }),
    ...(args.gh === undefined ? {} : { ghPath: args.gh }),
  });
  console.log(JSON.stringify({ ...result, repository: args.repo }));
  process.exitCode = result.valid ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
});
