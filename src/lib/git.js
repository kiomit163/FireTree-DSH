/** Git adapter: resolve commits, compute changed files, and bind a change to a tree/diff hash. */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/** Git adapter failure. */
export class GitError extends Error {
  /**
   * @param {string} code - Stable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'GitError';
    this.code = code;
  }
}

function git(root, args, encoding = 'utf8') {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error && error.stderr
      ? String(error.stderr).trim()
      : '';
    throw new GitError('GIT_FAILED', `git ${args[0]} failed${stderr.length > 0 ? `: ${stderr}` : ''}`);
  }
}

function assertRef(ref, label) {
  if (typeof ref !== 'string' || ref.trim().length === 0 || ref.length > 200) {
    throw new GitError('INVALID_REF', `${label} must be a non-empty ref`);
  }
  if (/\s/.test(ref) || ref.startsWith('-')) {
    throw new GitError('INVALID_REF', `${label} contains unsupported characters`);
  }
}

/**
 * Resolve a ref to a full commit SHA.
 *
 * @param {string} root - Repository root.
 * @param {string} ref - Commit, branch, or tag.
 * @returns {string} Full commit SHA.
 */
export function resolveCommit(root, ref) {
  assertRef(ref, 'ref');
  return git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
}

/**
 * @param {string} root - Repository root.
 * @param {string} ref - Commit-ish.
 * @returns {string} Tree SHA.
 */
export function resolveTree(root, ref) {
  assertRef(ref, 'ref');
  return git(root, ['rev-parse', '--verify', `${ref}^{tree}`]).trim();
}

function normalizePaths(buffer) {
  return [...new Set(
    buffer
      .toString('utf8')
      .split('\0')
      .filter((item) => item.length > 0)
      .map((item) => item.replaceAll('\\', '/')),
  )].sort();
}

/**
 * List changed paths between two commits. Renames are intentionally reported as
 * delete + add (`--no-renames`) so impact analysis sees both sides.
 *
 * @param {string} root - Repository root.
 * @param {string} base - Base commit-ish.
 * @param {string} head - Head commit-ish.
 * @returns {string[]} Sorted unique repo-relative paths.
 */
export function changedFiles(root, base, head) {
  // `.firetree/` holds the protocol's own artifacts (including this assessment).
  // They are governed by the protocol, not by the code-change diff.
  const output = git(root, [
    'diff', '--name-only', '-z', '--no-renames', `${base}..${head}`,
    '--', '.', ':(exclude).firetree/**',
  ], 'buffer');
  return normalizePaths(output);
}

/**
 * @param {string} root - Repository root.
 * @param {string} base - Base commit-ish.
 * @param {string} head - Head commit-ish.
 * @returns {string} SHA-256 of the binary diff.
 */
export function diffSha256(root, base, head) {
  const output = git(root, [
    'diff', '--binary', '--no-renames', '--full-index', `${base}..${head}`,
    '--', '.', ':(exclude).firetree/**',
  ], 'buffer');
  return createHash('sha256').update(output).digest('hex');
}

function sameFiles(expected, actual) {
  if (expected.length !== actual.length) return false;
  const left = [...expected].map((item) => item.replaceAll('\\', '/')).sort();
  const right = [...actual].sort();
  return left.every((item, index) => item === right[index]);
}

/**
 * Verify that the caller-provided file set is exactly the git diff and return
 * immutable change identity fields.
 *
 * @param {string} root - Repository root.
 * @param {string} base - Base ref.
 * @param {string} head - Head ref.
 * @param {string[]} files - Caller-provided changed paths.
 * @returns {{base: string, head: string, tree_sha: string, diff_sha256: string, files: string[]}} Identity.
 */
export function verifyGitChange(root, base, head, files) {
  if (!Array.isArray(files) || files.length === 0) throw new GitError('INVALID_FILES', 'files must be a non-empty array');
  const baseSha = resolveCommit(root, base);
  const headSha = resolveCommit(root, head);
  const actual = changedFiles(root, baseSha, headSha);
  if (actual.length === 0) throw new GitError('EMPTY_DIFF', 'base..head contains no changed files');
  if (!sameFiles(files, actual)) {
    const expected = new Set(files);
    const missing = actual.filter((file) => !expected.has(file));
    const extra = files.filter((file) => !actual.includes(file));
    throw new GitError(
      'FILES_MISMATCH',
      `files do not match git diff (missing: ${missing.slice(0, 5).join(', ') || 'none'}; extra: ${extra.slice(0, 5).join(', ') || 'none'})`,
    );
  }
  return {
    base: baseSha,
    head: headSha,
    tree_sha: resolveTree(root, headSha),
    diff_sha256: diffSha256(root, baseSha, headSha),
    files: actual,
  };
}
