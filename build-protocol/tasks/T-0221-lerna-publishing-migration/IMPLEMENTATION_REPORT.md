# T-0221 Implementation Report

Status: DONE_WITH_CONCERNS

Lerna 10.0.1 is pinned as the sole reachable publication command. The retained
policy validates the exact inventory, common version, internal pins, metadata,
and version-derived channel. Static manifest tags are removed. The official OIDC
job performs read-only registry preflight, publishes staged `.publish` content
with sequential Lerna `from-package`, and verifies final registry completeness.
The PR workflow remains read-only.

Evidence: disposable Verdaccio qualification published synthetic public packages
in dependency order while excluding a private workspace; staged content and
explicit tags succeeded; a fully published Lerna rerun was a no-op, so the thin
preflight deliberately rejects that case. Focused GREEN: 35 tests passed.

Concern: lockfile generation required updating concrete internal pins after the
required version-only commit because pnpm otherwise attempted to resolve an
unpublished exact workspace package. No public registry was mutated, no token
was introduced, and no branch was pushed. Final `verify:release`, specialist
review, security review, and live trusted-publisher configuration remain owned
by the orchestration convergence phase.
