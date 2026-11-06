import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const parking = readFileSync(new URL('../docs/PARKING-LOT.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../DEVELOPMENT-PLAN.md', import.meta.url), 'utf8');

test('M0/T0.10 scope freeze is recorded', () => {
  assert.match(parking, /M0\/T0\.10 确认（2026-11-06）/);
  assert.match(parking, /四机制 \+ 两横切 \+ 一测量层/);
  assert.match(parking, /未新增机制、工具或 schema/);
  assert.match(parking, /组织仿真、控制论数学化、代码索引、多宿主、研讨厅 UI 仍不进入 v1/);
});

test('all parking entries have a re-evaluation trigger', () => {
  const rows = parking.split('\n').filter((line) => /^\| P\d+ \|/.test(line));
  assert.ok(rows.length >= 16, `expected at least 16 parking entries, got ${rows.length}`);
  for (const row of rows) {
    const columns = row.split('|').map((part) => part.trim());
    assert.equal(columns.length >= 7, true, `malformed parking row: ${row}`);
    assert.ok(columns.at(-2).length > 0, `parking row has no trigger: ${row}`);
  }
  assert.match(parking, /\| P15 \|/);
  assert.match(parking, /\| P16 \|/);
});

test('README and master plan keep the anti-scope boundary', () => {
  assert.match(readme, /不是治理 OS|不是.*治理/);
  assert.match(readme, /不重造宿主已有的东西/);
  assert.match(plan, /## 16\. 不做什么（anti-scope）/);
  assert.match(plan, /不建工作流引擎、RBAC、CCB 运行时、组织仿真、签名服务/);
});
