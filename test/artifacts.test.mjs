import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ArtifactError,
  assertSafeId,
  firetreeRelativePath,
  listJsonFiles,
  readFiretreeJson,
  resolveWithin,
  writeFiretreeJson,
  writeJsonAtomic,
  writeTextAtomic,
} from '../src/lib/artifacts.js';
import { canonicalJson } from '../src/lib/json.js';

async function withTempDir(callback) {
  const root = await mkdtemp(join(tmpdir(), 'firetree-artifacts-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('canonical JSON sorts object keys but preserves arrays', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalJson({ z: [3, { b: 2, a: 1 }], a: null }), '{"a":null,"z":[3,{"a":1,"b":2}]}');
});

test('atomic JSON writes and reads back strict JSON', async () => {
  await withTempDir(async (root) => {
    const file = join(root, 'nested', 'artifact.json');
    const result = await writeJsonAtomic(file, { ok: true, n: 2 });
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await readFile(file, 'utf8')).endsWith('\n'), true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ok: true, n: 2 });
  });
});

test('writeTextAtomic replaces an existing file atomically', async () => {
  await withTempDir(async (root) => {
    const file = join(root, 'state.txt');
    await writeFile(file, 'old', 'utf8');
    await writeTextAtomic(file, 'new');
    assert.equal(await readFile(file, 'utf8'), 'new');
  });
});

test('.firetree artifacts write and verify a sidecar hash', async () => {
  await withTempDir(async (root) => {
    const result = await writeFiretreeJson(root, firetreeRelativePath('oid', 'billing.json'), {
      schema: 'firetree.oid/v1',
      subsystem: 'billing',
    });
    assert.equal(result.path, '.firetree/oid/billing.json');
    const read = await readFiretreeJson(root, result.path, { verifyHash: true });
    assert.equal(read.sha256, result.sha256);
    assert.deepEqual(read.value, { schema: 'firetree.oid/v1', subsystem: 'billing' });

    await writeFile(join(root, result.path), '{"tampered":true}\n', 'utf8');
    await assert.rejects(
      readFiretreeJson(root, result.path, { verifyHash: true }),
      (error) => error instanceof ArtifactError && error.code === 'HASH_MISMATCH',
    );
  });
});

test('rejects path traversal and unsafe ids', async () => {
  await withTempDir(async (root) => {
    for (const path of ['../escape.json', '/absolute.json', 'a/../../b.json']) {
      assert.throws(() => resolveWithin(root, path), (error) => error instanceof ArtifactError && error.code === 'PATH_TRAVERSAL');
    }
    for (const id of ['..', '.', 'a/b', '', 'a b']) {
      assert.throws(() => assertSafeId(id), (error) => error instanceof ArtifactError && error.code === 'INVALID_ID');
    }
    assert.equal(assertSafeId('billing-01'), 'billing-01');
  });
});

test('lists only JSON files and handles a missing directory', async () => {
  await withTempDir(async (root) => {
    assert.deepEqual(await listJsonFiles(join(root, 'missing')), []);
    await writeJsonAtomic(join(root, 'b.json'), { b: 1 });
    await writeJsonAtomic(join(root, 'a.json'), { a: 1 });
    await writeFile(join(root, 'note.txt'), 'x', 'utf8');
    const files = await listJsonFiles(root);
    assert.deepEqual(files.map((file) => file.split(/[\\/]/).at(-1)), ['a.json', 'b.json']);
  });
});

test('rejects non-strict JSON at write time', async () => {
  await withTempDir(async (root) => {
    await assert.rejects(writeJsonAtomic(join(root, 'bad.json'), { value: undefined }), /Invalid JSON/);
  });
});
