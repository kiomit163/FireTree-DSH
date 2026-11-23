/** Deterministic trust-root digest over policy and registry artifacts. */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { sha256Text } from './artifacts.js';

async function hashFiles(root, directory, pattern) {
  let names;
  try {
    names = (await readdir(join(root, directory))).filter((name) => pattern.test(name)).sort();
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const records = [];
  for (const name of names) {
    const file = join(root, directory, name);
    records.push(`${relative(root, file).replaceAll('\\', '/')}\0${await readFile(file, 'utf8')}`);
  }
  return sha256Text(records.join('\0'));
}

/**
 * Compute policy and registry digests from the trusted checkout.
 *
 * @param {string} root - Repository root.
 * @returns {Promise<{policy_sha256: string, registry_sha256: string, combined: string}>} Trust root.
 */
export async function computeTrustRoot(root) {
  const policy = await readFile(join(root, '.firetree', 'policy.json'), 'utf8');
  const policySha = sha256Text(policy);
  const subsystems = await hashFiles(root, join('.firetree', 'subsystems'), /\.json$/u);
  const oids = await hashFiles(root, join('.firetree', 'oid'), /\.json$/u);
  if (subsystems === null) throw new Error('subsystem registry is empty');
  const registrySha = sha256Text(`${subsystems}\0${oids ?? ''}`);
  return {
    policy_sha256: policySha,
    registry_sha256: registrySha,
    combined: sha256Text(`${policySha}\0${registrySha}`),
  };
}
