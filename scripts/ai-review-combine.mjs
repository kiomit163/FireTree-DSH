#!/usr/bin/env node
/** Combine provider seat records into a firetree.ai-review/v1 artifact. */

import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { evaluateAiReview } from '../src/lib/ai-review.js';

function usage() {
  return [
    'Usage: ai-review-combine --seat <seat-a.json> --seat <seat-b.json> --change <id> --head <sha> --diff-sha256 <sha256> --author-provider <id> --author-model <id> --out <artifact.json>',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { seat: [] };
  const values = new Set(['--seat', '--change', '--head', '--diff-sha256', '--author-provider', '--author-model', '--out']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    if (key === '--seat') args.seat.push(value);
    else args[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['change', 'head', 'diff-sha256', 'author-provider', 'author-model', 'out']) {
    if (typeof args[required] !== 'string' || args[required].length === 0) throw new Error(`--${required} is required`);
  }
  if (args.seat.length < 2) throw new Error('at least two --seat files are required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const seats = [];
  for (const path of args.seat) seats.push(JSON.parse(await readFile(resolve(path), 'utf8')));
  const providers = new Set(seats.map((seat) => seat.provider));
  const mode = providers.size > 1 ? 'multi-provider' : 'single-provider';
  const artifact = {
    schema: 'firetree.ai-review/v1',
    change: {
      id: args.change,
      head: args.head.toLowerCase(),
      diff_sha256: args['diff-sha256'],
    },
    mode,
    author: { provider: args['author-provider'], model: args['author-model'] },
    seats,
    unresolved: 0,
    converged: true,
    created_at: new Date().toISOString(),
  };
  const check = evaluateAiReview(artifact, { diffSha256: args['diff-sha256'] });
  if (!check.valid) throw new Error(`combined artifact is invalid: ${check.gaps.join('; ')}`);
  const temporary = `${resolve(args.out)}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await rename(temporary, resolve(args.out));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  console.log(`review written: ${args.out} mode=${mode} seats=${seats.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
