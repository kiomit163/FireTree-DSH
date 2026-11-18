import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { apply, inject, PROMPT_SECTION } from '../index.js';
import { SKILLS } from '../src/skills.js';

function context() {
  const tools = new Map();
  const sections = [];
  const skills = [];
  const ctx = {
    tools: {
      register(definition) {
        assert.equal(tools.has(definition.name), false, `duplicate tool ${definition.name}`);
        tools.set(definition.name, definition);
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section);
      },
    },
    skills: {
      register(skill) {
        skills.push(skill);
      },
    },
  };
  return { ctx, tools, sections, skills };
}

test('declares the host services it needs', () => {
  assert.deepEqual(inject, ['tools', 'systemPrompt', 'skills', 'workingDirectory']);
});

test('registers exactly seven tools with callable definitions', () => {
  const { ctx, tools } = context();
  apply(ctx);

  assert.equal(tools.size, 7);
  assert.deepEqual(
    [...tools.keys()].sort(),
    ['firetree_assess', 'firetree_classify', 'firetree_hypothesis', 'firetree_receipt', 'firetree_review', 'firetree_state', 'firetree_synthesize'],
  );

  for (const [name, definition] of tools) {
    assert.equal(definition.name, name);
    assert.equal(typeof definition.description, 'string');
    assert.ok(definition.description.length > 0);
    assert.equal(definition.parameters.type, 'object');
    assert.equal(definition.parameters.additionalProperties, false);
    assert.equal(definition.output.schema.type, 'object');
    assert.equal(typeof definition.output.render, 'function');
    assert.equal(typeof definition.execute, 'function');
  }
});

test('prompt section stays within the twelve-line budget', () => {
  assert.equal(PROMPT_SECTION.name, 'firetree:delivery-protocol');
  assert.equal(Number.isFinite(PROMPT_SECTION.order), true);
  assert.ok(PROMPT_SECTION.text.split('\n').length <= 12);
  assert.match(PROMPT_SECTION.text, /M[12]/);
});

test('registers six placeholders whose bodies load from SKILL.md', () => {
  const { ctx, sections, skills } = context();
  apply(ctx);

  assert.equal(sections.length, 1);
  assert.equal(skills.length, 6);
  assert.deepEqual(
    skills.map((skill) => skill.name).sort(),
    ['firetree', 'firetree-assess', 'firetree-classify', 'firetree-receipt', 'firetree-review', 'firetree-synthesize'],
  );

  for (const skill of skills) {
    assert.ok(skill.description.length > 0);
    assert.ok(skill.content.length > 0);
    assert.match(skill.content, /M0 占位|M1|M2/);
    assert.equal(skill.source, 'bundled');
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true });
    assert.equal(skill.resourceBase.kind, 'directory');
    assert.ok(skill.resourceBase.path.endsWith(join('skills', skill.name)));
  }

  assert.equal(SKILLS.length, 6);
});
