#!/usr/bin/env node
/** Fetch a GitHub Actions OIDC token and write normalized FireTree claims. */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseOidcClaims, verifyClaims } from '../src/lib/identity.js';

function parseArgs(argv) {
  const args = { audience: 'firetree', out: 'claims.json' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--out' || key === '--audience') {
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
  return args;
}

function decodePayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('OIDC token is not a JWT');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (typeof payload !== 'object' || payload === null) throw new Error('OIDC payload is not an object');
  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/github-oidc.mjs --out claims.json [--audience firetree]');
    return;
  }
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error('ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN are missing; run with permissions: id-token: write');
  }
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  if (!repository || !sha) throw new Error('GITHUB_REPOSITORY/GITHUB_SHA are missing');

  const url = new URL(requestUrl);
  url.searchParams.set('audience', args.audience);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`OIDC token request failed with HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body.value !== 'string') throw new Error('OIDC token response has no value');

  const claims = parseOidcClaims(decodePayload(body.value));
  const verification = verifyClaims(claims, {
    repository,
    sha,
    audience: args.audience,
  });
  if (!verification.valid) throw new Error(`OIDC claims are invalid: ${verification.failures.join('; ')}`);
  const out = resolve(args.out);
  await writeFile(out, `${JSON.stringify(claims, null, 2)}\n`, 'utf8');
  console.log(`claims written: ${out} (sha=${claims.sha}, run_id=${claims.run_id})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
