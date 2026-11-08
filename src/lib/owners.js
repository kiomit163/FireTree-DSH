/** Minimal Kubernetes-style OWNERS / OWNERS_ALIASES resolver. */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { normalizeRepoPath } from './glob.js';

const SKIP_DIRECTORIES = new Set(['.git', '.firetree', 'node_modules']);
const LIST_SECTIONS = new Set(['approvers', 'reviewers']);

function stripComment(line) {
  return line.replace(/\s+#.*$/, '');
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function keyOf(line) {
  return unquote(line.trim().replace(/:$/, ''));
}

function ownerName(value) {
  const name = unquote(value.trim());
  if (name.length === 0) return null;
  return name.startsWith('@') ? name : `@${name}`;
}

function listItem(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('-') ? ownerName(trimmed.slice(1).trim()) : null;
}

/**
 * Parse one Kubernetes OWNERS file. Unknown YAML sections are ignored so the
 * adapter stays minimal and does not invent policy.
 *
 * @param {string} text - OWNERS content.
 * @param {string} [source] - Source label.
 * @returns {object} Parsed owners rules.
 */
export function parseOwners(text, source = 'OWNERS') {
  if (typeof text !== 'string') throw new TypeError('OWNERS text must be a string');
  const approvers = [];
  const reviewers = [];
  const filters = [];
  const aliases = new Map();
  let noParentOwners = false;
  let section = null;
  let filter = null;
  let filterSection = null;
  let alias = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = stripComment(rawLine);
    if (withoutComment.trim().length === 0) continue;
    const indent = withoutComment.match(/^ */)[0].length;
    const trimmed = withoutComment.trim();

    if (trimmed.startsWith('-')) {
      const owner = listItem(trimmed);
      if (owner !== null && section === 'aliases' && alias !== null) {
        alias.owners.push(owner);
        continue;
      }
      if (owner !== null && LIST_SECTIONS.has(section)) {
        if (section === 'approvers') approvers.push(owner);
        else reviewers.push(owner);
        continue;
      }
      if (owner !== null && section === 'filters' && filter !== null && filterSection !== null) {
        filter[filterSection].push(owner);
        continue;
      }
    }

    if (indent === 0) {
      section = keyOf(trimmed);
      filter = null;
      filterSection = null;
      alias = null;
      continue;
    }

    if (section === 'options') {
      const match = /^no_parent_owners:\s*(true|false)\s*$/i.exec(trimmed);
      if (indent === 2 && match !== null) noParentOwners = match[1].toLowerCase() === 'true';
      continue;
    }

    if (section === 'filters') {
      if (indent === 2 && trimmed.endsWith(':')) {
        filter = { pattern: keyOf(trimmed), approvers: [], reviewers: [] };
        filters.push(filter);
        filterSection = null;
      } else if (indent === 4 && filter !== null && trimmed.endsWith(':')) {
        const name = keyOf(trimmed);
        filterSection = LIST_SECTIONS.has(name) ? name : null;
      } else if (filter !== null && filterSection !== null) {
        const owner = listItem(trimmed);
        if (owner !== null) filter[filterSection].push(owner);
      }
      continue;
    }

    if (section === 'aliases') {
      if (indent === 2 && trimmed.endsWith(':')) {
        alias = { name: keyOf(trimmed).toLowerCase(), owners: [] };
        aliases.set(alias.name, alias);
      } else if (alias !== null) {
        const owner = listItem(trimmed);
        if (owner !== null) alias.owners.push(owner);
      }
      continue;
    }

    if (LIST_SECTIONS.has(section)) {
      const owner = listItem(trimmed);
      if (owner !== null) {
        if (section === 'approvers') approvers.push(owner);
        else reviewers.push(owner);
      }
    }
  }

  const compiledFilters = [];
  for (const entry of filters) {
    try {
      compiledFilters.push({ ...entry, regex: new RegExp(entry.pattern) });
    } catch {
      // Invalid Kubernetes filter regex is ignored; it must not widen owners.
    }
  }

  return {
    source,
    approvers: [...new Set(approvers)],
    reviewers: [...new Set(reviewers)],
    filters: compiledFilters,
    aliases,
    noParentOwners,
  };
}

/**
 * @param {string} text - OWNERS_ALIASES content.
 * @param {string} [source] - Source label.
 * @returns {Map<string, string[]>} Alias name to owner labels.
 */
export function parseOwnersAliases(text, source = 'OWNERS_ALIASES') {
  if (typeof text !== 'string') throw new TypeError('OWNERS_ALIASES text must be a string');
  const parsed = parseOwners(text, source);
  return new Map([...parsed.aliases].map(([name, value]) => [name.toLowerCase(), [...value.owners]]));
}

function expandOwners(values, aliases, seen = new Set()) {
  const output = new Set();
  for (const value of values) {
    const key = (value.startsWith('@') ? value.slice(1) : value).toLowerCase();
    if (seen.has(key)) continue;
    const alias = aliases.get(key);
    if (alias === undefined) {
      output.add(value);
      continue;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(key);
    for (const expanded of expandOwners(alias, aliases, nextSeen)) output.add(expanded);
  }
  return [...output];
}

function ownersForRule(rule, aliases, relativePath) {
  const values = [...rule.approvers, ...rule.reviewers];
  for (const filter of rule.filters) {
    if (filter.regex.test(relativePath)) values.push(...filter.approvers, ...filter.reviewers);
  }
  return {
    owners: [...new Set(expandOwners(values, aliases))].sort(),
    pattern: rule.source,
    noParentOwners: rule.noParentOwners,
  };
}

async function discoverOwnersFiles(root) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name === 'OWNERS') found.push(path);
    }
  }
  await walk(root);
  return found;
}

/**
 * Load Kubernetes OWNERS files and return a resolver compatible with impact analysis.
 *
 * @param {string} root - Repository root.
 * @returns {Promise<{source: string, files: number, resolve: (repoPath: string) => {owners: string[], pattern: string|null}}|null>} Resolver.
 */
export async function loadOwners(root) {
  const aliasesFile = join(root, 'OWNERS_ALIASES');
  let aliases = new Map();
  try {
    aliases = parseOwnersAliases(await readFile(aliasesFile, 'utf8'), 'OWNERS_ALIASES');
  } catch {
    // OWNERS without aliases is valid.
  }

  const files = await discoverOwnersFiles(root);
  if (files.length === 0) return null;
  const byDirectory = new Map();

  for (const file of files) {
    const relativeFile = relative(root, file).replaceAll(sep, '/');
    const directory = dirname(relativeFile) === '.' ? '' : dirname(relativeFile);
    try {
      byDirectory.set(directory, parseOwners(await readFile(file, 'utf8'), relativeFile));
    } catch {
      // A malformed OWNERS file must not widen owners; skip it.
    }
  }

  function resolve(repoPath) {
    const path = normalizeRepoPath(repoPath);
    let directory = dirname(path);
    if (directory === '.') directory = '';
    const owners = new Set();
    let pattern = null;
    while (true) {
      const rule = byDirectory.get(directory);
      if (rule !== undefined) {
        const relativePath = directory === '' ? path : path.slice(directory.length + 1);
        const resolved = ownersForRule(rule, aliases, relativePath);
        for (const owner of resolved.owners) owners.add(owner);
        pattern = resolved.pattern;
        if (resolved.noParentOwners && resolved.owners.length > 0) break;
      }
      if (directory === '') break;
      directory = dirname(directory) === '.' ? '' : dirname(directory);
    }
    return { owners: [...owners].sort(), pattern };
  }

  return { source: 'OWNERS', files: files.length, resolve };
}
