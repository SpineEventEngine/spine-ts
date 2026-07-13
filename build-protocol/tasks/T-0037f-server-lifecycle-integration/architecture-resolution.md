# T-0037f Architecture Resolution

Status: Slice 6 final re-review assigned

## Slice 3 Round-2 Review-Fix

- `2026-07-13T20:18:47Z`: expose exact-handle read-only retry ownership so
  blocked initial detach is retried as ordinary detach, not nonexistent retry.

## Slice 3 Round-2 Review-Fix Handback

- `2026-07-13T20:24:18Z`: detach retry ownership remains solely in
  `EnvironmentAttachments`. The exact-handle read-only projection is true only
  for a rejected operation retained by that handle; foreign handles reject and
  observation advances no state. Server no longer infers retry ownership from
  an attempted call.
- A detach rejected before operation creation by another failed rollback stays
  ordinary-detach eligible. Once rollback clears, cleanup advances through the
  existing exact detach, safety, close-group, and terminal gates. No public
  surface, generation state copy, running-close behavior, or Slice 4+ semantics
  are added.
- `2026-07-13T20:26:17Z`: both typechecks, native 5 files / 164 tests, scoped
  lint/cleanup/format, exact nine-path scope/status/public-leak, and diff gates
  pass at unchanged baseline HEAD `0ceedad7`.

## Slice 3 Review-Fix Assignment

- `2026-07-13T19:59:08Z`: endpoint safety and detach completion are distinct.
  Preserve safe-error handles for exact retry while allowing dependency close;
  add the focused network/shared/partial-close/observation evidence.

## Slice 3 Review-Fix Handback

- `2026-07-13T20:09:14Z`: the failed-start record now treats endpoint safety
  and exact detach completion as independent checkpoints. Safe observation
  permits the existing close group to advance but does not remove the handle;
  only successful `detach`/`retryDetach` removes it. Record clearing requires
  no remaining handle and a complete close group.
- This preserves original-first aggregation and cause-once behavior while
  allowing inert exact cleanup to complete later without duplicate dependency
  close. No environment lifecycle state is copied into `Server`, and no public
  option, signature, export, running-close behavior, or Slice 4+ path is added.
- `2026-07-13T20:10:56Z`: both typechecks, native 5 files / 163 tests, scoped
  lint/cleanup/format, exact nine-path scope/status/public-leak, and diff gates
  pass at unchanged baseline HEAD `c3c9b3fd`.

## Resolution Summary

Keep lifecycle integration inside the existing `Server` module and the existing
package-internal `serverEnvironmentAccess` seam. `Server.start()` builds
contexts, derives their existing `boundedContextAccess.delivery(...)`
descriptors, attaches once with caller/server ownership, and awaits the
attachment's finite startup recovery before it creates or opens the HTTP/2
listener. The successful opaque attachment handle moves into
`RunningHttp2Server`.

Running close remains one deep existing public operation:
`RunningServer.close()`. It stops listener intake and sessions, detaches or
retries that exact attachment while endpoint dependencies remain open, and
only after the environment lifecycle reports endpoint safety does it enter the
existing ordered `RetryableCloseGroup` for contexts, explicit resources, and an
owned environment. No public lifecycle method, error class, option, result,
registration, retry handle, or export is added.

Failed start retains one server-private cleanup record only when cleanup cannot
finish in the first `start()` attempt. A later call to the existing
`Server.start()` is the explicit retry entry for that retained cleanup. Such a
call resumes cleanup only: it does not rebuild contexts or open a listener and
cannot return a fictitious `RunningServer`. If cleanup finishes without a
remaining cleanup failure, it rejects with one cause-less plain completion
error stating that deferred cleanup completed after an earlier failed start;
the original startup/delivery cause is not surfaced again. A caller-owned
environment can then be passed to one newly assembled server with fresh
contexts. A server-owned environment is permanently closed and cannot be
reused.

## Authority And Current Integrated Facts

The accepted TASK ledger, D-0085, D-0086, and the T-0037f section of
`PROJECT_COMPLETION_PLAN.md` remain authoritative. Actual integrated source at
baseline `fac6aaad` confirms:

- `Server.start()` currently builds contexts, constructs services/listener,
  and listens without calling `serverEnvironmentAccess.attach()` or reading
  `boundedContextAccess.delivery(...)`.
- `RunningHttp2Server.close()` currently closes network intake/sessions and
  then one flat retryable list of contexts, resources, and optionally the
  environment. It carries no attachment handle.
- `serverEnvironmentAccess` already exposes package-internal `attach`,
  `retryFailedStart`, `detach`, and `retryDetach`; T-0037f must consume them,
  not reproduce their state machines.
- `EnvironmentAttachments.attach()` owns descriptor transition/readiness,
  finite startup recovery, failed-registration rollback, and retained
  failed-start retry.
- `EnvironmentAttachments.detach()` owns last/non-last classification,
  quiescence/barriers, eligible cause consumption/reporting, retirement,
  cleanup, and exact-operation retry.
- `ServerEnvironment.close()` already performs owner-free permanent admission
  and ordered retryable facility teardown. A server-owned running/failed start
  must detach or finish failed-start rollback before calling it.
- `RetryableCloseGroup` already preserves close order, attempts later hooks
  after ordinary hook failures, flattens nested aggregates, and retries only
  failed indexes. It remains the sole context/resource/environment close-index
  owner.
- Current `server.test.ts` covers host/port/base URL, HTTP/2 session drain,
  close aggregation/retry, context-builder storage selection, context-build
  cleanup, caller/server environment ownership, facility order, and listener
  failure. Current environment tests separately prove failed-start, non-last,
  last, stop, permanent-close, and retry state machines, but no test currently
  proves their integration through `Server`.

## Integrated-Behavior Conflict And Narrow Resolution

The accepted ledger requires two different consequences from a rejected
detach or failed-start cleanup:

1. before proven quiescence/barrier, every endpoint-dependent context,
   resource, delivery facility, transport, and storage must remain open; and
2. after proven quiescence/barrier, reporting or inert-cleanup failure must not
   prevent later context/resource/facility close attempts.

The current `serverEnvironmentAccess` returns only `Promise<void>`. A rejected
promise does not reveal which side of that safety boundary was reached.
Conservatively retaining dependencies for every rejection would contradict the
second rule; closing them for every rejection would violate the first. Error
message/type inspection is not an acceptable lifecycle contract, especially
because non-last worker settlement may reject with an arbitrary cause.

Resolve only this demonstrated integration block:

- add a package-internal, handle-qualified endpoint-safety observation to the
  existing environment access; and
- add a package-internal failed-start-pending observation for the no-handle
  attachment-failure case.

The handle-qualified observation is false until a non-last detach has both
proven selected-worker quiescence and established its selected-owner barrier,
or until a last detach has reached the existing generation
`replacementSafe` postcondition. It is true after those points even when
reporting, worker retirement, coordinator removal, or another inert cleanup
step rejected. The failed-start observation is pending only while T-0037d
retains `#failedRollback`; its absence after a rejected attach/retry proves the
existing rollback owner reached its safe completion path. Foreign handles
still reject through existing identity validation.

These are read-only observations of checkpoints already owned by T-0037d/e1.
They do not advance lifecycle state, classify causes, close anything, expose a
generation, or add a root/package export. Do not introduce a second detach
result hierarchy, inspect arbitrary error strings, or copy checkpoint state
into `Server`.

Deterministic unsafe-path integration tests need controlled existing
`EnvironmentAttachments` workers. Reuse its current `createWorker` test seam
through one package-internal server-environment test installer, absent from the
root export and production call path. Do not add a public environment option or
mock lifecycle internals globally.

## Spine JVM Guardrail

The local research notes were searched first, as required:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  “Server assembly and exposed services”, “Environment and storage wiring”,
  and “Lifecycle and close behavior”;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, especially delivery
  ownership, local post-persist observer notification, and monitor-driven
  retry behavior; and
- `spine-jvm-docs/README.md` for the researched core-jvm baseline
  `6bf4118c8c76`.

The corresponding clean local core-jvm source was then inspected at
`/Users/armiol/development/Spine/core-jvm`, commit
`c7ca64b655f98e6c8cc6c8c91ee9a5ee910bfbde`:

- `server/src/main/java/io/spine/server/Server.java` starts gRPC, installs its
  shutdown hook, stops network intake before closing contexts, and logs and
  continues after a context-close failure;
- `server/src/main/java/io/spine/server/ServerEnvironment.java` owns shared
  delivery/factory selection and permanent tracer/transport/storage close;
- `server/src/test/java/io/spine/server/ServerTest.java` exercises public
  start/shutdown rather than a public registration model;
- `server/src/main/java/io/spine/server/delivery/Delivery.java` owns inbox
  observers and synchronous local post-persist notification; and
- `server/src/main/java/io/spine/server/delivery/DeliveryMonitor.java` exposes
  JVM-specific continuation/failure actions.

Implementation impact is deliberately narrow: retain the JVM-familiar
network-before-context shutdown shape and environment-level delivery ownership.
Do not copy JVM singleton state, shutdown hooks, threads, public monitor
actions, repeat callbacks, catch-up stations, or fail-fast environment close.
The stronger async safety/retry rules come from accepted D-0085/D-0086 and the
integrated TypeScript lifecycle, not invented JVM parity.

## Unchanged Public Interface

The root surface remains exactly:

- `Server` and existing constructor/`atPort`/`add`/`addResource`/`start`;
- `RunningServer` with `host`, `port`, `baseUrl`, and `close`;
- `ServerOptions`, including existing environment ownership options; and
- `ServerEnvironment` and its existing factories, properties, and `close`.

No root or package `exports` entry changes. No public signature or option
changes. Package-internal declarations may change only for the safety
observations and deterministic test setup above. `packages/server/test/index.test.ts`
and the API documentation check remain the leak gates.

Observable TSDoc/README may state:

- startup recovery settles before listener intake;
- a failed start may retain cleanup, and a later `start()` call on that same
  server retries cleanup only and does not return a running server;
- running close stops network intake/sessions before environment detach and
  closes contexts/resources only after endpoint safety;
- caller-owned environments remain open and reusable after complete detach;
- server-owned environments close only after detach and context/resource
  cleanup; and
- errors are aggregated without repeating already reported delivery causes.

Public docs must not name registrations, generations, detach handles, the
endpoint-safety observation, or package-internal explicit generation stop.

## Startup State And Ordering

One `Server.start()` attempt owns these ordered phases:

1. Build each configured context with existing partial-build cleanup behavior.
2. Derive one existing delivery descriptor per built context.
3. Attach to the selected environment with ownership `server` only when
   `ownsEnvironment` is true; otherwise use `caller`.
4. Await attachment transition/readiness installation and finite startup
   recovery.
5. Construct/register services and the HTTP/2 server.
6. Open the listener and return `RunningHttp2Server` carrying the exact
   attachment handle.

Listener creation may occur after recovery, not merely listener `listen()`;
this keeps attach failure free of transport cleanup and makes “listener was not
attempted” directly testable. Existing context-build failure remains before
attachment and preserves its current focused cleanup contract; T-0037f does
not redesign builder reuse or close the environment for a failure that occurred
before any environment registration.

Concurrent calls sharing one in-flight `start()` attempt coalesce on one
server-private promise so they cannot duplicate attach or cleanup. A sequential
call after a fully settled ordinary failure is not assigned a broad restart
contract. Only a retained failed-start cleanup record has the explicit retry
meaning described here.

## Failed-Start Cleanup

The server-private cleanup record contains only orchestration facts the
environment does not own: optional HTTP/2 server/sessions, optional attachment
handle, the existing retryable context/resource/environment close group, and
whether the original start failure has already crossed the caller boundary.
It does not copy generation, parked records, quiescence, or facility indexes.

Cleanup order is:

1. close listener intake and sessions if transport was created;
2. for a rejected attachment with no handle, resume T-0037d rollback only when
   the environment reports it pending; for listener failure after successful
   attachment, detach/retry that exact handle;
3. if endpoint safety is unproved, stop and retain every later server cleanup
   checkpoint;
4. once safe, attempt every context and explicit resource close in configured
   order; and
5. when server-owned, call the existing environment close, which performs
   permanent admission and facility teardown in its existing order.

The first `start()` rejection includes the original startup/listener error and
any cleanup errors reached in that attempt, using existing ordered flattening.
The original error is marked emitted. A retained-cleanup retry surfaces only
new retry/cleanup errors. If no new error remains, the retry call rejects with
the cause-less cleanup-completed error described above, clears the server
cleanup record, and opens no listener. This keeps the original and environment-
reported delivery causes from crossing the caller boundary twice.

## Running Close State And Ordering

`RunningHttp2Server.close()` retains its existing coalesced retry behavior and
adds only ordered checkpoints:

1. close HTTP/2 listener intake and sessions once;
2. call `detach` once, then `retryDetach` only after a rejected detach;
3. inspect the environment-owned endpoint-safety checkpoint after rejection;
4. if unsafe, reject without entering any context/resource/environment close;
5. if safe, retain the detach failure for this attempt and still run the
   existing ordered close group over contexts, resources, and optionally the
   environment; and
6. flatten all errors in phase order. The next `close()` retries only the
   retained detach cleanup and close-group indexes that did not succeed.

For non-last detach, safety never grants generation retirement or slot clear;
only the departing registration's barrier/cleanup is retried. For last detach,
the existing replacement-safe finally path clears the retired slot before
later server cleanup. An owned environment has an exclusive registration, so
its permanent close occurs only after successful/safe last detach and
context/resource close. Caller-owned environments are never placed in the
server close group.

## Exact Implementation And Test Ownership

| File                                                               | T-0037f ownership                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/server.ts`                             | Start coalescing; descriptor attachment before listener; retained failed-start server cleanup; attachment handle in running server; ordered detach/safety/close aggregation; observable TSDoc.                       |
| `packages/server/src/server/server-environment.ts`                 | Package-internal forwarding for failed-start-pending and handle endpoint-safety observations; one package-internal deterministic test installer only if required. No public `ServerEnvironment` change beyond TSDoc. |
| `packages/server/src/server/environment-attachment.ts`             | Read-only exposure of already-owned failed-start pending and detach endpoint-safety checkpoints. No attach/detach/stop/record semantic rewrite.                                                                      |
| `packages/server/src/server/retryable-close.ts`                    | No planned semantic change. Touch only if ordered start-error plus cleanup-error flattening cannot reuse `collectCloseError` and `RetryableCloseGroup` directly.                                                     |
| `packages/server/test/server/server-lifecycle-integration.test.ts` | New public-surface lifecycle integration tests for startup, failed-start continuation, running close, sharing, ownership, and races.                                                                                 |
| `packages/server/test/server/server-lifecycle-fixture.ts`          | Controlled existing generation worker, close/order probes, and listener probe shared only by the focused integration test. No production policy.                                                                     |
| `packages/server/test/server/server.test.ts`                       | Preserve existing host/port/session/resource/builder/listener compatibility tests; edit only assertions whose observable ordering is intentionally strengthened.                                                     |
| `packages/server/test/index.test.ts`                               | Existing exact root-export gate; no expected export additions.                                                                                                                                                       |
| `packages/server/README.md`                                        | Observable final lifecycle only; no internal operation names.                                                                                                                                                        |

No delivery coordinator, parked-record, handoff, Protobuf, generated, example,
root index, package manifest, or decision-log file is owned.

## Ordered TDD Implementation Slices

### Slice 1: Recovery Before Listener And Happy-Path Close

Files: `server.ts`, the focused integration test/fixture, and only the minimal
package-internal deterministic environment test setup needed by that test.

- RED: hold finite startup recovery pending and prove `start()` has not created
  or attempted the listener; release recovery and prove the returned host/port/
  base URL remain compatible. A normal close probe must show session/network,
  detach stop/await, context/resource, then owned facility order.
- GREEN: derive existing descriptors, attach before listener construction,
  carry the opaque handle, and sequence normal close through existing access
  and close-group operations.
- Acceptance: exactly one attach; listener only after successful recovery;
  exactly one detach; caller-owned environment remains open; owned environment
  closes after context/resource cleanup; repeated successful close is inert.
- Focused gate: new integration file plus existing `server.test.ts`,
  `environment-attachment.test.ts`, and `environment-close.test.ts`; generated
  build typecheck, scoped lint/format, cleanup rules, diff check, and export-key
  test.

#### Implementation Handback

`2026-07-13T17:37:37Z`: implemented as specified. No safety observation or
failed-start continuation is included: the only failed-listener adjustment is
the existing normal detach required before the pre-existing close group can
close an owned environment. Later slices retain unsafe quiescence, retained
cleanup retry, sharing, and last-detach behavior ownership.

#### Review-Fix Handback

`2026-07-13T17:51:28Z`: Slice 1 now hard-gates listener-failure dependency
cleanup on successful detach, coalesces only the current start attempt, and
narrows the deterministic installer to one pre-lifecycle worker factory.
Tests cover the complete accepted review batch without adding the later
endpoint-safety query or deferred cleanup state machine.

#### Coordinator Gate

Actual implementer metadata matches Terra Medium. Fresh 5-file / 114-test,
typecheck, lint, cleanup, format, scope/status, public-leak, and diff checks
pass. Applicable Slice 1 review concerns are assigned.

#### Review-Fix Assignment

The accepted Slice 1 review batch requires start coalescing, unsafe listener-
failure detach gating, a narrow pristine-only worker installer, and direct
listener/order/reuse/concurrent-close/bind-failure probes. These complete Slice
1 safety evidence without implementing retained cleanup retry from later slices.

### Slice 2: Caller-Owned Failed-Start Continuation

Files: `server.ts`, `server-environment.ts`, `environment-attachment.ts`, and
the focused integration test/fixture.

- RED: an attaching startup rejection whose rollback cannot prove quiescence
  opens no listener and closes no endpoint-dependent context/resource or
  caller-owned facility. A later `start()` call must resume the retained
  rollback without repeating stop/admission closure, then close each deferred
  server-owned dependency exactly once and open no listener.
- GREEN: retain the no-handle server cleanup record, consult only
  failed-start-pending state, aggregate the first failure once, and implement
  cleanup-only retry semantics.
- Acceptance: retry completes classification/reporting/retirement/slot clear
  once; caller environment/facilities stay open; original/reportable causes do
  not reappear; one newly assembled server with fresh contexts later attaches
  to the same environment as one fresh generation with no overlap.
- Focused gate: Slice 1 files plus failed-start/unsafe-retry cases from
  `environment-attachment.test.ts` and `environment-generation-stop.test.ts`.

### Slice 3: Server-Owned Startup And Listener Failure Cleanup

Files: `server.ts` and the focused integration test/fixture; package-internal
access changes only if Slice 2 evidence proves them necessary.

- RED: server-owned startup recovery failure must retire safely before context,
  resource, and environment facilities; unsafe quiescence must retain all of
  them. Listener bind failure after successful recovery must close network,
  detach, context/resource, then environment.
- GREEN: reuse the same retained cleanup record for pre-listener attachment and
  post-attachment listener failures, with the owned environment only in the
  final close group.
- Acceptance: all safe reporting/inert-cleanup errors aggregate while later
  hooks run; unsafe retry duplicates no stop/admission phase; successful retry
  permanently closes the owned environment and returns no `RunningServer`;
  existing `EADDRINUSE` behavior and error identity remain covered.
- Focused gate: focused integration and existing server/listener/environment-
  close tests plus the T-0037d/e3 regression files.

### Slice 4: Shared Non-Last Running Close And Retry

Files: `server.ts`, the endpoint-safety observation in
`server-environment.ts`/`environment-attachment.ts`, and focused tests.

- RED: two servers share one caller-owned environment. Closing one stops only
  its network and owners. Unsafe selected-owner quiescence retains its context/
  resource; explicit `close()` retry resumes exactly that detach. A separate
  post-barrier report/cleanup failure still closes that server's dependencies.
- GREEN: add the handle-qualified safety observation and retain independent
  detach/close-group checkpoints in `RunningHttp2Server`.
- Acceptance: sibling generation identity, readiness, pending work, endpoint,
  context/resource, and facilities stay usable; no generation stop/retire/slot
  clear occurs; newly orphaned records follow existing selection; causes cross
  once; successful hooks do not repeat.
- Focused gate: integration file, `server.test.ts`, environment attachment/
  generation-stop/delivery-record tests, typecheck/lint/format/diff/export.

### Slice 5: Last Detach, Owned Close, And Active-Work Safety

Files: `server.ts` and focused tests. No new lifecycle access beyond Slice 4.

- RED: last close with active delivery proves network intake closes first,
  transport/storage remain open until work settles, and no `PAUSED` successor
  starts after stop admission. Unsafe last detach retains every dependency;
  retry proves quiescence then closes in order. Safe reporting/inert cleanup
  failure still runs every later hook.
- GREEN: use the same running-close state machine with the existing last-detach
  replacement-safe checkpoint and owned environment close group.
- Acceptance: last generation retires/clears once; owned facilities close only
  after contexts/resources; caller-owned environment remains reusable after
  complete last detach; no old/new worker overlap; idempotent/retryable close
  remains compatible.
- Focused gate: integration file plus server, attachment, generation-stop,
  environment-close, run-coordinator, delivery-worker, and delivery-loop tests.

### Slice 6: Observable Documentation And Compatibility Closure

Files: `server.ts` TSDoc, `packages/server/README.md`, focused lifecycle tests,
and current task/work/review records. `packages/server/test/index.test.ts`
changes only if a stronger no-leak assertion is needed, never to add exports.

- RED: focused doc/public-leak scans identify the old flat shutdown wording and
  missing startup-recovery/failed-cleanup retry contract.
- GREEN: document only the observable lifecycle listed above and reconcile test
  names/acceptance evidence without naming internal stop, registration,
  generation, detach, or safety-query concepts.
- Acceptance: exact root exports unchanged; host/port/base URL, context-build
  failure, listener failure, sharing/ownership, retryable close, and public docs
  all match implemented behavior; generated artifacts remain untracked.
- Focused gate: `server.test.ts`, focused lifecycle test, root export test,
  `docs:check:generated`, API leak scans, typecheck/lint/format/diff, then full
  `pnpm verify` only at final child acceptance.

Each slice is one bounded implementation/review package. Run one RED test to
one minimal GREEN change before adding the next behavior; do not write all six
slices' tests up front. Every slice receives the relevant canonical review
concerns, and every concern receives a durable clean or concrete N/A
disposition.

## Focused Commands For The Implementer/Orchestrator

Use the worktree's established package manager invocation and avoid full verify
inside inner loops. The narrow command set is:

```text
corepack pnpm vitest run packages/server/test/server/server-lifecycle-integration.test.ts packages/server/test/server/server.test.ts
corepack pnpm vitest run packages/server/test/server/environment-attachment.test.ts packages/server/test/server/environment-generation-stop.test.ts packages/server/test/server/environment-close.test.ts packages/server/test/server/environment-delivery-records.test.ts packages/server/test/delivery/delivery-run-coordinator.test.ts
corepack pnpm vitest run packages/server/test/index.test.ts
corepack pnpm typecheck:build:generated
corepack pnpm exec eslint <changed TypeScript files>
node scripts/check-cleanup-rules.mjs
corepack pnpm exec prettier --check <changed files>
git diff --check
```

Final acceptance adds `pnpm docs:check:generated`, coverage at or above 90%,
API/export scans, and one full `pnpm verify`; post-merge repeats full verify.

## Risk Assumptions

- Endpoint safety is an environment-owned checkpoint, not inferred from error
  identity. If implementation cannot expose it read-only without changing
  T-0037d/e1 semantics, stop and return an architecture blocker.
- A selected-owner barrier is required for non-last safety even after worker
  settlement; closing a context before that barrier can race retained
  coordinator admission.
- The server-private cleanup record must retain actual built context instances
  and resources; rebuilding on cleanup retry would close the wrong objects and
  duplicate endpoint ownership.
- Context/resource close after a safe detach error may precede completion of
  inert environment cleanup. This is intentional and safe only because the
  environment checkpoint proves no selected endpoint can run.
- `Server.start()` cleanup retry must not create/listen, and must not rethrow the
  original/reportable cause. Otherwise the no-listener and cause-once contracts
  are false.
- Caller-owned environment reuse requires a newly assembled server/context
  set after deferred contexts close. The task does not promise reuse of a
  closed built `BoundedContext` instance or builder.
- Network close remains a gate. If intake/session shutdown itself fails, do not
  detach or close endpoint dependencies until a later close retry establishes
  the network phase.
- Existing `RetryableCloseGroup` is not assumed concurrency-safe. Public
  `start()`/`close()` attempt coalescing must prevent concurrent calls from
  entering the same group twice.
- Test installation of controlled attachments is package-internal and must be
  reset/isolated per test; it must not become runtime configuration or a root
  export.

## Explicit Exclusions

No retry timers, delay/backoff/jitter, health/monitor/scheduler API, process
supervision, signal topology/adapters, public registration/detach/generation
surface, public cleanup handle, public restart method, context-builder redesign,
T-0036/T-0037a-e3 semantic rewrite, parked-record redesign, `CATCH_UP`, legacy
`IMPORT_EVENT`, example change, generated artifact, root export, package export,
Protobuf change, decision-log rewrite, or security review belongs here.

The implementation must not access or modify `human-review-1-jul.md`.

## Architecture Handback

The architecture is ready for bounded TDD implementation in the six ordered
slices above, subject to the orchestrator's model/reasoning metadata acceptance
gate. The demonstrated package-internal safety-observation gap is resolved
without changing the public surface. No human question remains: the accepted
ledger plus fixed `Server.start()` cleanup-retry semantics determines the
smallest coherent implementation.

## Coordinator Acceptance

- `2026-07-13T17:26:43Z`: actual splitter runtime is confirmed as Sol High,
  matching explicit dispatch; the splitter used no subagents and is closed.
- Coordinator planning-file checks and the fresh 5-file / 160-test server and
  environment baseline pass. Slice 1 alone is authorized for Terra Medium TDD.

## Slice 1 Review-Fix Coordinator Gate

- `2026-07-13T17:53:59Z`: fresh 5-file / 120-test and all scoped mechanical,
  status, scope, public-leak, and diff checks pass. A fresh whole-slice
  style/API/reliability re-review is assigned; later slices remain unauthorized.

## Slice 1 Clean Closure

- `2026-07-13T17:58:54Z`: all applicable Slice 1 re-review concerns are CLEAN
  at required actual profiles. Slice 1 is accepted; Slice 2 alone is authorized
  for Terra Medium TDD.

## Slice 2 Implementation Handback

- `2026-07-13T18:10:59Z`: the implementation follows the fixed Slice 2 seam:
  `EnvironmentAttachments.failedStartPending` is a read-only projection of the
  existing rollback owner, forwarded only through package-internal
  `serverEnvironmentAccess`. It advances no state and enters no root export.
- `Server` owns only one no-handle cleanup record containing the existing
  retryable context/resource group. It consults pending state, delegates the
  state transition to `retryFailedStart`, retains dependencies while unsafe,
  and clears them only after environment safety and close-group completion.
- No listener/session or successful attachment-handle continuation is added;
  those remain Slice 3+. No architecture assumption or public contract changed.

## Slice 2 Pre-review Tooling Fix

- `2026-07-13T18:14:43Z`: tooling typecheck requires the focused worker fixture
  to retain real `ShardIndex` evidence and zero-message rejected progress. This
  is a test-contract correction only; Slice 2 behavior is unchanged.

## Slice 2 Coordinator Gate

- `2026-07-13T18:20:43Z`: tooling/generated typechecks, 5 files / 151 tests,
  and all scoped mechanical/public-leak checks pass. Applicable Slice 2 review
  concerns are assigned; later slices remain unauthorized.

## Slice 2 Review-Fix Assignment

- `2026-07-13T18:28:02Z`: fix immediate-safe caller cleanup, keep the pending
  observation read-only, unify fixture worker ownership, and prove cleanup-only
  retry under coalescing/repeated environment and partial close failures. This
  remains caller-owned Slice 2 behavior only.

## Slice 2 Review-Fix Handback

- `2026-07-13T18:37:05Z`: safe no-handle rollback now enters one immediate,
  non-retained `RetryableCloseGroup`; unsafe rollback still retains that same
  group and delegates all progress to existing environment retry state. The
  pending projection is observational only. No endpoint-safety result,
  listener/handle continuation, generation state copy, or public seam was added.
- Test fixture worker generation is now one snapshotted sequence, preserving
  deterministic identity without broadening production configuration.
- `2026-07-13T18:16:55Z`: the fixture now satisfies that evidence contract
  without changing server/environment architecture, runtime behavior, public
  surface, or the later-slice boundary.

## Slice 2 Review-Fix Coordinator Gate

- `2026-07-13T18:40:27Z`: all focused type/test/mechanical/leak checks pass;
  fresh whole-slice style/API/reliability re-review is assigned.

## Slice 2 Round-2 Review-Fix

- `2026-07-13T18:46:44Z`: retain failed immediate-safe close indexes for
  cleanup-only retry and recursively flatten original-first aggregate causes.
  No later-slice behavior is introduced.

## Slice 2 Round-2 Review-Fix Handback

- `2026-07-13T18:54:59Z`: the existing private no-handle cleanup record now
  retains the same `RetryableCloseGroup` when immediate-safe close is partial.
  Existing retryable-close index state remains the sole authority for later
  failed-index-only cleanup; no attachment, listener, or generation seam is
  added.
- Recursive use of the existing close-error traversal flattens both sides of
  immediate failure aggregation in original-first order. The implementation
  introduces no endpoint-safety observation, retained listener/server-owned
  cleanup, public contract, or later-slice continuation.
- `2026-07-13T18:57:02Z`: focused RED/GREEN is 11 pass / 2 expected fail, then
  13/13 pass; the complete native Slice 2 gate is 5 files / 155 tests. Both
  typechecks and all scoped lint, cleanup, format, nine-path allowlist/status/
  leak, and diff checks pass.

## Slice 2 Round-2 Coordinator Gate

- `2026-07-13T18:58:42Z`: all focused gates pass; fresh whole-slice applicable
  re-review is assigned.

## Slice 2 Round-3 Review-Fix

- `2026-07-13T19:04:47Z`: prevent normal restart of a consumed server after
  failed-start cleanup, require newly assembled server reuse, and describe the
  aggregate test truthfully as nested retirement evidence.

## Slice 2 Round-3 Review-Fix Handback

- `2026-07-13T19:09:35Z`: one private terminal bit now separates the consumed
  post-cleanup server from the existing retained-cleanup checkpoint. It is set
  only on the cause-less cleanup-completion path and is checked before any
  build/attach/listen work; no restart semantics or public state are introduced.
- Fresh caller-environment reuse remains a new `Server` plus fresh dependencies.
  Nested aggregate evidence is worker-retirement evidence, not reporter-path
  evidence; the package-internal installer seam remains unchanged.
- `2026-07-13T19:11:16Z`: focused RED/GREEN is 12 pass / 1 expected fail, then
  13/13 pass; the full native gate is 5 files / 155 tests. Both typechecks and
  all scoped mechanical, nine-path status/scope/leak, and diff gates pass.

## Slice 2 Round-3 Coordinator Gate

- `2026-07-13T19:13:06Z`: focused verification passes; fresh applicable whole-
  slice re-review is assigned.

## Slice 2 Round-4 Review-Fix

- `2026-07-13T19:19:36Z`: terminal consumption must coincide with every fully
  completed dependency cleanup path, before any original or retirement error
  is surfaced.

## Slice 2 Round-4 Review-Fix Handback

- `2026-07-13T19:24:08Z`: the existing private terminal bit is now written at
  the cleanup-completion boundary itself: after immediate-safe close success,
  and together with retained-record clearing. Error selection and ordering run
  afterward, so original, collected retirement, and cause-less completion paths
  all leave the same server terminal without adding a public lifecycle state.
- Direct prebuilt/non-idempotent tests prove both transitions and preserve fresh
  separate-server caller-environment reuse. Slice 3+ seams remain unchanged.
- `2026-07-13T19:25:29Z`: focused RED/GREEN is 13 pass / 2 expected fail, then
  15/15 pass; the complete native gate is 5 files / 157 tests. Both typechecks
  and all scoped mechanical, nine-path scope/status/leak, and diff checks pass.

## Slice 2 Round-4 Coordinator Gate

- `2026-07-13T19:26:55Z`: focused verification passes; fresh whole-slice
  applicable re-review is assigned.

## Slice 2 Clean Closure

- `2026-07-13T19:31:28Z`: all applicable concerns are CLEAN at required actual
  profiles. Slice 2 is accepted; Slice 3 alone is authorized for Terra Medium
  TDD.

## Slice 3 Implementation Handback

- `2026-07-13T19:47:13Z`: the accepted failed-start record now covers both
  no-handle server-owned attachment rollback and successful-attachment listener
  failure. It retains only server orchestration facts: optional network owner,
  optional exact handle, whether detach was attempted, and the existing
  retryable dependency group.
- `EnvironmentAttachments.endpointSafe()` is a read-only exact-handle view of
  existing checkpoints: last detach uses `replacementSafe`; non-last detach
  requires selected-owner quiescence and barrier (or completed registration
  removal). Foreign handles retain existing rejection and no public export,
  option, signature, or detached state hierarchy is added.
- Initial errors flatten original-first with reached safe cleanup errors. A
  retained retry omits original/reportable causes, performs no build/admission/
  attach/listen work, closes only after safety, and terminally rejects after
  record completion. Running-close changes remain assigned to later slices.
- `2026-07-13T19:49:09Z`: both typechecks, native 5 files / 159 tests, scoped
  lint/cleanup/format, exact nine-path scope/status/public-leak, and diff gates
  pass at unchanged baseline HEAD `65384a9a`.

## Slice 3 Round-3 Ownership Clarification

- `2026-07-13T20:33:31Z`: whole-slice re-review confirms the prior blocked-
  detach routing fix but finds that the listener record can still adopt a
  different server's environment-wide failed-start retry after its own handle
  clears. Exact cleanup provenance, not ambient environment state, must decide
  whether this record owns `retryFailedStart()`.
- The correction remains private orchestration state plus a focused concurrent
  shared-environment regression. It adds no public API and does not alter
  Slice 4+ running-close semantics.

## Slice 3 Round-3 Resolution Handback

- Rollback retry authority is now a required private fact on the server's
  retained cleanup record. An unsafe attachment-start rollback creates an
  owning record; immediate-safe dependency retry and listener-failure cleanup
  create non-owning records. Ambient `failedStartPending` remains only the
  owning record's progress check, never an ownership source.
- Exact detach/retry routing remains environment-owned and unchanged. A
  non-owning listener record that clears its exact handle proceeds directly to
  its retryable close group even when another server retains unsafe rollback.
  No lifecycle access, export, option, signature, running-close path, or Slice
  4+ behavior changed.
- Focused RED/GREEN is 0/1 then 1/1; the native five-file Slice 3 gate is
  165/165, with both typechecks and scoped lint/cleanup passing before final
  synchronized handback audits.
- `2026-07-13T20:44:56Z`: final typecheck/native/lint/cleanup/Prettier and exact
  scope/status/public-leak/diff gates pass. Seven changed paths remain within
  the accepted nine-path Slice 3 boundary; the architecture and public surface
  are otherwise unchanged.

## Slice 3 Round-3 Coordinator Acceptance

- `2026-07-13T20:48:57Z`: the private provenance correction and deterministic
  cross-server regression pass independent coordinator verification: both
  typechecks, 5 files / 165 tests, and every scoped static/audit gate. The
  existing implementer ran actual `gpt-5.6-terra` / medium with no subagents
  and is closed. Architecture remains unchanged; whole-slice re-review follows.

## Slice 3 Round-4 Attachment Provenance Clarification

- `2026-07-13T20:52:15Z`: exact rollback ownership must originate from the
  attachment attempt that created the failed rollback. An ambient pending flag
  cannot distinguish that owner from a later attachment rejected before claim
  creation. Add only the narrow package-internal provenance needed by `Server`
  and a three-server regression; do not expose a public lifecycle state or
  alter Slice 4+ running-close behavior.

## Slice 3 Round-4 Resolution Handback

- The active `FailedStartRollback` retains only its exact boundary
  `AggregateError`. A package-internal read-only comparison answers whether a
  supplied attachment rejection is that active retry owner. A blocked
  pre-claim attachment receives a distinct explicit-retry error and therefore
  cannot acquire rollback authority.
- `Server` snapshots only the comparison result into its existing private
  cleanup provenance. It does not inspect claims, generations, or rollback
  internals. Existing ambient `failedStartPending` remains solely an owning
  record's progress check. No public export, state hierarchy, option,
  signature, listener/running-close path, or Slice 4+ behavior changes.
- Focused RED/GREEN is 0/1 then 1/1 on both direct and three-server layers; the
  five-file native gate is 167/167, with both typechecks and scoped
  lint/cleanup passing before final synchronized handback audits.
- `2026-07-13T21:00:38Z`: final typecheck/native/lint/cleanup/Prettier and exact
  scope/status/public-leak/public-surface/diff gates pass. Nine changed paths
  remain inside the explicit ten-path boundary; the tenth path is the unchanged
  lifecycle fixture retained in the established Slice 3 allowlist.

## Slice 3 Round-4 Coordinator Acceptance

- `2026-07-13T21:02:54Z`: exact rejection provenance is accepted after
  independent coordinator verification: both typechecks, 6 files / 185 tests,
  and every scoped static/audit gate pass. The actual Terra Medium implementer
  used no subagents and is closed. Public and architectural surfaces remain
  unchanged; fresh whole-slice re-review follows.

## Slice 3 Round-5 Capability Lifetime Clarification

- `2026-07-13T21:07:28Z`: exact rejection identity is a live capability, not a
  permanent boolean. Observation must require a present rollback and assigned
  rejection. The `Server` cleanup record retains the originating rejection and
  re-qualifies it before each rollback retry; once the original rollback clears,
  that record advances only its own close group even if another rollback later
  appears. No public state or Slice 4+ behavior is added.

## Slice 3 Round-5 Resolution Handback

- The exact rejection is a capability with the same lifetime as its active
  `FailedStartRollback`. Optional absence is no longer interpreted as identity:
  both rollback and assigned rejection must be present before equality can
  grant retry authority.
- Server cleanup stores `{ rejection }`, not copied authority. Before invoking
  environment retry, and again after a retry rejection, it asks whether that
  exact capability still owns the active rollback. An expired capability skips
  environment work and reaches only its existing retryable close group.
- Direct tests cover absent, in-flight/unassigned, exact assigned, and cleared
  states. The deterministic A-clear/partial-close/B-new-owner transition proves
  no authority transfer, cause crossing, duplicate successful close, rebuild,
  attach, or listen. No package forwarding, public export, or Slice 4+ behavior
  changes.
- Focused RED/GREEN is 0/2 then 2/2 direct and 0/1 then 1/1 integration; the
  six-file native gate is 188/188, with both typechecks and scoped lint/cleanup
  passing before final handback audits.
- `2026-07-13T21:16:46Z`: final typecheck/native/lint/cleanup/Prettier and exact
  scope/status/public-leak/public-surface/diff gates pass. Eight changed paths
  remain inside the established ten-path internal boundary; package forwarding
  and fixture files remain unchanged.

## Slice 3 Round-5 Coordinator Acceptance

- `2026-07-13T21:19:35Z`: live rejection capability and sentinel guards pass
  independent coordinator verification: both typechecks, 6 files / 188 tests,
  and all scoped gates. Actual Terra Medium implementer used no subagents and
  is closed. Public/architecture surfaces remain unchanged; re-review follows.

## Slice 3 Acceptance And Slice 4 Boundary

- `2026-07-13T21:24:28Z`: all three applicable whole-slice reviewers are CLEAN
  at actual `gpt-5.6-terra` / high, no subagents, closed. Slice 3 exact cleanup
  provenance is accepted at `71c7a9aa`.
- Slice 4 now implements only shared non-last `RunningServer.close()` behavior:
  network first, exact non-last detach/safety, departing dependencies, retry
  checkpoints, sibling isolation, and no generation stop/retire/slot/facility
  close. Same implementer dispatch is `gpt-5.6-terra` / medium.

## Slice 4 Implementation Handback

- `2026-07-13T21:33:11Z`: the accepted Slice 4 shape required no new
  environment observation. Running close now retains independent network,
  exact attachment, and `RetryableCloseGroup` checkpoints. It calls
  `retryDetach` only for this handle's rejected operation and otherwise calls
  ordinary detach; endpoint safety alone decides whether departing dependencies
  may close after a detach rejection.
- Unsafe selected-owner quiescence leaves contexts/resources open and retries
  only the existing detach after the successful network phase. Safe
  post-barrier owner-retirement failure closes all eligible dependencies,
  aggregates detach-first causes with close failures, and retries only retained
  detach cleanup plus failed close indexes. Network failure remains a hard
  pre-detach gate.
- The new shared-generation integration evidence also proves sibling
  connectability/readiness, open caller facilities and sibling storages,
  same-generation join, close coalescing/idempotency, and exact-once hooks. The
  existing delivery-record gate continues to prove newly orphaned selection
  policy. No generation stop, retirement, slot clear, last-detach policy, owned
  active-work policy, public surface, or docs were added.
- RED is 0/1 unsafe retry and 0/1 safe continuation; GREEN is 1/1 and 1/1,
  integration 29/29, and the architecture gate 5 files / 176 tests. Handoff is
  pending fresh coordinator review, not self-acceptance.
- `2026-07-13T21:35:09Z`: final formatted-tree typecheck/native/lint/cleanup/
  Prettier and exact scope/status/public-leak/public-surface/diff gates pass.
  Six changed paths remain inside the ten-path Slice 4 boundary.

## Slice 4 Coordinator Acceptance

- `2026-07-13T21:38:45Z`: independent coordinator verification passes both
  typechecks, 5 files / 176 tests, and all scoped static/audit gates. Actual
  Terra Medium implementer used no subagents and is closed. The accepted
  architecture boundary remains non-last shared running close only; fresh
  applicable review follows.

## Slice 4 Round-2 Error-Presence Clarification

- `2026-07-13T21:44:09Z`: flattened leaf count is reporting data, not the
  detach-rejection checkpoint. Running close must retain an explicit failure
  fact and preserve an empty aggregate when no leaf causes exist. Endpoint
  safety is required after every rejected detach regardless of cause count.
  No public API, last-detach policy, or Slice 5+ behavior changes.

## Slice 4 Round-2 Review-Fix Handback

- `2026-07-13T21:48:04Z`: the implementation now separates `detachRejected`
  control state from `detachErrors` reporting order. Recursive flattening is
  unchanged for non-empty causes; a no-leaf result retains the exact original
  aggregate so rejection cannot become success.
- Endpoint-safety gating, ordinary-versus-retry detach selection, network
  checkpointing, and the existing retryable dependency group remain the only
  lifecycle mechanisms. The correction is local to `RunningHttp2Server`; no
  structured helper or lifecycle authority expansion was required.
- RED/GREEN is 0/2 then 2/2, integration 31/31, and the architecture five-file
  gate 178/178. Fresh coordinator review remains pending.
- `2026-07-13T21:49:38Z`: final typecheck/native/lint/cleanup/Prettier and exact
  scope/status/public-leak/public-surface/diff gates pass on six changed paths
  inside the ten-path boundary.

## Slice 4 Round-2 Coordinator Acceptance

- `2026-07-13T21:51:58Z`: explicit failure-presence control and empty-aggregate
  preservation pass independent verification: both typechecks, 5 files / 178
  tests, and all scoped gates. Actual Terra Medium implementer used no
  subagents and is closed. Architecture remains unchanged; re-review follows.

## Slice 4 Acceptance And Slice 5 Boundary

- `2026-07-13T21:55:10Z`: all three applicable Slice 4 reviewers are CLEAN at
  actual Terra High, no subagents, closed. Shared non-last running close is
  accepted at `72e41729`.
- Slice 5 now owns last detach, active delivery quiescence, no post-stop
  `PAUSED` successor, ordered context/resource/owned-environment close, safe-
  error continuation, and exact retry. Same Terra Medium implementer; no new
  lifecycle access beyond Slice 4 and no docs/public redesign.

## Slice 5 Implementation Handback

- `2026-07-13T22:09:18Z`: the accepted Slice 4 `RunningHttp2Server` checkpoints
  also satisfy the last-detach architecture without production change. Real
  active-work integration proves network/session closure first, irreversible
  stop before held settlement, no post-stop `PAUSED` successor, no old/new
  generation overlap, and context/resource/environment teardown only after the
  environment-owned replacement-safe barrier.
- Unsafe last detach remains handle-qualified and retains all dependencies;
  coalesced retry resumes the rejected detach without repeating successful
  network or stop hooks. Safe retirement/inert failures permit the ordered
  close group to continue, flatten with later cleanup errors, and retry only
  failed indexes. Empty aggregate failure presence and caller-owned fresh-
  generation reuse remain intact.
- Executable RED 0/1 identified an invalid producer/entity identity in the new
  real-event fixture before worker admission. Minimal fixture correction made
  the corrected behavior test 1/1 GREEN; all other last-only probes were green
  against unchanged production. The architecture therefore gains direct
  evidence, not a new state or access mechanism. Native evidence is 6/6
  focused, 36/36 integration, and 8 files / 360 tests; coordinator review is
  pending.
- `2026-07-13T22:12:10Z`: both typechecks and all scoped lint, cleanup,
  formatting, exact six-path scope, 4/4 status, public-leak/public-surface, and
  diff-integrity gates pass on the synchronized handback.

## Slice 5 Coordinator Acceptance

- `2026-07-13T22:14:51Z`: evidence-only Slice 5 passes independent coordinator
  verification: both typechecks, 8 files / 360 tests, and all scoped gates.
  Actual Terra Medium implementer used no subagents and is closed. Production,
  public, and architecture surfaces are unchanged; maintainability and
  reliability review now validate that the evidence is non-vacuous.

## Slice 5 Round-2 Evidence Clarification

- `2026-07-13T22:21:17Z`: accepted behavior is unchanged, but evidence must use
  nonempty tracked context storage, explicit session-event presence, teardown
  protection before every external resource, and a concurrently blocked fresh
  start during held old retirement. These are test/fixture corrections only;
  no production, public, architecture, or Slice 6 change is authorized.

## Slice 5 Round-2 Review-Fix Handback

- `2026-07-13T22:29:36Z`: corrected evidence uses explicit tracked-storage
  context construction, nonzero cardinality, exact context-close observation,
  and per-storage zero/one close counts. Session presence is a required fact
  before order comparison, and active-test cleanup protection begins before
  every global spy, session, worker hold, post, and close operation.
- A fixture-only held-retirement operation makes the no-overlap boundary
  deterministic: a concurrent fresh attachment remains queued with zero fresh
  worker starts until old retirement completes, then starts a distinct
  generation. No lifecycle authority, production state, public surface, or
  Slice 6 behavior changes.
- RED/GREEN evidence is 0/2 to 2/2 for storage non-vacuity and 0/1 to 1/1 for
  held retirement; corrected focused behavior is 6/6, integration 36/36, and
  the architecture gate 8 files / 360 tests with both typechecks passing.
  Coordinator re-review remains pending.
- `2026-07-13T22:31:24Z`: lint, cleanup, exact six-path format/scope, 4/4
  status, public-leak/public-surface, zero-production-diff, and diff-integrity
  gates pass on the synchronized handback.

## Slice 5 Round-2 Coordinator Acceptance

- `2026-07-13T22:34:03Z`: non-vacuous storage/session/teardown/overlap evidence
  passes independent verification: both typechecks, 8 files / 360 tests, and
  all scoped gates. Actual Terra Medium implementer used no subagents and is
  closed. Production/public/architecture surfaces remain unchanged; test-
  validity re-review follows.

## Slice 5 Round-3 Teardown Clarification

- `2026-07-13T22:40:14Z`: every prototype spy and running server in the two
  safe-failure scenarios must be acquired after entering a protected block and
  released through optional teardown handles. This is test hygiene required
  for deterministic evidence, with no behavior or architecture change.

## Slice 5 Round-3 Review-Fix Handback

- `2026-07-13T22:44:54Z`: the two safe-failure tests now establish teardown
  protection before fixture, prototype spy, and running-server acquisition.
  Optional handles and nested cleanup preserve every Slice 5 assertion while
  covering setup/start rejection windows. No lifecycle authority, architecture,
  production behavior, or public surface changed.
- Verification passes 3/3 affected cases, 6/6 corrected Slice 5 cases, 36/36
  integration cases, 8 files / 360 native tests, and both typechecks. Final
  static/audit evidence follows for coordinator re-review.
- `2026-07-13T22:47:22Z`: final scoped lint/cleanup/format and exact five-path
  scope, 4/4 status, public-leak/public-surface, zero-production-diff, and
  diff-integrity gates pass.

## Slice 5 Round-3 Coordinator Acceptance

- `2026-07-13T22:49:43Z`: protected safe-failure setup and independent teardown
  pass both typechecks, 8 files / 360 tests, and all scoped coordinator gates.
  Actual Terra Medium implementer used no subagents and is closed. No behavior
  or architecture change; final test-validity re-review follows.

## Slice 5 Acceptance And Slice 6 Boundary

- `2026-07-13T22:53:21Z`: style and reliability are CLEAN at actual Terra High,
  no subagents, closed. Last/owned active-work evidence is accepted at
  `39c58aed`; no production/public delta was required.
- Slice 6 owns only truthful observable lifecycle documentation, TSDoc/API
  surface checks, compatibility regression, final T-0037f focused/full gate,
  and durable completion records. Same Terra Medium implementer; no new runtime
  behavior or public contract may be invented.

## Slice 6 Implementation Handback

- `2026-07-13T23:04:08Z`: README and public TSDoc now expose only the accepted
  lifecycle contract: recovery before intake; no listener after context-build
  failure; ordered startup cleanup and cleanup-only continuation; terminal
  same-instance failure cleanup; fresh caller-owned reuse; network/work safety
  before dependency close; shared sibling isolation; owned-facility ordering;
  unfinished-only retries; idempotency; and stable observable aggregation.
  Private lifecycle operation names and topology remain absent.
- The focused 3-file compatibility gate is 67/67, generated docs contain all
  205 expected server exports, export/leak and all scoped static gates pass,
  and generated artifacts remain ignored. No runtime, signature, option, root
  export, or test changed.
- Final full verify exposes a pre-existing cross-slice test-fixture mismatch:
  4/1,595 tests fail because four service tests start `Server` with structural
  fakes rather than built contexts. The failure reproduces 4/98 in isolation
  and is outside the accepted Slice 6 file boundary. Architecture acceptance
  remains blocked pending coordinator disposition; no scope expansion occurred.

## Slice 6 Compatibility Fixture Disposition

- `2026-07-13T23:07:21Z`: the accepted server lifecycle requires real built
  contexts. Four older service tests bypass that contract with structural
  fakes. Correct the tests within their service-test ownership: use direct
  handler registration for structural service doubles or real built contexts
  for transport/server coverage. Do not add a production escape hatch. Full
  verify must pass before review assignment.

## Slice 6 Service Fixture Fix Handback

- `2026-07-13T23:14:17Z`: the four structural-double tests now exercise their
  actual service-handler boundary directly. This preserves service error,
  route-order, and tenant assertions without materializing fake lifecycle data
  or changing server/runtime/public behavior. Existing real HTTP/gRPC server
  coverage remains unchanged elsewhere in the same suite.
- Isolated service tests pass 98/98, focused Slice 6 compatibility passes 67/67,
  and full verify passes two 68-file / 1,595-test runs plus 95.31/90.15/98.1/
  95.35 statement/branch/function/line coverage. Documentation, API/export,
  type, lint, format, Proto, generated-clean, and diff gates pass. Review is
  pending; no self-acceptance.
- `2026-07-13T23:15:34Z`: exact final scope is the two Slice 6 documentation
  paths, one authorized service test, and four durable records (7 total); all
  four statuses are synchronized and no generated or unrelated path is present.

## Slice 6 Coordinator Final Acceptance

- `2026-07-13T23:20:14Z`: docs/TSDoc and service fixture compatibility pass an
  independent full project verify: 1,595 native and coverage tests, all coverage
  dimensions above 90%, 205 expected server exports, and every repository gate.
  Actual Terra Medium implementer used no subagents and is closed. Public
  signatures/exports/runtime remain unchanged; four final review lanes follow.

## Slice 6 Final Review Correction

- `2026-07-13T23:28:49Z`: arbitrary close failures require failure presence
  independent of flattened leaf count across the shared retryable close group,
  not only detach reporting. Preserve empty aggregate identity when traversal
  contributes no leaves and retain the failed hook for retry. Complete startup
  network-gate and original-first aggregation docs. This is a narrow accepted-
  contract correction, not a new public surface or lifecycle redesign.

## Slice 6 Final Review-Fix Handback

- `2026-07-13T23:39:27Z`: `RetryableCloseGroup` now treats recursive aggregate
  traversal and failure presence as separate concerns. A non-empty aggregate
  still contributes its flat ordered leaves; an empty or nested-empty aggregate
  contributes the original top-level failure when traversal added no leaf.
  Therefore the failed close index remains pending while later eligible close
  hooks run, and a repeated close retries only that index before becoming inert.
- Direct running-server coverage proves both empty shapes reject first close,
  allow a later resource hook once, retry only the failed explicit resource,
  then make subsequent close inert. Startup documentation now exposes the
  network hard gate and original-first cleanup aggregation without naming
  private lifecycle mechanisms. Full verify passes 68 files / 1,597 tests in
  both native and coverage phases; no lifecycle architecture, public surface,
  service fixture, or generated source changed. Coordinator re-review remains.
- Final exact audit passes eight-path formatting/scope, 4/4 synchronized status,
  public-leak/export/service-fixture checks, generated-clean verification, and
  diff integrity.

## Slice 6 Final Fix Coordinator Acceptance

- `2026-07-13T23:46:55Z`: shared close failure presence, explicit-resource
  retry evidence, and completed startup docs pass independent full verify with
  1,597 native and coverage tests and all project gates. Actual Terra Medium
  implementer used no subagents and is closed. Final four-lane re-review follows.
