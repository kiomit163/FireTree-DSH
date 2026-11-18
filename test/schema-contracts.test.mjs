import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateCorrectnessCase } from '../src/lib/correctness.js';
import { validateJsonSchema } from '../src/lib/schema.js';

const readJson = (relativePath) => JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
const readBytes = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url));

const policySchema = readJson('schemas/policy.schema.json');
const subsystemSchema = readJson('schemas/subsystems.schema.json');
const interfaceSchema = readJson('schemas/interfaces.schema.json');
const receiptSchema = readJson('schemas/receipt.schema.json');
const correctnessCaseSchema = receiptSchema.$defs.correctnessCase;

const policyOrg = readJson('fixtures/policy-org.json');
const policyRepo = readJson('fixtures/policy-repo.json');
const policySubsystem = readJson('fixtures/policy-subsystem.json');
const subsystem = readJson('fixtures/subsystem-billing.json');
const contract = readJson('fixtures/interface-billing-api.json');
const receiptL0 = readJson('fixtures/receipt-l0.json');
const receiptL1 = readJson('fixtures/receipt-l1.json');
const receiptL2 = readJson('fixtures/receipt-l2.json');
const caseL1 = readJson('fixtures/correctness-case-l1.json');
const caseL2 = readJson('fixtures/correctness-case-l2.json');
const caseEmptyMapping = readJson('fixtures/correctness-case-l2-empty-mapping.json');
const caseUnmappedClaim = readJson('fixtures/correctness-case-l2-unmapped-claim.json');
const fixedNow = new Date('2026-11-06T00:00:00Z');

const errorsFor = (value, schema, rootSchema = schema) => validateJsonSchema(value, schema, { rootSchema });
const assertValid = (value, schema, rootSchema = schema) => assert.deepEqual(errorsFor(value, schema, rootSchema), []);
const assertInvalid = (value, schema, pattern, rootSchema = schema) => {
  const errors = errorsFor(value, schema, rootSchema);
  assert.ok(errors.length > 0, 'expected schema rejection');
  if (pattern !== undefined) {
    assert.ok(errors.some((error) => pattern.test(error.message)), `expected ${pattern}, got ${JSON.stringify(errors)}`);
  }
};

test('all four schemas are JSON Schema 2020-12 documents with stable ids', () => {
  for (const schema of [policySchema, subsystemSchema, interfaceSchema, receiptSchema]) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /^https:\/\/firetree\.local\/schemas\//);
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
  }
  assert.ok(receiptSchema.$defs.correctnessCase, 'receipt schema must embed correctness case v0');
});

test('policy fixtures are valid and demonstrate org -> repo -> subsystem tightening', () => {
  assertValid(policyOrg, policySchema);
  assertValid(policyRepo, policySchema);
  assertValid(policySubsystem, policySchema);

  assert.equal(policyOrg.extends, null);
  assert.equal(policyRepo.extends, 'policy-org.json');
  assert.equal(policySubsystem.extends, 'policy-repo.json');

  assert.ok(policyRepo.tiers.L0.sample_rate > policyOrg.tiers.L0.sample_rate);
  assert.ok(policySubsystem.tiers.L0.sample_rate > policyRepo.tiers.L0.sample_rate);
  assert.ok(policyRepo.tiers.L2.token_budget < policyOrg.tiers.L2.token_budget);
  assert.ok(policySubsystem.tiers.L2.token_budget < policyRepo.tiers.L2.token_budget);
  assert.equal(policySubsystem.inheritance.mode, 'tighten_only');
  assert.deepEqual(policySubsystem.inheritance.relaxation_requires, ['architect_approval', 'expires_at']);
});

test('policy rejects relaxation outside an exception and non-human exception approval', () => {
  const relaxed = structuredClone(policySubsystem);
  relaxed.inheritance.mode = 'allow_relax';
  assertInvalid(relaxed, policySchema, /tighten_only/);

  const agentApproved = structuredClone(policySubsystem);
  agentApproved.exceptions[0].approver = 'agent:bot';
  assertInvalid(agentApproved, policySchema, /must match \^human:/);
});

test('subsystem and interface fixtures validate their registries', () => {
  assertValid(subsystem, subsystemSchema);
  assertValid(contract, interfaceSchema);

  const noOwners = structuredClone(subsystem);
  noOwners.owners = [];
  assertInvalid(noOwners, subsystemSchema, /at least 1 items/);

  const noConsumers = structuredClone(contract);
  noConsumers.consumers = [];
  assertInvalid(noConsumers, interfaceSchema, /at least 1 items/);
});

test('L0, L1, and L2 receipts validate the same v1 contract', () => {
  assertValid(receiptL0, receiptSchema);
  assertValid(receiptL1, receiptSchema);
  assertValid(receiptL2, receiptSchema);

  assert.equal(receiptL0.signoff, null);
  assert.equal(receiptL0.correctness_case, null);
  assert.equal(receiptL0.assurance, 'A1');
  assert.match(receiptL0.evidence[0].producer, /^local:/);
  assert.equal(receiptL1.correctness_case.mapped_claims, 1);
  assert.equal(receiptL2.correctness_case.mapped_claims, 2);
});

test('receipt correctness-case summaries point at the fixture content hashes', () => {
  for (const [receipt, path] of [
    [receiptL1, 'fixtures/correctness-case-l1.json'],
    [receiptL2, 'fixtures/correctness-case-l2.json'],
  ]) {
    const hash = createHash('sha256').update(readBytes(path)).digest('hex');
    assert.equal(receipt.correctness_case.sha256, hash);
  }
});

test('L2 rejects a missing correctness case and a non-human sign-off', () => {
  const missingCase = structuredClone(receiptL2);
  missingCase.correctness_case = null;
  assertInvalid(missingCase, receiptSchema, /must be object/);

  const ciSignoff = structuredClone(receiptL2);
  ciSignoff.signoff.by = 'ci';
  assertInvalid(ciSignoff, receiptSchema, /human/);

  const oneRound = structuredClone(receiptL2);
  oneRound.review.rounds = 1;
  assertInvalid(oneRound, receiptSchema, /at least 2/);
});

test('sampled policy, zero dissent, and OCG/unknown require their guards', () => {
  const noSample = structuredClone(receiptL0);
  delete noSample.policy.sample;
  assertInvalid(noSample, receiptSchema, /sample/);

  const noChecks = structuredClone(receiptL0);
  delete noChecks.review.zero_dissent_checks;
  assertInvalid(noChecks, receiptSchema, /zero_dissent_checks/);

  const ocgAtL0 = structuredClone(receiptL0);
  ocgAtL0.classification.kind = 'unknown';
  assertInvalid(ocgAtL0, receiptSchema, /L2/);
});

test('L0/L1 cannot claim low-confidence or untraversed impact', () => {
  const lowConfidence = structuredClone(receiptL1);
  lowConfidence.impact.confidence = 'low';
  assertInvalid(lowConfidence, receiptSchema, /high/);

  const untraversed = structuredClone(receiptL0);
  untraversed.impact.traversed = false;
  assertInvalid(untraversed, receiptSchema, /true/);
});

test('A2 cannot be claimed with local evidence', () => {
  const localA2 = structuredClone(receiptL1);
  localA2.evidence[0].producer = 'local:node-test';
  assertInvalid(localA2, receiptSchema, /must match \^\(\?!/);
});

test('evidence producer cannot be the agent', () => {
  const agentEvidence = structuredClone(receiptL1);
  agentEvidence.evidence[0].producer = 'agent:claude';
  assertInvalid(agentEvidence, receiptSchema, /must match \^\(\?!/);
});

test('L1 and L2 correctness cases pass schema plus claim-coverage checks', () => {
  const l1 = validateCorrectnessCase(caseL1, correctnessCaseSchema, { now: fixedNow, rootSchema: receiptSchema });
  const l2 = validateCorrectnessCase(caseL2, correctnessCaseSchema, { now: fixedNow, rootSchema: receiptSchema });
  assert.deepEqual(l1.errors, []);
  assert.deepEqual(l2.errors, []);
  assert.equal(l1.valid, true);
  assert.equal(l2.valid, true);
});

test('empty mapping is rejected by the v1 correctness-case contract', () => {
  const schemaErrors = errorsFor(caseEmptyMapping, correctnessCaseSchema, receiptSchema);
  assert.ok(schemaErrors.some((error) => error.keyword === 'minItems'));

  const result = validateCorrectnessCase(caseEmptyMapping, correctnessCaseSchema, { now: fixedNow, rootSchema: receiptSchema });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === 'minItems'));
});

test('a missing claim mapping is rejected even when the mapping array is non-empty', () => {
  const schemaErrors = errorsFor(caseUnmappedClaim, correctnessCaseSchema, receiptSchema);
  assert.deepEqual(schemaErrors, []);

  const result = validateCorrectnessCase(caseUnmappedClaim, correctnessCaseSchema, { now: fixedNow, rootSchema: receiptSchema });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /claim "c2" has no mapping/.test(error.message)));
});

test('residual risk requires a human and a live expiry', () => {
  const agentResidual = structuredClone(caseL2);
  agentResidual.residual[0].accepted_by = 'agent:bot';
  assertInvalid(agentResidual, correctnessCaseSchema, /must match \^human:/, receiptSchema);

  const expiredResidual = structuredClone(caseL2);
  expiredResidual.residual[0].expires_at = '2020-01-01T00:00:00Z';
  const result = validateCorrectnessCase(expiredResidual, correctnessCaseSchema, { now: fixedNow, rootSchema: receiptSchema });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === 'expired'));
});
