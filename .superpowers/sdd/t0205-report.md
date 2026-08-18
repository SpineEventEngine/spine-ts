# T-0205 implementation report

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
