# T-0037f Architecture Resolution

Status: Slice 2 round-3 re-review assigned

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
