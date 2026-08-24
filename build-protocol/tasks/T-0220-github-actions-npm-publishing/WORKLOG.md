# T-0220 Work Log

- `2026-08-24`: The orchestrator inspected the dirty primary checkout without
  changing it, confirmed configured `origin` is `git@github.com:armiol/spine-ts.git`,
  and created `.worktrees/github-actions-npm-publishing` from exact
  `origin/main@35e0d81dfd4fe72f93804319f7437de71279edda`.
- `2026-08-24`: Frozen installation completed with pnpm `11.9.0`. The focused
  baseline passed 3 release/package test files and 47 tests with zero failures.
- `2026-08-24`: The implementation owner is the existing `implementer` role
  with explicit `gpt-5.6-terra` / `medium` dispatch and no child spawning.

This log will record RED/GREEN evidence, commits, immediate personal-origin
pushes, mechanical checks, review dispositions, corrections, and final
verification. No real NPM publication or official-organization push is in
scope.

- `2026-08-24`: RED: `pnpm --config.verify-deps-before-run=false exec vitest run
scripts/release-policy.test.mjs --passWithNoTests` failed because the permanent
  policy module did not exist. GREEN: the same focused suite passed 4/4 after
  `release-policy.mjs` implemented exact version/channel and inventory policy.
- `2026-08-24`: RED: `pnpm --config.verify-deps-before-run=false exec vitest run
scripts/release-publisher.test.mjs --passWithNoTests` failed because the
  permanent publisher module did not exist. GREEN: policy, publisher, and
  artifact suites passed 13/13. The version-only commit `2ed14bf9b` was pushed
  immediately to verified personal `origin` (`git@github.com:armiol/spine-ts.git`).
- `2026-08-24`: Implementation remains incomplete: concrete internal pins and
  lockfile alignment, functional npm registry adapter, structural workflow
  tests, full preparation/consumer handoff proof, and review are pending. No
  real publication, NPM credential, official remote, tag, or environment was
  mutated.
- `2026-08-24`: Pin/lockfile endpoint: updated all 46 concrete internal
  `@spine-event-engine/*` dependency-family pins from `2.0.0-snapshot.3` to
  `2.0.0-snapshot.4`, preserving `workspace:*` and external versions. RED was
  the stale-pin inventory (46 matches); GREEN inventory found zero matches.
  `pnpm install --lockfile-only`, focused package metadata tests (12/12), and
  `pnpm install --frozen-lockfile` passed. The ordinary install reported only
  pre-existing missing built-bin warnings for `spine-delivery-server`.
- `2026-08-24`: Release-module endpoint RED/GREEN: the portable manifest test
  first failed on a missing module, then passed after manifest creation and
  checksum validation. Focused artifact, policy, and publisher suites passed
  7/7; CLI syntax and diff checks passed. Preparation reuses the already-packed
  artifact list for the external-consumer proof; the guarded CLI uses public
  registry reads only after its official GitHub Actions context gate.
- `2026-08-24`: Correction endpoint: release-manifest validation now rejects
  non-exact inventory/order/version/tag/path/checksum input; publication requires
  a supplied bounded visibility poller, and the CLI now requires the `push`
  event claim as well as the official repository/ref claims. Focused suites
  passed 7/7 with CLI syntax and diff checks.
- `2026-08-24`: Publisher correction RED/GREEN: malformed public-registry
  version metadata initially resolved with an undefined integrity; it now fails
  closed. Focused publisher tests pass 5/5, with targeted ESLint, Prettier, and
  diff checks clean. Coverage includes explicit-404 absence, non-404 rejection,
  semantic snapshot/stable ordering, and bounded visibility polling.
- `2026-08-24`: CLI trust seam RED/GREEN: importing the CLI no longer executes
  it, and an injected invocation rejects publication outside the exact official
  Actions push context. Focused CLI/artifact tests passed 2/2 with syntax and
  diff checks.
- `2026-08-24`: Artifact-authority endpoint: uploaded manifests are checked
  against a source-derived expected release model. Artifact/policy focused
  suites passed 16/16, covering inventory, version/tag, portable path,
  integrity/checksum, dependency, and order tampering.
- `2026-08-24`: Workflow endpoint: immutable action provenance is checkout v6
  `d23441a48e516b6c34aea4fa41551a30e30af803`, setup-node v6
  `249970729cb0ef3589644e2896645e5dc5ba9c38`, pnpm/action-setup v6
  `0977fd99725f1db4007ccb2928dbb4e90d06cc86`, upload-artifact v4
  `ea165f8d65b6e75b540449e92b4886f43607fa02`, and download-artifact v5
  `634f93cb2916e3fdff6788551b99b062d0335ce0`. Focused structural workflow
  tests passed 3/3 without running a publication.
- `2026-08-24`: Pushed T-0220 commits: `2ed14bf9b` version bump,
  `f83fba7d4` internal pins/lockfile, `cc9e1e280` release modules,
  `9affc1422`, `fb7caf934`, `c8526bcf0` publication corrections,
  `f5efab696`, `0b300bc51`, `a1ed376e1`, `0a67ac25c` CLI/artifact seams,
  `f56c9658d` workflows, `e1ed40ff4`/`87bc711ec` generated alignment,
  and `8193bc7f5` consumer cleanup. All were pushed to verified personal
  origin; no official activation or NPM publication occurred.
- `2026-08-24`: Mechanical ESLint correction: replaced the Node-global
  `structuredClone` in the release-artifact tampering test with a JSON test
  fixture clone. Focused artifact tests passed 12/12; focused ESLint and diff
  checks passed.
- `2026-08-24`: Consolidated correction: direct CLI invocation uses a resolved
  file URL; registry requests use abortable timeout/error handling and the
  dedicated dist-tags endpoint; publication rechecks tag invariants immediately
  before mutation. Workflows pin pnpm v6.0.9's dereferenced commit and use
  Node 24.18.0's bundled npm 11.16.0 without installation in the OIDC job.
  Focused release suites passed 39/39 with targeted ESLint/format/diff checks.
- `2026-08-24`: Follow-up correction makes pack, proof, and manifest-write
  cleanup failures independent and invokes both captured signal handlers with
  conventional exit codes. The registry test now asserts the exact dedicated
  npm dist-tags endpoint. Focused release suites passed 40/40 with ESLint,
  Prettier, and diff checks clean.
- `2026-08-24`: Re-review correction: dist-tags endpoint responses are parsed as
  direct tag maps; final selected-tag equality is asserted for every package;
  a real relative subprocess CLI invocation proves the safe context gate. Fake
  publication fixtures now model tag visibility. Focused release suites passed
  41/41 with targeted lint/format/diff clean.
- `2026-08-24`: Security re-review test correction asserts the approved
  pnpm/action-setup v6.0.9 SHA and verifies that the OIDC job checks exact
  Node/npm versions without running a package-manager installation command.
  Focused workflow tests passed 3/3 with lint/format/diff clean.
- `2026-08-24`: Final correction coverage: a relative child-process CLI call
  clears GitHub context and proves the local publish gate; each pack/proof/write
  failure and both non-returning signal exits clean only owned output. Public
  registry fetch and body parsing are abort-aware under injected timeouts.
  Publication rejects selected-tag movement before mutation and selected or
  opposite-tag movement at finalization. Workflow tests collect every
  pnpm/action-setup reference and require only reviewed v6.0.9 SHA occurrences,
  including an option-prefixed `npm --prefix x install` recognition fixture.
  Focused CLI/publisher/workflow/artifact tests passed 46/46, with focused
  ESLint, Prettier, and diff checks clean.
- `2026-08-24`: Mechanical preflight found Prettier drift limited to
  `scripts/package-artifacts.mjs` and `scripts/release-policy.test.mjs`.
  Repository Prettier rewrote only their line wrapping; changed-file format and
  whitespace-diff checks passed. No semantic behavior or review scope changed.
