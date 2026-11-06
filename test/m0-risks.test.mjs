import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const plan = readFileSync(new URL('../DEVELOPMENT-PLAN.md', import.meta.url), 'utf8');
const section = plan.match(/## 15\. 风险登记册([\s\S]*?)## 16\./)?.[1] ?? '';

test('risk register has owner, warning, mitigation, and contingency columns', () => {
  assert.ok(section.length > 0, 'risk register section is missing');
  assert.match(section, /\| ID \| 风险 \| P \| I \| Owner \| 预警 \/ 阈值 \| 缓解 \| 应急 \|/);
  assert.match(section, /Owner 是角色而非个人/);
});

test('risk register covers the required delivery and platform risks', () => {
  const required = [
    '影响分析漏报',
    '吞吐崩溃',
    '成本超预算',
    '团队绕过',
    '人签橡皮图章',
    'DSH API 漂移',
    '工件泛滥',
    '隐私/密钥',
    '单维护者',
    '过度拟合试点',
    '证据剧场',
  ];
  for (const risk of required) assert.match(section, new RegExp(risk.replace('/', '\\/')));
});

test('risk register has at least twelve tracked risk rows', () => {
  const rows = section.split('\n').filter((line) => /^\| R\d+ \|/.test(line));
  assert.ok(rows.length >= 12, `expected at least 12 risk rows, got ${rows.length}`);
  for (const row of rows) {
    assert.match(row, /\| (高|中|低) \| (高|中|低) \|/);
    assert.match(row, /\| 缓解 |/);
  }
});
