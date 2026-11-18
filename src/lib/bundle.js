/** Content-addressed evidence bundle manifests for offline verification. */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { sha256Text } from './artifacts.js';
import { canonicalJson } from './json.js';

/** Bundle manifest failure. */
export class BundleError extends Error {
  /**
   * @param {string} code - Stable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'BundleError';
    this.code = code;
  }
}

const MANIFEST_NAME = 'bundle-manifest.json';

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else if (entry.isFile() && entry.name !== MANIFEST_NAME) files.push(path);
  }
  return files;
}

/**
 * Build a deterministic manifest for every file under a bundle directory.
 *
 * @param {string} directory - Bundle root.
 * @returns {Promise<object>} Bundle manifest.
 */
export async function buildBundleManifest(directory) {
  const absolute = await readdir(directory).catch((error) => {
    throw new BundleError('BUNDLE_UNREADABLE', `cannot read bundle ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (absolute.length === 0) throw new BundleError('BUNDLE_EMPTY', 'bundle contains no files');
  const files = (await walk(directory))
    .map((file) => ({
      path: relative(directory, file).replaceAll('\\', '/'),
      sha256: null,
      bytes: 0,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const item of files) {
    const bytes = await readFile(join(directory, item.path));
    item.sha256 = createHash('sha256').update(bytes).digest('hex');
    item.bytes = bytes.byteLength;
  }

  const manifest = {
    schema: 'firetree.bundle/v1',
    files,
    digest: sha256Text(canonicalJson(files)),
  };
  return manifest;
}

/**
 * Verify a directory against a previously written manifest.
 *
 * @param {string} directory - Bundle root.
 * @param {unknown} manifest - Parsed manifest.
 * @returns {Promise<{valid: boolean, gaps: string[]}>} Verification result.
 */
export async function verifyBundleManifest(directory, manifest) {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new BundleError('INVALID_MANIFEST', 'manifest must be an object');
  }
  if (manifest.schema !== 'firetree.bundle/v1') throw new BundleError('INVALID_MANIFEST', 'manifest schema must be firetree.bundle/v1');
  if (!Array.isArray(manifest.files)) throw new BundleError('INVALID_MANIFEST', 'manifest.files must be an array');
  const expected = manifest.files.map((item) => ({
    path: String(item.path).replaceAll('\\', '/'),
    sha256: String(item.sha256),
    bytes: Number(item.bytes),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const actual = await buildBundleManifest(directory);
  const gaps = [];
  if (expected.length !== actual.files.length) gaps.push(`file count differs: manifest ${expected.length}, bundle ${actual.files.length}`);
  const actualByPath = new Map(actual.files.map((item) => [item.path, item]));
  for (const item of expected) {
    const found = actualByPath.get(item.path);
    if (!found) {
      gaps.push(`missing file: ${item.path}`);
      continue;
    }
    if (found.sha256 !== item.sha256) gaps.push(`hash mismatch: ${item.path}`);
    if (found.bytes !== item.bytes) gaps.push(`size mismatch: ${item.path}`);
  }
  const expectedPaths = new Set(expected.map((item) => item.path));
  for (const item of actual.files) {
    if (!expectedPaths.has(item.path)) gaps.push(`unexpected file: ${item.path}`);
  }
  if (manifest.digest !== sha256Text(canonicalJson(expected))) gaps.push('manifest digest does not match file list');
  if (actual.digest !== manifest.digest) gaps.push('bundle digest does not match manifest');
  return { valid: gaps.length === 0, gaps };
}

export { MANIFEST_NAME };
