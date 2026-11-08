/** Compare FireTree's OWNERS resolver with Prow's official Approvers probe. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadOwners } from '../src/lib/owners.js';

const FILES = [
  'base/test.md',
  'leaf/test.md',
  'leaf-filter/test.md',
  'leaf-filter/test.dat',
  'no-parent/test.go',
  'no-parent-filter/test.txt',
  'no-parent-filter/test.go_to_parent',
  'aliases/test.go',
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--official' || key === '--root') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (!args.official || !args.root) throw new Error('usage: node scripts/compare-prow-owners.mjs --root <fixture> --official <json>');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const official = JSON.parse(await readFile(resolve(args.official), 'utf8'));
  const owners = await loadOwners(resolve(args.root));
  if (owners === null) throw new Error('FireTree could not load OWNERS from fixture');

  const failures = [];
  const normalize = (owner) => (owner.startsWith('@') ? owner.slice(1) : owner);
  for (const file of FILES) {
    const expected = [...(official[file] ?? [])].map(normalize).sort();
    const actual = owners.resolve(file).owners.map(normalize);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      failures.push({ file, expected, actual });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`MISMATCH ${failure.file}`);
      console.error(`  Prow:     ${failure.expected.join(', ')}`);
      console.error(`  FireTree: ${failure.actual.join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`prow_owners_parity: ${FILES.length}/${FILES.length} cases match`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
