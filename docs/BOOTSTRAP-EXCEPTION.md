# Bootstrap exception record

Date: 2026-11-22

PR #3 (`a8feee3`, merge commit `f750565`) was merged with a one-time
administrator bypass because it repairs the approval-binding trust root and
the governed A3 path was not yet available. The bypass was reverted immediately
after the merge; `main` remains protected by the required `firetree-a2` check.

Scope: only the approval-binding repair.
Expiry: this exception is historical and grants no ongoing bypass.
