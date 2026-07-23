# T-0063 Implementation Report

Status: Authoring complete — awaiting orchestrator review and task-level full gate

Baseline: `f2558ec5`

## Assignment

- Existing role: `implementer`.
- Expected profile: explicitly dispatched `gpt-5.6-terra` / `medium`.
- Scope and acceptance source:
  `build-protocol/tasks/T-0063-delivery-scheduler-supervisor/TASK.md`.
- The implementation owner records RED/GREEN evidence, changed files, focused
  commands/results, assumptions, and any blocker here. It does not edit review
  dispositions, commit, push, merge, install dependencies, spawn children, or
  touch unrelated/protected files.

## Authoring Metadata

- Existing role: `implementer`.
- Configured dispatch profile: `gpt-5.6-terra` / `medium` (explicit in the
  assignment). Runtime self-introspection is not exposed on this surface, so
  no independent runtime metadata could be recorded; no visible fallback or
  profile mismatch was exposed.
- JVM source guardrail: inspected task-relevant delivery notes in
  `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, sections
  "Delivery", "Shard Locking", "Delivery Run", and "Failures and Retries".
  The resulting implementation stays with finite shard runs, cleanup release,
  coalesced late notifications, and monitor/source-led recovery rather than a
  general executor abstraction.

## TDD Evidence

1. Controlled admission / public supervisor seam
   - RED: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/delivery/delivery-supervisor.test.ts` failed with
     `TypeError: DeliverySupervisor is not a constructor`.
   - GREEN: added the public structural supervisor/source seam and a controlled
     abort signal passed to its local delivery port. The same focused command
     passed: 1 file, 1 test.
2. Bounded scheduler
   - RED: the focused suite failed its distinct-shard capacity expectation;
     received `[0, 1, 2]` rather than bounded retained work `[0, 1]`.
   - GREEN: added finite active/pending admission, one follow-up per active
     shard, and a bounded overflow-rescan flag. The focused command passed:
     1 file, 3 tests.
3. Source snapshot discovery
   - RED: the focused suite failed with expected source-discovered work absent
     (`[]` rather than `[1]`). A first fixture run also exposed a missing
     `ShardIndex` import; that fixture-only error was corrected before the
     behavior check.
   - GREEN: start now obtains one structural source snapshot and admits only
     non-empty `NOT_PICKED` shards. Focused suite passed: 1 file, 4 tests;
     `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
     also passed.
4. Bounded close fence
   - RED: blocked close did not settle; the behavior assertion received
     `"still pending"` where `DeliveryShutdownTimeoutError` was required.
   - GREEN: close stops admission, aborts the shared controlled signal, clears
     pending work, and rejects a grace-expired blocked run with a sanitized
     `DeliveryShutdownTimeoutError`. Focused suite passed: 1 file, 5 tests;
     generated typecheck passed.
5. T-0062 structural source alignment
   - RED: the server source exposed provisional `snapshot` / `observe` names,
     which did not match the accepted delivery-client surface.
   - GREEN: `DeliverySource` now structurally requires
     `shardSnapshot(options?)`, `observeShardUpdates(options?)`, and
     `releaseExpired(inactivityMs, options?)`. A delivery-client-owned compile
     fixture assigns a real `DeliveryClient` value to `DeliverySource` without
     adding a server-to-delivery-client package dependency. Focused fixtures
     passed: 2 files / 6 tests; generated typecheck passed.
6. Controlled admission and coalesced recovery
   - RED: `DeliveryRunControl` construction failed because the package-internal
     controlled admission seam did not exist.
   - GREEN: an aborted control signal rejects before the wrapped finite run is
     admitted; the public `Delivery.run()` declaration remains unchanged.
     The supervisor now has one coalesced periodic recovery timer which invokes
     stale-session release and a snapshot before admitting recoverable shards.
     Focused controlled-run test passed: 1 file / 1 test; generated typecheck
     passed.
7. Controlled late settlement
   - RED: an in-flight controlled run remained pending after its signal aborted,
     causing the focused test to time out after 5 seconds.
   - GREEN: `DeliveryRunControl` races the caller-visible finite run with its
     abort signal while attaching rejection observation to the detached
     underlying settlement. `DeliverySupervisor` owns this control wrapper over
     a `Delivery.run()`-compatible structural port, preserving the public
     `Delivery.run()` signature. Focused supervisor/control suite passed:
     2 files / 7 tests, without unhandled rejections.

## Current Changed Files

- `packages/server/src/delivery/delivery-supervisor.ts`
- `packages/server/src/index.ts`
- `packages/server/test/delivery/delivery-supervisor.test.ts`
- this report

## Foundation Verification And Then-Open Limitations (Historical Handoff)

- Latest focused evidence: generated typecheck passed; supervisor suite passed
  1 file / 5 tests; `git diff --check` passed.
- Latest mechanical checks for the currently touched files are green: focused
  ESLint, Prettier check, generated typecheck, and `git diff --check` passed.
- Expanded current focused evidence: delivery supervisor/control, delivery
  builder/loop, remote-adapter quarantine, and shard-observation suites passed
  7 files / 124 tests. `pnpm --config.verify-deps-before-run=false docs:check`
  passed after frozen Proto provenance/descriptor verification, TypeDoc, and
  API-doc checking.
- Updated `packages/server/README.md` and `packages/delivery-client/README.md`
  with the current structural source relationship, bounded scheduling behavior,
  and exact non-guarantees. The docs gate was rerun after those edits and
  passed.
- At that handoff, the accepted five slices were not complete: the implementation lacked
  the full T-0062 adapter/source integration, cancellable bounded watch restart,
  periodic recovery and stale-session release, operation-option propagation
  through the actual `Delivery.run()` / loop / lease path, retryable release
  cleanup, environment/local-inbox ownership, public README/user-guide/API
  inventory integration, and the required fake-clock/resource-bound coverage.
- No commit, push, merge, dependency install, review-disposition edit, or
  protected-file access was performed.

## Author Handoff

The first authoring context was closed after the verified foundation above. A
fresh, explicitly configured `implementer` (`gpt-5.6-terra` / `medium`) now
owns only actual durable-commit fencing and delivery-port/remote-adapter
operation-option propagation. Later remaining slices stay unassigned until
that bounded seam is verified.

## Durable Fencing Slice

- RED/GREEN: a pending endpoint that is aborted before it settles previously
  completed its row; the new focused fence test proves the row remains pending
  after late settlement (`failed: 1`, `delivered: 0`).
- Added source-compatible optional `signal`/`timeoutMs` operation options to
  delivery inbox, inbox-work, and work-registry ports. The loop and controlled
  delivery path forward them through pickup, read, claim, synchronization,
  completion, renewal, release, and remote client calls. `Delivery.run()` is
  unchanged.
- Remote mutations remain one-attempt calls: options are forwarded to the
  T-0062 client rather than retried, preserving its unknown-outcome quarantine.
- Evidence: generated typecheck; focused fencing, run-control, supervisor,
  loop, remote-adapter quarantine, and remote-work-registry suites (6 files /
  80 tests); focused ESLint; Prettier; and diff check passed.
- Runtime metadata limitation: self-introspection is not exposed. The
  configured existing implementer profile was explicitly `gpt-5.6-terra` /
  `medium`, with no visible fallback or mismatch.
- Limitation: JavaScript cannot force-preempt a synchronous endpoint. Abort or
  deadline is checked at all subsequent durable checkpoints, so its late
  settle cannot complete/remove the admitted row.
- The orchestrator independently reran and accepted the same 6-file/80-test
  focused suite, generated typecheck, focused ESLint, Prettier, and diff check.

## Supervisor Lifecycle Handoff

A fresh explicit `implementer` (`gpt-5.6-terra` / `medium`) now owns only the
remaining supervisor cleanup/recovery resource semantics and narrow local
inbox/`ServerEnvironment` ownership wiring. The accepted fencing path is a
stable dependency. Public guide/API reconciliation remains unassigned until
this runtime slice is green.

## Supervisor Lifecycle Slice — 2026-07-23

- Updated only `delivery-supervisor.ts` and its direct lifecycle test. Existing
  local-inbox readiness callbacks already notify only after durable receipt,
  and `ServerEnvironment` already owns the configured delivery closeable via
  `RetryableCloseGroup`; no coordinator refactor or duplicate ownership seam
  was introduced.
- The supervisor now uses one coalesced recovery timeout and one watch-restart
  timeout (never per shard), bounded exponential watch reconnect, one active
  snapshot/release pass, finite active/pending shard state, and a separate
  source-abort controller so close cancels watch/recovery immediately while
  allowing active delivery epochs their configured grace.
- Close checkpoints stopped admission, cleared queued work, cancelled timers,
  fenced active controlled runs after grace, and attempted stale-release
  cleanup exactly once per close attempt. A successful cleanup is remembered;
  a failed or timed-out release remains incomplete and is retried by a later
  close. Cleanup receives its own abort signal so a blocked release cannot
  make the first close unbounded. Unknown release mutation outcomes are never
  accepted as success.
- New behavior tests cover watch reconnect/backoff, retrying only failed
  release cleanup, bounded blocked release abort, and immediate watch
  cancellation. Existing tests retain same-shard coalescing, distinct-shard
  bounds, snapshot discovery, and active-run timeout fencing.
- Focused verification: supervisor/run-control/fencing/local-handoff suites
  passed (4 files, 24 tests); generated build typecheck, focused ESLint,
  repository Prettier check, and `git diff --check` passed.
- Limitation: the focused `server-environment-singleton` test that opens a
  loopback listener fails in this managed sandbox with `listen EPERM
127.0.0.1`; it is unrelated to this slice and requires an unrestricted
  runner for confirmation. No new public API or documentation work was added.
- Runtime self-introspection remains unavailable; configured existing
  `implementer` dispatch was explicitly `gpt-5.6-terra` / `medium`, with no
  visible fallback or mismatch.
- The orchestrator independently confirmed the 4-file/24-test lifecycle suite,
  generated build, ESLint, full formatting, and diff hygiene. The separately
  loopback-dependent environment singleton integration passed 1 file / 7 tests
  with the required permission. This slice is accepted and its implementer is
  closed.

## Completion Handoff

A fresh explicit `implementer` (`gpt-5.6-terra` / `medium`) owns the final
acceptance-matrix audit, missing behavior/resource tests, public user guide and
API inventory reconciliation, and stale report/record cleanup. Runtime code is
otherwise frozen unless a new RED acceptance regression proves a concrete gap.

## Completion Acceptance Audit — 2026-07-23

- Existing role: `implementer`; configured dispatch was explicitly
  `gpt-5.6-terra` / `medium`. Runtime self-introspection is unavailable on this
  surface, so the immutable configured profile is the available evidence; no
  visible fallback or mismatch was exposed.
- Most new acceptance tests passed against the frozen supervisor/run-control
  implementation. One focused RED proved a concrete defect: a raw `Error`
  from stale-session release escaped with its private message and custom actor
  property. The smallest GREEN changes only `toError()` in
  `delivery-supervisor.ts`: it preserves the public structured shutdown-timeout
  error and otherwise creates the fixed primitive
  `Delivery supervisor release cleanup failed.` error. The RED command failed
  exactly on the leaked message/property; the same focused command passed after
  the change.
- Acceptance matrix:
  - one active drain and exact one same-shard follow-up:
    `coalesces a same-shard storm into one follow-up run`;
  - finite distinct active/pending admission:
    `bounds distinct active shards and drains retained pending work`;
  - overflow eventual recovery with exact retained-work bound:
    `rescans an overflowed distinct shard after capacity becomes available`;
  - source snapshot and fail-closed unknown stale-release outcome:
    `discovers pending shards from the source snapshot` and `fails closed when
stale-session release has an unknown outcome`;
  - bounded close during a blocked endpoint, active-epoch fence, and detached
    late resolve/reject: `fences a blocked run when close grace expires` plus
    the two `DeliveryRunControl` abort/late-settlement tests;
  - bounded Admin-watch restart/backoff and close cancellation:
    `restarts a failed Admin watch with one bounded backoff timer` and
    `cancels the Admin watch as soon as close stops admission`;
  - release cleanup retry-only-incomplete and blocked cleanup abort:
    `retries only incomplete release cleanup on a later close` and `bounds a
blocked release cleanup and aborts its cleanup request`;
  - timer resource bound and release-error sanitization: `retains one recovery
timer and releases all timer resources on close` and `sanitizes an unknown
release-cleanup rejection`.
- Focused T-0061/T-0062/T-0063 regression evidence passed: 9 test files / 139
  tests (`delivery-supervisor`, `delivery-run-control`, `delivery-fencing`,
  `delivery-builder`, `delivery-loop`, supervisor source compatibility,
  remote-adapter quarantine, remote work registry, and shard observation).
- Generated build typecheck and TypeDoc/API documentation check passed. The API
  inventory now declares the seven public supervisor exports and explicitly
  rejects public `DeliveryScheduler`, `DeliveryRunControl`, `DeliveryRunPort`,
  and `DeliveryControlledRun` names in both the root and TypeDoc surface.
- `docs/USER_GUIDE.md` now provides compile-ready public `DeliveryClient` /
  `DeliverySupervisor` composition, lifecycle ownership, finite scheduling
  bounds, trusted-network and at-least-once/abort limitations, the no-automatic-
  mutable-retry rule, and Wave exclusions. The server README now agrees with
  those lifecycle and non-guarantee claims; the delivery-client README already
  documented the compatible structural source and mutation rule.
- Files changed in this completion slice: `packages/server/src/delivery/
delivery-supervisor.ts`, `packages/server/test/delivery/delivery-supervisor.test.ts`, `packages/server/test/delivery/
delivery-run-control.test.ts`, `docs/USER_GUIDE.md`, `packages/server/
README.md`, `scripts/check-api-docs.mjs`, this report, and the T-0063 work
  log. Earlier task-slice files remain in the worktree and are not attributed to
  this completion audit.
- Remaining task-level uncertainty: the required whole-task reviewer wave and
  post-review full `pnpm verify` gate are orchestrator-owned and have not run in
  this authoring slice. No known runtime defect or environment blocker remains.

## Mechanical Typing And Builder-Fence Correction — 2026-07-23

- Existing role: `implementer`; configured dispatch remains explicitly
  `gpt-5.6-terra` / `medium`. Runtime self-introspection is unavailable on this
  surface, so the immutable configured profile remains the available evidence;
  no visible fallback or mismatch was exposed.
- Corrected test-only fixture typing without weakening production declarations:
  explicit `undefined` resolver values, real `ShardIndex` values, required
  optional-shard assertions, and a `DeliveryRunOptions`-compatible test port.
- RED: the public `DeliveryBuilder.build()` plus `DeliverySupervisor` path
  allowed a pending endpoint to complete its durable row after supervisor
  timeout (`completed: 1`, expected `0`). `BuiltDelivery` exposed only public
  `run()`, causing the supervisor control to take its unfenced fallback.
- GREEN: `BuiltDelivery` now forwards the existing package-internal
  `runControlled()` to `CoreDelivery`. It is not added to the public `Delivery`
  interface, root exports, or API inventory. The public builder/supervisor RED
  passes after the forwarding change, with no public-contract expansion.
- Verification passed: focused T-0061/T-0062/T-0063 regression set, 9 files /
  140 tests; `pnpm typecheck:generated`; repository Prettier check; and
  `git diff --check`.

## Focused Wave 2 Targeted Corrections — 2026-07-23

- Existing role: `implementer`; configured dispatch remained explicitly
  `gpt-5.6-terra` / `medium`. Runtime self-introspection remained unavailable;
  no visible fallback or mismatch was exposed.
- Nominal capability RED: a forged value with both `run()` and
  `runControlled()` was accepted. GREEN: `delivery-builder.ts` now owns a
  module-private `WeakMap` from actual `BuiltDelivery` identities to controlled
  runners. The package-internal resolver returns a runner only for a registered
  identity; `DeliveryRunControl` no longer probes a structural method.
  `BuiltDelivery` no longer carries a runtime `runControlled` method, and the
  public interface, root exports, and API inventory remain unchanged.
- Environment REDs reproduced the single-shard-total rejection and partial
  worker installation after supervisor construction failure. GREEN: exact
  shards are grouped by `ofTotal`, with one builder-created delivery/supervisor
  per group behind the runtime owner. Worker and all supervisor resources are
  constructed before either owner map entry is installed.
- Whole and selected-owner stop track the legacy worker and supervisor
  independently. A failure in either component does not skip the other;
  successful components are checkpointed while an exact failed component is
  retried. Whole and selected retirement wrap every component call so
  synchronous throws and asynchronous rejections are all settled and
  aggregated without suppressing sibling cleanup.
- New real-runtime evidence covers routed notification, periodic local
  recovery, mixed shard totals, atomic setup failure, paired whole/selected
  stop failure, live sibling behavior after selected retirement, and no routed
  work after full retirement.
- Fresh verification passed the exact prior 12-file regression plus these
  additions: 278 tests. Generated build/tooling typecheck, repository ESLint
  and cleanup enforcement, full formatting, TypeDoc/API inventory with 224
  server exports, and diff hygiene all passed.
- No child agent, commit, push, merge, dependency installation, review
  disposition edit, gate weakening, or unrelated/protected edit was performed.

## Final Mechanical Test-Fixture Cleanup — 2026-07-23

- Existing role/profile remained the explicit `implementer`,
  `gpt-5.6-terra` / `medium`. Runtime self-introspection remained unavailable;
  no visible fallback or mismatch was exposed.
- Removed the atomic-construction test's duplicate private-constructor cast and
  worker-selection closure. The centralized `environmentDeliveryWorkerFixture`
  now accepts an optional storage-context override, so both the invalid and
  valid setup attempts use the same injection path as the other lifecycle
  tests. Production code, public contracts, documentation, and behavior were
  unchanged.
- Verification passed: `environment-attachment.test.ts`, 75/75 tests;
  generated build/tooling typecheck; touched-file Prettier; and diff hygiene.
- No child agent, commit, push, merge, install, review-disposition edit, or
  unrelated/protected edit was performed.
