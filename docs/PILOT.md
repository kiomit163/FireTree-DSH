# Pilot: repository shadow

Status: planned.

Scope: 30–50 pull requests in this repository, using shadow mode. FireTree
records assessments, evidence, and gate outcomes without blocking merges during
the first 10 PRs.

Pre-registered metrics:

- false-block rate;
- gate latency;
- L2 share;
- unknown-path share;
- review disagreements;
- escaped defects.

Exit criteria: false-block rate below 10%, no auth bypass, and at least 30 PRs
with complete evidence. This shadow is not an independent external pilot.