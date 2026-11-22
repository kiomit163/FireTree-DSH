import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = '.github/workflows';
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => join(directory, name));
const action = /^\s*(?:-\s*)?uses:\s*['"]?([^\s@'"]+)@([^\s#'"]+)['"]?/;
let failed = 0;
for (const file of files) {
  for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const match = line.match(action);
    if (!match) continue;
    const [, name, ref] = match;
    if (name.startsWith('./') || name.startsWith('docker://')) continue;
    if (!/^[a-f0-9]{40}$/.test(ref)) {
      console.error(`${file}:${index + 1}: action ${name} is not pinned to a 40-character commit SHA (${ref})`);
      failed += 1;
    }
  }
}
if (failed > 0) process.exitCode = 1;
else console.log(`actions pinned: ${files.length} workflow files`);
