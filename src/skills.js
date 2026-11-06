/** Skill registrations loaded from the package's skills directory. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILL_SPECS = Object.freeze([
  {
    name: 'firetree',
    description: 'Route FireTree-DSH delivery work: assess entry, receipt exit, four mechanisms, evidence and sign-off rules.',
    whenToUse: 'Use when a change is being delivered or when deciding which FireTree tool to call.',
  },
  {
    name: 'firetree-classify',
    description: 'Classify a subsystem or program object and record the OID dossier at the correct scope.',
    whenToUse: 'Use for subsystem/program decomposition questions, not for individual PRs.',
  },
  {
    name: 'firetree-assess',
    description: 'Assess a change for risk tier, impact set, required artifacts, sampling, and sign-off.',
    whenToUse: 'Use at the entry point of every change before claiming delivery work is complete.',
  },
  {
    name: 'firetree-synthesize',
    description: 'Plan or record independent-seat synthesis for an L2 cross-boundary decision.',
    whenToUse: 'Use only for L2 decisions that need multiple independent providers or seats.',
  },
  {
    name: 'firetree-review',
    description: 'Open, record rounds for, and issue a verdict on a tiered review.',
    whenToUse: 'Use when recording L1 three-step or L2 seven-step review evidence.',
  },
  {
    name: 'firetree-receipt',
    description: 'Build or check the delivery receipt from external evidence, review, correctness case, and human sign-off.',
    whenToUse: 'Use before claiming completion or merging a change that requires a receipt.',
  },
]);

/**
 * @param {string} name - Kebab-case skill directory name.
 * @returns {string} Absolute skill directory path.
 */
function skillDirectory(name) {
  return fileURLToPath(new URL(`../skills/${name}`, import.meta.url));
}

/** Runtime skill registrations with bodies read from SKILL.md. */
export const SKILLS = Object.freeze(SKILL_SPECS.map((spec) => {
  const directory = skillDirectory(spec.name);
  const content = readFileSync(new URL(`../skills/${spec.name}/SKILL.md`, import.meta.url), 'utf8');
  return Object.freeze({
    name: spec.name,
    description: spec.description,
    whenToUse: spec.whenToUse,
    content,
    source: 'bundled',
    invocation: Object.freeze({ modelInvocable: true, userInvocable: true }),
    resourceBase: Object.freeze({ kind: 'directory', path: directory }),
  });
}));
