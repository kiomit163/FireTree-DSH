/** Interface registry hash verification. */

import { sha256File } from './artifacts.js';
import { resolveWithin } from './artifacts.js';
import { existsSync } from 'node:fs';

/**
 * Verify every interface definition file against its registered SHA-256.
 *
 * @param {string} root - Repository root.
 * @param {object[]} interfaces - Interface registry entries.
 * @returns {Promise<{valid: boolean, gaps: string[]}>} Result.
 */
export async function verifyInterfaceHashes(root, interfaces) {
  const gaps = [];
  for (const contract of interfaces ?? []) {
    let file;
    try {
      file = resolveWithin(root, contract.file);
    } catch {
      gaps.push(`${contract.id}: interface file path is unsafe`);
      continue;
    }
    if (!existsSync(file)) {
      gaps.push(`${contract.id}: interface file is missing: ${contract.file}`);
      continue;
    }
    const actual = await sha256File(file);
    if (actual !== contract.sha256) gaps.push(`${contract.id}: interface hash does not match ${contract.file}`);
  }
  return { valid: gaps.length === 0, gaps };
}
