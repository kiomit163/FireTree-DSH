#!/usr/bin/env node
/** CI smoke for OIDC A2: build an isolated fixture, then invoke the real firetree-check gate. */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createAssessTool } from '../src/tools/assess.js';
import { createReceiptTool } from '../src/tools/receipt.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const HASH = 'a'.repeat(64);
const EXEC = { agent: { id: 'ci-a2' }, signal: new AbortController().signal };

function parseArgs(argv) {
  const args = { audience: 'firetree' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--claims' || key === '--jwt' || key === '--audience') {
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
  if (typeof args.claims !== 'string' || args.claims.length === 0) throw new Error('--claims is required');
  if (typeof args.jwt !== 'string' || args.jwt.length === 0) throw new Error('--jwt is required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/ci-a2-smoke.mjs --claims claims.json --jwt oidc.jwt [--audience firetree]');
    return;
  }
  const claimsPath = resolve(args.claims);
  const claims = JSON.parse(await readFile(claimsPath, 'utf8'));
  if (typeof claims.repository !== 'string' || typeof claims.sha !== 'string') {
    throw new Error('claims must contain repository and sha');
  }

  const workspace = await createM1Workspace({ parent: process.env.RUNNER_TEMP });
  try {
    const ctx = { workingDirectory: { async ensure() { return workspace.root; } } };
    const policyPath = join(workspace.root, '.firetree', 'policy.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    policy.tiers.L0.sample_rate = 0;
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');

    const assess = createAssessTool(ctx);
    await assess.execute({
      base: '0'.repeat(40),
      head: claims.sha,
      files: ['docs/README.md'],
      change: 'ci-a2',
    }, EXEC);

    await mkdir(join(workspace.root, 'evidence'), { recursive: true });
    await writeFile(join(workspace.root, 'evidence', 'junit.xml'), '<testsuite tests="1" failures="0"><testcase name="ci-a2"/></testsuite>\n', 'utf8');

    const receipt = createReceiptTool(ctx);
    const built = await receipt.execute({
      action: 'build',
      mode: 'autonomous',
      change: 'ci-a2',
      intent: { spec: 'docs/README.md', sha256: HASH },
      classification: { subsystem: 'docs', kind: 'simple', method: 'decompose', dossier_sha256: HASH },
      evidence: [{
        kind: 'test',
        producer: 'ci:github-actions',
        run_ref: 'evidence/junit.xml',
        produced_at: new Date().toISOString(),
      }],
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      assurance: 'A2',
    }, EXEC);
    if (!built.ok) throw new Error(`fixture technical evidence failed: ${built.gaps.join('; ')}`);

    const check = join(process.cwd(), 'bin', 'firetree-check.mjs');
    let stdout;
    try {
      stdout = execFileSync(process.execPath, [
        check,
        '--root', workspace.root,
        '--mode', 'autonomous',
        '--change', 'ci-a2',
        '--jwt', resolve(args.jwt),
        '--repository', claims.repository,
        '--audience', args.audience,
        '--require', 'A2',
      ], { encoding: 'utf8' });
    } catch (error) {
      const out = typeof error.stdout === 'string' ? error.stdout : error.stdout?.toString('utf8') ?? '';
      const err = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString('utf8') ?? '';
      throw new Error(`firetree-check failed: ${error.message}\nstdout: ${out}\nstderr: ${err}`);
    }
    console.log(stdout.trim());
  } finally {
    await workspace.cleanup();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(`::error::${message.replaceAll('\n', '%0A')}`);
  process.exitCode = 1;
});
