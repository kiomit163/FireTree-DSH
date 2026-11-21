#!/usr/bin/env node
/** Fetch a GitHub Actions OIDC token and write normalized FireTree claims. */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseOidcClaims } from '../src/lib/identity.js';

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
  if (!process.env.GITHUB_REPOSITORY) throw new Error('GITHUB_REPOSITORY is missing');

  const url = new URL(requestUrl);
  url.searchParams.set('audience', args.audience);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`OIDC token request failed with HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body.value !== 'string') throw new Error('OIDC token response has no value');

  const payload = JSON.parse(Buffer.from(body.value.split('.')[1], 'base64url').toString('utf8'));
  const claims = parseOidcClaims(payload);
  const out = resolve(args.out);
  const jwtOut = `${out}.jwt`;
  await writeFile(jwtOut, body.value, 'utf8');
  await writeFile(out, `${JSON.stringify(claims, null, 2)}\n`, 'utf8');
  console.log(`JWT written: ${jwtOut}; unverified claims written: ${out} (sha=${claims.sha}, run_id=${claims.run_id})`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  console.error(`::error::${message.replaceAll('\n', '%0A')}`);
  process.exitCode = 1;
});
