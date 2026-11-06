import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const baseline = readFileSync(new URL('../docs/SCALE-BASELINE.md', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../DEVELOPMENT-PLAN.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('baseline records the selected target and measured dimensions', () => {
  assert.match(baseline, /T0\.9/);
  assert.match(baseline, /MiniMax-Code/);
  assert.match(baseline, /4,562/);
  assert.match(baseline, /1,119,654/);
  assert.match(baseline, /938,534/);
  assert.match(baseline, /192 创建 \/ 169 合并（约 24\/周）/);
  assert.match(baseline, /582\.5s（约 9\.7 min）/);
  assert.match(baseline, /无 JUnit\/SARIF\/coverage\/SBOM/);
  assert.match(baseline, /0 个 subsystem \/ 0 个 interface/);
});

test('baseline records >2x deviations and an explicit adjustment', () => {
  assert.match(baseline, /2\.19×/);
  assert.match(baseline, /2\.08×/);
  assert.match(baseline, /不据此宣称百万行规模已验证/);
  assert.match(baseline, /M4 目标不降低/);
  assert.match(baseline, /补证据生产者/);
  assert.match(baseline, /CI 时长自动化/);
  assert.match(baseline, /metrics-v0/);
});

test('baseline is reproducible and honest about its limits', () => {
  assert.match(baseline, /4198174c89963ca7614ae7705bb897814d11b4ee/);
  assert.match(baseline, /3c21163c85a9684030cb147bfef48c6284fa3c46/);
  assert.match(baseline, /shallow/);
  assert.match(baseline, /团队数不可测/);
  assert.match(baseline, /PR 数包含 bot\/Dependabot/);
  assert.match(baseline, /https:\/\/github\.com\/MiniMax-AI\/minimax-code/);
  assert.match(baseline, /CulisBooks/);
});

test('main plan and README reference the M0 baseline', () => {
  assert.match(plan, /T0\.9 复核（2026-11-06）/);
  assert.match(plan, /docs\/SCALE-BASELINE\.md/);
  assert.match(readme, /docs\/SCALE-BASELINE\.md/);
});
