/** Deterministic impact analysis and automatic risk tier. */

import { resolveCodeowners } from './codeowners.js';
import { matchesGlob, normalizeRepoPath } from './glob.js';

/** Impact analysis failure. */
export class ImpactError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ImpactError';
    this.code = code;
  }
}

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'go.mod',
  'go.sum',
  'cargo.toml',
  'cargo.lock',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'pipfile',
  'pipfile.lock',
  'composer.json',
  'composer.lock',
]);

const SECURITY_SEGMENTS = new Set(['auth', 'security', 'crypto', 'secret', 'secrets', 'iam', 'rbac', 'permission', 'permissions']);
const DATA_SEGMENTS = new Set(['migration', 'migrations', 'schema', 'schemas', 'database', 'databases', 'seed', 'seeds']);
const TEST_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'testdata']);
const DOC_SEGMENTS = new Set(['docs', 'doc', 'documentation']);
const LOW_RISK_CONFIG = /^(?:\.editorconfig|\.gitignore|\.gitattributes|\.prettierrc(?:\..*)?|\.npmrc|\.nvmrc|\.markdownlint.*)$/;
const PROTECTED_PATHS = [
  /^\.firetree\//,
  /^\.github\/workflows\//,
  /^src\/lib\/(?:impact|policy|assurance|ai-review|receipt|git)\.js$/,
  /^bin\/(?:firetree-check|firetree-ci|firetree-assess)\.mjs$/,
  /^schemas\//,
  /^CODEOWNERS$/,
  /^cordis\.patch\.yml$/,
  /^\.gitignore$/,
  /^\.gitattributes$/,
  /^plan\//,
  /^reference\//,
];
const DOC_EXTENSIONS = /\.(md|mdx|rst|txt|adoc|png|jpe?g|gif|svg|webp)$/i;

function basename(path) {
  return path.split('/').at(-1) ?? path;
}

function extension(path) {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index).toLowerCase();
}

/**
 * @param {string} repoPath - Normalized repo path.
 * @returns {boolean} Whether this is a test-only path.
 */
export function isTestPath(repoPath) {
  const segments = repoPath.split('/');
  return segments.some((segment) => TEST_SEGMENTS.has(segment))
    || /\.(test|spec)\./.test(basename(repoPath))
    || /_test\.[^.]+$/.test(basename(repoPath));
}

/**
 * @param {string} repoPath - Normalized repo path.
 * @returns {boolean} Whether this is documentation.
 */
export function isDocsPath(repoPath) {
  const segments = repoPath.split('/');
  const name = basename(repoPath).toLowerCase();
  return segments.some((segment) => DOC_SEGMENTS.has(segment))
    || /\.(md|mdx|rst)$/.test(name)
    || /^(readme|license|changelog|notice)(\.|$)/.test(name);
}

/**
 * @param {string} repoPath - Normalized repo path.
 * @returns {boolean} Whether this is configuration.
 */
export function isConfigPath(repoPath) {
  // Only tooling metadata is L0. `.env`, CI workflows, service config, and
  // arbitrary JSON/YAML are not low-risk just because of their extension.
  return LOW_RISK_CONFIG.test(basename(repoPath));
}

/**
 * @param {string} repoPath - Normalized repo path.
 * @returns {boolean} Whether this is a dependency manifest/lockfile.
 */
export function isDependencyPath(repoPath) {
  return DEPENDENCY_FILES.has(basename(repoPath).toLowerCase());
}

/**
 * @param {string} repoPath - Normalized repo path.
 * @returns {boolean} Whether this is a control-defining path that must be L2.
 */
export function isProtectedPath(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  return PROTECTED_PATHS.some((pattern) => pattern.test(normalized));
}

/**
 * @param {string} repoPath - Normalized repo path.
 * @returns {boolean} Whether a security-sensitive path segment is present.
 */
export function isSecuritySensitivePath(repoPath) {
  return repoPath.split('/').some((segment) => SECURITY_SEGMENTS.has(segment.toLowerCase()))
    || /\.(pem|key|crt|p12|pfx)$/i.test(basename(repoPath));
}

/**
 * @param {string} repoPath - Normalized repo path.
 * @returns {boolean} Whether a data/schema-sensitive path segment is present.
 */
export function isDataSensitivePath(repoPath) {
  return repoPath.split('/').some((segment) => DATA_SEGMENTS.has(segment.toLowerCase()))
    || extension(repoPath) === '.sql';
}

/**
 * @param {string} repoPath - Normalized repo path.
 * @returns {boolean} Whether the path is document/config/test-only.
 */
export function isL0Path(repoPath) {
  const name = basename(repoPath);
  const docs = isDocsPath(repoPath) && DOC_EXTENSIONS.test(name);
  const test = isTestPath(repoPath)
    && (repoPath.split('/').some((segment) => ['testdata', '__tests__'].includes(segment))
      || /\.(test|spec)\./.test(name)
      || /_test\.[^.]+$/.test(name));
  return docs || isConfigPath(repoPath) || test;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

/**
 * Analyze a changed file set against the repo registry.
 *
 * @param {{files: string[], subsystems: object[], interfaces: object[], codeowners?: object|null}} input - Analysis input.
 * @returns {{
 *   auto_tier: 'L0'|'L1'|'L2',
 *   reasons: string[],
 *   confidence: 'high'|'low',
 *   impact: {
 *     files: string[],
 *     subsystems: string[],
 *     interfaces: string[],
 *     owners: string[],
 *     tests: string[],
 *     unknown: string[],
 *     unresolved_consumers: string[],
 *     traversed: boolean
 *   }
 * }} Analysis result.
 */
export function analyzeImpact(input) {
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new ImpactError('NO_FILES', 'at least one changed file is required');
  }
  for (const file of input.files) {
    if (typeof file !== 'string' || normalizeRepoPath(file).length === 0) {
      throw new ImpactError('INVALID_FILE', 'changed files must be non-empty strings');
    }
  }

  const files = uniqueSorted(input.files.map((file) => normalizeRepoPath(file)));
  const subsystems = input.subsystems ?? [];
  const interfaces = input.interfaces ?? [];
  const subsystemById = new Map(subsystems.map((subsystem) => [subsystem.id, subsystem]));
  const interfaceById = new Map(interfaces.map((contract) => [contract.id, contract]));
  const changedSubsystems = new Set();
  const codeSubsystems = new Set();
  const changedInterfaces = new Set();
  const owners = new Set();
  const tests = new Set();
  const unknown = [];
  const unresolvedConsumers = new Set();
  const interfaceChanges = new Set();
  const hasOwnerResolver = input.codeowners !== null
    && input.codeowners !== undefined
    && typeof input.codeowners.resolve === 'function';
  const dependencyFiles = [];
  const sensitiveFiles = [];
  const protectedFiles = [];

  const addInterfaceImpact = (contractId, seen) => {
    if (seen.has(contractId)) return;
    seen.add(contractId);
    const contract = interfaceById.get(contractId);
    if (contract === undefined) return;
    for (const consumer of contract.consumers ?? []) {
      if (subsystemById.has(consumer)) {
        changedSubsystems.add(consumer);
        const subsystem = subsystemById.get(consumer);
        for (const owner of subsystem.owners ?? []) owners.add(owner);
        for (const test of subsystem.tests ?? []) tests.add(test);
      } else {
        unresolvedConsumers.add(consumer);
      }
    }
    for (const dependency of contract.depends_on ?? []) addInterfaceImpact(dependency, seen);
  };

  for (const file of files) {
    const matchedSubsystems = subsystems.filter((subsystem) => subsystem.paths.some((pattern) => matchesGlob(file, pattern)));
    if (matchedSubsystems.length === 0) unknown.push(file);
    for (const subsystem of matchedSubsystems) {
      changedSubsystems.add(subsystem.id);
      if (!isL0Path(file)) codeSubsystems.add(subsystem.id);
      if (!hasOwnerResolver) {
        for (const owner of subsystem.owners ?? []) owners.add(owner);
      }
      for (const test of subsystem.tests ?? []) tests.add(test);
    }

    const ownerMatch = input.codeowners && typeof input.codeowners.resolve === 'function'
      ? input.codeowners.resolve(file)
      : resolveCodeowners(file, input.codeowners ?? null);
    for (const owner of ownerMatch.owners) owners.add(owner);

    for (const contract of interfaces) {
      if (!matchesGlob(file, contract.file)) continue;
      changedInterfaces.add(contract.id);
      interfaceChanges.add(contract.id);
      addInterfaceImpact(contract.id, new Set());
    }

    if (isDependencyPath(file)) dependencyFiles.push(file);
    if (isProtectedPath(file)) protectedFiles.push(file);
    if (!isTestPath(file) && !isDocsPath(file) && (isSecuritySensitivePath(file) || isDataSensitivePath(file))) {
      sensitiveFiles.push(file);
    }
  }

  const reasons = [];
  for (const file of unknown) reasons.push(`unknown path: ${file}`);
  for (const file of protectedFiles) reasons.push(`protected path: ${file}`);
  for (const id of [...interfaceChanges].sort()) reasons.push(`interface changed: ${id}`);
  if (codeSubsystems.size > 1) reasons.push(`cross-subsystem: ${[...codeSubsystems].sort().join(', ')}`);
  for (const file of dependencyFiles) reasons.push(`dependency changed: ${file}`);
  for (const file of sensitiveFiles) reasons.push(`sensitive path: ${file}`);
  for (const consumer of [...unresolvedConsumers].sort()) reasons.push(`consumer not registered: ${consumer}`);

  const l0 = files.every((file) => isL0Path(file) && !isProtectedPath(file));
  const l2 = unknown.length > 0
    || protectedFiles.length > 0
    || changedInterfaces.size > 0
    || codeSubsystems.size > 1
    || dependencyFiles.length > 0
    || sensitiveFiles.length > 0
    || unresolvedConsumers.size > 0;
  const autoTier = l2 ? 'L2' : l0 ? 'L0' : 'L1';
  const traversed = unknown.length === 0 && unresolvedConsumers.size === 0;

  return {
    auto_tier: autoTier,
    reasons,
    confidence: traversed ? 'high' : 'low',
    impact: {
      files,
      subsystems: uniqueSorted(changedSubsystems),
      interfaces: uniqueSorted(changedInterfaces),
      owners: uniqueSorted(owners),
      tests: uniqueSorted(tests),
      unknown,
      unresolved_consumers: uniqueSorted(unresolvedConsumers),
      traversed,
    },
  };
}
