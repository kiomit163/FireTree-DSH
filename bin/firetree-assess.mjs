#!/usr/bin/env node
/** CLI wrapper for firetree_assess: compute the git diff and write an assessment. */

import { resolve } from 'node:path';

import { changedFiles, resolveCommit } from '../src/lib/git.js';
import { createAssessTool } from '../src/tools/assess.js';

function usage() {
  return [
    'Usage: firetree-assess --base <ref> --head <ref> --change <id> [options]',
    '',
    'Options:',
    '  --root <dir>              Repository root (default: cwd)',
    '  --verify-git              Require the file set to match git diff (default)',
    '  --no-verify-git           Use --files without checking git',
    '  --files <a,b>             Explicit file list (required with --no-verify-git)',
    '  --declared-tier <L0|L1|L2>',
    '  --policy <path>           Repo-relative policy path',
    '',
    'Exit codes: 0 = assessed, 1 = assessment failed, 2 = usage/runtime error.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { root: process.cwd(), verifyGit: true };
  const values = new Set(['--root', '--base', '--head', '--change', '--files', '--declared-tier', '--policy']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (key === '--verify-git') {
      args.verifyGit = true;
      continue;
    }
    if (key === '--no-verify-git') {
      args.verifyGit = false;
      continue;
    }
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  if (typeof args.base !== 'string' || args.base.length === 0) throw new Error('--base is required');
  if (typeof args.head !== 'string' || args.head.length === 0) throw new Error('--head is required');
  if (typeof args.change !== 'string' || args.change.length === 0) throw new Error('--change is required');
  if (args.verifyGit === false && typeof args.files !== 'string') throw new Error('--files is required without --verify-git');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const root = resolve(args.root);
  const base = resolveCommit(root, args.base);
  const head = resolveCommit(root, args.head);
  let files;
  if (args.verifyGit !== false) {
    files = changedFiles(root, base, head);
  } else {
    files = args.files.split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (files.length === 0) throw new Error('no changed files found');

  const tool = createAssessTool({ workingDirectory: { async ensure() { return root; } } });
  const output = await tool.execute({
    base,
    head,
    files,
    change: args.change,
    verify_git: args.verifyGit !== false,
    ...(args['declared-tier'] === undefined ? {} : { declared_tier: args['declared-tier'] }),
    ...(args.policy === undefined ? {} : { policy_path: args.policy }),
  }, { agent: { id: 'cli' }, signal: new AbortController().signal });

  console.log(JSON.stringify({
    ok: output.ok,
    change: output.change,
    tier: output.tier,
    auto_tier: output.auto_tier,
    required_artifacts: output.required_artifacts,
    sampling: output.sampling,
    impact: output.impact,
    artifact: output.artifact,
    ...(output.git === undefined ? {} : { git: output.git }),
    ...(output.revision === undefined ? {} : { revision: output.revision }),
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
});
