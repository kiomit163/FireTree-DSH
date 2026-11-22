#!/usr/bin/env node
/** Build autonomous technical evidence from an existing assessment and CI evidence. */

import { access, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { readFiretreeJson, resolveWithin, sha256Text } from '../src/lib/artifacts.js';
import { createReceiptTool } from '../src/tools/receipt.js';

function usage() {
  return [
    'Usage: firetree-ci --change <id> --evidence <path> [options]',
    '',
    'Options:',
    '  --root <dir>              Repository root (default: cwd)',
    '  --registry-root <dir>     Trusted root containing .firetree policy/registry',
    '  --intent-spec <text>      Intent description (default: change id)',
    '  --producer <id>           Evidence producer (default: ci:github-actions)',
    '  --expires-at <date-time>  Evidence expiry (default: now + 30 days)',
    '  --assurance <A1|A2>       Declared technical assurance (default: A2)',
    '  --ai-review <path>        Adversarial AI review artifact (validated by check)',
    '',
    'L2 changes may require an adversarial AI review when the check requires A3-AI-S/A3-AI.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { root: process.cwd(), producer: 'ci:github-actions', assurance: 'A2' };
  const values = new Set(['--root', '--registry-root', '--change', '--evidence', '--intent-spec', '--producer', '--expires-at', '--assurance', '--ai-review']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!values.has(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} requires a value`);
    args[key.slice(2)] = value;
    index += 1;
  }
  if (typeof args.change !== 'string' || args.change.length === 0) throw new Error('--change is required');
  if (typeof args.evidence !== 'string' || args.evidence.length === 0) throw new Error('--evidence is required');
  if (!['A1', 'A2'].includes(args.assurance)) throw new Error('--assurance must be A1 or A2');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const root = resolve(args.root);
  const assessment = await readFiretreeJson(root, `.firetree/changes/${args.change}/assessment.json`, { verifyHash: true });
  if (assessment === null) throw new Error('assessment is missing; run firetree-assess first');
  if (typeof args['ai-review'] === 'string') {
    try {
      await access(resolve(root, args['ai-review']));
    } catch {
      throw new Error(`AI review artifact is missing: ${args['ai-review']}`);
    }
  }
  const impact = assessment.value.impact;
  const subsystemId = impact.subsystems?.[0];
  if (typeof subsystemId !== 'string' || subsystemId.length === 0) {
    throw new Error('cannot classify technical evidence: assessment has no subsystem');
  }
  let registryRoot = root;
  if (args['registry-root'] !== undefined) {
    try {
      const candidate = resolveWithin(root, args['registry-root']);
      const realRoot = await realpath(root);
      const realRegistry = await realpath(candidate);
      const relativeRegistry = relative(realRoot, realRegistry);
      if (relativeRegistry.startsWith('..') || isAbsolute(relativeRegistry)) throw new Error('escape');
      registryRoot = realRegistry;
    } catch {
      throw new Error('--registry-root must stay inside the repository root');
    }
  }
  const subsystem = await readFiretreeJson(registryRoot, `.firetree/subsystems/${subsystemId}.json`, { verifyHash: false });
  if (subsystem === null) throw new Error(`subsystem registry entry is missing: ${subsystemId}`);
  const dossier = subsystem.value.dossier;

  const intentSha = assessment.value.git?.diff_sha256
    ?? sha256Text((assessment.value.change?.files ?? []).join('\n'));
  const expiresAt = args['expires-at'] ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    throw new Error('--expires-at must be a future date-time');
  }

  const tool = createReceiptTool({ workingDirectory: { async ensure() { return root; } } });
  const result = await tool.execute({
    action: 'build',
    mode: 'autonomous',
    change: args.change,
    intent: { spec: args['intent-spec'] ?? args.change, sha256: intentSha },
    classification: {
      subsystem: subsystemId,
      kind: dossier.kind,
      method: dossier.method,
      dossier_sha256: dossier.sha256,
    },
    evidence: [{
      kind: 'test',
      producer: args.producer,
      run_ref: args.evidence,
      produced_at: new Date().toISOString(),
    }],
    expires_at: expiresAt,
    assurance: args.assurance,
    ...(args['ai-review'] === undefined ? {} : { ai_review: args['ai-review'] }),
  }, { agent: { id: 'ci' }, signal: new AbortController().signal });
  if (!result.ok) {
    console.error(`technical evidence failed: ${result.gaps.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    change: args.change,
    tier: result.technical_evidence.tier,
    assurance: result.technical_evidence.assurance,
    artifact: result.artifact,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 1;
});
