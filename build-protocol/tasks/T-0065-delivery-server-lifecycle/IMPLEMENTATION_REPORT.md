# T-0065 Implementation Report

Status: accepted; full verification passed; ready to commit.

## Assignment

- Existing role: implementer.
- Expected profile: `gpt-5.6-terra` / `medium` reasoning, explicitly dispatched.
- Runtime self-introspection: unavailable on this surface; the immutable dispatched
  profile is the available evidence.

## TDD Evidence

### Slice 1 — configuration

- RED command: `pnpm exec vitest run packages/delivery-server/test/delivery-server-config.test.ts`
- RED result: two focused failures. The expected missing behavior was observed:
  `DeliveryServer is not a constructor` because the package exported no lifecycle
  class.
- GREEN implementation: added the minimal public configuration/lifecycle shell and the
  already pinned `@connectrpc/connect-node@2.1.2` importer entry.
- Initial verification blocker: `pnpm install --lockfile-only` could not resolve the npm
  registry (`ENOTFOUND`). A subsequent `pnpm install --offline` recreated this
  worktree's `node_modules`, then also attempted unavailable registry requests and
  did not recreate workspace package links. Direct Vitest invocation now fails
  before test collection because `@spine-ts/proto/delivery-server` cannot resolve.

Independent recovery and GREEN: the orchestrator repaired the workspace with
`pnpm install --frozen-lockfile` under network permission and independently ran
`pnpm vitest run packages/delivery-server/test/delivery-server-config.test.ts`.
Result: 1 file / 2 tests passed. Slice 1 is GREEN; slices 2–10 remain pending.

### Slice 2 — Admin snapshot

- RED command: `pnpm vitest run packages/delivery-server/test/delivery-server-admin.test.ts`
- RED result: the real listener test reached `start()` and failed with
  `listen EPERM: operation not permitted 127.0.0.1`. This is a native-loopback
  sandbox restriction, not a behavior assertion failure. It needs an
  orchestrator/native rerun.
- Implementation drafted: registers `AdminService` and computes an empty/current,
  deterministic snapshot from the same canonical maps.
- Static check: `pnpm exec tsc -p packages/delivery-server --noEmit` passed.

### Slice 3 — Admin transitions (in progress)

- Implementation now routes actual message insert/remove and successful shard-session
  transitions through an Admin publisher inside the existing mutation admission
  callback. Duplicate/missing mutations do not publish.
- Regression evidence: `pnpm vitest run packages/delivery-server/test/core
packages/delivery-server/test/delivery-server-config.test.ts` passed: 5 files /
  23 tests. The package typecheck also passed.
- Required dedicated transition, ACK-race, 100/101 overflow, cancellation, and
  shutdown stream tests remain to be authored and observed RED/GREEN.

### Slice 4 — ACK gate (partial GREEN)

- `packages/delivery-server/test/admin-publisher.test.ts` adds direct behavioral
  coverage without a listener: a pre-ACK publication is dropped, the first frame
  is the sole ACK, a later publication is a complete observation, and shutdown
  completes a waiting stream. The test was first corrected after a timeout exposed
  the intended eligibility gate; it now passes (1 file / 2 tests).
- The stream terminal path was changed to return after publisher closure, avoiding
  an invalid undefined wire frame.
- Exact 100/101 overflow, cancellation/return cleanup, and full transition matrix
  remain incomplete.

### Slices 3–6 focused evidence

- Command: `pnpm vitest run packages/delivery-server/test/admin-publisher.test.ts
packages/delivery-server/test/health-service.test.ts
packages/delivery-server/test/core/transition-notifications.test.ts`
  Result: 3 files / 7 tests passed.
- Command: `pnpm exec tsc -p packages/delivery-server --noEmit`
  Result: passed.
- Publisher coverage asserts the exact 100 pending slots / 101st overflow behavior
  and stable `ResourceExhausted` message, caller iterator return cleanup, ACK gate,
  and shutdown completion. Health coverage asserts overall, every canonical
  descriptor, unknown service, non-serving transition, and `Watch` unimplemented.
- Inbox coverage asserts actual insert/remove transitions only, duplicate/missing
  no-op suppression, and batch input order. Dedicated Shard notification coverage
  (initial pick, stale takeover, explicit and expired release) is still missing;
  therefore slice 3 remains partially complete.

### Slice 3 closure

- Added direct Shard handler coverage for successful initial pickup, strict stale
  takeover, explicit release, and inclusive expired-session release. The test also
  asserts admission-order notifications and suppression for failed pickup/missing
  release.
- RED/GREEN command: `pnpm vitest run
packages/delivery-server/test/core/transition-notifications.test.ts`; result:
  1 file / 3 tests passed. (The transition callbacks already existed from the
  previous implementation step, so this focused coverage was green on first run;
  it is recorded as post-implementation coverage rather than a fabricated RED.)
- Regression command: `pnpm vitest run packages/delivery-server/test/admin-publisher.test.ts
packages/delivery-server/test/health-service.test.ts
packages/delivery-server/test/core/transition-notifications.test.ts`;
  result: 3 files / 9 tests passed. `pnpm exec tsc -p packages/delivery-server
--noEmit` passed.

### Slice 8 — shutdown admission fence (GREEN)

- RED command: `pnpm vitest run
packages/delivery-server/test/core/mutation-admission.test.ts`.
  Expected RED observed: a queued mutation resolved and committed after `close()`.
- GREEN implementation: `MutationAdmission.close()` now rejects all pending,
  not-yet-admitted mutations and clears the queue; later admissions reject with
  `Code.Unavailable`. An already running synchronous admission remains unchanged.
- GREEN command: the same focused test command; result 1 file / 5 tests passed.
  `pnpm exec tsc -p packages/delivery-server --noEmit` passed.

### Slice 8 terminal lifecycle (partial GREEN)

- Added `packages/delivery-server/test/delivery-server-lifecycle.test.ts` for
  close-before-start terminality/no binding and concurrent/repeated close promise
  sharing. Command: `pnpm vitest run
packages/delivery-server/test/delivery-server-lifecycle.test.ts`; result: 1 file
  / 2 tests passed. Package typecheck passed.
- These assertions were written against existing terminal behavior and passed first
  run, so they are recorded as coverage rather than claimed RED/GREEN proof.
- Still needed on the native listener: close-during/after-start, exact health →
  admission → Admin completion → listener/session phase order, active Admin stream,
  failed-start cleanup, and session close timing. Suggested command after authoring:
  `pnpm vitest run packages/delivery-server/test/delivery-server-lifecycle.test.ts`.
- Expanded the lifecycle suite with close-during-start terminality, active Admin
  stream completion plus successful port reuse after close, and collision cleanup
  preserving the owner listener. Local command `pnpm vitest run
packages/delivery-server/test/delivery-server-lifecycle.test.ts` yields 5 tests:
  3 direct terminal cases pass; 2 listener cases stop at sandbox `EPERM`.
  ESLint and package typecheck pass. Native command is the same.
- Exact internal phase-order instrumentation (health non-serving → admission fence
  → Admin completion → network/session close) is still not represented; the current
  native tests establish only the externally observable terminal effects.
- Native lifecycle RED found a real terminal bug: after close-during-start, a later
  `start()` returned the cached start promise. Fixed by checking `#close` before
  `#start` in `DeliveryServer.start()`, so every later start rejects clearly.
- Native also found a fixture defect: Connect returns an `AsyncIterable`; the active
  Admin test now obtains its iterator explicitly before `next()`. Local lint and
  typecheck pass; local lifecycle test remains 3 direct passes / 2 socket EPERMs.
  Native GREEN command: `pnpm vitest run
packages/delivery-server/test/delivery-server-lifecycle.test.ts`.
- Ordering assessment: the production order directly sets the health-serving flag,
  then closes admission/Admin assembly, then starts listener/session close. The
  listener cannot serve an observable health query once close reaches network
  teardown. A package-private assembly does not currently own health, so no direct
  handler-order probe exists without refactoring the cohesive assembly; this remains
  an explicit coverage limitation.
- Independent native rerun after the terminal-start and AsyncIterable fixes passed:
  1 file / 5 tests, closing slice 8.

### Native-only remaining lifecycle commands

- `pnpm vitest run packages/delivery-server/test/delivery-server-admin.test.ts`
- `pnpm vitest run packages/delivery-server/test/delivery-server-listener.test.ts`
  (to be authored for all descriptors, inbound bound, bind/start/collision cleanup)
- `pnpm vitest run packages/delivery-server/test/delivery-server-lifecycle.test.ts`
  (to be authored for session drain and ordered terminal close)
- `pnpm vitest run packages/delivery-server/test/delivery-server-process.test.ts`
  (to be authored for executable config failure and SIGINT/SIGTERM cleanup)

The last three test files do not yet exist; sockets and process spawning are not
available in this sandbox, so these cannot be honestly completed here.

### Slice 9 executable (partial GREEN)

- Added `packages/delivery-server/test/delivery-server-process.test.ts` for invalid
  configuration before bind, readiness reporting, SIGINT, SIGTERM, and repeated
  near-concurrent signal delivery. The test executes the built package bin.
- RED command: `pnpm vitest run
packages/delivery-server/test/delivery-server-process.test.ts`. Invalid config
  originally emitted a Node stack trace because `new DeliveryServer()` executed
  outside the bin's startup rejection handler.
- GREEN implementation: the bin now wraps construction and startup in one
  sanitized reporting path, and writes `Delivery server listening at <baseUrl>`
  only after successful startup. The invalid-config process case passes locally.
- Local run after GREEN: 3 process tests, 1 passes; SIGINT/SIGTERM children exit
  before readiness because the sandbox denies their loopback bind. Static lint and
  package build/typecheck pass. Native command: `pnpm vitest run
packages/delivery-server/test/delivery-server-process.test.ts`.
- Signal handler removal is implemented on startup failure and uses `once` for
  one-shot teardown; native signal/port cleanup remains to be confirmed.

## Slice 10 Documentation, API, And Mechanical Closure

- README now documents the two public listener declarations, exact option/env/default
  precedence and units, executable usage/readiness, loopback default, explicit
  trusted-network cleartext warning, terminal shutdown sequence, in-memory restart
  loss, and every relevant exclusion.
- Package metadata exports `spine-delivery-server` from `dist/bin`, includes the
  required pinned `@connectrpc/connect-node@2.1.2` dependency, and preserves the
  existing package files policy.
- Built declaration inspection confirms exactly five root exports: existing
  `createInMemoryDeliveryServerCore`, `InMemoryDeliveryServerCore`,
  `InMemoryDeliveryServerCoreOptions`, plus `DeliveryServer` and
  `DeliveryServerOptions`. No Node listener implementation types are exported.
- Mechanical evidence:
  - delivery-server core/config/Admin/health/public tests plus delivery-client
    observation regression: 10 files / 53 tests passed locally;
  - `pnpm exec eslint packages/delivery-server/src packages/delivery-server/test`: passed;
  - `pnpm exec prettier --check packages/delivery-server`: passed;
  - `pnpm exec tsc -p packages/delivery-server --noEmit`: passed;
  - `pnpm docs:check:generated`: passed (TypeDoc + API-doc checker);
  - `git diff --check`: passed.
- The generator executable-bit side effect at
  `packages/client/codegen/generate-projection-columns.mjs` was restored; no
  unrelated generator drift remains.

## Native Evidence

- Admin snapshot: 1 file / 1 test passed.
- Listener suite, including all services, start sharing/collision/session close and
  configured inbound limit: 1 file / 5 tests passed.
- Lifecycle suite after terminal-start and AsyncIterable fixes: 1 file / 5 tests
  passed.
- Executable invalid-config, SIGINT, SIGTERM, and duplicate signal cleanup: 1 file /
  3 tests passed.

## Self-Review And Remaining Concerns

- Production ownership remains limited to the assigned delivery-server package,
  package lock, and T-0065 records. No proto, delivery-client, server-package, or
  example production source was changed.
- The actual runtime profile cannot be introspected on this surface; immutable
  dispatch evidence is existing implementer `gpt-5.6-terra` / `medium`.
- Strict test-first evidence is complete for configuration construction and shutdown
  admission fencing and the executable construction error. Several later direct
  coverage tests were added after their implementation and passed first run; this
  is explicitly logged as TDD evidence debt rather than misreported RED/GREEN.
- Internal phase ordering is implemented in source as health flag, assembly
  admission/Admin closure, then listener/session close, but has no direct
  package-private health-order probe. This is a reliability-review concern, not a
  claim of independently verified instrumentation.
- No commit, review wave, full repository `pnpm verify`, merge, or push has run;
  the packet is ready for mechanical pre-review and specialist review, subject to
  the recorded coverage limitation.

## Pre-Review Mechanical Correction Batch

- Independent pre-review behavioral suite passed: 14 files / 67 tests, including
  the native listener and process cases.
- Corrected direct generated-service tests to use `create(EmptySchema)` and real
  `HealthCheckRequestSchema` messages. Every subscription now obtains an
  `AsyncIterator` through `[Symbol.asyncIterator]()` before `next()`/`return()`.
- Corrected executable signal test data to `NodeJS.Signals` and renamed core
  transition callbacks to `onTransition`, satisfying cleanup naming rules without
  changing behavior.
- Mechanical rerun results:
  - `pnpm typecheck:build:generated`: passed;
  - `pnpm typecheck:tooling`: passed;
  - delivery-server ESLint: passed;
  - `node scripts/check-cleanup-rules.mjs`: passed;
  - delivery-server Prettier check: passed;
  - focused local non-network delivery-server/delivery-client suite: 10 files / 53
    tests passed;
  - `pnpm docs:check:generated`: passed;
  - `git diff --check`: passed.
- Generator mode remains clean; no diff is present for
  `packages/client/codegen/generate-projection-columns.mjs`.

## API Inventory Follow-Up

- Fresh generated docs validation exposed the intentional root exports absent from
  the deterministic API inventory. Updated only
  `scripts/check-api-docs.mjs` to add `DeliveryServer` and
  `DeliveryServerOptions`, preserving exact named-export/no-wildcard enforcement.
- `pnpm docs:check:generated`, touched-script ESLint/Prettier, cleanup enforcement,
  and `git diff --check` pass. The orchestrator-formatted implementation report and
  requirements analysis were preserved.

### Slice 7 listener suite authored

- Added `packages/delivery-server/test/delivery-server-listener.test.ts` covering
  explicit ephemeral bind, shared concurrent start, Admin/Health and generated
  Inbox/Shard client registration, collision terminality, idle session close, and
  default/pre-start public state.
- Local command: `pnpm vitest run
packages/delivery-server/test/delivery-server-listener.test.ts`. Result: 4 tests,
  1 direct default-state assertion passed and the 3 listener tests reached the
  known sandbox `listen EPERM` at `127.0.0.1` before product behavior could run.
- `pnpm exec eslint packages/delivery-server/test/delivery-server-listener.test.ts`
  and `pnpm exec tsc -p packages/delivery-server --noEmit` passed.
- Native command: `pnpm vitest run
packages/delivery-server/test/delivery-server-listener.test.ts`.
- Native feedback initially found the idle-session assertion raced connection setup.
  The test now awaits the client HTTP/2 `connect` event with a one-shot error
  handler before invoking `close()`, preventing an unhandled refused-connection
  event. It also now invokes each of the four registered descriptors (Admin,
  Health, Inbox invalid request, and Shard invalid request), not just client
  construction. Local rerun remains stopped only by sandbox `EPERM`; lint and
  package typecheck pass.
- The inbound-read-limit case remains unimplemented. It requires a real oversized
  wire RPC and must be added/run in the same native listener suite.
- Independent native rerun after the connection-race correction passed: 1 file /
  4 listener tests. This validates all registered services, concurrent start,
  collision terminality, and idle tracked-session closure.
- Added inbound-limit test with exact `maxInboundMessageBytes: 256`: a normal
  Inbox write must succeed and a 2 KiB UUID-bearing wire request must reject with
  `Code.ResourceExhausted`. Local command now has 5 tests, 1 non-network default
  assertion passes, and 4 socket cases stop at sandbox `EPERM`. Lint and package
  typecheck passed. Native command remains `pnpm vitest run
packages/delivery-server/test/delivery-server-listener.test.ts`.
- Independent native rerun of the completed listener suite passed: 1 file / 5
  tests, closing slice 7.

## Current Mechanical Evidence

- `pnpm exec eslint packages/delivery-server/src packages/delivery-server/test`: passed.
- `pnpm exec tsc -p packages/delivery-server --noEmit`: passed.
- `pnpm exec prettier --check packages/delivery-server`: passed.
- `git diff --check`: passed.
- Focused core/config suite: 5 files / 23 tests passed.
- Public API suite: 1 file / 2 tests passed.
- Native Admin command for the orchestrator:
  `pnpm vitest run packages/delivery-server/test/delivery-server-admin.test.ts`.
  The test now correctly uses `createGrpcTransport` and `Http2SessionManager`,
  matching `DeliveryClient.connectTo`; local execution is still stopped before
  RPC by the sandbox loopback `EPERM`.
- Independent native rerun passed: `pnpm vitest run
packages/delivery-server/test/delivery-server-admin.test.ts` (1 file / 1 test).

## Review-Wave Correction Batch

- Reliability P1: the 101st pending Admin update now atomically clears the queue,
  stores the stable `ResourceExhausted` terminal error, unregisters the subscriber,
  and ignores later publication without waiting for another iterator call.
- Reliability P1/P2: Admin owns a per-shard message-count projection. Inbox callbacks
  update it only after actual insert/delete transitions inside mutation admission;
  snapshots and complete frames no longer rescan canonical messages.
- Reliability P1: executable signal handlers are removed together in the shared
  shutdown promise `finally`, including mixed/duplicate signal paths, startup
  failure, and successful teardown.
- Reliability P2: direct cancellation and real transport abort unregister active
  Admin subscribers. Real and direct tests cover pre-ACK mutation discard,
  overflow cleanup, message-only/picked/released observations, no-op count
  suppression, retained last-pick time, deterministic order, and complete frames.
- Reliability P2: package-private `runDeliveryServerShutdown()` owns and proves the
  exact health → admission → Admin → network/session phase order used by the public
  lifecycle.
- Style P2: internal tests now mirror `src` under `test/admin`, `test/health`,
  `test/server`, and `test/bin`; only the genuine public-root test remains at the
  test root.
- Documentation/API: README now imports `DeliveryServer`, shows an explicit
  trusted-network executable command and configured URL, and keeps the cleartext,
  unauthenticated warning adjacent. Public options and lifecycle members have
  complete TSDoc; package description matches both core and standalone listener.
- Focused review-correction RED evidence:
  - overflow cleanup/count projection/shutdown-order tests initially failed because
    the instrumentation and projection did not exist;
  - direct cancellation timed out before subscriber abort handling was added.
- Final focused GREEN evidence: the complete native-inclusive suite passed 16
  files / 74 tests. Generated-build/tooling typechecks, touched lint, cleanup,
  formatting, TypeDoc/API inventory, and cached diff checks all passed on the
  staged correction endpoint.

## Full Verification Coverage Follow-Up

- The native full functional and coverage run passed 126 files / 2,302 tests.
- Initial branch coverage was 7,225/8,028 (89.99%), one covered branch below the
  repository's 90% gate.
- The V8 coverage artifact identified the synchronous blank-host configuration
  guard as a meaningful uncovered T-0065 branch. A behavior-focused assertion now
  proves that `new DeliveryServer({ host: " " })` rejects before startup.
- Focused verification passed 1 file / 2 tests. The native full coverage rerun
  passed at 7,226/8,028 branches (90.00%), with no threshold or exclusion change.
- This is a deterministic test-only coverage correction. It changes no production
  behavior or public contract and does not reopen any specialist review lane.
