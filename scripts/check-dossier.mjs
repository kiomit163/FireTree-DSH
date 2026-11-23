#!/usr/bin/env node
/** Fail CI when technical evidence does not match the subsystem dossier registry. */

import { resolve } from 'node:path';

import { readFiretreeJson } from '../src/lib/artifacts.js';

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--root' || key === '--change') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (typeof args.change !== 'string' || args.change.length === 0) throw new Error('--change is required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const evidence = await readFiretreeJson(root, `.firetree/evidence/${args.change}.json`, { verifyHash: true, missing: 'null' });
  if (evidence === null) throw new Error(`technical evidence is missing for ${args.change}`);
  const classification = evidence.value.classification;
  if (classification === undefined || classification === null) throw new Error('technical evidence has no classification');
  const record = await readFiretreeJson(root, `.firetree/subsystems/${classification.subsystem}.json`, { verifyHash: true, missing: 'null' });
  if (record === null) throw new Error(`subsystem registry entry is missing: ${classification.subsystem}`);
  const dossier = record.value.dossier;
  if (dossier === undefined || dossier === null) throw new Error(`subsystem ${classification.subsystem} has no dossier`);
  if (classification.dossier_sha256 !== dossier.sha256) throw new Error('technical evidence dossier hash does not match subsystem registry');
  if (classification.kind !== dossier.kind) throw new Error('technical evidence classification kind does not match dossier');
  if (classification.method !== dossier.method) throw new Error('technical evidence classification method does not match dossier');
  console.log(`dossier verified: ${classification.subsystem} ${dossier.kind}/${dossier.method}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
