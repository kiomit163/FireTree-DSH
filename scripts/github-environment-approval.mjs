#!/usr/bin/env node
/** Normalize a GitHub environment approval from a workflow run. */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { approvalFromEnvironment, parseApproval } from '../src/lib/approval.js';

function parseArgs(argv) {
  const args = { environment: 'firetree-a3', out: 'approval.json' };
  const values = new Set(['--repo', '--run-id', '--environment', '--head', '--change', '--assessment-sha256', '--diff-sha256', '--out']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['repo', 'run-id', 'head']) {
    if (typeof args[required] !== 'string' || args[required].length === 0) throw new Error(`--${required} is required`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/github-environment-approval.mjs --repo <owner/repo> --run-id <id> --head <sha> --environment <name> --out <file>');
    return;
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GH_TOKEN/GITHUB_TOKEN is required to read environment approvals');
  const response = await fetch(`https://api.github.com/repos/${args.repo}/actions/runs/${args['run-id']}/approvals`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`environment approvals API failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const approvals = await response.json();
  const approval = parseApproval(approvalFromEnvironment(approvals, {
    environment: args.environment,
    head: args.head,
    ...(args.change === undefined ? {} : { change: args.change }),
    ...(args['assessment-sha256'] === undefined ? {} : { assessmentSha256: args['assessment-sha256'] }),
    ...(args['diff-sha256'] === undefined ? {} : { diffSha256: args['diff-sha256'] }),
  }));
  const out = resolve(args.out);
  await writeFile(out, `${JSON.stringify(approval, null, 2)}\n`, 'utf8');
  console.log(`approval written: ${out} reviewer=${approval.reviewer}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
