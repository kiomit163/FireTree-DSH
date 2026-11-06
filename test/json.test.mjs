import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertJsonValue,
  isStrictJsonValue,
  JsonValueError,
  parseStrictJson,
  toStrictJson,
} from '../src/lib/json.js';

const isJsonValueError = (error) => error instanceof JsonValueError;

test('accepts nested strict JSON values', () => {
  const shared = { value: '重复引用不是环' };
  const value = {
    text: 'FireTree',
    count: 3,
    ratio: 0.5,
    enabled: true,
    nothing: null,
    items: [1, 'two', false, shared, shared],
  };
  assert.doesNotThrow(() => assertJsonValue(value));
  assert.equal(isStrictJsonValue(value), true);
  assert.deepEqual(parseStrictJson(toStrictJson(value)), value);
});

test('rejects undefined, functions, symbols, and bigint', () => {
  for (const value of [undefined, () => 1, Symbol('x'), 1n]) {
    assert.throws(() => assertJsonValue(value), isJsonValueError);
  }
  assert.throws(() => assertJsonValue({ nested: undefined }), isJsonValueError);
});

test('rejects non-finite numbers and negative zero', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
    assert.throws(() => assertJsonValue(value), isJsonValueError);
  }
});

test('rejects sparse arrays and circular references', () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => assertJsonValue(sparse), isJsonValueError);

  const circular = {};
  circular.self = circular;
  assert.throws(() => assertJsonValue(circular), isJsonValueError);
});

test('rejects class instances, dates, symbol keys, and toJSON hooks', () => {
  class Custom {}
  const symbolKeyed = { [Symbol('hidden')]: 1 };
  const toJson = { toJSON: () => 'rewritten' };

  for (const value of [new Custom(), new Date('2026-11-06T00:00:00Z'), symbolKeyed, toJson]) {
    assert.throws(() => assertJsonValue(value), isJsonValueError);
  }
});

test('reports the JSON path of the offending value', () => {
  assert.throws(
    () => assertJsonValue({ outer: { inner: Number.NaN } }),
    (error) => isJsonValueError(error) && error.path === '$.outer.inner',
  );
});

test('parseStrictJson rejects malformed JSON and accepts valid JSON', () => {
  assert.deepEqual(parseStrictJson('{"a":[1,true,null]}'), { a: [1, true, null] });
  assert.throws(() => parseStrictJson('{"a":}'), isJsonValueError);
  assert.throws(() => parseStrictJson('{"a": Infinity}'), isJsonValueError);
});

test('toStrictJson returns lossless JSON text', () => {
  assert.equal(toStrictJson({ ok: true, n: 1 }), '{"ok":true,"n":1}');
  assert.throws(() => toStrictJson({ bad: undefined }), isJsonValueError);
});
