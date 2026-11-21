# Trusted A2 smoke

This is a documentation-only change used to exercise the pull_request_target
build/verify split. The trusted verifier must load policy and registry from the
base SHA and must not execute code from this branch.

Expected result: `build` runs untrusted tests, `verify` runs from base code,
and `report` publishes `firetree-a2` on the PR head.

Triggered after the trusted OIDC fetch fix.

Retrigger after current-base workflow fix.

Retrigger after OIDC trusted-base binding.

Retrigger after diff/approval hardening.

Retrigger after hidden artifact retention.
