#!/usr/bin/env node
/** Propose subsystem registry groups from a repo tree; never writes fake registry entries. */

import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { loadCodeowners, resolveCodeowners } from '../src/lib/codeowners.js';
import { loadOwners } from '../src/lib/owners.js';

function parseArgs(argv) {
  const args = { root: process.cwd(), depth: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--root' || key === '--out' || key === '--depth') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else if (key === '--help' || key === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  return args;
}

const SKIP = new Set(['.git', '.tmp', '.firetree', 'node_modules']);

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'root';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/bootstrap-registry.mjs --root <repo> [--depth 2] [--out file]');
    return;
  }
  const root = resolve(args.root);
  const depth = Math.max(1, Math.min(4, Number.parseInt(String(args.depth), 10) || 2));
  const files = await walk(root);
  const codeowners = await loadCodeowners(root);
  const ownersResolver = codeowners ?? await loadOwners(root);
  const groups = new Map();
  for (const file of files) {
    const relativePath = relative(root, file).replaceAll('\\', '/');
    const parts = relativePath.split('/');
    const prefix = parts.slice(0, Math.min(depth, Math.max(0, parts.length - 1))).join('/') || 'repo-root';
    const group = groups.get(prefix) ?? { id: slug(prefix), paths: [`${prefix === 'repo-root' ? '' : `${prefix}/`}**`], files: 0, owners: new Set(), samples: [] };
    group.files += 1;
    if (group.samples.length < 3) group.samples.push(relativePath);
    if (codeowners !== null) {
      for (const owner of resolveCodeowners(relativePath, codeowners).owners) group.owners.add(owner);
    } else if (ownersResolver) {
      for (const owner of ownersResolver.resolve(relativePath).owners) group.owners.add(owner);
    }
    groups.set(prefix, group);
  }
  const report = {
    schema: 'firetree.bootstrap/v1',
    generated_at: new Date().toISOString(),
    root,
    depth,
    groups: [...groups.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((group) => ({
        id: group.id,
        paths: group.paths,
        files: group.files,
        owners: [...group.owners].sort(),
        samples: group.samples,
      })),
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out === undefined) process.stdout.write(text);
  else {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(resolve(root, args.out), text, 'utf8');
    console.log(`groups=${report.groups.length} out=${args.out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
