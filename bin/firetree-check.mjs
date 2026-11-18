#!/usr/bin/env node
/** CI gate for a FireTree change: check technical evidence or a governed receipt, then verify provenance. */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseApproval, verifyApproval } from '../src/lib/approval.js';
import { atLeast, deriveAssurance } from '../src/lib/assurance.js';
import { verifyBundleManifest } from '../src/lib/bundle.js';
import { IdentityError, parseOidcClaims, verifyClaims } from '../src/lib/identity.js';
import { parseSignature, verifySignature } from '../src/lib/signature.js';
import { createReceiptTool } from '../src/tools/receipt.js';

function usage() {
  return [
    'Usage: firetree-check --change <id> --mode <governed|autonomous> [options]',
    '',
    'Options:',
    '  --root <dir>              Repository root (default: cwd)',
    '  --claims <file>           GitHub Actions OIDC claims JSON (enables A2)',
    '  --bundle <dir>            Evidence bundle directory with bundle-manifest.json',
    '  --approval <file>         Normalized human approval JSON (A3)',
    '  --signature <file>        Detached Ed25519 signature over the bundle digest (A3)',
    '  --public-key <pem>        Ed25519 public key for --signature',
    '  --reviewer <id>           Expected approval reviewer (optional)',
    '  --require <A1|A2|A3>      Minimum derived assurance (default: receipt value)',
    '  --repository <owner/repo> Expected repository for claims',
    '  --issuer <url>            Expected OIDC issuer',
    '  --audience <value>        Expected OIDC audience',
    '',
    'Exit codes: 0 = check passed, 1 = evidence/assurance gaps, 2 = usage/runtime error.',
  ].join('\n');
}

const VALUE_ARGS = new Set([
  '--change', '--mode', '--root', '--claims', '--bundle', '--approval', '--signature',
  '--public-key', '--reviewer', '--require', '--repository', '--issuer', '--audience',
]);

function parseArgs(argv) {
  const args = { root: process.cwd(), mode: 'governed' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!VALUE_ARGS.has(key)) throw new Error(`unknown argument: ${key}`);
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
  if ((args.signature === undefined) !== (args['public-key'] === undefined)) {
    throw new Error('--signature and --public-key must be used together');
  }
  return args;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
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
  let approvalVerified = false;
  let signed = false;

  if (result.ok) {
    const record = args.mode === 'governed' ? result.receipt : result.technical_evidence;
    const head = record?.change?.head;

    if (args.claims !== undefined) {
      try {
        claims = parseOidcClaims(await readJson(resolve(root, args.claims)));
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

    let bundleManifest = null;
    if (args.bundle !== undefined) {
      const bundleRoot = resolve(root, args.bundle);
      try {
        bundleManifest = await readJson(join(bundleRoot, 'bundle-manifest.json'));
        const bundleCheck = await verifyBundleManifest(bundleRoot, bundleManifest);
        gaps.push(...bundleCheck.gaps);
      } catch (error) {
        gaps.push(`bundle manifest is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (args.approval !== undefined) {
      try {
        const approval = parseApproval(await readJson(resolve(root, args.approval)));
        const approvalCheck = verifyApproval(approval, {
          head: typeof head === 'string' ? head : '',
          ...(args.reviewer === undefined ? {} : { reviewer: args.reviewer }),
        });
        approvalVerified = approvalCheck.valid;
        gaps.push(...approvalCheck.failures);
      } catch (error) {
        gaps.push(`approval is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (args.signature !== undefined) {
      if (bundleManifest === null) {
        gaps.push('--signature requires --bundle with bundle-manifest.json');
      } else {
        try {
          const signature = parseSignature(await readJson(resolve(root, args.signature)));
          const publicKey = await readFile(resolve(root, args['public-key']), 'utf8');
          const check = verifySignature(signature, bundleManifest.digest, publicKey);
          signed = check.valid;
          if (!check.valid && check.reason !== null) gaps.push(check.reason);
        } catch (error) {
          gaps.push(`signature is invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    derived = deriveAssurance({
      claimsValid,
      claims,
      evidence: record?.evidence ?? [],
      approval: approvalVerified ? { verified: true } : null,
      signed,
    });

    const claimed = record?.assurance;
    if (claimed !== undefined && !atLeast(derived.level, claimed)) {
      gaps.push(`claimed assurance ${claimed} exceeds derived assurance ${derived.level}`);
    }
    if (args.require !== undefined && !atLeast(derived.level, args.require)) {
      gaps.push(`required assurance ${args.require} but derived ${derived.level}`);
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
