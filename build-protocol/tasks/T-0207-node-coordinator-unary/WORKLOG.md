# T-0207 work log

## 2026-08-18 — Framing

- Baseline is verified `origin/main@45396bce6`; the protected primary checkout
  is not used.
- The implementation owner is the existing `implementer`, explicitly
  configured `gpt-5.6-terra` / medium. No subagents are permitted; the runtime
  surface does not expose telemetry.
- T-0206 provides a private WeakMap READY-member snapshot, but it currently
  has no membership-change notification. T-0207 will add the smallest internal
  listener/reconciliation handoff so replacement and loss do not require
  polling or expose topology publicly.
- The current Server uses `connectNodeAdapter`; generated CommandService and
  QueryService clients use `createGrpcTransport`; default request/response
  bounds are 4 MiB. Existing child `SpineServices` remains the sole Bus intake.

## 2026-08-18 — Unary forwarding checkpoint

- RED: the first Coordinator acceptance failed because the private
  `node-coordinator` module did not exist. The initial clean worktree also
  lacked generated Protobuf output after build cleanup; normal frozen Proto
  generation restored the baseline before the RED was repeated.
- GREEN: a private `NodeCoordinator` uses `connectNodeAdapter`, generated
  `CommandService`/`QueryService` descriptors, `createGrpcTransport`, and the
  T-0205 membership kernel. It selects one READY member per unary call and
  performs no retry. Its request path keeps application headers, cancellation,
  and remaining deadline while excluding protocol-owned headers; response
  headers/trailers are copied back without duplicating gRPC framing headers.
- `ManagedServerCoordinator` opens this listener only through its production
  private dependency after the first READY cohort, owns it during close, and
  publishes an internal READY-membership notification. Existing fake clock and
  child tests deliberately omit that production-only dependency, preserving
  their deterministic lifecycle boundary.
- A real forked managed parent proves a request travels through the Coordinator
  to its child `Server` normal service. Focused fork verification passed 43/43;
  server typechecking passed. Generated manifest IDs created by the temporary
  generation step were restored and are not part of this task.

## 2026-08-18 — Forwarding contract completion

- Generated HTTP/2 acceptance proves selected-child failure has no retry,
  cancellation and deadlines reach the selected child, application metadata and
  downstream response headers/trailers cross the coordinator, and configured
  inbound/outbound message bounds reject oversized calls at the coordinator.
- Replacement selection uses the internal READY-member notification rather
  than polling or public topology.

## 2026-08-18 — Ownership transfer and coverage convergence

- Ownership of the existing uncommitted T-0207 production, test, documentation,
  and record diff transferred to the existing `implementer`, configured
  `gpt-5.6-terra` / medium. Subagents are prohibited. Runtime model telemetry
  is not exposed by this surface; the configured immutable role/profile is the
  available evidence.
- The inherited focused suite initially proved 91.82% executable lines but
  87.92% branches and 87.59% functions across the two changed runtime modules.
  Exact LCOV inspection showed that the shortfall came from three impossible
  pre-construction route guards and six subscription callbacks/configuration
  callbacks that this unary-only Coordinator cannot invoke. Those defensive
  duplicates were removed instead of creating test-only access to private
  internals. The kernel is deliberately supplied only its forwarding/member
  lifecycle subset; T-0208 owns subscription fan-out.
- Added real IPv6 listener acceptance: the private Coordinator exposes a valid
  bracketed Connect base URL. The full focused managed/coordinator suite is
  green at 93.52% statements, 90.04% branches, 91.93% functions, and 95.71%
  lines (57 tests).
- Deterministic preflight is green after generated build and tooling
  typechecks: affected ESLint, cleanup, TSDoc, copyright, logging-containment,
  generated-doc inventory, format, and `git diff --check` all pass. Callback
  parameters in the private ready-members seam were renamed to satisfy the
  repository cleanup rule without changing its behavior.
- `pnpm verify:task -- --coverage packages/server/test/server/node-coordinator.test.ts
packages/server/test/server/managed-server-application.test.ts --source
packages/server/src/server/node-coordinator.ts
packages/server/src/server/managed-server-application.ts` is green. It ran
  the frozen Proto checks/generation, generated build, package-wide ESLint and
  deterministic policy gates, release-readiness check, and the focused
  coverage suite. The branch is ready for its required specialist review wave.

## 2026-08-18 — Consolidated review correction batch

- The TypeScript/API reviewer (`typescript_api_docs_reviewer`, configured
  `gpt-5.6-terra` / high; runtime telemetry unavailable) found two P1 issues:
  the unary Coordinator lied about its full membership-kernel contract, and the
  public managed listener defaulted to undiscoverable port zero. The code now
  supplies every required kernel/client callback; unsupported subscription
  operations throw the explicit T-0208 boundary error rather than becoming an
  `undefined` call. `ManagedServerApplicationOptions.port` is now required and
  accepts only `1..65535` before parent or child assembly.
- RED/GREEN: six invalid public port cases initially entered local child
  assembly; the new test failed with a resolved child handle. After validation,
  all six reject before `createServer` runs. Direct private `NodeCoordinator`
  tests still use port zero for ephemeral loopback listeners.
- The documentation reviewer (`documentation_reviewer`, configured
  `gpt-5.6-luna` / medium; runtime telemetry unavailable) found stale claims
  about no Coordinator forwarding, no process supervisor, and ZeroMQ as the
  current multi-process deployment path. The package README, package reference,
  architecture notes, runtime architecture, and D-0126 now distinguish unary
  Coordinator deployment from legacy ZeroMQ pending T-0212 removal, reserve
  subscription fan-out for T-0208, state zero-READY `UNAVAILABLE`/no-retry
  behavior, and remove prohibited manifest/attestation/strategy-identity
  wording.
- Focused managed/coordinator acceptance is green: 63 tests, 93.34%
  statements, 90.29% branches, 91.26% functions, and 95.49% lines. The next
  action is affected TypeScript/API and documentation re-review after the
  deterministic correction preflight.

## 2026-08-18 — Affected specialist re-review

- TypeScript/API re-review passed: the full kernel/client contracts are
  explicit, the public managed port is truthful and validated before startup,
  and no new public topology, transport, or Proto contract leaked.
- Documentation re-review passed: unary-only forwarding, zero-READY behavior,
  process supervision, legacy ZeroMQ disposition, and T-0208 subscription
  ownership are consistent across the package and architecture guides.
- Style/maintainability re-review passed: the unsafe assertions and stale
  wording are gone, while Coordinator/topology seams remain internal.
- Performance/reliability re-review passed with the 63 focused tests green:
  port validation precedes side effects and existing forwarding, no-retry,
  cancellation, deadline, and bounded-close behavior remains intact.
- Reviewers used the existing configured roles. TypeScript/API, style, and
  reliability used `gpt-5.6-terra` / high; documentation used
  `gpt-5.6-luna` / medium. Runtime telemetry was unavailable to every lane.
  No reviewer reported a remaining P0-P2 finding.
