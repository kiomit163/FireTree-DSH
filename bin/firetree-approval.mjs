#!/usr/bin/env node
/** Normalize a GitHub PR review (fetched by CI) into a FireTree approval record. */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { readFiretreeJson } from '../src/lib/artifacts.js';
import { approvalFromGithubReview, parseApproval } from '../src/lib/approval.js';

function usage() {
  return [
    'Usage: firetree-approval --input <github-review.json> --head <sha> [--change <id>] [--assessment <path>] [--root <dir>] [--out <file>]',
    '',
    'The input is the GitHub review object returned by the pulls reviews API:',
    '  { "id": 1, "user": { "login": "alice" }, "state": "APPROVED",',
    '    "commit_id": "<sha>", "submitted_at": "2026-11-18T00:00:00Z", "html_url": "..." }',
    '',
    'The approval is bound to the assessment digest and, when the assessment has',
    'git identity, to its diff digest. This is required for firetree-check to',
    'accept the approval on a normally assessed change.',
    '',
    'Exit codes: 0 = approval written, 1 = invalid review, 2 = usage error.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (key === '--input' || key === '--head' || key === '--change' || key === '--assessment' || key === '--root' || key === '--out') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (typeof args.input !== 'string' || args.input.length === 0) throw new Error('--input is required');
  if (typeof args.head !== 'string' || !/^[a-f0-9]{7,64}$/.test(args.head)) throw new Error('--head must be a commit SHA');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const root = resolve(args.root ?? process.cwd());
  const assessmentPath = args.assessment
    ?? (args.change === undefined ? undefined : `.firetree/changes/${args.change}/assessment.json`);
  if (assessmentPath === undefined) throw new Error('--assessment or --change is required to bind the approval');
  let assessmentSha256;
  let diffSha256;
  if (assessmentPath !== undefined) {
    const assessment = await readFiretreeJson(root, assessmentPath, { verifyHash: true, missing: 'null' });
    if (assessment === null) throw new Error('assessment is missing; run firetree_assess first');
    if (assessment.value.change?.head !== args.head.toLowerCase()) {
      throw new Error('approval head does not match the assessment head');
    }
    if (args.change !== undefined && assessment.value.change?.id !== args.change) {
      throw new Error('approval change id does not match the assessment change id');
    }
    assessmentSha256 = assessment.sha256;
    diffSha256 = assessment.value.git?.diff_sha256;
  }
  const review = JSON.parse(await readFile(resolve(args.input), 'utf8'));
  const approval = parseApproval(approvalFromGithubReview(review, {
    head: args.head,
    change: args.change,
    ...(assessmentSha256 === undefined ? {} : { assessmentSha256 }),
    ...(diffSha256 === undefined ? {} : { diffSha256 }),
  }));
  const text = `${JSON.stringify(approval, null, 2)}\n`;
  if (args.out === undefined) process.stdout.write(text);
  else {
    await writeFile(resolve(args.out), text, 'utf8');
    console.log(`approval written: ${args.out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
});
