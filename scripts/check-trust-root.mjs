#!/usr/bin/env node
/** Verify the technical evidence trust-root anchor against the base checkout. */

import { resolve } from 'node:path';

import { readFiretreeJson } from '../src/lib/artifacts.js';
import { computeTrustRoot } from '../src/lib/trust-root.js';

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key !== '--root' && key !== '--change') throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  if (typeof args.change !== 'string' || args.change.length === 0) throw new Error('--change is required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const record = await readFiretreeJson(root, `.firetree/evidence/${args.change}.trust-anchor.json`, { verifyHash: true, missing: 'null' });
  if (record === null) throw new Error(`trust anchor is missing for ${args.change}`);
  const actual = await computeTrustRoot(root);
  const anchor = record.value;
  if (anchor.schema !== 'firetree.trust-root/v1') throw new Error('trust anchor schema is invalid');
  if (anchor.change !== args.change) throw new Error('trust anchor change does not match');
  if (anchor.policy_sha256 !== actual.policy_sha256) throw new Error('policy digest does not match trust anchor');
  if (anchor.registry_sha256 !== actual.registry_sha256) throw new Error('registry digest does not match trust anchor');
  if (anchor.combined !== actual.combined) throw new Error('combined trust-root digest does not match anchor');
  console.log(`trust root verified: ${actual.combined}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
