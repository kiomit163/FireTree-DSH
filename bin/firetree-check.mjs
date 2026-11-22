#!/usr/bin/env node
/** CI gate for a FireTree change: check technical evidence or a governed receipt, then verify provenance. */

import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { evaluateAiReview } from '../src/lib/ai-review.js';
import { atLeast, deriveAssurance } from '../src/lib/assurance.js';
import { verifyGithubAttestation } from '../src/lib/attestation.js';
import { verifyBundleManifest } from '../src/lib/bundle.js';
import { IdentityError, verifyGithubJwt } from '../src/lib/identity.js';
import { readFiretreeJson, sha256File } from '../src/lib/artifacts.js';
import { readEvents } from '../src/lib/events.js';
import { parseSignature, verifySignature } from '../src/lib/signature.js';
import { createReceiptTool } from '../src/tools/receipt.js';

function usage() {
  return [
    'Usage: firetree-check --change <id> --mode <governed|autonomous> [options]',
    '',
    'Options:',
    '  --root <dir>              Repository root (default: cwd)',
    '  --jwt <file>              Raw GitHub Actions OIDC JWT (enables A2; signature verified)',
    '  --jwks <file>             Local JWKS JSON for offline/tests (default: GitHub JWKS)',
    '  --claims-sha <sha>        SHA the OIDC token must bind to (default: change head)',
    '  --workflow-ref <ref>      Expected OIDC workflow_ref (optional)',
    '  --ai-review <file>        Adversarial AI review artifact (A3-AI-S/A3-AI)',
    '  --event-anchor <file>     Event chain anchor artifact',
    '  --review-signing-key-env <name>  Env var for required AI review HMAC key',
    '  --bundle <dir>            Evidence bundle directory with bundle-manifest.json',
    '  --signature <file>        Detached Ed25519 signature over the bundle digest',
    '  --public-key <pem>        Ed25519 public key for --signature',
    '  --attestation <file>      GitHub attestation bundle (gh --bundle)',
    '  --attested-artifact <f>   Artifact covered by attestation (default: <bundle>/bundle-manifest.json)',
    '  --signer-workflow <ref>   Expected GitHub workflow identity for attestation',
    '  --source-digest <sha>     Expected source digest for attestation',
    '  --gh <path>               GitHub CLI path (default: gh)',
    '  --require <A1|A2|A3-AI-S|A3-AI>  Minimum derived assurance (default: receipt value)',
    '  --repository <owner/repo> Expected repository for claims',
    '  --issuer <url>            Expected OIDC issuer',
    '  --audience <value>        Expected OIDC audience',
    '',
    'Exit codes: 0 = check passed, 1 = evidence/assurance gaps, 2 = usage/runtime error.',
  ].join('\n');
}

const VALUE_ARGS = new Set([
  '--change', '--mode', '--root', '--jwt', '--jwks', '--claims-sha', '--workflow-ref', '--ai-review', '--event-anchor', '--review-signing-key-env', '--bundle', '--signature',
  '--public-key', '--attestation', '--attested-artifact', '--signer-workflow', '--source-digest',
  '--gh', '--require', '--repository', '--issuer', '--audience',
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
  if (args.require !== undefined && !['A1', 'A2', 'A3-AI-S', 'A3-AI'].includes(args.require)) {
    throw new Error('--require must be A1, A2, A3-AI-S, or A3-AI');
  }
  if (args.jwt !== undefined && (typeof args.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.repository))) {
    throw new Error('--jwt requires --repository owner/repo');
  }
  if (args.jwt !== undefined && (typeof args['workflow-ref'] !== 'string' || args['workflow-ref'].length === 0)) {
    throw new Error('--jwt requires --workflow-ref owner/repo/.github/workflows/<file>@refs/heads/<branch>');
  }
  if ((args.signature === undefined) !== (args['public-key'] === undefined)) {
    throw new Error('--signature and --public-key must be used together');
  }
  if (args.attestation !== undefined && args.bundle === undefined) {
    throw new Error('--attestation requires --bundle so the attested manifest is part of the bundle');
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
  let aiReviewValid = false;
  let aiReviewMode = null;
  let signed = false;
  let attested = false;

  if (result.ok) {
    const record = args.mode === 'governed' ? result.receipt : result.technical_evidence;
    const head = record?.change?.head;

    if (args.jwt !== undefined) {
      try {
        const rawJwt = (await readFile(resolve(root, args.jwt), 'utf8')).trim();
        const jwks = args.jwks === undefined
          ? undefined
          : await readJson(resolve(root, args.jwks));
        const claimsSha = args['claims-sha'] ?? (typeof head === 'string' ? head : undefined);
        const verified = await verifyGithubJwt(rawJwt, {
          ...(args.issuer === undefined ? {} : { issuer: args.issuer }),
          audience: args.audience ?? 'firetree',
          ...(args.repository === undefined ? {} : { repository: args.repository }),
          ...(claimsSha === undefined ? {} : { sha: claimsSha }),
          ...(args['workflow-ref'] === undefined ? {} : { workflowRef: args['workflow-ref'] }),
          ...(jwks === undefined ? {} : { jwks }),
        });
        claims = verified.claims;
        claimsValid = true;
      } catch (error) {
        const message = error instanceof IdentityError || error instanceof Error ? error.message : String(error);
        gaps.push(`JWT is invalid: ${message}`);
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

    let assessmentRecord = null;
    try {
      assessmentRecord = await readFiretreeJson(
        root,
        `.firetree/changes/${args.change}/assessment.json`,
        { verifyHash: true, missing: 'null' },
      );
    } catch (error) {
      gaps.push(`assessment artifact is unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (args['event-anchor'] !== undefined) {
      const anchorRecord = await readFiretreeJson(root, args['event-anchor'], { verifyHash: true, missing: 'null' });
      if (anchorRecord === null) {
        gaps.push('event anchor is missing');
      } else {
        const anchor = anchorRecord.value;
        const eventLog = await readEvents(root);
        if (!eventLog.valid) gaps.push(...eventLog.gaps);
        if (anchor.schema !== 'firetree.event-anchor/v1') gaps.push('event anchor schema is invalid');
        if (anchor.change?.id !== args.change) gaps.push('event anchor change does not match');
        if (anchor.change?.head !== head) gaps.push('event anchor head does not match evidence');
        if (anchor.events?.count !== eventLog.events.length) gaps.push('event anchor count does not match chain');
        const actualHead = eventLog.events.length === 0 ? null : eventLog.events.at(-1).hash;
        if (anchor.events?.head !== actualHead) gaps.push('event anchor head does not match chain');
      }
    }

    if (args['ai-review'] !== undefined) {
      try {
        if (args.bundle === undefined || bundleManifest === null) {
          gaps.push('--ai-review requires --bundle with a verified bundle-manifest.json');
        } else {
          const reviewPath = resolve(root, args['ai-review']);
          const bundleRoot = resolve(root, args.bundle);
          const relativePath = relative(bundleRoot, reviewPath).replaceAll('\\', '/');
          if (relativePath.startsWith('../') || relativePath === '..') {
            gaps.push('AI review must be inside the attested bundle');
          } else {
            const entry = bundleManifest.files?.find((file) => file.path === relativePath);
            const actual = await sha256File(reviewPath);
            if (entry === undefined) gaps.push('AI review is not listed in the bundle manifest');
            else if (entry.sha256 !== actual) gaps.push('AI review hash does not match the bundle manifest');
            // The review commit is necessarily a descendant of the reviewed
            // head. Bind to the diff digest, which excludes review artifacts.
            const signingKeyEnv = args['review-signing-key-env'] ?? 'FIRE_TREE_REVIEW_SIGNING_KEY';
            const signingKey = process.env[signingKeyEnv];
            const review = evaluateAiReview(await readJson(reviewPath), {
              ...(typeof assessmentRecord?.value?.git?.diff_sha256 === 'string'
                ? { diffSha256: assessmentRecord.value.git.diff_sha256 }
                : {}),
            }, {
              requireSignature: args.require === 'A3-AI',
              ...(typeof signingKey === 'string' ? { signingKey } : {}),
            });
            aiReviewValid = review.valid;
            aiReviewMode = review.mode;
            gaps.push(...review.gaps);
          }
        }
      } catch (error) {
        gaps.push(`AI review is invalid: ${error instanceof Error ? error.message : String(error)}`);
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

    if (args.attestation !== undefined) {
      if (typeof args['signer-workflow'] !== 'string' || args['signer-workflow'].length === 0) {
        gaps.push('--attestation requires --signer-workflow');
      }
      const bundleRoot = resolve(root, args.bundle);
      const artifact = resolve(root, args['attested-artifact'] ?? join(bundleRoot, 'bundle-manifest.json'));
      try {
        const check = await verifyGithubAttestation({
          artifact,
          bundle: resolve(root, args.attestation),
          repository: args.repository ?? claims?.repository ?? '',
          ...(args['signer-workflow'] === undefined ? {} : { signerWorkflow: args['signer-workflow'] }),
          ...(args['source-digest'] === undefined ? {} : { sourceDigest: args['source-digest'] }),
          ...(args.gh === undefined ? {} : { ghPath: args.gh }),
        });
        attested = check.valid;
        if (!check.valid && check.reason !== null) gaps.push(`attestation: ${check.reason}`);
      } catch (error) {
        gaps.push(`attestation is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    derived = deriveAssurance({
      claimsValid,
      claims,
      evidence: record?.evidence ?? [],
      aiReview: aiReviewValid ? { valid: true, mode: aiReviewMode } : null,
      signed,
      attested,
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
  if (!output.ok) console.error(`::error::${gaps.join('; ').replaceAll('\n', '%0A')}`);
  console.log(JSON.stringify(output));
  process.exitCode = output.ok ? 0 : 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(`::error::${message.replaceAll('\n', '%0A')}`);
  console.error(usage());
  process.exitCode = 2;
});
