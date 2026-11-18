#!/usr/bin/env node
/** Syntax-check every JavaScript/ES module in the repository with `node --check`. */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SKIP_DIRECTORIES = new Set(['.git', '.tmp', 'node_modules']);
const EXTENSIONS = new Set(['.js', '.mjs']);

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

/**
 * @param {string} [root] - Repository root.
 * @returns {{checked: number, failures: Array<{file: string, message: string}>}} Result.
 */
export function checkSyntax(root = ROOT) {
  const files = walk(root).sort();
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push({
        file: relative(root, file).replaceAll('\\', '/'),
        message: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
      });
    }
  }
  return { checked: files.length, failures };
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = checkSyntax();
  console.log(`checked=${result.checked} failed=${result.failures.length}`);
  for (const failure of result.failures) {
    console.error(`FAIL ${failure.file}`);
    if (failure.message.length > 0) console.error(failure.message);
  }
  if (result.failures.length > 0) process.exitCode = 1;
}
