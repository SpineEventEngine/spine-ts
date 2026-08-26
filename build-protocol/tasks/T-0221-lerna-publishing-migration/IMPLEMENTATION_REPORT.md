# T-0221 Implementation Report

Status: DONE_WITH_CONCERNS

Lerna 10.0.1 is pinned as the sole reachable publication command. The retained
policy validates the exact inventory, common version, internal pins, metadata,
and version-derived channel. Static manifest tags are removed. The official OIDC
job performs read-only registry preflight, publishes staged `.publish` content
with sequential Lerna `from-package`, and verifies final registry completeness.
The PR workflow remains read-only.

Commits through the coverage correction: `59e957f6b` (`Bump version ->
2.0.0-snapshot.5`), `461ad8563`, `c1f82e540`, `ad6305205`, `f2b2257e9`,
`88bfb936a`, `f489ad664`, and `62d400926`; the consolidated review-correction
commit is pending.

Evidence: disposable Verdaccio qualification published synthetic public packages
in dependency order while excluding a private workspace; staged content and
explicit tags succeeded; a fully published Lerna rerun was a no-op, so the thin
preflight deliberately rejects that case. Focused GREEN: 35 tests passed.

Mechanical correction evidence: `lerna.json` restricts Lerna to pnpm workspace
discovery with external versions and `useNx: false`; 37 focused tests pass,
Lerna reports 25 workspace packages (18 public, 7 private), and
`release-cli.mjs prepare --check` passes. Registry reads now reject malformed
records and time out without mutation; the privileged install ignores scripts.

Cheap-preflight correction: generated Proto package manifests were aligned from
`2.0.0-snapshot.4` to the actual workspace version `2.0.0-snapshot.5` after
`pnpm proto:generate` correctly rejected the mismatch. Regeneration and the
17-test Todo startup contract then passed. This remains a separate local commit
from the required version-only commit.

Second cheap-preflight correction: registry read timeout primitives now use the
lint-recognized `globalThis` namespace. The three focused registry tests and
targeted ESLint passed without weakening lint rules.

Third cheap-preflight correction: a local registry-record JSDoc typedef keeps
the annotation within the repository's 120-character cleanup limit. Cleanup
lint, targeted ESLint, and the three focused registry tests passed.

Formatting correction: the repository formatter rewrote the six files reported
by cheap preflight. The 25-test affected release suite and diff check passed.
The format-check process ended without usable terminal completion evidence in
this execution surface, so final whole-repository format evidence remains with
the continuing preflight.

Coverage correction: behavior tests cover staged `.publish` extraction and
cleanup, safe CLI command routing, registry outcomes, and static-tag policy
rejection. Scoped aggregate coverage across `release-cli.mjs`,
`release-policy.mjs`, and `release-registry.mjs` is 95.56% statements, 94.61%
branches, 92.50% functions, and 95.65% lines. `package-artifacts.mjs` changed
only by deleting the obsolete private `releaseTag` helper, so it is outside this
source set. The artifact upload enables hidden files only for the validated
`$RUNNER_TEMP/release` staging tree; workflow tests pin that exact path/option.

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

Review correction evidence: strict registry selection runs immediately before
Lerna and emits only missing names from the exact public inventory. The
workflow writes those names to an owned `$RUNNER_TEMP` file under `set -euo
pipefail`, rejects an empty file, constructs explicit repeated `--scope`
arguments, and removes the file through a trap. This preserves fail-closed
selection despite Lerna's own permissive lookup handling. The residual is
narrow: a later Lerna re-query may be ambiguous, but it cannot expand the
strictly selected package set. The runbook now names the four accepted losses:
byte identity, integrity-aware resume, per-dependency visibility waits, and
per-package tag-race checks; aggregate final version/tag verification remains
the boundary. The current focused suite is GREEN with 45 tests; final
specialist/security convergence and `verify:release` remain pending.

Latest scoped coverage is 96.00% statements, 95.23% branches, 93.18%
functions, and 96.05% lines across `release-cli.mjs`, `release-policy.mjs`, and
`release-registry.mjs`. Prettier, cleanup lint, targeted ESLint, Lerna discovery
(25 packages), checked staging, and `git diff --check` are GREEN.

Affected re-review proved the previous `--scope` correction invalid because
Lerna 10.0.1 does not support it. The workflow now creates a disposable non-Git
workspace from only strict-selected manifests and `.publish` directories, then
runs the pinned original-checkout Lerna binary there. A synthetic Verdaccio
qualification published selected base then dependent and did not discover or
publish the omitted synthetic package. Final security and `verify:release`
remain pending.

Final reliability correction adds exact development dependency `verdaccio@6.2.2`
for ordinary-CI local-only qualification. It validates selected staged-package
publication and a fully-published no-op without public mutation. The workflow
uses a uniquely allocated owned parent directory and `--no-git-reset` for the
generated non-Git workspace; final security and `verify:release` remain pending.

The superseding workspace path has focused aggregate coverage of 94.20%
statements, 94.96% branches, 90.19% functions, and 93.95% lines.
