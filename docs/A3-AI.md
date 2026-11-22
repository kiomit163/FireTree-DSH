# A3-AI: machine-governed adversarial assurance

> Status: **A3-AI-S implemented and exercised**. PR #9 was reviewed by two
> single-provider AI seats and merged after the required `firetree-a2` check
> passed. This is not human sign-off and must never be labelled `A3`.

## Why

The owner has no second human reviewer and wants an auditable decision made by
AI rather than a human. FireTree keeps the original `A3` human level unchanged
and adds a separate machine assurance:

```text
A0 < A1 < A2 < A3-AI-S < A3-AI < A3
```

- `A3-AI-S`: A2 + same-provider, multi-context adversarial review + signed/attested bundle.
- `A3-AI`: A2 + multi-provider adversarial review + signed/attested bundle.
- `A3`: human approval (unchanged).

`A3-AI` never satisfies a requirement for `A3`.

## What the review artifact proves

A `firetree.ai-review/v1` artifact records:

- the change head, diff digest, and assessment digest;
- the author provider/model;
- at least two reviewer seats with distinct context, prompt, and transcript hashes;
- each finding's severity, disposition, and evidence;
- zero unresolved findings and a converged verdict.

The validator proves structure, binding, quorum, and the absence of duplicate
contexts/transcripts. It **cannot** prove that a model actually generated a
transcript, that a transcript is unbiased, or that a provider is independent.
Those are explicit residual risks.

## Residual risk (must be shown in the receipt)

- Single-provider mode is **not** independent-provider review.
- A model can hallucinate or be sycophantic; deterministic evidence is the
  primary truth source and A3-AI cannot override a failing test, coverage floor,
  SARIF threshold, or SBOM finding.
- The model provider is part of the trust root. If it is compromised, the
  machine assurance fails.
- A review artifact can be fabricated by a local agent; the CI attestation over
  the bundle is what limits substitution, not the AI text itself.

## Implementation status

- `firetree.ai-review/v1` schema and two-seat validator are implemented.
- `firetree-check --require A3-AI-S` binds the review to the assessed diff and
  requires it inside the attested bundle.
- The trusted PR verifier materializes the review from PR data, builds the
  bundle, attests it, and runs the check without executing PR code.
- PR #9 (governance coverage and L0 sampling 0.1) passed this path and was
  auto-merged.
- The review used two seats from the same provider, so it is `A3-AI-S`
  (single-provider), not `A3-AI`.

## Next implementation steps

1. Add a second model provider; then `A3-AI` becomes available without a
   protocol change.
2. Persist the AI-review summary and residual risks in the receipt/technical
   evidence, not only in check stdout.
3. Expand tests for multi-provider, accepted-blocker rejection, and review
   substitution.
4. Keep `A3` human-only; `A3-AI-S` never satisfies `--require A3`.
