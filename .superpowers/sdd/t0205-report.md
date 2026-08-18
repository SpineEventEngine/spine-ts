# T-0205 implementation report

## Convergence update — coverage blocked, not review ready

- The close-cancellation correction and focused kernel/Gateway suite pass: 3
  files / 59 tests.
- The full task verifier passed generated/tooling typechecks, cleanup, TSDoc,
  copyright, containment, Prettier, and documentation audience checks before
  `docs:api:check` rejected accidental deployment root exports. The kernel is
  now exposed only through the explicit internal package subpath; targeted
  deployment/auth build, API docs, containment, scoped ESLint, TSDoc, cleanup,
  copyright, Prettier, and `git diff --check` pass.
- Fresh exact-source coverage remains below the binding threshold: the focused
  suite measures 62.27% kernel executable lines and 45.51% branches; complete
  deployment/auth tests pass 17 files / 450 tests with the same kernel result.
  Required changed executable line and branch coverage is 90%.
- No runtime regression is reproduced. The remaining work is a
  behavior-focused kernel test expansion for currently uncovered scheduling,
  child activation/cancellation, cleanup retry, and close branches. Do not
  review or complete this task until that evidence is green.

## Current handoff — not review ready

- RED evidence retained: `pnpm exec vitest run
  packages/deployment/test/membership-kernel.test.ts` failed before product code
  with `TypeError: BackendMembershipKernel is not a constructor`.
- Initial GREEN: that kernel-only test then passed after adding the deployment
  internal module and export.
- Product extraction is incomplete. The first integrated
  `pnpm typecheck:build:generated` passed, but focused kernel/Gateway testing
  produced 51/59 passing tests. The remaining failures prove missing parity for
  failed close/dispose retry, replacement after unexpected activation end, and
  serialization of child disposal before client close. A delayed child-start
  close test still times out while preserving its RED regression evidence.
- No commit or push was made. Runtime self-telemetry is unavailable on this
  execution surface; the task dispatch profile remains the configured existing
  implementer role, `gpt-5.6-terra` / `medium`.
- Changed files: deployment internal kernel/test/index export; auth dynamic
  forwarder adapter; task work log. No public Proto, process, provider,
  ServerEnvironment, BoundedContext, IntegrationBroker, Delivery, or example
  path was touched.

## Next required work

Port the established owner’s failed-client and failed-child cleanup retry sets,
plus child-cleanup join ordering, into the generic kernel before rerunning the
focused auth suites. Do not run preflight, coverage, review, commit, or push
until those behavioral regressions converge.

## Systematic-debugging resume

Reproduced current parity as 52/59. The baseline-to-kernel responsibility map
and hypothesis 1 are recorded in the task work log: the generic kernel lost
the baseline's failed-disposal, failed-child-cleanup, and per-client cleanup
join state. The first correction is restricted to restoring that ownership;
activation/replacement remains a separately verified concern.

The cleanup correction is confirmed by targeted tests after rebuilding project
references. The next complete focused run reached 58/59 but timed out on the
older-removal/newer-membership coalescing test, a newly introduced lifecycle
regression. The task remains uncommitted and not review-ready.
