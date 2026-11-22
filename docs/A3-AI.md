# A3-AI: machine-governed adversarial assurance

> Status: proposed / single-provider (A3-AI-S) foundation. This is not human
> sign-off and must never be labelled `A3`.

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

## Next implementation steps

1. Generate review artifacts from real DSH subagents; record provider/model and
   transcript hashes.
2. Run at least two contexts; for `A3-AI`, configure a second provider.
3. Bind the artifact into the attested bundle and require it from
   `firetree-check --require A3-AI-S`.
4. Make L2 PRs use this path; keep `A3` human-only.
