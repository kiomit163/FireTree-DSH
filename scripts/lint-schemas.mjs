#!/usr/bin/env node
/** Lint the JSON Schema subset used by the FireTree contracts. */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_DIR = fileURLToPath(new URL('../schemas/', import.meta.url));

/**
 * Keywords the local validator actually implements.
 * Anything else would be silently ignored, which is a contract-integrity bug.
 */
const VALIDATION_KEYWORDS = new Set([
  '$ref',
  'type',
  'const',
  'enum',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'required',
  'properties',
  'additionalProperties',
  'minProperties',
  'maxProperties',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
]);

/** Annotation/metadata keywords; they do not change validation and are allowed. */
const ANNOTATION_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  '$defs',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

const TYPES = new Set(['null', 'array', 'object', 'number', 'integer', 'string', 'boolean']);
const FORMATS = new Set(['date-time']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pointerKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function resolveLocalRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`only local JSON pointers are supported, got ${String(ref)}`);
  }
  let current = root;
  for (const rawToken of ref.slice(2).split('/')) {
    const token = decodeURIComponent(rawToken).replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isPlainObject(current) || !Object.hasOwn(current, token)) {
      throw new Error(`unresolved JSON pointer ${ref}`);
    }
    current = current[token];
  }
  return current;
}

function lintNode(schema, root, path, errors) {
  if (schema === true || schema === false) return;
  if (!isPlainObject(schema)) {
    errors.push(`${path}: schema must be an object or boolean`);
    return;
  }

  for (const key of Object.keys(schema)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    if (!VALIDATION_KEYWORDS.has(key)) {
      errors.push(`${path}: unsupported validation keyword ${JSON.stringify(key)}`);
    }
  }

  if (Object.hasOwn(schema, '$ref')) {
    if (typeof schema.$ref !== 'string') {
      errors.push(`${path}: $ref must be a string`);
    } else {
      try {
        resolveLocalRef(schema.$ref, root);
      } catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (Object.hasOwn(schema, 'type')) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length === 0) errors.push(`${path}: type must not be empty`);
    for (const type of types) {
      if (!TYPES.has(type)) errors.push(`${path}: unsupported type ${JSON.stringify(type)}`);
    }
  }

  if (Object.hasOwn(schema, 'enum') && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    errors.push(`${path}: enum must be a non-empty array`);
  }

  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    if (!Object.hasOwn(schema, keyword)) continue;
    if (!Array.isArray(schema[keyword]) || schema[keyword].length === 0) {
      errors.push(`${path}: ${keyword} must be a non-empty array`);
      continue;
    }
    schema[keyword].forEach((child, index) => lintNode(child, root, `${path}.${keyword}[${index}]`, errors));
  }

  if (Object.hasOwn(schema, 'not')) lintNode(schema.not, root, `${path}.not`, errors);

  for (const keyword of ['if', 'then', 'else']) {
    if (Object.hasOwn(schema, keyword)) lintNode(schema[keyword], root, `${path}.${keyword}`, errors);
  }

  if (Object.hasOwn(schema, 'required')) {
    if (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== 'string')) {
      errors.push(`${path}: required must be an array of strings`);
    } else if (schema.additionalProperties === false && isPlainObject(schema.properties)) {
      // Only enforce declared properties when the object is closed. A partial
      // allOf branch (no additionalProperties: false) may require keys that the
      // base schema declares.
      for (const key of schema.required) {
        if (!Object.hasOwn(schema.properties, key)) {
          errors.push(`${path}: required property ${JSON.stringify(key)} is not declared in properties`);
        }
      }
    }
  }

  if (Object.hasOwn(schema, 'properties')) {
    if (!isPlainObject(schema.properties)) {
      errors.push(`${path}: properties must be an object`);
    } else {
      for (const [key, child] of Object.entries(schema.properties)) {
        lintNode(child, root, `${path}${pointerKey(key)}`, errors);
      }
    }
  }

  if (Object.hasOwn(schema, '$defs')) {
    if (!isPlainObject(schema.$defs)) {
      errors.push(`${path}: $defs must be an object`);
    } else {
      for (const [key, child] of Object.entries(schema.$defs)) {
        lintNode(child, root, `${path}.$defs${pointerKey(key)}`, errors);
      }
    }
  }

  if (Object.hasOwn(schema, 'additionalProperties')) {
    if (typeof schema.additionalProperties !== 'boolean') {
      lintNode(schema.additionalProperties, root, `${path}.additionalProperties`, errors);
    }
  }

  if (Object.hasOwn(schema, 'items')) {
    if (Array.isArray(schema.items)) {
      errors.push(`${path}: tuple items are not supported`);
    } else {
      lintNode(schema.items, root, `${path}.items`, errors);
    }
  }

  for (const keyword of ['minProperties', 'maxProperties', 'minItems', 'maxItems']) {
    if (Object.hasOwn(schema, keyword) && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) {
      errors.push(`${path}: ${keyword} must be a non-negative integer`);
    }
  }

  for (const keyword of ['minLength', 'maxLength']) {
    if (Object.hasOwn(schema, keyword) && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) {
      errors.push(`${path}: ${keyword} must be a non-negative integer`);
    }
  }

  if (Object.hasOwn(schema, 'uniqueItems') && typeof schema.uniqueItems !== 'boolean') {
    errors.push(`${path}: uniqueItems must be a boolean`);
  }

  if (Object.hasOwn(schema, 'pattern')) {
    if (typeof schema.pattern !== 'string') {
      errors.push(`${path}: pattern must be a string`);
    } else {
      try {
        new RegExp(schema.pattern, 'u');
      } catch (error) {
        errors.push(`${path}: invalid pattern (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }

  if (Object.hasOwn(schema, 'format') && !FORMATS.has(schema.format)) {
    errors.push(`${path}: unsupported format ${JSON.stringify(schema.format)}`);
  }

  for (const keyword of ['minimum', 'maximum']) {
    if (Object.hasOwn(schema, keyword) && (typeof schema[keyword] !== 'number' || !Number.isFinite(schema[keyword]))) {
      errors.push(`${path}: ${keyword} must be a finite number`);
    }
  }
}

/**
 * @param {string} directory - Directory containing `*.schema.json`.
 * @returns {{files: number, errors: string[]}} Lint result.
 */
export function lintSchemas(directory = SCHEMA_DIR) {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.schema.json'))
    .sort();
  const errors = [];
  for (const name of files) {
    const path = join(directory, name);
    let schema;
    try {
      schema = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      errors.push(`${name}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    lintNode(schema, schema, name, errors);
  }
  return { files: files.length, errors };
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const result = lintSchemas();
  console.log(`schemas=${result.files} errors=${result.errors.length}`);
  for (const error of result.errors) console.error(error);
  if (result.errors.length > 0) process.exitCode = 1;
}
