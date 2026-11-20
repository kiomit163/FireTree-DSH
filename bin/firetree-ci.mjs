#!/usr/bin/env node
/** Build autonomous technical evidence from an existing assessment and CI evidence. */

import { resolve } from 'node:path';

import { readFiretreeJson, sha256Text } from '../src/lib/artifacts.js';
import { createReceiptTool } from '../src/tools/receipt.js';

function usage() {
  return [
    'Usage: firetree-ci --change <id> --evidence <path> [options]',
    '',
    'Options:',
    '  --root <dir>              Repository root (default: cwd)',
    '  --intent-spec <text>      Intent description (default: change id)',
    '  --producer <id>           Evidence producer (default: ci:github-actions)',
    '  --expires-at <date-time>  Evidence expiry (default: now + 30 days)',
    '  --assurance <A1|A2>       Declared technical assurance (default: A2)',
    '',
    'L2 changes are rejected: they require a governed receipt with human sign-off.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { root: process.cwd(), producer: 'ci:github-actions', assurance: 'A2' };
  const values = new Set(['--root', '--change', '--evidence', '--intent-spec', '--producer', '--expires-at', '--assurance']);
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
  if (assessment.value.tier === 'L2') {
    throw new Error('L2 changes require a governed receipt with human sign-off; A2 CI cannot complete them');
  }
  const impact = assessment.value.impact;
  const subsystemId = impact.subsystems?.[0];
  if (typeof subsystemId !== 'string' || subsystemId.length === 0) {
    throw new Error('cannot classify technical evidence: assessment has no subsystem');
  }
  const subsystem = await readFiretreeJson(root, `.firetree/subsystems/${subsystemId}.json`, { verifyHash: false });
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
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(`::error::${message.replaceAll('\n', '%0A')}`);
  console.error(usage());
  process.exitCode = 1;
});
