#!/usr/bin/env node
/** CI gate for a FireTree change: check technical evidence or a governed receipt, then verify provenance. */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { atLeast, deriveAssurance } from '../src/lib/assurance.js';
import { verifyBundleManifest } from '../src/lib/bundle.js';
import { IdentityError, parseOidcClaims, verifyClaims } from '../src/lib/identity.js';
import { createReceiptTool } from '../src/tools/receipt.js';

function usage() {
  return [
    'Usage: firetree-check --change <id> --mode <governed|autonomous> [options]',
    '',
    'Options:',
    '  --root <dir>             Repository root (default: cwd)',
    '  --claims <file>          GitHub Actions OIDC claims JSON (enables A2)',
    '  --bundle <dir>           Evidence bundle directory with bundle-manifest.json',
    '  --require <A1|A2|A3>     Minimum derived assurance (default: receipt value)',
    '  --repository <owner/repo> Expected repository for claims',
    '  --issuer <url>           Expected OIDC issuer',
    '  --audience <value>       Expected OIDC audience',
    '',
    'Exit codes: 0 = check passed, 1 = evidence/assurance gaps, 2 = usage/runtime error.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { root: process.cwd(), mode: 'governed' };
  const values = new Set(['--change', '--mode', '--root', '--claims', '--bundle', '--require', '--repository', '--issuer', '--audience']);
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
  if (args.mode !== 'governed' && args.mode !== 'autonomous') throw new Error('--mode must be governed or autonomous');
  if (args.require !== undefined && !['A1', 'A2', 'A3'].includes(args.require)) {
    throw new Error('--require must be A1, A2, or A3');
  }
  return args;
}

async function readClaims(file) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  return parseOidcClaims(value);
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

  const gaps = [...(result.gaps ?? [])];
  let derived = null;
  let claims = null;
  let claimsValid = false;

  if (result.ok) {
    const record = args.mode === 'governed' ? result.receipt : result.technical_evidence;
    const head = record?.change?.head;
    if (args.claims !== undefined) {
      try {
        claims = await readClaims(resolve(root, args.claims));
        const verification = verifyClaims(claims, {
          ...(args.issuer === undefined ? {} : { issuer: args.issuer }),
          ...(args.audience === undefined ? {} : { audience: args.audience }),
          ...(args.repository === undefined ? {} : { repository: args.repository }),
          ...(typeof head === 'string' ? { sha: head } : {}),
        });
        claimsValid = verification.valid;
        gaps.push(...verification.failures);
      } catch (error) {
        const message = error instanceof IdentityError || error instanceof Error ? error.message : String(error);
        gaps.push(`claims are invalid: ${message}`);
      }
    }

    derived = deriveAssurance({
      claimsValid,
      claims,
      evidence: record?.evidence ?? [],
      approval: null,
      signed: false,
    });

    const claimed = record?.assurance;
    if (claimed !== undefined && !atLeast(derived.level, claimed)) {
      gaps.push(`claimed assurance ${claimed} exceeds derived assurance ${derived.level}`);
    }

    if (args.require !== undefined && !atLeast(derived.level, args.require)) {
      gaps.push(`required assurance ${args.require} but derived ${derived.level}`);
    }
    if (args.require === 'A3') {
      gaps.push('A3 verification is not implemented in v0.1 (requires signed approval bundle)');
    }

    if (args.bundle !== undefined) {
      const bundleRoot = resolve(root, args.bundle);
      try {
        const manifest = JSON.parse(await readFile(join(bundleRoot, 'bundle-manifest.json'), 'utf8'));
        const bundleCheck = await verifyBundleManifest(bundleRoot, manifest);
        gaps.push(...bundleCheck.gaps);
      } catch (error) {
        gaps.push(`bundle manifest is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const output = {
    ok: gaps.length === 0,
    mode: args.mode,
    change: args.change,
    gaps,
    ...(derived === null ? {} : { assurance: derived.level, assurance_reasons: derived.reasons }),
  };
  console.log(JSON.stringify(output));
  process.exitCode = output.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exitCode = 2;
});
