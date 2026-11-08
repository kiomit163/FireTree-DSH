#!/usr/bin/env node
/** CI gate for a FireTree change: check autonomous technical evidence or a governed receipt. */

import { resolve } from 'node:path';

import { createReceiptTool } from '../src/tools/receipt.js';

function usage() {
  return [
    'Usage: firetree-check --change <id> --mode <governed|autonomous> [--root <dir>]',
    '',
    'Exit codes: 0 = check passed, 1 = evidence gaps, 2 = usage/runtime error.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { root: process.cwd(), mode: 'governed' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (key === '--change' || key === '--mode' || key === '--root') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (typeof args.change !== 'string' || args.change.length === 0) throw new Error('--change is required');
  if (args.mode !== 'governed' && args.mode !== 'autonomous') throw new Error('--mode must be governed or autonomous');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const root = resolve(args.root);
  const tool = createReceiptTool({ workingDirectory: { async ensure() { return root; } } });
  const result = await tool.execute({
    action: 'check',
    mode: args.mode,
    change: args.change,
  }, { agent: { id: 'ci' }, signal: new AbortController().signal });
  const output = {
    ok: result.ok,
    mode: args.mode,
    change: args.change,
    gaps: result.gaps ?? [],
    render: result.render,
  };
  console.log(JSON.stringify(output));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 2;
});
