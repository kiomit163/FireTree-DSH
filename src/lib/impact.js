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
const TEST_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e']);
const DOC_SEGMENTS = new Set(['docs', 'doc', 'documentation']);
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.conf']);

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
  const name = basename(repoPath);
  return name.startsWith('.env')
    || CONFIG_EXTENSIONS.has(extension(repoPath))
    || repoPath.startsWith('.github/');
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
  return isDocsPath(repoPath) || isConfigPath(repoPath) || isTestPath(repoPath);
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
  const changedSubsystems = new Set();
  const codeSubsystems = new Set();
  const changedInterfaces = new Set();
  const owners = new Set();
  const tests = new Set();
  const unknown = [];
  const unresolvedConsumers = new Set();
  const interfaceChanges = new Set();
  const dependencyFiles = [];
  const sensitiveFiles = [];

  for (const file of files) {
    const matchedSubsystems = subsystems.filter((subsystem) => subsystem.paths.some((pattern) => matchesGlob(file, pattern)));
    if (matchedSubsystems.length === 0) unknown.push(file);
    for (const subsystem of matchedSubsystems) {
      changedSubsystems.add(subsystem.id);
      if (!isL0Path(file)) codeSubsystems.add(subsystem.id);
      for (const owner of subsystem.owners ?? []) owners.add(owner);
      for (const test of subsystem.tests ?? []) tests.add(test);
    }

    const codeownerMatch = resolveCodeowners(file, input.codeowners ?? null);
    for (const owner of codeownerMatch.owners) owners.add(owner);

    for (const contract of interfaces) {
      if (!matchesGlob(file, contract.file)) continue;
      changedInterfaces.add(contract.id);
      interfaceChanges.add(contract.id);
      for (const consumer of contract.consumers ?? []) {
        if (subsystemById.has(consumer)) {
          changedSubsystems.add(consumer);
          codeSubsystems.add(consumer);
          const subsystem = subsystemById.get(consumer);
          for (const owner of subsystem.owners ?? []) owners.add(owner);
          for (const test of subsystem.tests ?? []) tests.add(test);
        } else {
          unresolvedConsumers.add(consumer);
        }
      }
    }

    if (isDependencyPath(file)) dependencyFiles.push(file);
    if (!isTestPath(file) && !isDocsPath(file) && (isSecuritySensitivePath(file) || isDataSensitivePath(file))) {
      sensitiveFiles.push(file);
    }
  }

  const reasons = [];
  for (const file of unknown) reasons.push(`unknown path: ${file}`);
  for (const id of [...interfaceChanges].sort()) reasons.push(`interface changed: ${id}`);
  if (codeSubsystems.size > 1) reasons.push(`cross-subsystem: ${[...codeSubsystems].sort().join(', ')}`);
  for (const file of dependencyFiles) reasons.push(`dependency changed: ${file}`);
  for (const file of sensitiveFiles) reasons.push(`sensitive path: ${file}`);
  for (const consumer of [...unresolvedConsumers].sort()) reasons.push(`consumer not registered: ${consumer}`);

  const l0 = files.every(isL0Path);
  const l2 = unknown.length > 0
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
