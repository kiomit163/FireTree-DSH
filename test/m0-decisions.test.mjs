import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const decisionsUrl = new URL('../docs/DECISIONS.md', import.meta.url);
const text = readFileSync(decisionsUrl, 'utf8');
const blocks = text
  .split(/^## /m)
  .filter((block) => /^D[1-8] /.test(block));

const field = (block, name) => new RegExp(`^- ${name}：`, 'm').test(block);

test('all eight decisions are present exactly once', () => {
  assert.equal(blocks.length, 8);
  assert.deepEqual(
    blocks.map((block) => block.slice(0, 2)),
    ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'],
  );
});

test('user authorization is recorded with a date and scope', () => {
  assert.match(text, /授权日期：2026-11-06/);
  assert.match(text, /用户直接开工指令/);
  assert.match(text, /不替代 L2 人签/);
  assert.match(text, /agent 自签恒为 0/);
});

for (const block of blocks) {
  const id = block.slice(0, 2);

  test(`${id} is ACCEPTED with all mandatory decision fields`, () => {
    assert.match(block, /^- 状态：ACCEPTED$/m);
    assert.doesNotMatch(block, /^- 状态：PROPOSED$/m);
    assert.ok(field(block, '日期'));
    assert.ok(field(block, '授权方式'));
    assert.ok(field(block, '采纳代价'));
    assert.ok(field(block, '证伪条件'));
    assert.ok(field(block, '复议时间'));
    assert.ok(field(block, '红队反对意见与回应'));
  });

  test(`${id} preserves option costs`, () => {
    assert.ok((block.match(/代价：/g) ?? []).length >= 2);
  });
}

for (const id of ['D1', 'D2']) {
  const block = blocks.find((candidate) => candidate.startsWith(`${id} `));
  test(`${id} records the million-line scale meaning`, () => {
    assert.match(block, /^- 规模含义：/m);
    assert.match(block, /10k–50k 文件/);
    assert.match(block, /1M–5M LOC/);
    assert.match(block, /3–5 个团队/);
    assert.match(block, /50–500 PR\/周/);
  });
}

test('D7 records the staged escape-defect thresholds without ambiguity', () => {
  const block = blocks.find((candidate) => candidate.startsWith('D7 '));
  assert.match(block, /M4 去留阈值/);
  assert.match(block, /≥20%/);
  assert.match(block, /12 个月能力目标/);
  assert.match(block, /≥30%/);
});
