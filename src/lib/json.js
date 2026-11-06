/** Strict JSON value admission and serialization helpers. */

/** Error code emitted for values that cannot be represented losslessly as JSON. */
export const JSON_VALUE_ERROR = 'INVALID_JSON_VALUE';

/** Thrown when a value is not strict JSON. */
export class JsonValueError extends Error {
  /**
   * @param {string} path - JSON path of the offending value.
   * @param {string} reason - Human-readable reason.
   */
  constructor(path, reason) {
    super(`Invalid JSON value at ${path}: ${reason}`);
    this.name = 'JsonValueError';
    this.code = JSON_VALUE_ERROR;
    this.path = path;
  }
}

/**
 * Assert that a value is representable as strict JSON without loss.
 *
 * Rejected values include undefined, functions, symbols, bigint, non-finite
 * numbers, negative zero, sparse arrays, cycles, class instances, Date, and
 * objects carrying symbol keys or a toJSON hook.
 *
 * @param {unknown} value - Candidate value.
 * @param {string} [path] - JSON path used in the error message.
 * @returns {void}
 */
export function assertJsonValue(value, path = '$') {
  const seen = new WeakSet();

  const visit = (current, at) => {
    if (current === null) return;

    switch (typeof current) {
      case 'string':
      case 'boolean':
        return;
      case 'number':
        if (!Number.isFinite(current)) throw new JsonValueError(at, 'number must be finite');
        if (Object.is(current, -0)) throw new JsonValueError(at, 'negative zero is not lossless JSON');
        return;
      case 'object':
        break;
      default:
        throw new JsonValueError(at, `unsupported type ${typeof current}`);
    }

    if (seen.has(current)) throw new JsonValueError(at, 'circular reference');
    seen.add(current);

    try {
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index += 1) {
          if (!(index in current)) throw new JsonValueError(`${at}[${index}]`, 'sparse array');
          visit(current[index], `${at}[${index}]`);
        }
        return;
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new JsonValueError(at, 'object must be a plain object');
      }
      if (Object.getOwnPropertySymbols(current).length > 0) {
        throw new JsonValueError(at, 'symbol keys are not JSON');
      }
      if (Object.hasOwn(current, 'toJSON') && typeof current.toJSON === 'function') {
        throw new JsonValueError(at, 'toJSON hooks are not accepted');
      }

      for (const key of Object.keys(current)) {
        visit(current[key], `${at}.${key}`);
      }
    } finally {
      seen.delete(current);
    }
  };

  visit(value, path);
}

/**
 * Serialize a strict JSON value.
 *
 * @param {unknown} value - Candidate value.
 * @returns {string} Canonical JSON text.
 */
export function toStrictJson(value) {
  assertJsonValue(value);
  return JSON.stringify(value);
}

/**
 * Parse JSON text and assert that the result is a strict JSON value.
 *
 * @param {string} text - JSON text.
 * @returns {unknown} Parsed value.
 */
export function parseStrictJson(text) {
  if (typeof text !== 'string') throw new TypeError('parseStrictJson expects a string');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new JsonValueError('$', `invalid JSON text: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertJsonValue(parsed);
  return parsed;
}

/**
 * Check whether a value is strict JSON without throwing.
 *
 * @param {unknown} value - Candidate value.
 * @returns {boolean} Whether the value passes strict JSON admission.
 */
export function isStrictJsonValue(value) {
  try {
    assertJsonValue(value);
    return true;
  } catch {
    return false;
  }
}
