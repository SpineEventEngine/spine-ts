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
