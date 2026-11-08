/** Validate cached pilot JUnit XML files without network access. */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { validateJunitXml } from '../src/lib/junit.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root' || argv[index] === '--out') {
      args[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argv[index]}`);
    }
  }
  if (!args.root) throw new Error('usage: --root <repo> [--out <json>]');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const dir = join(root, '.firetree', 'pilot-ci');
  const files = (await readdir(dir)).filter((file) => file.endsWith('-junit.xml')).sort();
  const results = [];
  let valid = 0;
  for (const file of files) {
    const result = validateJunitXml(await readFile(join(dir, file), 'utf8'));
    if (result.valid) valid += 1;
    results.push({ file, valid: result.valid, gaps: result.gaps, totals: result.totals });
  }
  const summary = {
    schema: 'firetree.junit-validation/v0',
    root,
    generated_at: new Date().toISOString(),
    files: files.length,
    valid,
    invalid: files.length - valid,
    results,
  };
  const out = resolve(args.out ?? join(root, '.firetree', 'junit-validation.json'));
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`junit_files=${summary.files} valid=${summary.valid} invalid=${summary.invalid} out=${out}`);
  if (summary.invalid > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
