/** Project rich internal JSON Schema documents onto the Host tool-schema subset. */

const ALLOWED_KEYS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'description',
  'title',
  'default',
  'examples',
]);

function inferredType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return undefined;
}

/**
 * Recursively remove keywords the Host tool-schema compiler does not accept.
 *
 * Internal schemas may keep pattern/minLength/format/uniqueItems/minItems/
 * minimum/maximum for our own validation; the model-facing schema only needs
 * shape and enums.
 *
 * @param {object} schema - Internal schema node.
 * @returns {object} Host-supported schema node.
 */
export function toToolSchema(schema) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new TypeError('toToolSchema expects a schema object');
  }

  const output = {};
  for (const key of ALLOWED_KEYS) {
    if (!Object.hasOwn(schema, key)) continue;
    if (key === 'properties') {
      output.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([name, child]) => [name, toToolSchema(child)]),
      );
    } else if (key === 'items') {
      output.items = toToolSchema(schema.items);
    } else if (key === 'oneOf') {
      if (!Array.isArray(schema.oneOf)) throw new TypeError('oneOf must be an array');
      output.oneOf = schema.oneOf.map(toToolSchema);
    } else {
      output[key] = schema[key];
    }
  }

  if (output.const !== undefined && output.type === undefined && output.oneOf === undefined) {
    const type = inferredType(output.const);
    if (type !== undefined) output.type = type;
  }
  return output;
}

/**
 * Collect unsupported keywords for tests and diagnostics.
 *
 * @param {unknown} schema - Schema node.
 * @param {string} [path] - Diagnostic path.
 * @param {string[]} [found] - Accumulator.
 * @returns {string[]} Unsupported-key paths.
 */
export function unsupportedToolSchemaPaths(schema, path = '$', found = []) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return found;
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYS.has(key)) found.push(`${path}.${key}`);
  }
  const next = [
    ...Object.entries(schema.properties ?? {}).map(([name, child]) => [child, `${path}.properties.${name}`]),
    ...(schema.items === undefined ? [] : [[schema.items, `${path}.items`]]),
    ...(Array.isArray(schema.oneOf) ? schema.oneOf.map((child, index) => [child, `${path}.oneOf[${index}]`]) : []),
  ];
  for (const [child, childPath] of next) unsupportedToolSchemaPaths(child, childPath, found);
  return found;
}
