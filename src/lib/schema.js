/** Minimal JSON Schema 2020-12 subset validator used by the M0 contracts. */

/** One validation failure. */
export class SchemaValidationError extends Error {
  /** @param {Array<{path: string, keyword: string, message: string}>} errors */
  constructor(errors) {
    super(errors.map((error) => `${error.path}: ${error.message}`).join('; '));
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * @param {unknown} value - Candidate JSON value.
 * @returns {'null'|'array'|'object'|'number'|'integer'|'string'|'boolean'|'unknown'} JSON type.
 */
export function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'object':
      return 'object';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    default:
      return 'unknown';
  }
}

function matchesType(value, type) {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    default:
      return false;
  }
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function childPath(path, key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function resolveLocalRef(ref, rootSchema) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`only local JSON pointers are supported, got ${String(ref)}`);
  }
  let current = rootSchema;
  for (const rawToken of ref.slice(2).split('/')) {
    const token = decodeURIComponent(rawToken).replaceAll('~1', '/').replaceAll('~0', '~');
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, token)) {
      throw new Error(`unresolved JSON pointer ${ref}`);
    }
    current = current[token];
  }
  return current;
}

function push(errors, path, keyword, message) {
  errors.push({ path, keyword, message });
}

function collectErrors(value, schema, path, rootSchema, depth) {
  const errors = [];
  validateNode(value, schema, path, rootSchema, errors, depth);
  return errors;
}

function validateNode(value, schema, path, rootSchema, errors, depth) {
  if (depth > 200) {
    push(errors, path, 'depth', 'schema recursion limit exceeded');
    return;
  }
  if (schema === true) return;
  if (schema === false) {
    push(errors, path, 'false', 'schema rejects every value');
    return;
  }
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    push(errors, path, 'schema', 'schema must be an object or boolean');
    return;
  }

  if (typeof schema.$ref === 'string') {
    try {
      validateNode(value, resolveLocalRef(schema.$ref, rootSchema), path, rootSchema, errors, depth + 1);
    } catch (error) {
      push(errors, path, '$ref', error instanceof Error ? error.message : String(error));
      return;
    }
  }

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => matchesType(value, type))) {
      push(errors, path, 'type', `must be ${allowed.join(' or ')}, got ${jsonType(value)}`);
      return;
    }
  }

  if (Object.hasOwn(schema, 'const') && !deepEqual(value, schema.const)) {
    push(errors, path, 'const', `must equal ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => deepEqual(value, candidate))) {
    push(errors, path, 'enum', `must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(', ')}`);
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) validateNode(value, branch, path, rootSchema, errors, depth + 1);
  }

  if (Array.isArray(schema.anyOf)) {
    const valid = schema.anyOf.some((branch) => collectErrors(value, branch, path, rootSchema, depth + 1).length === 0);
    if (!valid) push(errors, path, 'anyOf', 'must match at least one branch');
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((branch) => collectErrors(value, branch, path, rootSchema, depth + 1).length === 0);
    if (matches.length !== 1) push(errors, path, 'oneOf', `must match exactly one branch, matched ${matches.length}`);
  }

  if (schema.not !== undefined) {
    const valid = collectErrors(value, schema.not, path, rootSchema, depth + 1).length === 0;
    if (valid) push(errors, path, 'not', 'must not match the negative schema');
  }

  if (schema.if !== undefined) {
    const conditionValid = collectErrors(value, schema.if, path, rootSchema, depth + 1).length === 0;
    if (conditionValid && schema.then !== undefined) {
      validateNode(value, schema.then, path, rootSchema, errors, depth + 1);
    }
    if (!conditionValid && schema.else !== undefined) {
      validateNode(value, schema.else, path, rootSchema, errors, depth + 1);
    }
  }

  const isObject = matchesType(value, 'object');
  if (isObject) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.hasOwn(value, key)) push(errors, path, 'required', `missing required property "${key}"`);
      }
    }
    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) {
      push(errors, path, 'minProperties', `must have at least ${schema.minProperties} properties`);
    }
    if (Number.isInteger(schema.maxProperties) && Object.keys(value).length > schema.maxProperties) {
      push(errors, path, 'maxProperties', `must have at most ${schema.maxProperties} properties`);
    }
    if (typeof schema.properties === 'object' && schema.properties !== null && !Array.isArray(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, key)) {
          validateNode(value[key], childSchema, childPath(path, key), rootSchema, errors, depth + 1);
        }
      }
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!known.has(key)) push(errors, childPath(path, key), 'additionalProperties', 'property is not allowed');
      }
    } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!known.has(key)) validateNode(value[key], schema.additionalProperties, childPath(path, key), rootSchema, errors, depth + 1);
      }
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      push(errors, path, 'minItems', `must have at least ${schema.minItems} items`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      push(errors, path, 'maxItems', `must have at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = canonical(item);
        if (seen.has(key)) push(errors, path, 'uniqueItems', 'items must be unique');
        seen.add(key);
      }
    }
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        validateNode(value[index], schema.items, `${path}[${index}]`, rootSchema, errors, depth + 1);
      }
    }
  }

  if (typeof value === 'string') {
    const length = [...value].length;
    if (Number.isInteger(schema.minLength) && length < schema.minLength) {
      push(errors, path, 'minLength', `must have at least ${schema.minLength} characters`);
    }
    if (Number.isInteger(schema.maxLength) && length > schema.maxLength) {
      push(errors, path, 'maxLength', `must have at most ${schema.maxLength} characters`);
    }
    if (typeof schema.pattern === 'string') {
      let pattern;
      try {
        pattern = new RegExp(schema.pattern, 'u');
      } catch (error) {
        push(errors, path, 'pattern', `invalid pattern: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (pattern !== undefined && !pattern.test(value)) {
        push(errors, path, 'pattern', `must match ${schema.pattern}`);
      }
    }
    if (schema.format === 'date-time' && (!DATE_TIME.test(value) || Number.isNaN(Date.parse(value)))) {
      push(errors, path, 'format', 'must be an RFC 3339 date-time');
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      push(errors, path, 'minimum', `must be at least ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      push(errors, path, 'maximum', `must be at most ${schema.maximum}`);
    }
  }
}

/**
 * Validate a JSON value against the supported JSON Schema subset.
 *
 * Supported keywords: local $ref, type, const, enum, allOf/anyOf/oneOf/not,
 * if/then/else, required, properties, additionalProperties, min/maxProperties,
 * min/maxItems, uniqueItems, items, min/maxLength, pattern, date-time format,
 * minimum, and maximum.
 *
 * @param {unknown} value - Candidate value.
 * @param {object|boolean} schema - Schema node.
 * @param {{rootSchema?: object|boolean}} [options] - Root used for local $ref.
 * @returns {Array<{path: string, keyword: string, message: string}>} Errors; empty when valid.
 */
export function validateJsonSchema(value, schema, options = {}) {
  const errors = [];
  validateNode(value, schema, '$', options.rootSchema ?? schema, errors, 0);
  return errors;
}

/**
 * @param {unknown} value - Candidate value.
 * @param {object|boolean} schema - Schema node.
 * @param {{rootSchema?: object|boolean}} [options] - Root used for local $ref.
 * @returns {void}
 */
export function assertJsonSchemaValue(value, schema, options = {}) {
  const errors = validateJsonSchema(value, schema, options);
  if (errors.length > 0) throw new SchemaValidationError(errors);
}
