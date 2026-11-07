/** Repo-relative glob matching for subsystem paths and CODEOWNERS. */

/**
 * Normalize a repo-relative path or glob.
 *
 * @param {string} value - Path or pattern.
 * @returns {string} Normalized path with forward slashes and no leading "./".
 */
export function normalizeRepoPath(value) {
  if (typeof value !== 'string') throw new TypeError('path must be a string');
  let normalized = value.trim().replaceAll('\\', '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  return normalized;
}

/**
 * Normalize a glob. A trailing slash means "everything below this directory".
 *
 * @param {string} pattern - Glob pattern.
 * @returns {string} Normalized pattern.
 */
export function normalizeGlob(pattern) {
  let normalized = normalizeRepoPath(pattern);
  if (normalized.startsWith('/')) normalized = normalized.slice(1);
  if (normalized.endsWith('/')) normalized += '**';
  if (normalized.length === 0) throw new Error('glob pattern must not be empty');
  return normalized;
}

/**
 * Convert a glob to an anchored RegExp.
 *
 * Supports `**`, `*`, and `?`; `*` and `?` never cross `/`.
 *
 * @param {string} pattern - Glob pattern.
 * @returns {RegExp} Anchored regular expression.
 */
export function globToRegExp(pattern) {
  const normalized = normalizeGlob(pattern);
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        if (normalized[index + 2] === '/') {
          source += '(?:[^/]+/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  source += '$';
  return new RegExp(source);
}

/**
 * @param {string} repoPath - Repo-relative path.
 * @param {string} pattern - Glob.
 * @returns {boolean} Whether the path matches.
 */
export function matchesGlob(repoPath, pattern) {
  return globToRegExp(pattern).test(normalizeRepoPath(repoPath));
}

/**
 * @param {string} repoPath - Repo-relative path.
 * @param {readonly string[]} patterns - Globs.
 * @returns {boolean} Whether any pattern matches.
 */
export function matchesAnyGlob(repoPath, patterns) {
  return patterns.some((pattern) => matchesGlob(repoPath, pattern));
}
