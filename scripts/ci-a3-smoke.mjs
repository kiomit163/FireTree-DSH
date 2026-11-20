#!/usr/bin/env node
/** Build an isolated A3 smoke workspace: assessment, technical evidence, JUnit, and bundle manifest. */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { readFiretreeJson, sha256Text } from '../src/lib/artifacts.js';
import { buildBundleManifest } from '../src/lib/bundle.js';
import { createAssessTool } from '../src/tools/assess.js';
import { createReceiptTool } from '../src/tools/receipt.js';
import { createM1Workspace } from '../test-support/m1-workspace.mjs';

const EXEC = { agent: { id: 'ci-a3' }, signal: new AbortController().signal };

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--workspace' || key === '--claims' || key === '--junit') {
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
  if (typeof args.workspace !== 'string' || args.workspace.length === 0) throw new Error('--workspace is required');
  if (typeof args.claims !== 'string' || args.claims.length === 0) throw new Error('--claims is required');
  if (typeof args.junit !== 'string' || args.junit.length === 0) throw new Error('--junit is required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/ci-a3-smoke.mjs --workspace <dir> --claims <file> --junit <file>');
    return;
  }
  const workspace = resolve(args.workspace);
  await rm(workspace, { recursive: true, force: true });
  const fixture = await createM1Workspace({ root: workspace });
  const claims = JSON.parse(await readFile(resolve(args.claims), 'utf8'));
  const policyPath = join(fixture.root, '.firetree', 'policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  policy.tiers.L0.sample_rate = 0;
  await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  const docsRegistry = await readFiretreeJson(fixture.root, '.firetree/subsystems/docs.json', { verifyHash: false });

  const ctx = { workingDirectory: { async ensure() { return fixture.root; } } };
  await createAssessTool(ctx).execute({
    base: '0'.repeat(40),
    head: claims.sha,
    files: ['docs/README.md'],
    change: 'ci-a3',
  }, EXEC);

  await mkdir(join(fixture.root, 'evidence'), { recursive: true });
  await cp(resolve(args.junit), join(fixture.root, 'evidence', 'ci-junit.xml'));

  const receipt = createReceiptTool(ctx);
  const built = await receipt.execute({
    action: 'build',
    mode: 'autonomous',
    change: 'ci-a3',
    intent: { spec: 'PR A3 smoke', sha256: sha256Text('docs/README.md') },
    classification: {
      subsystem: 'docs',
      kind: docsRegistry.value.dossier.kind,
      method: docsRegistry.value.dossier.method,
      dossier_sha256: docsRegistry.value.dossier.sha256,
    },
    evidence: [{
      kind: 'test',
      producer: 'ci:github-actions',
      run_ref: 'evidence/ci-junit.xml',
      produced_at: new Date().toISOString(),
    }],
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    assurance: 'A2',
  }, EXEC);
  if (!built.ok) throw new Error(`A3 smoke technical evidence failed: ${built.gaps.join('; ')}`);

  const manifest = await buildBundleManifest(fixture.root);
  await writeFile(join(fixture.root, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    workspace: fixture.root,
    change: 'ci-a3',
    bundle_manifest: join(fixture.root, 'bundle-manifest.json'),
    bundle_digest: manifest.digest,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
