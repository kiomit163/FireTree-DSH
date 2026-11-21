/** Registry and policy loading with schema validation. */

import { readFileSync } from 'node:fs';

import { listJsonFiles, readJsonFile, resolveWithin } from './artifacts.js';
import { loadPolicyChain, PolicyError } from './policy.js';
import { validateJsonSchema } from './schema.js';

const SUBSYSTEM_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/subsystems.schema.json', import.meta.url), 'utf8'));
const INTERFACE_SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/interfaces.schema.json', import.meta.url), 'utf8'));

/** Registry/policy loading failure. */
export class RegistryError extends Error {
  /**
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable message.
   * @param {{path?: string, errors?: Array<{path: string, keyword: string, message: string}>}} [details] - Details.
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.path = details.path;
    this.errors = details.errors ?? [];
  }
}

function schemaErrors(value, schema, label) {
  const errors = validateJsonSchema(value, schema);
  if (errors.length > 0) {
    throw new RegistryError('SCHEMA_INVALID', `${label} does not match its schema`, { errors });
  }
}

/**
 * @param {string} root - Repository root.
 * @param {string} [policyPath] - Repo-relative policy path.
 * @returns {Promise<object>} Validated policy.
 */
export async function loadPolicy(root, policyPath = '.firetree/policy.json') {
  try {
    return await loadPolicyChain(root, policyPath);
  } catch (error) {
    if (error instanceof PolicyError) {
      throw new RegistryError(error.code, error.message, { path: error.path, errors: error.errors });
    }
    throw error;
  }
}

async function loadEntries(root, relativeDirectory, schema, label) {
  const directory = resolveWithin(root, relativeDirectory);
  const files = await listJsonFiles(directory);
  const entries = [];
  const seen = new Set();
  for (const file of files) {
    const value = await readJsonFile(file);
    const relativePath = `${relativeDirectory}/${file.split(/[\\/]/).at(-1)}`;
    schemaErrors(value, schema, relativePath);
    if (seen.has(value.id)) throw new RegistryError('DUPLICATE_ID', `${label} id "${value.id}" is duplicated`, { path: relativePath });
    seen.add(value.id);
    entries.push(value);
  }
  entries.sort((left, right) => left.id.localeCompare(right.id));
  return entries;
}

/**
 * @param {string} root - Repository root.
 * @returns {Promise<object[]>} Validated subsystem entries.
 */
export async function loadSubsystems(root, relativeDirectory = '.firetree/subsystems') {
  return loadEntries(root, relativeDirectory, SUBSYSTEM_SCHEMA, 'subsystem');
}

/**
 * @param {string} root - Repository root.
 * @returns {Promise<object[]>} Validated interface entries.
 */
export async function loadInterfaces(root, relativeDirectory = '.firetree/interfaces') {
  return loadEntries(root, relativeDirectory, INTERFACE_SCHEMA, 'interface');
}

/**
 * @param {string} root - Repository root.
 * @param {{policyPath?: string, subsystemsPath?: string, interfacesPath?: string}} [options] - Path overrides.
 * @returns {Promise<{policy: object, subsystems: object[], interfaces: object[]}>} Loaded registry.
 */
export async function loadRegistry(root, options = {}) {
  const [policy, subsystems, interfaces] = await Promise.all([
    loadPolicy(root, options.policyPath),
    loadSubsystems(root, options.subsystemsPath),
    loadInterfaces(root, options.interfacesPath),
  ]);
  return { policy, subsystems, interfaces };
}
