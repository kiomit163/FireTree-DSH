/** Artifact storage under .firetree/: safe paths, atomic writes, and content hashes. */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { parseStrictJson, assertJsonValue } from './json.js';
import { withFileLock } from './lock.js';

/** Error raised by artifact storage and path admission. */
export class ArtifactError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   * @param {{path?: string, cause?: unknown}} [details] - Optional details.
   */
  constructor(code, message, details = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ArtifactError';
    this.code = code;
    this.path = details.path;
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validate a change/subsystem id before it becomes a path segment.
 *
 * @param {unknown} id - Candidate id.
 * @param {string} [label] - Field label for errors.
 * @returns {string} The validated id.
 */
export function assertSafeId(id, label = 'id') {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || id === '.' || id === '..') {
    throw new ArtifactError('INVALID_ID', `${label} must match ${SAFE_ID.source}`, { path: String(id) });
  }
  return id;
}

/**
 * Resolve a repo-relative path under a root and reject traversal/absolute paths.
 *
 * @param {string} root - Absolute repository root.
 * @param {string} relativePath - Repo-relative path, using forward or back slashes.
 * @returns {string} Absolute path inside root.
 */
export function resolveWithin(root, relativePath) {
  if (typeof root !== 'string' || root.length === 0) throw new ArtifactError('INVALID_ROOT', 'root must be a non-empty string');
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new ArtifactError('INVALID_PATH', 'artifact path must be a non-empty string');
  }
  const normalized = relativePath.replaceAll('\\', '/');
  if (isAbsolute(normalized) || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new ArtifactError('PATH_TRAVERSAL', `artifact path escapes root: ${relativePath}`, { path: relativePath });
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, normalized);
  const rel = relative(absoluteRoot, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ArtifactError('PATH_TRAVERSAL', `artifact path escapes root: ${relativePath}`, { path: relativePath });
  }
  return target;
}

/**
 * Build an absolute path under <root>/.firetree.
 *
 * @param {string} root - Repository root.
 * @param {...string} parts - Path segments under .firetree.
 * @returns {string} Absolute artifact path.
 */
export function firetreePath(root, ...parts) {
  return resolveWithin(root, ['.firetree', ...parts].join('/'));
}

/**
 * @param {string} root - Repository root.
 * @param {...string} parts - Path segments under .firetree.
 * @returns {string} Repo-relative artifact path with forward slashes.
 */
export function firetreeRelativePath(...parts) {
  return ['.firetree', ...parts].join('/');
}

/**
 * @param {string} text - Text to hash.
 * @returns {string} Lowercase SHA-256.
 */
export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {string} file - File path.
 * @returns {Promise<string>} Lowercase SHA-256 of the file bytes.
 */
export async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

/**
 * Write text through a same-directory temporary file and rename.
 *
 * @param {string} file - Destination path.
 * @param {string} text - UTF-8 text.
 * @returns {Promise<void>} Resolves after rename.
 */
export async function writeTextAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'w');
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
    // Directory fsync makes the rename durable on POSIX. Some platforms do not
    // support opening a directory for fsync; that is not a write failure.
    await open(dirname(file), 'r')
      .then(async (directory) => {
        await directory.sync().catch(() => {});
        await directory.close();
      })
      .catch(() => {});
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw new ArtifactError('WRITE_FAILED', `failed to write ${file}`, { path: file, cause: error });
  }
}

/**
 * Write strict JSON atomically.
 *
 * @param {string} file - Destination path.
 * @param {unknown} value - Strict JSON value.
 * @returns {Promise<{file: string, sha256: string, bytes: number}>} Write receipt.
 */
export async function writeJsonAtomic(file, value) {
  assertJsonValue(value);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const sha256 = sha256Text(text);
  await writeTextAtomic(file, text);
  return { file, sha256, bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * Write an artifact and its .sha256 sidecar under .firetree.
 *
 * @param {string} root - Repository root.
 * @param {string} relativePath - Repo-relative path under .firetree.
 * @param {unknown} value - Strict JSON value.
 * @returns {Promise<{path: string, sha256: string, bytes: number}>} Write receipt.
 */
export async function writeFiretreeJson(root, relativePath, value) {
  const file = resolveWithin(root, relativePath);
  return withFileLock(`${file}.lock`, async () => {
    const result = await writeJsonAtomic(file, value);
    await writeTextAtomic(`${file}.sha256`, `${result.sha256}\n`);
    return { path: relativePath.replaceAll('\\', '/'), sha256: result.sha256, bytes: result.bytes };
  });
}

/**
 * Read a JSON file, optionally requiring the sidecar hash to match.
 *
 * @param {string} root - Repository root.
 * @param {string} relativePath - Repo-relative path.
 * @param {{verifyHash?: boolean, missing?: 'error'|'null'}} [options] - Read policy.
 * @returns {Promise<{value: unknown, sha256: string|null, path: string}|null>} Parsed value.
 */
export async function readFiretreeJson(root, relativePath, options = {}) {
  const file = resolveWithin(root, relativePath);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT' && options.missing === 'null') return null;
    throw new ArtifactError('READ_FAILED', `cannot read ${relativePath}`, { path: relativePath, cause: error });
  }

  let value;
  try {
    value = parseStrictJson(text);
  } catch (error) {
    throw new ArtifactError('INVALID_JSON', `${relativePath} is not strict JSON`, { path: relativePath, cause: error });
  }

  const digest = sha256Text(text);
  let sidecar = null;
  try {
    sidecar = (await readFile(`${file}.sha256`, 'utf8')).trim().toLowerCase();
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'ENOENT') || options.verifyHash === true) {
      throw new ArtifactError('HASH_MISSING', `${relativePath}.sha256 is required`, { path: relativePath, cause: error });
    }
  }

  if (sidecar !== null) {
    if (!/^[a-f0-9]{64}$/.test(sidecar)) {
      throw new ArtifactError('HASH_INVALID', `${relativePath}.sha256 is not a SHA-256 hex digest`, { path: relativePath });
    }
    if (sidecar !== digest) {
      throw new ArtifactError('HASH_MISMATCH', `${relativePath} does not match its .sha256 sidecar`, { path: relativePath });
    }
  }

  return { value, sha256: sidecar === null ? null : digest, path: relativePath.replaceAll('\\', '/') };
}

/**
 * Read a strict JSON file outside the sidecar convention.
 *
 * @param {string} file - Absolute file path.
 * @param {'error'|'null'} [missing] - ENOENT behavior.
 * @returns {Promise<unknown|null>} Parsed value.
 */
export async function readJsonFile(file, missing = 'error') {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (missing === 'null' && error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw new ArtifactError('READ_FAILED', `cannot read ${file}`, { path: file, cause: error });
  }
  try {
    return parseStrictJson(text);
  } catch (error) {
    throw new ArtifactError('INVALID_JSON', `${file} is not strict JSON`, { path: file, cause: error });
  }
}

/**
 * @param {string} directory - Directory to scan.
 * @returns {Promise<string[]>} Sorted .json file paths; empty when the directory is absent.
 */
export async function listJsonFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw new ArtifactError('READ_FAILED', `cannot list ${directory}`, { path: directory, cause: error });
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

/**
 * @param {string} file - Candidate path.
 * @returns {boolean} Whether the path currently exists.
 */
export function pathExists(file) {
  return existsSync(file);
}
