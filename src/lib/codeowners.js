/** GitHub-style CODEOWNERS parsing and last-match-wins owner resolution. */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { matchesGlob, normalizeGlob, normalizeRepoPath } from './glob.js';

/** CODEOWNERS parsing failure. */
export class CodeownersError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   * @param {{line?: number, path?: string}} [details] - Error details.
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CodeownersError';
    this.code = code;
    this.line = details.line;
    this.path = details.path;
  }
}

const OWNER = /^(?:@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

/**
 * @param {string} root - Repository root.
 * @returns {string|null} Absolute CODEOWNERS path using GitHub precedence.
 */
export function findCodeownersFile(root) {
  for (const candidate of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
    const file = join(root, candidate);
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * @param {string} text - CODEOWNERS content.
 * @param {string} [source] - Source label for errors.
 * @returns {{source: string, patterns: Array<{pattern: string, owners: string[], line: number}>}} Parsed rules.
 */
export function parseCodeowners(text, source = 'CODEOWNERS') {
  if (typeof text !== 'string') throw new TypeError('CODEOWNERS text must be a string');
  const patterns = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    let line = lines[index].trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const comment = line.indexOf('#');
    if (comment >= 0) line = line.slice(0, comment).trim();
    if (line.length === 0) continue;

    const parts = line.split(/\s+/);
    const rawPattern = parts[0];
    const owners = parts.slice(1);
    if (owners.length === 0) throw new CodeownersError('INVALID_LINE', `${source}:${lineNumber} has no owner`, { line: lineNumber, path: source });
    for (const owner of owners) {
      if (!OWNER.test(owner)) throw new CodeownersError('INVALID_OWNER', `${source}:${lineNumber} has invalid owner ${owner}`, { line: lineNumber, path: source });
    }

    const anchored = rawPattern.startsWith('/');
    let pattern = normalizeGlob(rawPattern);
    if (!anchored && !pattern.includes('/')) pattern = `**/${pattern}`;
    patterns.push({ pattern, owners, line: lineNumber });
  }
  return { source, patterns };
}

/**
 * @param {string} root - Repository root.
 * @returns {Promise<{source: string, patterns: Array<{pattern: string, owners: string[], line: number}>}|null>} Parsed CODEOWNERS.
 */
export async function loadCodeowners(root) {
  const file = findCodeownersFile(root);
  if (file === null) return null;
  const text = await readFile(file, 'utf8');
  return parseCodeowners(text, file.replaceAll('\\', '/'));
}

/**
 * Resolve owners using GitHub's last-match-wins rule.
 *
 * @param {string} repoPath - Repo-relative changed path.
 * @param {{patterns: Array<{pattern: string, owners: string[], line: number}>}|null} parsed - Parsed CODEOWNERS.
 * @returns {{owners: string[], pattern: string|null}} Matching owners and pattern.
 */
export function resolveCodeowners(repoPath, parsed) {
  if (parsed === null) return { owners: [], pattern: null };
  const path = normalizeRepoPath(repoPath);
  let match = null;
  for (const rule of parsed.patterns) {
    if (matchesGlob(path, rule.pattern)) match = rule;
  }
  return match === null ? { owners: [], pattern: null } : { owners: [...match.owners], pattern: match.pattern };
}
