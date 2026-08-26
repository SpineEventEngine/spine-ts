# T-0221 Implementation Report

Status: DONE_WITH_CONCERNS

Lerna 10.0.1 is pinned as the sole reachable publication command. The retained
policy validates the exact inventory, common version, internal pins, metadata,
and version-derived channel. Static manifest tags are removed. The official OIDC
job performs read-only registry preflight, publishes staged `.publish` content
with sequential Lerna `from-package`, and verifies final registry completeness.
The PR workflow remains read-only.

Commits: `59e957f6b` (`Bump version -> 2.0.0-snapshot.5`) and `461ad8563`
(`Migrate publishing workflow to Lerna`); the mechanical correction commit is
pending.

Evidence: disposable Verdaccio qualification published synthetic public packages
in dependency order while excluding a private workspace; staged content and
explicit tags succeeded; a fully published Lerna rerun was a no-op, so the thin
preflight deliberately rejects that case. Focused GREEN: 35 tests passed.

Mechanical correction evidence: `lerna.json` restricts Lerna to pnpm workspace
discovery with external versions and `useNx: false`; 37 focused tests pass,
Lerna reports 25 workspace packages (18 public, 7 private), and
`release-cli.mjs prepare --check` passes. Registry reads now reject malformed
records and time out without mutation; the privileged install ignores scripts.

Concern: lockfile generation required updating concrete internal pins after the
required version-only commit because pnpm otherwise attempted to resolve an
unpublished exact workspace package. No public registry was mutated, no token
was introduced, and no branch was pushed. Final `verify:release`, specialist
review, security review, and live trusted-publisher configuration remain owned
by the orchestration convergence phase.

Cleanup evidence: the qualification-only Verdaccio process (PID 3494, bound to
`127.0.0.1:4873`) was terminated after qualification. The exact owned fixture
directory was verified and moved recoverably to
`/Users/armiol/.Trash/spine-verdaccio.bCMWb3-t0221`; the port no longer responds.
