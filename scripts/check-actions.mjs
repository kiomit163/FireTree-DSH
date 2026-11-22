import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = '.github/workflows';
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => join(directory, name));
const action = /uses:\s*['"]?([^\s@'",}]+)@([^\s#'",}]+)['"]?/g;
let failed = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(action)) {
    const [raw, name, ref] = match;
    if (name.startsWith('./')) continue;
    if (name.startsWith('docker://')) {
      if (!/^docker:\/\/[^@\s]+@sha256:[a-f0-9]{64}$/.test(raw.replace(/^uses:\s*['"]?/, '').replace(/['"]?$/, ''))) {
        console.error(`${file}: docker action is not pinned by sha256 digest (${name}@${ref})`);
        failed += 1;
      }
      continue;
    }
    if (!/^[a-f0-9]{40}$/.test(ref)) {
      console.error(`${file}: action ${name} is not pinned to a 40-character commit SHA (${ref})`);
      failed += 1;
    }
  }
}
if (failed > 0) process.exitCode = 1;
else console.log(`actions pinned: ${files.length} workflow files`);
