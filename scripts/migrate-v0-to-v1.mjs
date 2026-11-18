#!/usr/bin/env node
/** Migrate v0 FireTree artifacts to v1 where safe; report manual steps otherwise. */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { writeFiretreeJson } from '../src/lib/artifacts.js';
import { policyDigest } from '../src/lib/policy.js';

function parseArgs(argv) {
  const args = { root: process.cwd(), apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--apply') {
      args.apply = true;
    } else if (key === '--root' || key === '--out') {
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

async function walk(directory, files = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.sha256')) files.push(path);
  }
  return files;
}

function modeForTier(tier) {
  return tier === 'L0' ? 'light' : tier === 'L1' ? 'standard' : 'full';
}

async function migrateValue(root, file, value) {
  const blocked = [];
  const changed = [];
  const relativePath = relative(root, file).replaceAll('\\', '/');
  if (typeof value.schema !== 'string' || !/\/v0$/.test(value.schema)) return null;

  value.schema = value.schema.replace(/\/v0$/, '/v1');
  changed.push('schema');

  if (/^firetree\.receipt\//.test(value.schema) || value.schema === 'firetree.receipt/v1') {
    value.impact ??= {};
    for (const key of ['unknown', 'unresolved_consumers', 'reasons']) {
      if (!Array.isArray(value.impact[key])) {
        value.impact[key] = [];
        changed.push(`impact.${key}`);
      }
    }
    if (value.review && typeof value.review === 'object') {
      if (value.review.mode === undefined) {
        value.review.mode = modeForTier(value.tier);
        changed.push('review.mode');
      }
      if (value.review.assessment_sha256 === undefined || value.review.package_sha256 === undefined) {
        blocked.push('receipt review is missing assessment_sha256/package_sha256; re-run review and receipt');
      }
      if (value.tier === 'L0' && value.policy?.sampling === 'sampled' && value.review.human_spot_check === undefined) {
        blocked.push('sampled L0 receipt is missing human_spot_check');
      }
    }
  }

  if (value.schema === 'firetree.assessment/v1') {
    if (!Number.isInteger(value.revision)) {
      value.revision = 1;
      changed.push('revision');
    }
  }

  if (value.schema.includes('review-package/') || value.schema.includes('review-verdict/')) {
    if (value.mode === undefined) {
      value.mode = modeForTier(value.tier);
      changed.push('mode');
    }
    if (value.assessment_sha256 === undefined || (value.schema.includes('verdict') && value.package_sha256 === undefined)) {
      blocked.push('review artifact is missing assessment/package hashes; re-run review');
    }
  }

  if (value.schema === 'firetree.policy/v1') {
    value.version = policyDigest(value);
    changed.push('version');
  }

  if (argsApplyFlag && blocked.length === 0) {
    await writeFiretreeJson(root, relativePath, value);
  }

  return { path: relativePath, schema: value.schema, changed, blocked };
}

let argsApplyFlag = false;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  argsApplyFlag = args.apply === true;
  if (args.help) {
    console.log('Usage: node scripts/migrate-v0-to-v1.mjs --root <repo> [--apply] [--out <json>]');
    return;
  }
  const root = resolve(args.root);
  const files = await walk(join(root, '.firetree'));
  const results = [];
  for (const file of files) {
    let value;
    try {
      value = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    const result = await migrateValue(root, file, value);
    if (result !== null) results.push(result);
  }
  const summary = {
    schema: 'firetree.migration-report/v1',
    apply: args.apply === true,
    files: results.length,
    migrated: results.filter((item) => item.blocked.length === 0).length,
    blocked: results.filter((item) => item.blocked.length > 0).length,
    results,
  };
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (args.out === undefined) process.stdout.write(text);
  else {
    await import('node:fs/promises').then(({ writeFile }) => writeFile(resolve(root, args.out), text, 'utf8'));
    console.log(`files=${summary.files} migrated=${summary.migrated} blocked=${summary.blocked} out=${args.out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
