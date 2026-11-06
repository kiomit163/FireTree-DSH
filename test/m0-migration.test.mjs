import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(new URL('../docs/MIGRATION.md', import.meta.url), 'utf8');

test('migration confirms all four classes and freezes the deletion list', () => {
  assert.match(migration, /T0\.8 确认（2026-11-06）/);
  assert.match(migration, /\[x\] 逐项确认 10\/10/);
  assert.match(migration, /\[x\] 逐项确认 6\/6/);
  assert.match(migration, /\[x\] \*\*删除清单冻结（2026-11-06，T0\.8）\*\*/);
  assert.match(migration, /### 2\.5 冻结记录（T0\.8）/);
  assert.match(migration, /冻结例外\*\*：无/);
});

test('migration uses the canonical src/lib paths and six skills', () => {
  assert.match(migration, /`src\/lib\/schema\.js`/);
  assert.match(migration, /`src\/lib\/shell-ast\.js`/);
  assert.match(migration, /`src\/lib\/rounds\.js`/);
  assert.match(migration, /`src\/lib\/hash\.js`/);
  assert.match(migration, /`src\/lib\/receipt\.js`/);
  assert.match(migration, /6 个技能/);
  assert.doesNotMatch(migration, /5 个技能/);
});

test('deletion list retains every frozen runtime group', () => {
  for (const item of [
    '`packages/workflow/*`',
    '`packages/identity/*`',
    '`packages/ccb/*`',
    '`packages/org/*`',
    '`packages/evidence/sign.mjs`',
    '`hooks/*`',
    '`install.mjs`',
    '`scripts/{run,accept,gate,charter,policy,ledger,review,program}.mjs`',
    '`tools/selftest-*.mjs`',
  ]) {
    assert.ok(migration.includes(item), `missing delete item ${item}`);
  }
});

test('archive record and completion boundaries remain honest', () => {
  assert.match(migration, /`v5-archive`/);
  assert.match(migration, /00e81a890e7cefc2fff89c2991a06593a827f4b8/);
  assert.match(migration, /完成标准未全部满足/);
  assert.match(migration, /不得声称迁移完成/);
});
