# Decision Log

Navigation: [README](README.md)

Future implementation must append every decision here or to a task-specific decision file linked from here.

## D-0126: Use Complete Application Replicas Behind Node-Local HTTP/2 Coordinators

Status: Accepted; unexpected-child-exit policy remains open in T-0203

Date: 2026-08-18

Decision: A managed Spine TS deployment starts an explicitly configured number
of complete application-process replicas on every deployment node. Each replica
contains the application's complete Bounded Context set, observes the shared
Delivery Server directly, and uses one process-wide in-memory
`TransportFactory` by default for IntegrationBroker exchange between its local
contexts. A node-local, service-aware HTTP/2 Coordinator exposes the node's
normal Spine gRPC services: Command and Query calls select one ready replica,
while Subscription calls fan one logical node child to every ready replica and
merge their updates. The Gateway remains the only durable logical subscription
owner and performs the outer fan-out across discovered node Coordinators.

The process count is a required deployer-supplied startup value. It is never
derived from CPU count and never changes Delivery shard identity. Integration
traffic and Delivery notifications do not pass through the Gateway or Node
Coordinator. No new public Protobuf service is introduced.

The current same-host ZeroMQ command/event and IntegrationBroker paths are
removed only after the HTTP/2 Coordinator, direct Delivery, and hierarchical
subscription replacement have real acceptance. This decision supersedes the
deployment conclusions of D-0007 and D-0064 and the cross-process-transport
portion of Wave 13; it preserves their historical record and all Wave 13
same-process domain/event semantics.

Rationale: Node.js uses one JavaScript execution thread per process. Complete
replicas allow the deployer to use multiple cores without splitting domain
roles or bypassing CommandBus/EventBus. Shared Delivery already provides the
correct cross-process/node work notification and exclusive shard ownership.
Installing each subscription on every current replica lets the process which
actually observes an Event or commits state emit the update, while the Gateway
retains one durable client-facing subscription. Process-local integration is
sufficient because every replica contains every application Bounded Context.

Consequences:

- Production no longer requires an explicit IntegrationBroker channel factory;
  the optional setting is named `integrationChannelFactory`.
- Managed replicas use ephemeral native subscription registries; the Gateway
  retains durable logical bindings.
- GKE/GCE discovery points to ready Node Coordinators rather than individual
  application workers.
- Managed deployment requires explicitly configured remote/shared Delivery and
  shard strategy, but process and shard counts remain independent.
- The future Gateway-hosted Integration Hub for physically split server
  applications is outside the first release.
- T-0203 must resolve whether an unexpected child exit terminates the whole
  node or triggers bounded child replacement before implementation begins.

## D-0125: Use Node DNS promises for GKE DNS discovery

Status: Accepted

Date: 2026-08-07

Decision: `@spine-event-engine/deployment-gke` uses Node's maintained
`node:dns/promises` `Resolver` directly. It returns A and AAAA records with
TTL metadata, and `Resolver.cancel()` cancels the admitted lookup. The resolver
is injectable for deterministic tests and operator-owned integration.

Rationale: Node LTS already supplies the only needed DNS behavior, so a
third-party DNS dependency would add surface without capability.

## D-0064: Execute Local Runtime Routes Through SignalTransport

Status: Accepted

Date: 2026-07-08

Decision: For T-0016f, make the existing command/event runtime routing plan
executable through the adapter-agnostic `SignalTransport` contract. The runtime
binding registers command routes with request/respond semantics and event routes
with publish/subscribe semantics, validates inbound transport envelopes before
runtime intake, enqueues accepted dispatch work through
`SingleProcessServerRuntime`, and returns a closeable handle that closes
transport registrations before the runtime. Keep ZeroMQ local IPC details in
`@spine-ts/transport` adapter-private code and keep the public server API
same-host/local by construction.

Rationale: Spine JVM contexts route commands through `CommandBus`, events
through `EventBus`, and integration traffic through transport-backed broker
facilities owned by server runtime configuration. Spine TS already has
adapter-agnostic transport descriptors and metadata routing plans, but those
plans are not executable. A small runtime binding proves the local transport
boundary without adding the broader server/environment owner that belongs to
T-0016g.

Alternatives considered:

- Build a complete JVM-style `ServerEnvironment`, integration broker, and
  process supervisor now. Rejected as overbroad for this slice and contrary to
  the simplification mandate.
- Expose ZeroMQ endpoints or socket options in server runtime APIs. Rejected
  because ZeroMQ must remain an adapter-private local IPC implementation detail.
- Keep the routing plan metadata-only. Rejected because T-0016f exists to make
  command/event routes executable over `SignalTransport`.

Consequences:

- Docs must state that the runtime binding is local-only and that live IPC tests
  may require sandbox/network escalation.
- Inbound transport validation must fail before handler dispatch or runtime
  queue intake.
- Later T-0016g lifecycle work owns public server/environment startup and
  shutdown policy; this slice only returns closeable binding handles.

## D-0063: Start Delivery Worker As A Small Shard Drain

Status: Accepted

Date: 2026-07-08

Decision: For T-0016e, add the first delivery worker as a small local shard
drain over the existing durable inbox and shard registry. The worker claims one
shard, reads `TO_DELIVER` inbox rows in stored order, invokes a supplied
framework endpoint callback once per row, marks successful deliveries
`DELIVERED`, leaves failed deliveries retryable, returns simple run statistics,
and releases the shard in a `finally` path. The worker may add a narrow inbox
status-update storage method, but must not introduce a broad scheduler,
transport runtime, catch-up pipeline, delivery monitor hierarchy, batch
listener, observer system, retained attempt-history store, or app-facing
delivery API.

Rationale: Spine JVM `Delivery.deliverMessagesFrom()` claims a shard via
`ShardedWorkRegistry`, reads inbox pages, dispatches live messages through
target deliveries, records delivered rows through a conveyor flush, and releases
the shard. Spine TS already has inbox persistence and shard sessions, but not
the worker handoff. A small shard drain completes the missing boundary while
keeping the server module familiar and avoiding the oversized JVM delivery
centerpiece before transport, catch-up, and scheduling tasks justify it.

Alternatives considered:

- Port JVM delivery stations, conveyor, monitor, observers, catch-up, and
  maintenance now. Rejected as overbroad for the readiness slice and contrary to
  the current simplicity guardrail.
- Keep delivery storage-only and defer worker dispatch again. Rejected because
  T-0016e exists to prove the durable inbox can actually hand work to framework
  endpoints.
- Expose direct app-facing delivery helpers. Rejected because delivery remains
  framework-owned; end-user application code should not manage framework
  internals.

Consequences:

- Documentation must state that this is a local direct worker boundary, not a
  production scheduler or transport-backed delivery loop.
- Later transport/runtime tasks can invoke the same drain/worker API without
  leaking ZeroMQ or process orchestration details into delivery storage.
- Reviewers must flag attempts to add catch-up, batching, broad monitors,
  app-facing delivery APIs, or retained attempt stores in this task.

## D-0062: Keep T-0016d Subscriptions In-Memory And Idempotent

Status: Accepted

Date: 2026-07-08

Decision: For T-0016d, keep `SubscriptionService` as a thin adapter over
context-owned `Stand` subscriptions. A subscription is created as an inactive
in-memory service record only after `Subscribe` validates that the requested
target is registered. Activation attaches that record to the context `Stand`;
duplicate activation for an already-active record completes without updates
and does not add delivery waiters or close the active stream. Cancellation
removes the record idempotently, abandoned inactive records expire after the
inactive TTL, activation iterator/stream finalization removes active records,
and slow consumers are closed when the bounded update queue is exceeded.
Unknown subscription activation completes without updates, and unknown or
missing-ID cancellation returns OK. If activation fails while attaching to
`Stand`, the inactive service record is removed before the error is propagated.

Rationale: Current Spine JVM `SubscriptionService` delegates
`subscribe`/`activate`/`cancel` to `Stand`; `Stand` validates topics and
subscriptions against a subscription registry. Spine TS has the same small
service/Stand split but does not yet have JVM's full durable/server-side
subscription registry model. Completing unknown activation streams and treating
unknown cancellation as OK gives the first Connect/Node surface deterministic
client cleanup behavior without adding a speculative durable subscription
store.

Alternatives considered:

- Add a durable subscription store now. Rejected as broader than T-0016d and
  premature before delivery worker and transport-backed runtime tasks.
- Match JVM unknown-subscription validation exactly and fail activation/cancel
  for missing records. Rejected for this slice because the current async
  iterator API already uses stream completion for unknown activation, and
  idempotent cancellation is simpler for local client cleanup.

Consequences:

- Documentation must explicitly call subscription state process-local and
  in-memory.
- Unknown subscription targets are rejected before service records exist; never
  activated records expire by TTL; active records are removed by cancellation,
  stream finalization, attach failure, or queue-limit closure.
- Later server lifecycle/runtime tasks may replace the service-local map with a
  richer registry, but must preserve tenant checks and cleanup guarantees.

## D-0061: Keep T-0016c Query Readiness To The Minimal Explicit Profile

Status: Accepted

Date: 2026-07-08

Decision: For T-0016c, keep `QueryService.Read` on the current minimal Spine TS
profile: ID-filter point reads and projection-state `Target.include_all = true`
reads. Reject unsupported column filters and response-format features explicitly
before storage reads. Keep the service layer as a thin bounded-context router
and error translator, with read-side execution delegated to the context-owned
`Stand`.

Rationale: Current Spine JVM source keeps `QueryService` as a target-type router
and delegates to `context.stand().execute(query, observer)`. JVM `Stand` then
uses query processors backed by repository/storage query APIs. Spine TS does
not yet have the full repository/query-column/response-format machinery, so
silently accepting unsupported query shapes would mislead users. A small,
explicit profile matches the current framework stage and avoids inventing a
generic query engine.

Alternatives considered:

- Implement full JVM-style column filters, field masks, ordering, and limits in
  this task. Rejected as too broad for T-0016c and likely to overbuild storage
  semantics before repositories expose the needed metadata.
- Continue accepting partially malformed filters and returning empty results.
  Rejected because unsupported query features must fail explicitly and early.

Consequences:

- Docs must state the supported profile and unsupported features clearly.
- Later tasks can add column filters/response format when storage and
  query-column metadata are ready.

## D-0059: Bare decorators are completed by generated handler registries

Status: Accepted

Date: 2026-07-07

Context: T-0014 established that ordinary end-user code uses bare `@Assign`,
`@Command`, `@React`, and `@Subscribe`, avoids schema-bearing decorators, avoids
framework `Command`/`Event` envelope returns, and does not own decorated handler
discovery or materialization. Runtime standard decorator metadata does not
expose TypeScript parameter or return types, so bare decorators alone cannot
recover Protobuf-ES schemas for command/event routing. T-0015a needed a small
contract before later package-generation, runtime-discovery, and to-do
migration slices; T-0015c adds the build-time analyzer for that contract.

Decision: Treat the generated handler registry as the framework-owned bridge
from bare decorated methods to canonical handler metadata. The logical registry
is versioned and groups handlers by entity class. Each generated handler record
contains the handler kind, method name, inferred first-parameter signal schema,
explicit public arity of one or two parameters, and emitted schemas inferred
from explicit return types. `@Assign` emits non-empty generated event schemas,
`@Command` emits non-empty generated command schemas, `@React` emits generated
event schemas or nothing, and `@Subscribe` emits none because it must return
explicit `void`. New generated registry records do not include `@Apply`.

Generated registry modules are ignored build artifacts under `generated/`
output directories and must not be committed. T-0015a deliberately does not
choose the final runtime loading anchor; T-0015c implements the analyzer, while
package generation and automatic discovery remain later T-0015d/T-0015e work.

Consequences:

- Ordinary application examples remain bare-decorator source and must not call
  `materializeDecoratedEntityHandlers()` or app-owned discovery helpers.
- The analyzer must fail closed when the first parameter type or required return
  type is missing, has the wrong generated signal role, lacks a verified
  generated schema export, or resolves to a framework envelope.
- Existing schema-bearing decorator materialization remains compatibility code
  only and is not the public path for new app handlers.
- Later registry ingestion should convert generated records into existing
  handler metadata/readiness surfaces instead of adding a broad parallel
  runtime registration API.

## D-0047: Reset implementation toward simpler JVM-aligned architecture

Status: Accepted

Date: 2026-07-01

Context: Human review on `2026-07-01` rejected the current framework direction
as over-engineered. The review specifically called out flat package structure,
co-located tests, long names, scattered standalone helpers, generated code in
version control, and server concepts much larger than their Spine JVM
counterparts. `bounded-context.ts` was named as representative evidence:
redundant error-detail types such as `BoundedContextRepositorySnapshotErrorDetails`
and `BoundedContextRepositoryRegistrationConflictErrorDetails` do not map to a
clear JVM concept and make the API harder to read. The human clarified that no
external users depend on the current framework code, so cleanup may be
aggressive and may delete or replace wrong abstractions.

Decision: Abandon the current `T-0012` command-execution branch line and restart
corrective work from the repository trunk. The repository has no local
`master` ref; `main` is the available trunk and is used as the reset base. The
new implementation roadmap must follow this order:

1. `StorageFactory`, `Storage`, in-memory storage, and event store.
2. `CommandBus`, `EventBus`, dispatching mechanisms, and JVM-like handler
   annotations/decorators.
3. `BoundedContext`, assembly, and registration.
4. Entity kinds, repositories, signal routing, and aggregate storage as
   snapshots plus events.
5. Delivery, `Inbox`, signal endpoints, and event-dispatch transactions.
6. `Stand` and entity-updated system events.
7. Real gRPC `CommandService`, `QueryService`, and `SubscriptionService`
   interfaces matching Spine JVM protobuf contracts.
8. Previously omitted details.
9. Then implement the to-do example app; when the example exposes a missing
   framework feature, implement the framework feature first and continue.

Code should prefer Spine JVM concept names and small APIs over precise but long
TypeScript-specific names. Public standalone functions are disallowed unless a
strong reason is recorded. Programmer/configuration mistakes should use simple
errors/exceptions; runtime signal outcomes may use small result objects. The
implementation must not introduce large "details" error hierarchies or
speculative concepts merely because a later framework may need something
related.

Consequences:

- Future splitter, implementer, and reviewer prompts must treat simplicity as a
  hard requirement, not taste feedback.
- Generated Protobuf-ES output belongs under `packages/<package>/generated/`,
  is removed and regenerated during builds, and is entirely ignored by Git.
- T-0024 later clarified that item 4's aggregate storage shape is superseded by
  ADR 0001/T-0024: aggregates load the latest persisted state, and aggregate
  events are retained as a traceability journal only.
- Production source files must be grouped by package-specific semantics under
  `src/`; package-root `src` folders should contain only a few top-level entry
  files. Tests must live under `packages/<package>/test/` and mirror the
  corresponding `src` folder structure.
- The to-do example may use in-memory storage, but it must start only after real
  gRPC, query, and subscription APIs exist. It is not a simulation.
- Reviewers must flag over-engineered names, excessive error-detail types,
  standalone helper sprawl, flat source layouts, co-located tests, committed
  generated code, and any divergence from the corrected implementation order.

## D-0046: T-0009f starts repository and bounded-context seams without dispatch execution

Status: Accepted

Date: 2026-06-30

Context: After T-0009e introduced OOP entity base classes, the next roadmap item
is `T-0009f Repository Seams And Bounded-Context Registration Skeleton`.
Spine JVM `BoundedContextBuilder` accepts repositories and entity classes,
builds contexts lazily, and registers repositories/dispatchers with buses,
stands, storage, integration brokers, and delivery. Spine JVM repositories route
signals to inbox endpoints instead of directly executing handlers in the common
dispatch path. The TypeScript framework does not yet have buses, inbox delivery,
read-side stands, gRPC services, tenant index storage, or production storage
factories.

Decision: Start T-0009f with registration seams only: repository identity and
entity-family ownership metadata, bounded-context name/tenant-mode builders,
add/remove registration APIs, duplicate/conflict checks, immutable built context
snapshots, and capability markers that later buses/stands/storage can consume.
Do not execute handlers, route commands/events, write inbox records, open
storage, build system contexts, start buses, expose gRPC services, or infer
tenant state in this slice. Keep the API familiar to Spine JVM users but
TypeScript-small until the missing runtime pieces exist.

Consequences:

- Reviewers must reject dispatch, storage, inbox, stand, gRPC, ZeroMQ, or system
  context behavior added under T-0009f unless the splitter creates a later
  explicit subtask for that behavior.
- Builder APIs may expose names that mirror JVM concepts, but documentation must
  state which runtime behaviors remain deferred.
- Future bus/storage/read-side tasks can consume these registration snapshots as
  contracts without inheriting speculative runtime execution.

## D-0045: Server-module implementation requires close JVM source guardrail

Status: Accepted

Date: 2026-06-30

Context: Human guidance before further `server` module implementation clarified
that TypeScript server work must take a close look at the corresponding Spine
JVM `core-jvm/server` code, avoid over-inventing, and avoid over-engineering.
The build protocol already contained a JVM source inspection note, but the
guidance needs to be explicit as a protocol-level guardrail before any more
server-module code is created or changed.

Decision: Strengthen `BUILD_PROTOCOL.md#skills-and-tooling` so any code related
to `@spine-ts/server` must inspect task-relevant Spine JVM `core-jvm/server`
source before creating or changing server runtime/API code. Implementers must
record the inspected JVM notes/source files and their implementation impact in
the task log before or in the same atomic step as code changes. Server-module
work must prefer the smallest TypeScript contract that remains familiar to
Spine JVM behavior, and must defer broader abstractions, lifecycle phases,
dispatch/storage behavior, or convenience APIs unless both inspected JVM source
and current task scope justify them.

Consequences:

- Future server-module tasks have an auditable pre-implementation source
  inspection gate, not a vague compatibility preference.
- Reviewers should flag server code that introduces abstractions or runtime
  behavior without recorded task-relevant `core-jvm/server` source evidence.
- Documentation and task logs should describe unsupported or deferred behavior
  instead of expanding the server module speculatively.

## D-0044: T-0009e entity bases start as scoped OOP state shells

Status: Accepted

Date: 2026-06-29

Context: The roadmap now reaches `T-0009e Concrete OOP Entity Base Classes
With Capability Segregation`. `T-0009d.2` already provides an
`EntityTransaction` draft/result kernel, handler metadata exists, and
repositories/storage dispatch are still later tasks. Spine JVM `Entity`,
`AbstractEntity`, `TransactionalEntity`, `Aggregate`, `Projection`, and
`ProcessManager` show the desired conceptual shape, but most JVM behavior is
repository or dispatch owned.

Decision: Start entity base classes as small OOP state shells that expose
identity, state snapshots, version metadata, lifecycle flags, and scoped
transaction-backed draft mutation for future runtime callers. Do not implement
repository ownership, handler invocation, event sourcing history, dispatch
phases, idempotency, query clients, Bounded Context injection, lifecycle events,
storage writes, buses, gRPC, or ZeroMQ in the first `T-0009e` slice. Family
classes such as `Aggregate`, `Projection`, and `ProcessManager` may exist as
typed capability markers only if the splitter keeps them shallow and verifies
they do not pretend to dispatch.

Alternatives considered:

- Build full aggregate/projection/process-manager dispatch now. Rejected
  because repositories, buses, event history, and storage integration are later
  roadmap items and would over-invent the server module.
- Keep only standalone transaction helpers and delay entity classes entirely.
  Rejected because the developer API needs familiar OOP base-class shapes before
  repository seams can bind metadata, handlers, and transactions.
- Model JVM builders directly. Rejected because Protobuf-ES uses message
  values and schemas rather than generated Java builders; TS should use
  explicit transaction draft updates while preserving the conceptual boundary.

Consequences:

- Reviewers must reject any first-slice entity base behavior that silently
  invokes handlers, stores state, posts signals, or exposes transport/runtime
  details.
- Public docs must be explicit that these bases are local OOP/domain shells and
  future repository/runtime consumers own persistence and dispatch.
- The splitter must stage any family-specific restrictions, event-sourced
  aggregate behavior, or process-manager querying separately.

## D-0043: T-0009d.2c closes the transaction API without runtime expansion

Status: Accepted

Date: 2026-06-29

Context: `T-0009d.2a` introduced the minimal `EntityTransaction` draft/commit
kernel, and `T-0009d.2b` added lifecycle and explicit version draft helpers.
The remaining splitter item, `T-0009d.2c Public API Polish, Compatibility
Notes, Verification Closure`, should make the series interruption-resistant and
clear to users without adding behavior that belongs to later repository,
entity-base, dispatch, storage, or transport tasks.

Decision: Treat `T-0009d.2c` as a public API compatibility and verification
closure. It may update parent task/work logs, user/API/architecture docs,
TypeDoc wording, export-gate expectations, and tests that assert the existing
public surface. It must not add new transaction runtime capabilities unless a
concrete compatibility defect is discovered, the corresponding Spine JVM
`core-jvm/server` code is inspected, and a new decision is recorded. The
default implementation path is docs, compatibility notes, API assertions, and
verification evidence.

Alternatives considered:

- Add the next runtime layer now, such as entity base classes or repository
  commit integration. Rejected because the splitter scoped this final item as
  public API polish and verification closure, and the human asked to avoid
  over-inventing server behavior.
- Add convenience helpers proactively before entity bases exist. Rejected
  because D-0040 through D-0042 keep the transaction kernel deliberately small
  until concrete runtime consumers prove the API gap.
- Skip the closure because `2a` and `2b` already pass verification. Rejected
  because parent roadmap logs and public compatibility notes must stay durable
  and clear before the next server task builds on this API.

Consequences:

- Reviewers for `T-0009d.2c` must flag any new runtime behavior as out of
  scope unless it is tied to a recorded compatibility defect and JVM source
  inspection.
- Public docs should describe `EntityTransaction` as a JVM-familiar in-memory
  draft/result boundary, not storage-backed transaction infrastructure.
- Completion requires fresh branch verification and main integration
  verification evidence.

## D-0042: T-0009d.2b lifecycle and version helpers are draft metadata only

Date: 2026-06-29

Context: `T-0009d.2b` follows the minimal `EntityTransaction` kernel with
small lifecycle and explicit version draft helpers. Spine JVM `Transaction`
buffers `LifecycleFlags` and exposes `setArchived()` / `setDeleted()` only
inside an active transaction. JVM version increments are tied to
`VersionIncrement` and dispatch phases, which are not implemented in this TS
slice.

Decision: Add only draft metadata helpers in `@spine-ts/server` for lifecycle
flags and caller-owned version metadata. Lifecycle helpers may set `archived`
or `deleted` flags on the in-memory transaction draft, and `requireActive()`
may guard active-only mutation based on those draft flags. Version helpers may
replace explicit draft metadata supplied by the caller. The framework will not
invent automatic increments, clocks, event versions, lifecycle events,
repository filtering, storage writes, entity records, or dispatch-phase
semantics in this task.

Alternatives considered:

- Implement JVM-style `VersionIncrement` now. Rejected because event/command
  dispatch phases and event version policy are not available yet.
- Emit lifecycle events or diagnostics from helpers. Rejected because storage,
  entity records, lifecycle monitors, and buses are out of scope.
- Treat archived/deleted flags as read-side filtering behavior. Rejected
  because read-side query semantics belong to repository/storage/query tasks.

Consequences:

- The public helper names stay familiar to Spine JVM users without claiming
  persistence/runtime behavior.
- Later entity base classes can call these helpers inside framework-controlled
  handling transactions.
- Later runtime tasks must define how version increments and lifecycle
  diagnostics are produced before storage/dispatch integration.

## D-0041: T-0009d.2a validation-rejected commits leave the draft transaction active

Date: 2026-06-29

Context: `T-0009d.2a` adds the minimal `EntityTransaction` draft/result kernel.
The task requires ordinary validation failures to return rejected commit results
with validator violations and not throw. It also requires deterministic rejection
of `update()` and `commit()` after commit or rollback, but does not specify that
a validation-rejected commit attempt releases the transaction.

Decision: A validation-rejected `commit()` returns `status: "rejected"` with
the previous state, rejected draft, version metadata, lifecycle flags, and
validator result, while keeping the transaction `status` as `"active"`.
Accepted commits set transaction status to `"committed"`; rollback sets it to
`"rolled-back"`.

Consequences:

- Framework/runtime code can inspect validator violations and decide whether to
  update the draft again, roll back, or surface the rejection.
- The minimal transaction status union remains the D-0040 set:
  `"active" | "committed" | "rolled-back"`.
- Future repository/handler slices may add stricter caller policy without
  changing the structured rejected commit result.

## D-0040: T-0009d.2 server transaction kernel stays smaller than runtime

Date: 2026-06-29

Context: T-0009d.2 starts the entity transaction layer after built-in
`(set_once)` transition validation. The human specifically warned that
`@spine-ts/server` work should closely inspect Spine JVM `core-jvm/server` and
avoid over-inventing. Task-relevant JVM code shows `Transaction` as a buffered
draft over entity state, version, and lifecycle flags, injected into a
`TransactionalEntity`, validated at commit, and released after commit or
rollback. It also owns dispatch phases and entity mutation in JVM, but those
runtime concerns are larger than this TS slice.

Decision: Implement only a small TypeScript transaction draft/result kernel in
this task. It may expose an explicit draft/update API, active/committed/rolled
back status, lifecycle/version draft data, commit-time state transition
validation through `validateEntityStateTransition()`, and structured commit
results. It must not implement repositories, storage writes/reads, handler
dispatch, dispatcher phases, recent history, buses, gRPC, ZeroMQ, worker
processes, or transport adapters.

Alternatives considered:

- Implement a full JVM-like `Transaction` with dispatch phases now. Rejected
  because handler invocation, repositories, and storage are not ready, and this
  would overfit unimplemented runtime behavior.
- Keep only the existing pure `validateEntityStateTransition()` API. Rejected
  because the next server slice needs a framework-owned commit boundary that
  future entity base classes can consume.
- Use implicit global or async-local transaction state. Rejected for this slice
  because the JVM model exposes explicit transaction ownership and the TS spec
  prefers explicit parameters for Node async safety.

Consequences:

- Future `Aggregate`, `Projection`, and `ProcessManager` base classes can build
  on a small validation-backed transaction boundary.
- Later runtime tasks may add repository integration and dispatch phases without
  breaking this public kernel.
- Reviewers should reject speculative transport/storage/dispatch behavior in
  this task even if it resembles later JVM responsibilities.

## D-0001: Documentation-only scope for current task

Answer from human: create documentation/specifications only now. Do not create package skeletons or implementation code.

## D-0002: New folder name

Answer from human: use `build-protocol` as the new root folder for this specification set.

## D-0003: Spine Protobuf files

Answer from human: required Spine Protobuf files must be copied into the TS framework implementation. The specification records this as a compatibility requirement; actual copying happens during implementation.

## D-0004: Compatibility target

Answer from human: no source-level compatibility with Spine JVM is required, but the TS framework should be conceptually familiar to Spine JVM users.

## D-0005: Handler declaration

Answer from human: use TypeScript decorators if they fit, and use the latest mature TypeScript decorator specification. The spec therefore targets TypeScript 5+ standard decorators and requires fallback/codegen investigation.

## D-0006: Custom code generation

Answer from human: whether custom code generation is required is an investigation decision. The spec defines the generated/runtime metadata contract but does not prescribe the generation mechanism.

## D-0007: ZeroMQ scope

Answer from human: ZeroMQ is only for local IPC signal transfer. Scaling beyond one host should use another transport behind the abstraction.

## D-0008: Bus topology

Answer from human: choose topology based on bus needs; buses have publishers and subscribers, and pub/sub appears natural. The spec uses pub/sub where appropriate but allows other ZeroMQ patterns inside the adapter for command/query semantics.

## D-0009: gRPC service contracts

Answer from human: keep Spine JVM gRPC interfaces, especially `CommandService`, `QueryService`, and `SubscriptionService`; sync/async behavior follows their definitions.

## D-0010: To-do example timing

Answer from human: the spec must require a standalone to-do example app, but details remain light until the framework shape is defined.

## D-0011: Build protocol execution environment

Answer from human: the build protocol will be executed in Codex on macOS with sub-agents available.

## D-0012: Human questions

Answer from human: stop on blocking questions. For non-blocking questions, spawn advisory sub-agents, have them propose/vote, record the result, and continue.

## D-0013: Tooling choices

Answer from human: define selection criteria now and defer exact choices.

## D-0014: Review coverage

Answer from human: every task, including documentation tasks, must receive code style, documentation, TS docs, security, and performance reviews.

## D-0015: Required docs from start

Answer from human: ADRs, package-level READMEs, and API references are required from the start; architecture diagrams are not required from the start.

## D-0016: Initialize implementation repository before first task branch

Date: 2026-06-27

Context: The implementation workspace initially contained the build protocol and JVM research documents but was not a Git repository. The build protocol requires one feature branch and one worktree per coding task/sub-task.

Decision: Initialize this workspace as a Git repository, commit the existing specification and bootstrap logs as the baseline, then create task-specific feature branches and worktrees from that baseline.

Alternatives considered:

- Treat the absence of Git as a blocking human question. Rejected because the user explicitly requested immediate autonomous progress and branch/worktree execution is part of the protocol.
- Use temporary directories without Git branches. Rejected because it would violate the protocol and make interruption recovery weaker.

Consequences:

- The initial repository history starts from the provided specification corpus plus the autonomous-process bootstrap logs.
- Task implementation branches are traceable from the first durable baseline commit.

## D-0017: Reusable governance templates without duplicated quality rules

Date: 2026-06-27

Context: T-0001 creates durable task, work-log, review-log, question-log, and decision templates before runtime implementation begins. Future agents need consistent files for resumability, but the repository already has `build-protocol/CODE_QUALITY.md` as the seed for authoritative quality rules.

Decision: Add reusable governance templates under `build-protocol/templates/` and contributor workflow notes in `build-protocol/CONTRIBUTOR_WORKFLOW.md`. Templates must link to `BUILD_PROTOCOL.md` and `CODE_QUALITY.md` for gates, quality rules, and reviewer expectations instead of copying those rules into each template.

Alternatives considered:

- Copy quality gates into every template. Rejected because copied rules drift and violate the non-duplication rule.
- Defer templates until implementation code exists. Rejected because the build protocol requires durable logs before or alongside changes and reviewer loops need a stable scaffold.

Consequences:

- Future task agents can start from a consistent logging shape.
- Reviewers can verify resumability and protocol compliance without comparing several duplicated quality-rule files.
- Any future rule changes should be made in the authoritative protocol or quality documents, then referenced from templates as needed.

## D-0018: Canonical governance paths and redacted logs

Date: 2026-06-27

Context: Review round 1 for T-0001 found that task logs could drift into parallel path shapes and unresolved-question references could imply lowercase/uppercase aliases. The same review asked for audit-friendly governance logs that do not commit sensitive values.

Decision: Use `build-protocol/tasks/<task-slug>/TASK.md` as the canonical task-log path for new tasks, matching the existing bootstrap records. Use only `build-protocol/questions/UNRESOLVED.md` for unresolved questions. Governance logs and templates must record enough evidence for auditability while redacting tokens, credentials, auth headers, secret environment variables, sensitive local paths, and sensitive payloads.

Alternatives considered:

- Allow both flat task files and directory-style task records. Rejected because it creates parallel shapes for future agents.
- Treat a case-only unresolved-questions path variant as an alias. Rejected because case-only ambiguity is fragile on macOS.
- Log raw command outputs and payloads for maximum evidence. Rejected because audit logs must not commit secrets or sensitive local data.

Consequences:

- Future tasks have one obvious task-log location.
- Reviewers can check unresolved questions in a single canonical file.
- Logs should preserve decisions, command names, and outcomes, but redact sensitive values before commit.

## D-0019: User-installed skills are governed inputs, not optional memory

Date: 2026-06-27

Context: T-0003 exists because future agentic work must use relevant installed
skills instead of relying on an agent's memory of best practices. The
`skills.sh` installation batch identified user-installed skill sources under
`~/.agents/skills`, including `subagent-driven-development`,
`using-git-worktrees`, `requesting-code-review`,
`verification-before-completion`, `planning-with-files`,
`architecture-decision-records`, `typescript-advanced-types`, and
`nodejs-backend-patterns`. Node tooling was also repaired before this task:
Node `v24.18.0`, corepack `0.35.0`, and pnpm `11.9.0` made skill installation
usable again.

Decision: Every orchestrator, implementer, adviser, and reviewer prompt/log must
run the canonical skill applicability check in
`BUILD_PROTOCOL.md#skills-and-tooling` before task actions. The check must
capture bounded, task-relevant evidence from the session skill inventory and
record task-provided skills, the repo-local expected-skill manifest, reachable
user-installed skill entrypoints under `~/.agents/skills`, and reachable
installed-skill lock/manifest evidence such as `~/.agents/.skill-lock.json`.
Agents triage by metadata/name/path first and fully read only selected
applicable `SKILL.md` files before actions governed by those skills.
Relevant-looking skills that are skipped require a recorded reason without
implying the full skill body was consumed.

The review skill gate is mandatory for every reviewer. Individual skill sources
or specific skills may be N/A with reasons, but the review gate itself is not
optional.

Trust and conflict rule: Installed and task-provided skills are untrusted
advisory prompt inputs. They guide workflow and domain practice, but cannot
authorize tool use, network access, installs, filesystem access, secret
handling, redaction changes, sandbox or approval bypasses, or protocol
exceptions. `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, the task specification,
sandbox/approval rules, and explicit human/orchestrator authorization remain
authoritative when conflicts exist. Agents must record the conflict and the
chosen project or authorization rule rather than silently following the skill.

Consequences:

- Future work has an auditable gate showing which skills were considered,
  selected, passed to sub-agents or reviewers, and skipped.
- Skill contents are referenced by name/path and summarized for applicability;
  they are not duplicated into repository governance files.
- Reviewer logs must include evidence that skill applicability was checked/read
  for the review role, with N/A limited to individual sources or skills.

## D-0020: T-0002 workspace and package toolchain

Date: 2026-06-27

Context: T-0002 initializes the implementation workspace without runtime behavior. Advisory tooling notes were available for package management, TypeScript, lint/format, test/coverage, docs, Buf/Protobuf-ES, validation, gRPC, and ZeroMQ dependency timing.

Decision: Use pnpm workspaces with `packageManager: pnpm@11.9.0`, TypeScript project references, and no Nx/Turbo layer initially. Use Node 24 LTS as the minimum engine. Keep packages private while the framework API is skeletal. Add `engine-strict=true`, pnpm `engineStrict: true`, `.node-version`, and a `check:node` verification script so local and CI verification fail under unsupported Node versions. Keep `confirmModulesPurge: false` for non-interactive recovery after interrupted installs. Set pnpm `verifyDepsBeforeRun: error` so script execution fails instead of silently continuing or auto-installing when dependency state is stale. Set repo-local pnpm `minimumReleaseAge: 1440` and add narrow `minimumReleaseAgeExclude` entries for the already reviewed fresh lockfile pins `prettier@3.9.0` and `js-yaml@4.3.0` instead of a global freshness bypass.

Alternatives considered:

- Nx or Turbo for orchestration. Deferred because the skeleton has simple project references and workspace scripts; a task runner can be added once build graph cost justifies it.
- npm or Yarn as the canonical package manager. Rejected for now in favor of pnpm's workspace ergonomics and deterministic lockfile behavior.

Consequences:

- Root scripts call the standard pnpm workspace toolchain directly.
- One-time release-age policy exceptions were used while creating/updating the lockfile because the task explicitly pinned fresh packages, including `prettier@3.9.0`; the broad bypass is not retained as a repo default, and the repo now enforces release-age protection with explicit package/version exclusions for reviewed fresh pins.
- Non-interactive runs avoid TTY purge prompts after interrupted installs.
- Normal installs are subject to the repo-local release-age policy; scripts also keep pnpm's dependency-state pre-run verification enabled in fail-fast mode.
- Verification explicitly checks Node major version before TypeScript, lint, tests, docs, or proto stubs run.
- Reviewers should revisit task-runner adoption only after package graph complexity or CI time makes it useful.

## D-0021: T-0002 TypeScript and module target

Date: 2026-06-27

Context: The framework is ESM-first and targets modern Node.js. Advisory notes recommended TypeScript 6.0.3 with NodeNext and strict settings.

Decision: Pin `typescript@6.0.3`, configure ESM-first `NodeNext`, and enable modern strict compiler settings in `tsconfig.base.json`. Keep a documented fallback to TypeScript 5.9 if compatibility with released dependencies fails in a later verification or review task.

Alternatives considered:

- TypeScript 5.9 immediately. Deferred because advisory guidance selected 6.0.3 and the task should start from the intended current compiler.
- CommonJS output. Rejected because the framework and selected ecosystem are ESM-first.

Consequences:

- Package source imports use NodeNext-compatible `.js` specifiers.
- Later runtime tasks must preserve explicit public API types and TypeDoc comments.

## D-0022: T-0002 linting, formatting, testing, coverage, and API docs

Date: 2026-06-27

Context: The repository needs quality gates from the start without duplicating `CODE_QUALITY.md`. Advisory notes recommended ESLint flat config, `typescript-eslint@8.62.0`, Prettier 3.9.0, Vitest 4.1.9, V8 coverage, and TypeDoc 0.28.19.

Decision: Use ESLint flat config with `typescript-eslint@8.62.0`, `eslint-config-prettier`, Prettier 3.9.0, Vitest 4.1.9 with `@vitest/coverage-v8@4.1.9`, and TypeDoc 0.28.19 native HTML output. Configure 90% coverage thresholds for the current skeleton exports and future meaningful source. Defer `typedoc-plugin-markdown`. Format durable repository areas, including future `build-protocol/**/*.md` task/review/log files, while ignoring pre-existing unformatted protocol files until a dedicated formatting cleanup owns that churn. Add `@types/node@24.13.2` and a no-emit tooling/test/config TypeScript check so Vitest config and test files are typechecked in addition to package project references.

Alternatives considered:

- Biome or Oxlint as primary lint/format tooling. Rejected/deferred because ESLint plus typescript-eslint gives mature type-aware rules for this bootstrap.
- TypeDoc Markdown output. Deferred because native HTML is canonical for now and avoids another plugin dependency.

Consequences:

- Generated docs output lives under `docs/api/reference` and is ignored by Git.
- The current coverage gate is satisfied by metadata-only skeleton tests; future tasks must add behavior-level tests as runtime code appears.
- `pnpm typecheck` runs both `tsc -b` for package source builds and `tsc --noEmit -p tsconfig.eslint.json` for tests/config/tooling TS.
- TypeDoc currently emits one warning because the local `origin` remote is not valid for source links; HTML generation still succeeds with zero errors.

## D-0023: T-0002 Buf and Protobuf-ES bootstrap

Date: 2026-06-27

Context: The technical spec requires Buf and Protobuf-ES, but T-0002 must not copy Spine proto files. Advisory notes recommended current Buf/Protobuf-ES package versions and v2 config stubs.

Decision: Install `@bufbuild/buf@1.71.0`, `@bufbuild/protobuf@2.12.1`, and `@bufbuild/protoc-gen-es@2.12.1`. Add `buf.yaml` and `buf.gen.yaml` v2 stubs with `target=ts`, `import_extension=js`, and local `protoc-gen-es`. Add a proto workflow script that exits successfully with an explicit deferred message while `proto/` contains no `.proto` files. Approve only `@bufbuild/buf` in pnpm `onlyBuiltDependencies`, because pnpm flagged its postinstall build script during verification.

Alternatives considered:

- Copy Spine proto files during T-0002. Rejected because proto intake is out of scope for this task.
- Use `ts-proto`, `protobuf.js`, or hand-written bindings. Rejected by the Protobuf contract.

Consequences:

- `pnpm proto:lint` and `pnpm proto:generate` are realistic commands now and become real Buf invocations after proto intake.
- Generated Protobuf-ES output is expected under `packages/proto/src/generated` and is excluded from lint, coverage, and docs.

Supersession note: `D-0047` supersedes the generated-output path above. Current
generated Protobuf-ES output belongs under ignored
`packages/proto/generated`, is cleaned and regenerated by `pnpm proto:generate`,
and must remain untracked.

## D-0024: T-0002 deferred runtime dependencies and skill-install attempt

Date: 2026-06-27

Context: Advisory notes covered validation, gRPC, ZeroMQ, and Codex skills. T-0002 owns tooling only and must not implement runtime adapters or services.

Decision: Do not install `@spine-event-engine/validation-ts`, Connect/gRPC packages, or `zeromq` in T-0002. Record validation-ts as mandatory but deferred to the validation/proto task; current advisory note: latest `2.0.0-snapshot.1`, snapshot `2.0.0-snapshot.4`, peer `@bufbuild/protobuf ^2.10.2`. Prefer Connect-ES v2 candidates in the future server service-contract task, with `grpc-js` fallback only. Prefer `zeromq@6` in the future transport adapter task, deferred because it introduces native addon/runtime scope.

Also record that skills listing was repeated via `skill-installer` and failed with GitHub HTTP 401; no skill was installed and the failure is non-blocking for T-0002.

Alternatives considered:

- Install validation, gRPC, and ZeroMQ dependencies immediately. Rejected because that would widen T-0002 into runtime scope and make native/runtime verification premature.
- Treat the skills-listing failure as blocking. Rejected because the task has enough explicit advisory input and no required skill was available.

Consequences:

- Runtime dependency selection remains auditable without adding unused packages.
- Later validation, service-contract, and transport tasks must pin and smoke test their own dependencies when they enter scope.

## D-0025: T-0004 proto intake uses exact researched Spine source commits

Status: Accepted

Context: `PROTOBUF_CONTRACT.md` requires copied Spine JVM `.proto` files to be
preserved as canonical contracts, beginning with `spine/options.proto`, while
T-0002 intentionally deferred proto intake. The JVM research corpus records the
source baseline and commit IDs used for Spine 2.0.0-series behavior. The actual
proto files are not present in this repository, so T-0004 needs reproducible
upstream provenance before copying or generating any contracts.

Decision: T-0004 will copy proto files verbatim from exact GitHub raw URLs at
the researched commits recorded in `spine-jvm-docs/README.md`, starting with:

- `SpineEventEngine/base` commit
  `43b55858c410eaf79fc594ca6f3f3eab0daca027` for `spine/options.proto`
  and base/string transitive dependencies.
- `SpineEventEngine/validation` commit
  `6aec690168182866876584dab7c5a0b220b9b493` for
  `spine/validation/validation_error.proto`.
- `SpineEventEngine/time` commit
  `0d0251c1495f4dc5a383ef2d6b8b2a0e405a327d` only if the T-0004 minimal
  intake includes `spine/time_options.proto` or time message dependencies.

T-0004 must add a manifest or verification mechanism that records source
repository, full commit, upstream path, canonical source/raw URLs, local path,
and a checksum for each copied file. The default verification remains
network-free: it validates the manifest shape, copied file set, safe local
paths, and local SHA-256 checksums rather than fetching upstream on every run.
Buf and Protobuf-ES generation remain the only supported TypeScript generation
path.

Alternatives considered:

- Copy from local `/private/tmp/spine-research` clones. Rejected because those
  clones are not present in this workspace and would weaken reproducibility for
  interruption recovery.
- Track upstream default branches. Rejected because that could silently change
  Protobuf contracts and break compatibility with the researched JVM baseline.
- Rewrite a smaller local `options.proto`. Rejected by the Protobuf contract and
  the user instruction to preserve Spine definitions.

Consequences:

- Proto compatibility is tied to a stable, reviewable JVM research baseline.
- Network is required for the first intake or future drift checks unless files
  are already vendored locally.
- Future tasks may add more Spine proto sources from `core-jvm`, `time`,
  `change`, or other baseline repos, but each addition must extend the manifest
  rather than editing copied definitions by hand.

## D-0026: Pin pnpm local virtual-store behavior for reproducible verification

Status: Accepted

Date: 2026-06-28

Context: The workspace requires `verifyDepsBeforeRun: error` so scripts do not
run against stale dependency metadata. After Node and Corepack were repaired,
the Codex shell initially resolved an app-bundled `pnpm@11.7.0` while the
project pins `pnpm@11.9.0`. Reinstalling with Corepack fixed the package-manager
metadata, but `CI=true pnpm verify` still rejected the tree unless the
global-virtual-store setting matched the install command.

Decision: Pin `enableGlobalVirtualStore: false` in `pnpm-workspace.yaml` and use
Corepack so the project-pinned `pnpm@11.9.0` runs installs and verification.

Alternatives considered:

- Disable `verifyDepsBeforeRun`. Rejected because it would weaken the
  interruption-resistant verification guard established for the workspace.
- Require every verification command to pass
  `--config.enable-global-virtual-store=false`. Rejected because it is easy for
  future agents to forget and leaves the project dependent on shell history.
- Edit `node_modules/.modules.yaml` by hand. Rejected because install metadata
  should be owned by pnpm, not manually patched.

Consequences:

- `CI=true corepack pnpm verify` can compare dependency metadata against an
  explicit workspace setting instead of an ambient pnpm default.
- Future local installs should use Corepack or another pnpm `11.9.0`
  executable to respect `packageManager`.
- If the project later adopts pnpm's global virtual store intentionally, that
  decision must update this record and rerun install plus full verification.

## D-0027: Put the first runtime type registry in `@spine-ts/core`

Status: Accepted

Date: 2026-06-28

Context: T-0005 introduces the metadata and type registry layer over
Protobuf-ES schemas. The registry is runtime behavior: it owns lookup semantics,
duplicate registration policy, type URL derivation, and later metadata access
for validation and routing. The `@spine-ts/proto` package currently owns copied
Spine contracts, generated Protobuf-ES output, and curated generated exports.

Decision: Implement the first registry slice in `packages/core` and consume
curated exports from `@spine-ts/proto`. Keep `@spine-ts/proto` focused on
canonical generated contracts and generated-schema availability. Use explicit
manual registration for the current curated Spine schemas in this first slice.

Alternatives considered:

- Put the registry in `@spine-ts/proto`. Rejected because that would mix
  generated-contract ownership with runtime lookup policy and make later
  validation/runtime dependencies leak into the proto package.
- Create a new package only for metadata. Deferred because the current
  workspace already has `@spine-ts/core` for core runtime concepts and the
  first registry surface is small enough to belong there.

Consequences:

- Runtime users import registry APIs from `@spine-ts/core`.
- `@spine-ts/core` may depend on `@spine-ts/proto`, but generated packages do
  not depend on runtime packages.
- If the registry grows into a large independent compatibility layer, a future
  decision may split it into a dedicated package without changing the
  generated-contract boundary.

## D-0028: T-0005 registry lookup and type URL policy

Status: Accepted

Date: 2026-06-28

Context: T-0005 needs deterministic lookup semantics before runtime envelopes,
validation, or `Any` unpacking exist. The Protobuf contract requires mappings
between full names, type URLs, schemas, and semantic tags. Current copied Spine
proto files expose type URL prefixes and option definitions but only a small
message closure.

Decision: The first registry will derive canonical type URLs as
`<file type_url_prefix>/<schema.typeName>` when a file option supplies a prefix,
with `type.googleapis.com` as the documented fallback prefix used only for
files without the option.
Registration fails fast on duplicate full names, duplicate type URLs, or
conflicting schema identities. Public lookup APIs include throwing `get*`
methods and non-throwing `find*` methods, so callers can choose fail-fast or
optional control flow explicitly.

Alternatives considered:

- Overwrite duplicates like a plain map. Rejected because silent replacement can
  corrupt routing and validation decisions.
- Return only `undefined` for misses. Rejected because framework internals need
  descriptive failures when required message types are missing.
- Implement `Any` pack/unpack helpers immediately. Deferred to later envelope
  and validation tasks; T-0005 only supplies the registry lookup foundation.

Consequences:

- Runtime code can use fail-fast lookups while tests and optional flows can use
  `find*` methods.
- Duplicate registration tests become part of the compatibility guard.
- A later task must revisit semantic tag registration once copied proto fixtures
  include real `(is)` or `(every_is)` consumers.

## D-0029: Wrap `@spine-event-engine/validation-ts` behind the core validation facade

Status: Accepted

Date: 2026-06-28

Context: T-0006 introduces message validation. The Protobuf contract mandates
`@spine-event-engine/validation-ts` for single-message validation and reserves
stateful rules such as `(set_once)` for the framework transaction/runtime layer.
Current npm metadata checked on 2026-06-28 reports package versions
`2.0.0-snapshot.1`, `2.0.0-snapshot.3`, and `2.0.0-snapshot.4`; dist-tags
`latest = 2.0.0-snapshot.1` and `snapshot = 2.0.0-snapshot.4`; peer dependency
`@bufbuild/protobuf ^2.10.2`. The project currently uses
`@bufbuild/protobuf 2.12.1`, which satisfies the peer range. The published
snapshot README says the package API is experimental and recommends installing
the `snapshot` dist-tag.

Decision: Add `@spine-event-engine/validation-ts` to `@spine-ts/core` as an
exact `2.0.0-snapshot.4` dependency for T-0006, because that is the current
snapshot dist-tag and matches the project's Buf/Protobuf-ES stack. Do not expose
`validation-ts` imports as the framework API. Instead, wrap its public
`validate(schema, message)` and violation helpers behind a small
`@spine-ts/core` facade that returns structured Spine validation data and offers
a throwing check path. Keep framework transition validation, including
`(set_once)`, separate from single-message validation.

Alternatives considered:

- Use the npm `latest` dist-tag (`2.0.0-snapshot.1`). Rejected because the
  package README directs users to the `snapshot` dist-tag and `snapshot.4` is
  newer while remaining peer-compatible.
- Reimplement Spine validation rules in T-0006. Rejected because it violates
  the non-negotiable requirement to use `validation-ts` for single-message
  validation and would duplicate a common infrastructure library.
- Depend on a generic Protobuf validator or non-Buf generator runtime. Rejected
  because current library search did not find a Spine-options-compatible
  alternative, and generic protobuf stacks conflict with the Buf/Protobuf-ES
  contract.

Consequences:

- The framework can absorb `validation-ts` API churn by adjusting one adapter
  instead of changing user imports.
- T-0006 tests must exercise the facade behavior, not the upstream package
  internals.
- Future dependency updates must re-check the npm dist-tags, peer dependency,
  and exported declarations before changing the exact package version.

## D-0030: Core Signal Proto Intake Before Envelope Helpers

Status: Accepted

Date: 2026-06-28

Context: T-0007 needs command/event envelope and actor/tenant/version context
support. The current repository only contains the earlier proto intake set for
options, field paths, template strings, and validation errors. High-level
TypeScript envelope helpers would otherwise need to invent local shapes or
partial hand-written contracts.

Decision: Implement T-0007 as a proto-first sequence. T-0007a copies and
generates the minimal transitive Spine proto set for command/event envelopes and
actor/tenant/version context before adding higher-level TS envelope construction
helpers in later slices.

Alternatives considered:

- Implement TS-only envelope interfaces first. Rejected because it would violate
  the preserved Protobuf contract requirement and risk source-level drift from
  Spine message definitions.
- Copy every remaining Spine core/server/client proto now. Deferred because the
  task should keep scope reviewable and avoid pulling storage/service contracts
  before the envelope/context surface is needed.
- Generate from external imports without copying transitive support protos.
  Rejected because the repository must preserve copied Spine contracts and make
  Buf generation reproducible from pinned sources.

Consequences:

- T-0007a will add more curated `@spine-ts/proto` exports and default core
  registry entries.
- High-level `packCommand`, `packEvent`, origin-chain helpers, and validation
  policy can use generated contracts instead of hand-written message shapes.
- Runtime command/event bus tasks can rely on canonical type URLs and generated
  schemas.

## D-0031: Pin legacy base support protos used by core signal context

Status: Accepted

Date: 2026-06-28

Context: T-0007a copies the minimal transitive proto set for Spine
`Command`, `Event`, and actor/tenant context. The researched 2.0-series
`SpineEventEngine/base` commit used by T-0004 contains `spine/options.proto`,
`spine/base/field_path.proto`, and `spine/string/template_string.proto`, but
does not contain `spine/net/email_address.proto`,
`spine/net/internet_domain.proto`, or `spine/ui/language.proto`. Those files
were present only in a local extracted include-protos cache from a separate
Spine-using project. The cache alone was not enough provenance for
`proto/spine-sources.json`.

Decision: Copy the three support protos from the local extracted include-protos
cache only after verifying they match `SpineEventEngine/base` tag `v1.9.0`
commit `4e5dc1e9f3f361d3ac283d366cf2b639b1f62c12` byte-for-byte. Record that
commit, raw URL, source URL, and SHA-256 in `proto/spine-sources.json`.

Evidence:

- Local project dependency metadata pins `io.spine:spine-base:1.9.0`.
- `git ls-remote --tags https://github.com/SpineEventEngine/base.git`
  returned tag `v1.9.0` at
  `4e5dc1e9f3f361d3ac283d366cf2b639b1f62c12`.
- Raw GitHub checksums for the three files matched the local extracted copies:
  `d3fde13f40d61160933184b41a6221e06933191fb493c55778ce8e5789eb1ca6` for
  `email_address.proto`,
  `7efff4e0cb9c0052f245565fc5ac643bb1196cd0ecbdaa98b342ebb9c8fcc092` for
  `internet_domain.proto`, and
  `197d6d89ba396a0e4654665af63f5dcf39061820378e8cbb71fb082a51475418` for
  `language.proto`.

Alternatives considered:

- Attribute the extracted files to the 2.0-series base commit. Rejected because
  that commit does not contain the files.
- Omit `TenantId` or `ActorContext` transitive support. Rejected because it
  would make the copied command/event context closure incomplete.
- Rewrite smaller local replacements. Rejected by the Protobuf contract's
  verbatim-copy requirement.

Consequences:

- The T-0007a closure mixes 2.0-series core/time/validation contracts with the
  exact older base support protos required by those context messages.
- Future proto refresh work should revisit whether newer Spine repositories
  moved or renamed the net/UI support contracts before changing these manifest
  entries.

## D-0032: Use Spine-aware Any packing for core envelope helpers

Status: Accepted

Date: 2026-06-28

Context: T-0007b adds the first `@spine-ts/core` helpers for packing domain
messages into generated `spine.core.Command` and `spine.core.Event` envelopes.
Buf Protobuf-ES provides WKT `anyPack()` and `anyUnpack()` helpers, but
`anyPack()` currently builds type URLs with the standard
`type.googleapis.com/<full.type.Name>` prefix. Spine contracts declare
`option (type_url_prefix) = "type.spine.io"` and runtime routing depends on the
canonical Spine URL produced by the existing `deriveTypeUrl()` registry helper.

Decision: Implement T-0007b packing with `deriveTypeUrl(schema)` and
Protobuf-ES binary serialization rather than direct `anyPack()` use. Keep
unpacking/checking helpers exact-type-url aware so callers do not parse or
compare type URLs ad hoc.

Alternatives considered:

- Use Buf `anyPack()` directly. Rejected because it emits
  `type.googleapis.com/...` and would silently break Spine routing/type URL
  compatibility.
- Add local string concatenation at call sites. Rejected because it repeats type
  URL policy outside the core registry seam.
- Defer packing until runtime buses. Rejected because later command/event bus
  and service tasks need a tested canonical envelope construction surface.

Consequences:

- `@spine-ts/core` owns the Spine-aware `Any` packing seam.
- Command/event helpers can validate and pack payloads without exposing binary
  or type URL details to framework users.
- Future runtime tasks can consume generated `Command` and `Event` envelopes
  without inventing a second packing policy.

## D-0033: Start storage with package-owned contracts and in-memory adapter

Status: Accepted

Date: 2026-06-28

Context: The roadmap after core envelope construction points to `T-0008 Storage
Foundation`. Runtime architecture requires storage boundaries for entity
records, aggregate event histories and snapshots, read-side projection records,
delivery inbox records, tenant index records, and diagnostics. The repository
already has an `@spine-ts/storage` package skeleton, while repository,
transaction, bus, delivery, and ZeroMQ runtime behavior remain separate future
tasks.

Decision: Implement the first storage slice in `@spine-ts/storage` as
framework-owned TypeScript contracts plus an in-memory adapter. Keep it
record-oriented and asynchronous, with separate write/read storage concepts
where useful, but do not couple it to repositories, buses, decorators,
transport, or production databases yet.

Alternatives considered:

- Put storage contracts in `@spine-ts/core`. Rejected because storage is a
  runtime adapter boundary and `core` already owns metadata, validation, and
  envelope helpers.
- Start with a production database adapter. Rejected because no repository or
  delivery runtime exists yet and the storage seam needs tests before selecting
  durable infrastructure.
- Delay storage until repositories exist. Rejected because repository and
  delivery tasks need a stable adapter seam and an in-memory test backend.

Consequences:

- `@spine-ts/storage` becomes the package owner for storage interfaces and the
  first in-memory implementation.
- Future repository, delivery, projection, and transport tasks can depend on a
  tested storage seam without importing ZeroMQ or service concerns.
- T-0008a must document that in-memory storage is for tests/development and is
  not durable across process restarts.

## D-0034: Keep entity metadata in server with narrow proto option exports

Status: Accepted

Date: 2026-06-28

Context: The next roadmap slice is `T-0009 Entity And Handler Model`. The first
implementable sub-task needs descriptor-derived entity metadata: entity
kind/visibility, query columns, `(set_once)` fields, first-field routing hints,
and semantic tags from `(is)`/`(every_is)`. The generated `spine/options.proto`
file already contains the required Protobuf-ES extension descriptors, but the
`@spine-ts/proto` package root intentionally exposes only curated contracts.
The current `@spine-ts/server` package is still a skeleton and should own
server/runtime entity semantics rather than pushing repository-specific metadata
into `@spine-ts/core`.

Decision: Implement `T-0009a` by keeping entity metadata extraction in
`@spine-ts/server` and adding only narrow curated `@spine-ts/proto` root exports
for the Spine option descriptors and enum/message types required by that
extractor. Generic schema/type URL lookup remains in `@spine-ts/core`.
Decorators, handler registration, transactions, repositories, buses, storage
writes, and ZeroMQ remain out of scope for `T-0009a`.

Alternatives considered:

- Broadly re-export generated `spine/options_pb.ts`. Rejected because the proto
  package has an explicit curated-export policy and API docs check guarding
  against broad generated re-exports.
- Put entity metadata extraction in `@spine-ts/core`. Rejected because entity
  kind, visibility, columns, and routing hints are server/runtime model
  concerns, while `core` should stay focused on type registry, validation, and
  envelope helpers.
- Delay option exports until handler decorators. Rejected because transaction
  validation and handler metadata need the same descriptor surface, and
  `T-0009a` can test it without import-time side effects.

Consequences:

- `@spine-ts/proto` grows a small explicit public option surface.
- `@spine-ts/server` becomes the owner of entity metadata extraction and can use
  it later for handler registration, transaction validation, and repository
  assembly.
- Reviewers must verify that `T-0009a` does not introduce runtime registration,
  decorators, storage writes, buses, transport, or repository behavior.

## D-0035: Implement explicit handler registration before decorators

Status: Accepted

Date: 2026-06-29

Context: `T-0009b Handler Metadata Contract And Explicit Registration API`
continues the entity/handler model after descriptor-derived entity metadata.
The framework needs handler metadata for command assignment, command reaction,
event subscription, event reaction, and event application before later
transaction and runtime tasks can validate or invoke anything. TypeScript 5+
standard decorators may be useful, but decorator behavior and metadata
collection would add runtime/import-order questions before the core contract is
proven.

Decision: Implement an explicit OOP-style registration API first. It will bind
generated Protobuf-ES schemas to entity class method names and produce frozen,
deterministic handler metadata without instantiating entities or invoking
methods. Decorator support in `T-0009c` must target the same metadata contract
rather than inventing a parallel registration model.

Alternatives considered:

- Start with TypeScript decorators. Rejected because decorator metadata would
  couple the first handler contract to import-time side effects and still need
  an explicit fallback for users who avoid decorators.
- Delay handler metadata until the transaction kernel. Rejected because
  transaction validation needs a tested metadata surface and would otherwise
  mix API design with execution semantics.
- Build a full runtime registry immediately. Rejected because duplicate
  registration and lookup validation can follow once the explicit definition
  shape is stable.

Consequences:

- `@spine-ts/server` gets a deterministic, testable handler metadata surface
  before runtime execution exists.
- Later decorators can remain syntax sugar over explicit registration.
- Reviewers must verify that `T-0009b` does not implement handler invocation,
  transactions, repositories, buses, storage writes, or ZeroMQ transport.

## D-0036: Use caller-owned handler registry with first duplicate policy

Status: Accepted

Date: 2026-06-29

Context: `T-0009b.3 Handler Metadata Registry And Validation` follows the
explicit handler metadata contract from D-0035. The runtime architecture states
that a bounded context should have one effective handler per command message
type unless transformation/splitting is explicitly modeled, while events must
fan out to eligible subscribers/reactors/projections. The framework needs a
validated registry surface before decorators, repositories, and transaction
execution can consume handler metadata.

Decision: Implement the first handler metadata registry as caller-owned,
lookup-only data in `@spine-ts/server`. The registry registers existing
`EntityHandlersMetadata` objects, freezes deterministic listing/lookup views,
and rejects duplicate/conflicting declarations that would make later routing
ambiguous. The first public policy is:

- one command assignment per command message full type name in one registry;
- one event application per entity state full type name and event message full
  type name in one registry;
- event subscriptions, event reactions, and command reactions may have multiple
  handlers because later fan-out and process-manager behavior need many-to-one
  metadata.

The registry must not instantiate entities, invoke handlers, unpack payloads,
write storage, start buses/transports, or mutate global process state.

Alternatives considered:

- Keep registry validation deferred until repositories. Rejected because
  repositories and decorators would then each need ad hoc duplicate checks.
- Use a global process-wide registry. Rejected because import-order and test
  isolation would become observable before bounded-context assembly exists.
- Reject duplicate event subscriptions/reactors. Rejected because event fan-out
  is a core runtime requirement and would over-constrain projection/reactor
  modeling.

Consequences:

- Later decorators can emit or adapt to the same explicit registry contract.
- Later repository/routing tasks can rely on prevalidated command-assignee and
  event-applier uniqueness.
- Custom command routing or transformation/splitting may require a future
  extension of the duplicate policy, but the first lookup-only registry remains
  deterministic and conservative.

## D-0037: Use standard decorators as metadata-only handler adapters

Status: Accepted

Date: 2026-06-29

Context: `T-0009c.1 Decorator Metadata Collection` follows the explicit handler
metadata contract and caller-owned registry from D-0035 and D-0036. The
developer API calls for TypeScript 5+ standard decorators when they fit, while
preserving an explicit fallback and avoiding legacy `emitDecoratorMetadata`,
parameter decorators, import-order-sensitive globals, or runtime invocation
during metadata declaration.

Decision: Implement decorator support as syntax over the explicit handler
metadata contract. Public `@Assign`, `@Command`, `@Subscribe`, `@React`, and
`@Apply` method decorators must require explicit Protobuf-ES schemas, collect
class-owned deterministic metadata, and expose a materialization function that
returns the same `EntityHandlersMetadata` shape accepted by
`HandlerMetadataRegistry`. The explicit `defineEntityHandlers()` API remains the
fallback and the canonical metadata shape. Decorators must not instantiate
entities, invoke handlers, unpack payloads, write storage, start buses or
transports, or mutate a global process-wide registry.

Alternatives considered:

- Use legacy decorator metadata or `reflect-metadata`. Rejected because the
  project targets TypeScript 5+ standard decorators and explicit schema
  arguments preserve Protobuf contract clarity.
- Register decorated handlers in a global registry at import time. Rejected
  because import order would become observable and would make tests and bounded
  contexts harder to isolate.
- Skip decorators and rely only on explicit registration. Rejected because the
  developer API asks for annotation-like OOP handler declaration when standard
  decorators can fit without replacing explicit registration.
- Use code generation as the first decorator-like mechanism. Rejected for this
  slice because standard decorators can be tested locally against the same
  metadata contract before adding a generation pipeline.

Consequences:

- Decorator APIs must remain metadata-only and registry-compatible.
- Reviewers must verify there is no import-time global registration, handler
  invocation, repository/runtime behavior, storage write, bus, gRPC, or ZeroMQ
  behavior in T-0009c.1.
- If local TypeScript standard decorator semantics prove insufficient for a
  particular ergonomic goal, the explicit registration API remains supported and
  a later codegen task can be proposed without changing the registry contract.

## D-0038: Enforce set-once after the first committed entity state

Status: Accepted

Date: 2026-06-29

Context: `T-0009d.1 Built-In Set-Once Transition Validation` starts the
transaction/runtime validation roadmap without implementing transactions,
repositories, storage writes, or handler dispatch. Entity metadata already
surfaces fields marked with Spine `(set_once) = true`, and the core package
already exposes a framework-owned `validateTransition()` seam that sanitizes
transition-rule violations into repo-local `spine.validation.*` messages.
Proto3 scalar fields do not preserve user intent to set a default value, so the
first slice needs a deterministic committed-state rule.

Decision: Implement `(set_once)` as a server transition-validation rule over
previous and next entity state messages. Creation transitions where
`previous === undefined` pass built-in set-once checks for supported field
shapes. Once a previous state exists, each supported `(set_once)` field value is
fixed; any unequal proposed next value violates the rule, including
default-to-non-default changes. Unsupported field-shape handling is recorded in
D-0039. The public first slice should expose a high-level entity-state
transition validation API and keep low-level rule construction private unless
later tasks show caller value. Violation results must be shaped through the core
transition-validation facade and must not leak previous or next field values.

Alternatives considered:

- Treat default previous values as unset and allow a later non-default value.
  Rejected because proto3 presence is not reliable for all scalar fields and
  storage snapshots represent committed state.
- Expose a public `createSetOnceTransitionRule()` immediately. Rejected because
  the runtime needs a high-level entity transition validator first, and exposing
  rule construction would broaden the API before caller needs are proven.
- Enforce set-once only inside repositories. Rejected because repository work
  comes later and should consume a tested validation primitive.

Consequences:

- `@spine-ts/server` may depend on `@spine-ts/core` for transition result
  shaping while keeping storage and dispatch out of scope.
- Future transaction/entity-base/repository tasks can call the same high-level
  validator before commit.
- Reviewers must verify that T-0009d.1 does not instantiate entities, invoke
  handlers, apply events, read/write storage, start buses, mutate global
  runtime state, or introduce gRPC/ZeroMQ behavior.

## D-0039: Keep server validation boundaries JVM-familiar

Status: Accepted

Date: 2026-06-29

Context: During T-0009d.1 fix round 5, the human observed that server-module
work may be over-inventing behavior compared with Spine JVM. The local
`spine-jvm-docs/` corpus is available in this repository and summarizes the
server/runtime behavior expected from Spine JVM `core-jvm`.

JVM docs inspected for this decision:

- `spine-jvm-docs/README.md`, Generated/Runtime Contract;
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  Validation runtime, Field options, and Entity state sections;
- `spine-jvm-docs/spine-domain-model-and-signals.md`, Validation Options That
  Affect Modeling;
- `spine-jvm-docs/spine-entities-repositories-and-state.md`, Transactions and
  State Builders.

Additional `core-jvm` server source inspected during T-0009d.1 fix round 10:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`,
  transaction buffering and commit/update flow;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`,
  active-transaction builder access;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`,
  state update validation;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/InvalidEntityStateException.java`,
  structured validation exception creation.

Decision: Server-module work must check task-relevant local Spine JVM notes and,
when available, the corresponding `core-jvm` `server` source before introducing
or expanding server/runtime behavior. For set-once validation, stay close to the
JVM-familiar contract: enforcement belongs at generated builder/factory or
state-update validation boundaries over normal Protobuf entity state, structured
violations are surfaced through the validation facade, and repeated/map/explicit
optional `(set_once)` fields are unsupported in the JVM generation contract. In
TypeScript, unsupported repeated, map-valued, and explicit optional set-once
fields therefore fail closed with field-specific validation violations instead
of adding speculative collection or presence comparison in this task.

This does not make arbitrary hostile JavaScript object graphs part of the
primary public contract. The T-0009d.1 hardening tests exist to preserve
field-specific, sanitized failures at the public API boundary when callers pass
forged or proxy-backed values; they should not grow into a broad adversarial
object comparison subsystem unless a later runtime threat model requires it.

Alternatives considered:

- Implement canonical repeated, map-valued, or explicit optional set-once
  comparison now. Rejected because JVM notes say repeated/map/explicit optional
  `(set_once)` is unsupported at build time, and collection/presence
  canonicalization policy has not been designed for this contract.
- Continue expanding defensive equality for every hostile JavaScript object
  shape. Rejected because the server runtime should be designed around
  framework-controlled Protobuf state updates, with unsupported/adversarial
  inputs documented and failed closed.

Consequences:

- Future `@spine-ts/server` tasks must record relevant JVM docs and
  corresponding `core-jvm` server source inspection in task logs before
  broadening server behavior.
- T-0009d.1 keeps the server validator narrow: catch proxy reflection failures
  and report repeated/map-valued/explicit optional set-once as unsupported,
  without adding new validation abstractions.
- A later task may revisit repeated, map, or explicit optional support only
  after checking the JVM compatibility impact and deciding the relevant
  collection or presence canonicalization policy.

## D-0047: Repository Identity Seam Remains Metadata-Only

Status: Accepted

Date: 2026-06-30

Context: `T-0009f.2 Repository Identity And Entity Ownership Seam` introduces
the repository identity and entity ownership seam for later bounded-context
builder registration. Spine JVM `Repository.java` exposes entity ownership
metadata such as ID class, entity class, and entity state type, but its
registration, storage opening, stand type-supplier registration, routing failure
reporting, and lifecycle behavior depend on a built `BoundedContext` and server
runtime. Spine JVM `AggregateRepository`, `ProjectionRepository`, and
`ProcessManagerRepository` add routing, inboxes, caches, catch-up, command and
event bus registration, import, and dispatch behavior. Those are beyond the
selected subtask. The human explicitly warned to inspect the corresponding
Spine JVM server code closely and avoid over-inventing.

Decision: Implement `T-0009f.2` as a metadata-only repository identity seam over
entity constructors/state schemas and existing descriptor-derived entity
metadata. Do not implement create/find/store, storage adapters, routing
execution, inboxes, cache, query stand, context open/close lifecycle, handler
invocation, or bus registration in this subtask. Reject mismatches between the
entity family marker and the state schema kind, because later builder conflict
checks must rely on deterministic ownership metadata.

Consequences:

- The public API stays close to the current JVM concept without pretending to
  provide runtime repository behavior.
- Later `T-0009f.3` can register and deduplicate repositories using immutable
  identity snapshots.
- Runtime behavior remains explicitly deferred to storage, routing, delivery,
  and built-context tasks.

## D-0048: T-0010 Starts With A Minimal Single-Process Async Runtime Seam

Status: Accepted

Date: 2026-06-30

Context: T-0010 follows the repository and bounded-context registration seam.
The technical specification requires asynchronous signal processing and a future
multi-process Node runtime over a transport abstraction, initially backed by
ZeroMQ local IPC. The current codebase does not yet have gRPC services,
transport adapters, durable delivery, read-side stand execution, full command or
event dispatch, or server supervision. Spine JVM `BoundedContext`, `Bus`,
`CommandBus`, and `EventBus` show a much larger runtime graph: contexts own
command/event/import buses, stand, tenant index, integration broker, system
client, and visibility guard; buses convert signals to envelopes, filter,
store/record accepted signals, acknowledge posting, and then dispatch. The
human also asked for server work to stay close to `core-jvm/server` and avoid
over-inventing.

Decision: T-0010 starts with the smallest useful single-process asynchronous
runtime seam and lifecycle boundary that later tasks can extend. The first
split must not implement gRPC services, ZeroMQ transport, durable delivery
monitors, inbox storage, query/subscription stand execution, integration
broker, system context, process supervision, or full repository dispatch unless
the requirements splitter isolates a narrow, reviewed subtask for one of those
pieces. Preserve the JVM distinction between command acknowledgement and later
dispatch/rejection outcomes, and between event acceptance/storage and later
delivery, even when the first TS implementation only models queueing and
lifecycle contracts.

Consequences:

- Requirements splitting for T-0010 must produce small subtasks and explicitly
  route deferred runtime pieces to later tasks.
- Reviewers must flag speculative lifecycle phases, transport details, global
  singleton environments, read-side query execution, or dispatch/storage
  behavior that is not justified by the selected subtask.
- The public API should prefer explicit, testable async lifecycle objects over
  hidden import-time registration or process-wide mutable state.

## D-0049: T-0010.2 Adds Only A Bounded Context Runtime Handle

Status: Accepted

Date: 2026-06-30

Context: `T-0010.2 Bounded Context Runtime Handle` follows the
single-process runtime lifecycle/queue kernel. The corresponding Spine JVM
`core-jvm/server` code is intentionally much larger: `BoundedContextBuilder`
creates system and domain contexts, initializes tenant index, command bus, and
stand, and registers repositories, command dispatchers, event dispatchers, and
delivery dispatchers. `BoundedContext` owns command/event/import buses,
integration broker, stand, tenant index, visibility guard, internal access, and
close hooks. `Server.Builder` wires built contexts into command/query/
subscription gRPC services. The human explicitly warned that server-module work
should have a close look at Spine JVM `core-jvm/server` and avoid
over-inventing.

Decision: T-0010.2 adds only a lightweight runtime-facing handle for an already
built TS `BoundedContext` snapshot and the existing `ServerRuntimeLifecycle`
boundary. It must not recreate JVM's full server graph, service hosting, buses,
stand, tenant index, system context, delivery registration, repository runtime
registration, storage, transport, or handler invocation. The existing
metadata-only `BoundedContext` build contract remains intact.

Consequences:

- Later command/event intake tasks can reference a context-scoped runtime
  boundary without depending on service, bus, or storage abstractions.
- Reviewers must reject extra runtime members that imply buses, dispatch,
  read-side query execution, storage, transport, or repository runtime
  registration in this subtask.
- Public docs must state that the handle is not a JVM `Server` equivalent and
  is not a running context graph.

## D-0050: T-0010.3 Models Intake Outcomes Without Ack Or Buses

Status: Accepted

Date: 2026-06-30

Context: `T-0010.3 Write-Side Signal Intake Result` follows the runtime queue
and bounded-context runtime handle. Spine JVM `Bus.post()` converts signals to
envelopes, filters them, stores accepted signals, acknowledges accepted signals
with `Ack`, and then dispatches. Filter failures are immediate post-time
outcomes represented as `Ack` statuses; normal posting results do not use
`StreamObserver.onError()`. `CommandBus` adds command ack monitoring and
`EventBus` stores events before dispatch. These behaviors are larger than the
current TS runtime.

Decision: T-0010.3 introduces only typed result values that distinguish
accepted-for-async-work from immediate intake failure. It must not implement
`Ack`, command/event/import buses, filters, storage, store-before-dispatch,
dispatch, delivery, services, tenant validation, transport, or handler
invocation. Failure diagnostics should use stable reason codes and sanitized
metadata, not full signal payloads.

Consequences:

- Later command/event intake tasks can map these result values to Spine `Ack`
  semantics after the required proto contracts and service layer are in scope.
- Reviewers must flag attempts to enqueue work, dispatch handlers, store events,
  perform validation, or expose transport/service concepts in this subtask.
- The public documentation must explain that accepted means accepted for later
  asynchronous runtime work, not dispatched, stored, or successfully handled.

## D-0051: T-0010.4 Reuses Handler Metadata For Command Readiness

Status: Accepted

Date: 2026-06-30

Context: `T-0010.4 Command Registration Readiness` follows the signal intake
result seam. Spine JVM `CommandDispatcherRegistry` is a unicast registry: each
registered `CommandDispatcher` exposes handled command classes, and
registration rejects any command class that already has a dispatcher.
`AbstractAssignee` derives its command classes from assignee model metadata,
`DuplicateHandlerCheck` rejects duplicate command-handling methods across model
classes, and `CommandService.Builder` later builds service routing from each
context's registered command classes. The current TS code already has
`HandlerMetadataRegistry`, which registers `EntityHandlersMetadata` values,
rejects duplicate command assignments for one command message type, and exposes
lookup for the unique command assignment. The human explicitly warned to inspect
Spine JVM `core-jvm/server` closely and avoid over-inventing server-module
work.

Decision: T-0010.4 adds only a metadata/readiness surface that reports
registered command message types and their unique assignee metadata from the
existing handler metadata registry. It must reuse
`HandlerMetadataRegistry` duplicate-assignment enforcement rather than creating
a parallel command bus registry or new duplicate policy. It must not implement
command posting, command service `Ack` mapping, routing, dispatch, handler
invocation, validation, storage, delivery, transport, or repository runtime
registration.

Consequences:

- Later command service/runtime tasks can ask a bounded context's handler
  metadata which command types are ready before implementing posting or bus
  behavior.
- Reviewers must flag command bus/service/dispatch behavior or any second
  duplicate-assignment policy in this subtask.
- Public docs must describe the surface as registration readiness, not runtime
  command handling.

## D-0052: T-0010.5 Models Event Readiness As Multicast Metadata

Status: Accepted

Date: 2026-06-30

Context: `T-0010.5 Event Registration Readiness` follows command registration
readiness. Spine JVM `EventDispatcherRegistry` permits multiple event
dispatchers per event class and filters dispatchers by domestic versus external
event classes. `EventDispatcher`, `EventDispatcherDelegate`,
`EventSubscriber`, and `EventReactor` separate event dispatch capability from
handler invocation and expose domestic/external event interests. The current TS
code already has `HandlerMetadataRegistry`, which preserves many
event-subscription and event-reaction handlers and only rejects duplicate event
applications for the same entity state and event type. The human explicitly
warned to inspect Spine JVM `core-jvm/server` closely and avoid over-inventing
server-module work.

Decision: T-0010.5 adds only a metadata/readiness surface that reports
registered event message types and fan-out handler metadata for event
subscriptions and event reactions, plus event-application metadata grouped by
event type. It must reuse `HandlerMetadataRegistry` for event-application
uniqueness and must not reject duplicate subscribers or reactors. Because the
current TS handler metadata does not yet model external event interests,
domestic/external filtering and integration-broker wanted-event publication are
documented as deferred rather than guessed.

Consequences:

- Later event-bus, integration-broker, and import-runtime tasks can consume the
  readiness index without depending on handler invocation or transport.
- Reviewers must flag event bus, integration broker, import bus, storage,
  dispatch, service, transport, handler invocation, validation, or `Ack`
  behavior in this subtask.
- Public docs must describe the surface as event registration readiness and
  explicitly state that domestic/external classification is not available until
  a later metadata task introduces it.

## D-0053: T-0010.6 Closes Runtime Slice With Docs And Smoke Test Only

Status: Accepted

Date: 2026-06-30

Context: `T-0010.6 Runtime Closure And User-Facing Docs` follows the runtime
lifecycle, bounded-context runtime handle, signal intake result, and
registration-readiness subtasks. The Spine JVM `Server` class is a gRPC service
container and lifecycle supervisor, while `BoundedContext` owns command,
event, import, read-side, integration, tenant, system, repository, and close
collaborators that the TypeScript slice has intentionally deferred. The human
explicitly warned to inspect the Spine JVM `core-jvm/server` module closely and
avoid over-inventing server-module work.

Decision: T-0010.6 closes the first runtime slice with documentation and a tiny
bounded-context runtime assembly smoke test over existing public APIs. It must
not add a TypeScript `Server` facade, gRPC/service routing, command/event/import
bus behavior, storage lifecycle, read-side stand/query/subscription execution,
transport lifecycle, repository runtime registration, handler invocation,
validation, delivery, integration broker behavior, or `Ack` mapping.

Consequences:

- Public docs may show how to compose the existing
  `SingleProcessServerRuntime`, `BoundedContextRuntime`, signal intake result,
  and registration-readiness metadata, but must describe the composition as a
  first local runtime seam rather than a complete server.
- Reviewers must flag new server/service/transport/storage/bus behavior in this
  subtask as over-scoped unless a later task explicitly authorizes it.
- To-do example docs remain non-runnable for runtime behavior until the example
  implementation tasks introduce domain command/event/projection execution.

## D-0054: T-0011 Starts With Adapter-Agnostic Transport Contracts And Defers Native ZeroMQ Installation

Status: Accepted

Date: 2026-06-30

Context: T-0011 introduces the first transport foundation after the
single-process runtime and registration-readiness slices. The spec requires
local multi-process execution over an abstract bus transport initially backed
by ZeroMQ local IPC, but D-0007 limits ZeroMQ to one-host IPC and D-0024
already deferred ZeroMQ installation until the transport-adapter task. The
current workspace uses Node `>=24.0.0`. Requirements-splitting research
checked official npm metadata and project docs before any dependency choice:
`npm view zeromq ...` returned maintained package metadata for
`zeromq@6.5.0` from `zeromq/zeromq.js`; `npm view zmq ...` returned legacy
`zmq@2.15.3` metadata tied to an older repository lineage; `npm view
zeromq-old ...` and `npm view @aminya/node-zmq ...` returned `E404`.

Decision: Split T-0011 so the first subtask defines only adapter-agnostic
transport contracts, topics, routing descriptors, and close semantics over the
existing signal-envelope model. Do not install any native ZeroMQ dependency in
that first slice. Reserve dependency installation, adapter-private ZeroMQ
configuration, and IPC smoke tests for a later dedicated adapter subtask. When
that subtask begins, prefer the maintained official `zeromq@6` package line
unless newer task-time research contradicts it.

Alternatives considered:

- Install ZeroMQ in the first subtask. Rejected because the first slice should
  stay small, reviewable, and free of native runtime concerns while the public
  transport surface is still being shaped.
- Target the older `zmq` package line. Rejected because the metadata and
  repository lineage indicate a legacy binding line rather than the maintained
  current package.
- Delay all transport work until the adapter exists. Rejected because the
  runtime architecture and package boundary need a public contract seam before
  adapter or broker lifecycle work can proceed safely.

Consequences:

- `T-0011.1` can stay focused on transport-owned API boundaries and topic
  abstractions without leaking socket details into public code.
- The adapter-installation subtask must own native dependency pinning,
  bootstrap notes, and smoke tests instead of inheriting an implicit package
  choice.
- Reviewers should reject any early transport slice that creates sockets,
  installs native dependencies, or grows into broker/process/delivery behavior
  before the roadmap reaches those explicit subtasks.

## D-0055: T-0012.7b Keeps Event Validation And In-Memory Sharing Inside Existing Storage And Bus Seams

Status: Accepted

Date: 2026-07-01

Context: Round-14 review for aggregate storage and signal routing found that
repository event-route validation could happen after `EventBus` persisted an
event, duplicate event-ID checks were not shared across multiple event-store
instances, and in-memory record storages opened from one factory did not share
backing records. The task remains constrained to aggregate storage and signal
routing; delivery, inboxes, Stand, gRPC, retries, and new server facades are
out of scope.

Decision: Add an optional `EventDispatcher.accept(event)` hook used by
repository dispatchers for pre-store route validation, keep `EventBus` append
ordering as `EventStore.accept()` then dispatcher `accept()` then
`EventStore.append()` then `dispatch()`, serialize `EventStore` uniqueness
checks per storage factory and captured storage context, reject missing, blank,
or duplicate event IDs, and make
`InMemoryStorageFactory` share backing records for storages opened with the
same `RecordSpec` instance, context name, tenant mode, and tenant ID. Repeated
storage-factory calls for the same logical slice must return independently
closeable storage handles. Do not introduce delivery queues, repository
execution, handler invocation, or a broader storage transaction abstraction in
this task.

Consequences:

- Repository event routing now fails before context event storage when producer
  and first-field IDs are unreadable or contradictory.
- In-memory storage remains process-local and non-durable, but multiple stores
  opened from one factory/spec/context now observe the same records without
  crossing bounded-context names, tenant modes, or tenant IDs.
- Later durable storage adapters still need their own atomic insert or
  transaction guarantees; this task only strengthens the current in-process
  implementation without claiming distributed uniqueness.

## D-0056: T-0012.10 Uses Connect v2 For Real Node gRPC-Compatible Service Wiring

Status: Accepted

Date: 2026-07-04

Context: T-0012.10 must expose `CommandService.Post`, `QueryService.Read`, and
`SubscriptionService.Subscribe/Activate/Cancel` against the exact Spine JVM
service proto contracts. The repository already uses Buf and
`@bufbuild/protoc-gen-es@2.12.1`; generated service descriptors are emitted by
that generator under `packages/proto/generated`. Package lookup on
2026-07-04 showed `@connectrpc/connect@2.1.2` and
`@connectrpc/connect-node@2.1.2` current, with peers compatible with
`@bufbuild/protobuf@2.12.1`. The older
`@connectrpc/protoc-gen-connect-es@1.7.0` targets Protobuf-ES 1.x and is not
compatible with this workspace's 2.x generation.

Decision: Use `@connectrpc/connect@2.1.2` and
`@connectrpc/connect-node@2.1.2` for this first service slice. Register service
implementations from the Protobuf-ES v2 service descriptors and test them
through real Connect/Node transports, including the gRPC protocol path. Keep the
public construction API limited to route registration for the three services;
do not introduce a broad Spine `Server` facade, client DSL, handwritten service
schema, or custom in-process protocol.

Alternatives considered:

- Use `@connectrpc/protoc-gen-connect-es`. Rejected because its latest package
  line is 1.7.0 and peers against Protobuf-ES 1.x generation.
- Use `@grpc/grpc-js` directly. Rejected for this slice because it would require
  more handwritten glue around Protobuf-ES descriptors while Connect v2 already
  supports gRPC, gRPC-Web, and Connect protocols on Node.
- Simulate RPC with direct method calls or only `createRouterTransport`.
  Rejected because the task requires real gRPC-compatible runtime wiring.

Consequences:

- Runtime transport types stay in the service adapter package boundary and do
  not leak into `CommandBus`, `Stand`, or bounded-context domain/runtime
  classes.
- Generated service descriptors remain reproducible via the existing Buf /
  Protobuf-ES workflow; no additional generator is needed.
- Later tasks can wrap this small route-registration API in a larger server
  lifecycle only when the roadmap explicitly calls for it.

## D-0057: End-User Handlers Use Domain Messages And Default-Route Validation

Status: Accepted

Date: 2026-07-07

Context: Human review found the to-do example using schema-bearing decorators,
returning framework `Event` envelopes from aggregate handlers, and extracting
the target entity ID inside handler code. This contradicted prior human
requirements for the public TypeScript handler model. Local JVM research notes
also record Spine's first-field command routing convention: default command
routing reads the first field in Protobuf declaration order and requires it to
match the target entity ID type unless a repository route overrides it.

Decision:

- Normal end-user emitting handlers return generated domain messages, not
  framework `Command` or `Event` envelopes.
- Generated domain message return provenance must resolve to generated
  Protobuf-ES imports, generated namespace/value imports, or aliases proven back
  to those generated imports.
- `@Assign`, `@Command`, and `@React` handlers require explicit return types.
  `@Assign` returns generated event messages, `@Command` returns generated
  command messages, and `@React` returns generated event messages or explicit
  `void` for no emission. Emitting handlers may use one generated message,
  `T[]`, `readonly T[]`, `Array<T>`, `ReadonlyArray<T>`, or tuple/readonly tuple
  return types.
- `@Subscribe` handlers require explicit `void` return types.
- End-user application code uses bare decorators. Schema-bearing decorators are
  forbidden in ordinary app code unless a task records a narrow temporary
  legacy/testing exception.
- End-user application code must not discover or materialize decorated handler
  metadata. Handler discovery/materialization belongs to the framework and
  generated registry tooling.
- Aggregates must not use `@Apply`; aggregate state changes happen in
  framework-owned transactions for non-event-sourced aggregates.
- End-user application code must not call entity transaction-control methods such
  as `startTransaction()` or `commitTransaction()`.
- End-user application code must not create framework-internal `Event` envelopes
  or internal `EventId` values. The framework wraps returned domain event
  messages and generates internal event IDs.
- Default command target-ID extraction and validation belongs to the default
  command route. Commands handled by the default route and missing an acceptable
  first-field target ID must be rejected before handler invocation.
- Custom command routes belong to the corresponding entity repository and must
  be explicit. A custom route replaces the default first-field route, so the
  framework must not enforce the first-field requirement for commands handled
  by that custom route unless the route explicitly does so.
- Future task briefs and reviewer prompts must carry a human-imposed
  requirements ledger and an end-user API audit gate.

Consequences:

- The to-do example cannot be accepted while handlers return framework
  envelopes, use schema decorators, or call helper code such as
  `requireTaskId(command.id)` for default routing.
- Generated registry tooling must infer schemas from explicit handler parameter
  and return types, or a task must provide an explicit fallback that does not
  leak schema arguments into ordinary app handlers.
- Automated checks should be added where practical to reject envelope returns,
  `packEvent()`/`packCommand()` in ordinary handlers, schema-bearing
  decorators, aggregate `@Apply` handlers, transaction-control calls, direct
  internal event ID construction, missing `void` subscriber returns, and
  default-route ID extraction in examples, plus handler materialization helpers
  in end-user app code.

## D-0058: T-0014 Uses Explicit Metadata Until Generated Handler Registries Exist

Status: Accepted

Date: 2026-07-07

Context: The public handler syntax must be bare decorators such as `@Assign`,
`@React`, `@Subscribe`, and `@Command`, without schema arguments in ordinary
application code. At the same time, the first T-0014 implementation does not yet
include the build-time generated registry that will infer command/event schemas
from explicit handler parameter and return types. Human review also explicitly
forbids example/application code from defining or calling
`materializeDecoratedEntityHandlers`; handler discovery/materialization is a
framework responsibility only.

Decision:

- Keep the public decorators capable of recording bare standard-decorator
  declarations.
- Keep the migrated to-do example on explicit framework-owned
  `defineEntityHandlers()` metadata for now, so no schema-bearing decorators or
  application-owned materialization appear in end-user code.
- Make legacy `materializeDecoratedEntityHandlers()` reject bare decorated
  handlers with a clear error. It may still materialize schema-bearing legacy
  decorators for framework tests and temporary compatibility paths.
- Let repository execution own the new non-event-sourced aggregate path:
  aggregate assignees mutate draft state inside framework-owned transactions,
  return generated domain event messages, and the framework wraps those messages
  into internal `Event` envelopes with internal IDs before storage/dispatch.
- Let projection subscriber execution own transactions for subscribers that only
  mutate draft state, while preserving the legacy self-managed transaction path
  for existing tests until that compatibility surface is intentionally removed.

Alternatives considered:

- Generate registry metadata in this same slice. Rejected because it is a
  build-time discovery/codegen task and would make T-0014 larger than needed to
  remove the current end-user API violations.
- Keep schema-bearing decorators in the example temporarily. Rejected because the
  human requirement forbids explicit schema decorators in ordinary application
  code.
- Keep local example materialization as a bridge. Rejected because handler
  discovery/materialization is framework-owned and must not be copied into
  end-user apps.

Consequences:

- The next registry/codegen task must replace explicit to-do example metadata
  with generated framework metadata without changing the public bare decorator
  syntax.
- The cleanup guard now rejects app-owned materializers, framework envelope
  returns, aggregate appliers, transaction control, direct internal event IDs,
  and default-route ID validation helpers in example/end-user source.
- The current runtime supports the de-event-sourced aggregate direction while
  preserving enough legacy handler metadata behavior for existing framework
  tests to keep passing.

## D-0060: Bounded Context Builder Owns Default Generated Repository Assembly

Status: Accepted

Date: 2026-07-08

Context: T-0016b removes ordinary application ownership of generated handler
registry discovery and repository construction. Spine JVM assembly supports
`BoundedContext.singleTenant(name).add(EntityClass)` and
`BoundedContextBuilder.add(repository)`, while `DefaultRepository.of(Class)`
selects a family-appropriate default repository from the entity class. In Spine
TS, the generated handler registry is the available framework-owned metadata
source for bare-decorator handler schemas and emitted message schemas.

Decision:

- Add a framework-owned entity-class assembly path to `BoundedContextBuilder`.
- Keep `add(repository)` for custom repositories and tests, but ordinary
  application code should use `add(EntityClass)` when generated metadata exists.
- Keep existing synchronous `build()` behavior for explicit repository and
  dispatcher assembly.
- Add an async build path for entity-class generated assembly, letting the
  builder load the conventional compiled generated handler registry module and
  construct `Repository` instances internally with the matching entity metadata.
- Avoid a new default-repository factory hierarchy until separate repository
  families need genuinely different public construction behavior.
- Preserve the generated registry contract exactly as generated and ingested:
  declaration order, handler kind, `parameterCount`, `emittedSchemas`, and
  generated-message schema metadata.

Alternatives considered:

- Keep example-owned `GeneratedRegistryDiscovery` plus `new Repository(...)`.
  Rejected because handler discovery/materialization is framework-owned and
  application code must not import registry internals.
- Add a public `DefaultRepository` facade now. Rejected because the current
  `Repository` implementation already owns the needed runtime behavior, and a
  facade would add another name without reducing caller complexity beyond
  `BoundedContextBuilder.add(EntityClass)`.
- Require applications to pass schema arguments to `add()`. Rejected because it
  reintroduces schema-bearing app assembly and duplicates information already
  present in generated metadata.

Consequences:

- Existing synchronous `build()` call sites continue to work when they only add
  explicit repositories and dispatchers.
- Callers using entity-class generated assembly must use the async build path.
- The to-do example can assemble its context with only domain entity classes.
- Cleanup checks can treat app imports of handler metadata registries and
  generated registry discovery as regressions.

## D-0065: Add A Small Explicit Server Lifecycle Owner

Status: Accepted

Date: 2026-07-08

Context: T-0016g needs real gRPC-compatible server lifecycle ownership for the
framework and the to-do example. Spine JVM has `Server`, `ServerEnvironment`,
and `BoundedContext.close()` behavior, but the human review warned against
over-inventing server-module concepts. Current TS code duplicates HTTP/2
listener/session lifecycle helpers in the example and service tests.

Decision:

- Introduce a small explicit public `Server` API around existing
  `SpineServices` and Node HTTP/2 listener ownership.
- Default to local-only listener binding (`127.0.0.1`); broader binding is
  caller opt-in.
- Make shutdown deterministic: stop network intake first, close active HTTP/2
  sessions, then close owned contexts/resources.
- Keep resource ownership explicit. The server closes contexts it owns for the
  assembled application, but it must not silently close external storage,
  delivery, transport, or environment factories that it did not create.
- Do not introduce a JVM-style singleton `ServerEnvironment`, process
  supervisor, worker manager, durable scheduler, or ZeroMQ-specific API in this
  task.
- Reuse `SpineServices` directly for Command, Query, and Subscription routes
  rather than adding another facade.

Alternatives considered:

- Add a broad `ServerEnvironment` singleton now. Rejected because the current
  framework only needs listener/resource ownership, and a singleton would add
  policy before the storage/transport/delivery ownership model is mature.
- Keep HTTP/2 lifecycle code in the example/tests. Rejected because lifecycle
  ordering, local binding defaults, and close behavior are framework concerns
  and should be verified once.
- Hide all gRPC hosting behind `SpineServices`. Rejected because
  `SpineServices` is a route registrar, while listener/session ownership is a
  separate lifecycle concern.

Consequences:

- The to-do example should start with the framework server API and keep only
  domain assembly code locally.
- Service tests can use the public server lifecycle helper instead of copying
  HTTP/2 close/session plumbing.
- Later tasks may add an explicit environment object for storage/transport
  factory ownership, but this server API should remain usable without a
  process-wide singleton.

## D-0066: Adopt Runtime Metadata In Public Example Paths Before Registry Polish

Status: Accepted

Date: 2026-07-09

Context: T-0018a introduced `SignalMetadata` as the framework-owned runtime
metadata seam for generated command/event IDs, timestamps, actor/tenant command
context, event origin, producer IDs, and versions. That task deliberately left
public example and testing adoption as follow-up work. The current to-do
example docs and tests still assemble ordinary command IDs and
actor/tenant command contexts by hand, which makes the public surface look more
framework-internal than intended.

Decision:

- Run T-0018b as the next implementation slice.
- Use the existing `SignalMetadata` API in to-do example docs, to-do tests, and
  testing documentation for routine command metadata construction.
- Add a small helper only if direct `SignalMetadata` use remains repetitive and
  the helper clearly improves the caller.
- Keep `packCommand()` and `packEvent()` available as low-level helpers.
- Do not broaden this task into generated-registry hardening, client DSLs,
  transport changes, auth, handler discovery, or runtime redesign.

Alternatives considered:

- Move directly to descriptor-based generated-registry classification. Rejected
  for this slice because the public drift left by T-0018a is smaller, ready,
  and should be closed before deeper registry polish.
- Add a broad app-client command-posting DSL now. Rejected because it would
  hide too much policy behind a new abstraction and is not required to make the
  current callers clearer.
- Leave docs/tests hand-rolling metadata because envelope packing is still a
  low-level API. Rejected because routine command context metadata is now owned
  by `SignalMetadata`, and public examples should teach that seam.

Consequences:

- Public example code should stop showing manual
  `CommandIdSchema` / `CommandContextSchema` / `ActorContextSchema` assembly
  for ordinary command posts.
- Low-level envelope APIs remain available for framework internals and advanced
  tests.
- The next registry-discovery task remains separately planned and unblocked.

## D-0067: Fix No-Emission React Analyzer Drift Before Role Discovery

Status: Accepted

Date: 2026-07-09

Context: The generated-registry contract says `@React` handlers may either
return generated event messages or explicitly return `void` when they react
without emitting follow-up events. The build-time analyzer currently rejects
explicit `void` `@React` handlers as missing emitted schemas. This is a direct
contract drift and should be corrected before broader descriptor-based signal
role discovery.

Decision:

- Run T-0018c as the next implementation slice.
- Accept explicit `void` return types for `@React` and produce an
  `event-reaction` metadata record with `emittedSchemas: []`.
- Keep `@Assign` and `@Command` strict: they must emit at least one generated
  message schema and must reject `void`.
- Keep `@Subscribe` strict: it must explicitly return `void` and never emits.
- Do not broaden this slice into runtime invocation changes, registry writer
  shape changes, app examples, or descriptor role classification.

Alternatives considered:

- Move directly to descriptor-based command/event role classification. Rejected
  for this slice because the `@React` `void` contradiction is smaller, more
  direct, and independently testable.
- Make all handler kinds tolerate empty emitted schemas. Rejected because
  aggregate assignment and command-producing handlers require emitted domain
  messages by contract.
- Require no-emission reactions to use `@Subscribe` instead. Rejected because
  reactions and subscriptions have different routing/semantic roles.

Consequences:

- Build-time generated registries can represent no-emission event reactions
  without forcing artificial event returns.
- The later descriptor-role-discovery task can start from a handler contract
  that already matches the documented API.

## D-0068: Discover Generated Signal Roles From Descriptors

Status: Accepted

Date: 2026-07-09

Context: The generated-registry analyzer currently infers command/event roles
from generated module filenames such as `commands_pb` and `events_pb`. This is
convenient but not a stable semantic contract. Protobuf-ES generated modules
carry descriptor-backed metadata tying schema exports to source `.proto` files,
and the framework should use that metadata for command/event role decisions.

Decision:

- Run T-0018d as the next implementation slice.
- Infer generated command/event roles from descriptor-backed `.proto` identity
  for the imported schema export.
- Keep neutral generated modules usable for entity state schemas but fail
  closed when neutral schemas are used as handler signal or emitted command/event
  roles.
- Do not change generated registry output shape, runtime ingestion, runtime
  invocation, or public handler APIs in this slice.

Alternatives considered:

- Keep filename-based role inference. Rejected because module names can be
  misleading or neutral and should not define domain semantics.
- Add explicit role annotations to handlers or generated registries. Rejected
  because role information already exists in the generated Protobuf descriptor
  surface and explicit schema/role annotations would reintroduce error-prone app
  code.
- Broaden this task into descriptor-based entity metadata or registry output
  redesign. Rejected because the documented gap is analyzer role discovery and
  should stay local.

Consequences:

- Generated app modules can use neutral filenames without losing command/event
  role discovery when descriptors identify the source proto role.
- Misleading generated filenames no longer grant command/event roles by
  accident.
- Truly neutral generated message schemas continue to fail closed in handler
  signal/emitted positions.

## D-0069: Consume Semantic Tags In Runtime Routing Topics

Status: Accepted

Date: 2026-07-09

Context: T-0018e closed stale docs around runtime metadata and generated
registry readiness, leaving one concrete functional gap: semantic tags from
Spine `(is)` and `(every_is)` options are extracted into server entity metadata
and transport topics can carry tags, but runtime routing still creates command
and event topics from signal kind plus type URL only.

Decision:

- Run T-0019 as the next implementation slice.
- Keep the change local to runtime route planning and matching documentation.
- Use existing descriptor-derived entity metadata as the source of tags.
- For command routes, copy the command assignee entity tags into the command
  transport topic.
- For event routes, copy a deterministic deduplicated union of all registered
  receiver entity tags into the shared event transport topic.
- Do not add a new semantic-tag registry, handler materialization path, custom
  application API, delivery behavior, or transport adapter policy in this slice.

Alternatives considered:

- Keep tags preserved only in metadata and transport topics. Rejected because
  the recorded gap is that runtime routing does not consume them.
- Use only the first event receiver's tags. Rejected because event topics are
  shared fan-out topics; a deterministic union preserves all registered
  receiver metadata without new selection policy.
- Introduce a separate semantic-tag registry. Rejected as overengineered for
  the current implemented surfaces.

Consequences:

- Transport routing keys for registered command/event topics will include
  descriptor-derived semantic tags when receiver entity metadata has them.
- Event-topic tag order must remain deterministic and copy-safe.
- Later runtime slices can match by concrete event type URL and semantic tags
  without inventing another metadata source.

## D-0070: Build Server-Added Context Builders With Environment Storage Defaults

Status: Accepted

Date: 2026-07-09

Context: `T-0017k` introduced a small explicit `ServerEnvironment` for storage,
transport, delivery, tracing, and ownership, but intentionally deferred wiring
that environment into bounded-context builder assembly. Current docs say built
contexts keep whatever storage factory they were built with. Spine JVM server
assembly accepts `BoundedContextBuilder` instances and builds contexts lazily as
part of server assembly; JVM repositories obtain default storage through
`ServerEnvironment`.

Decision:

- Run `T-0020` as the next implementation slice.
- Let `Server` accept `BoundedContextBuilder` values in addition to built
  `BoundedContext` values.
- Build server-added builders during `Server.start()` before opening the
  listener.
- Use `ServerEnvironment.storageFactory` as the default storage factory for
  builders that did not explicitly choose one.
- Preserve `BoundedContextBuilder.withStorageFactory(...)` as the stronger
  local choice when it is present.
- Keep the TypeScript environment explicit and instance-based; do not introduce
  a Java-style process-wide singleton or broad assembly facade.

Alternatives considered:

- Keep requiring callers to build contexts before adding them to `Server`.
  Rejected because it leaves the recorded environment assembly gap open and
  differs from Spine JVM server-builder assembly.
- Add a global `ServerEnvironment.instance()` default. Rejected because prior
  TS design deliberately chose explicit environment instances for Node
  embedding and tests.
- Add a separate assembly manager/facade. Rejected as overengineered for a
  one-step storage-default integration.

Consequences:

- Existing `Server.add(builtContext)` callers continue to work.
- Applications can assemble contexts through `Server` so local/test and
  production storage defaults come from the selected environment.
- Failed builder assembly must reject before listener open and clean up any
  contexts already built for that start attempt.

## D-0071: Reconcile Durable Task Status Before Further Implementation

Status: Accepted

Date: 2026-07-09

Context: After T-0020 integration and verification, the root worktree was clean
except for the user-owned `human-review-1-jul.md`. Requirements splitting found
that T-0016d, T-0016e, and T-0016f task headers still said `in progress`, even
though their work logs recorded merge commits and post-merge full verification.
The build protocol depends on durable records surviving interruption and thread
compaction, so stale status headers can mislead the next autonomous session.

Decision:

- Run T-0021 as a docs/log-only reconciliation slice before the next
  implementation task.
- Correct only stale status headers whose existing work logs and merge records
  already prove integration.
- Record that T-0020 is ready, but the whole framework/example is not
  release-complete.
- Keep `human-review-1-jul.md` untouched.
- Record the required independent review lanes even for this
  documentation-only task.

Alternatives considered:

- Ignore stale headers and proceed directly to implementation. Rejected because
  interruption-resistant durable logs are a build protocol requirement.
- Broaden the task into a full historical log cleanup. Rejected because the
  immediate recovery risk is limited to current misleading T-0016d/e/f headers.

Consequences:

- Future sessions can distinguish completed T-0016 slices from remaining real
  runtime gaps.
- The next implementation slice can start from a trustworthy roadmap instead
  of re-investigating already integrated work.

## D-0072: Start Event Inbox Handoff With Projection Subscribers

Status: Accepted

Date: 2026-07-09

Context: T-0017g moved process-manager command assignees behind durable inbox
handoff, but repository event paths still execute directly after event-bus
routing. Current Spine JVM `ProjectionRepository.dispatchTo()` sends each routed
live event target through `inbox.send(event).toSubscriber(id)`, which writes an
`UPDATE_SUBSCRIBER` inbox row. `ProcessManagerRepository.dispatchTo()` uses
`REACT_UPON_EVENT`, and catch-up uses its own label and status. The next event
delivery slice should mirror one JVM endpoint path instead of inventing a
generic event delivery engine.

Decision:

- Run T-0022a as the next implementation slice.
- Move only live projection subscriber delivery behind durable local inbox
  handoff.
- Use `UPDATE_SUBSCRIBER`, `TO_DELIVER`, the original event ID, the projection
  state type URL, and the routed projection ID.
- Drain locally and replay only the exact inbox row target.
- Keep process-manager event reactors as direct local `EventBus` execution for
  this slice. Defer durable inbox routing for those reactors, aggregate event
  reactors/importers, projection catch-up, schedulers, retries, transport
  workers, and retained attempt history.

Alternatives considered:

- Build one generic repository event delivery engine. Rejected as too broad and
  more abstract than the JVM endpoint model needed for the next slice.
- Start with process-manager event reactors. Rejected because projection
  `UPDATE_SUBSCRIBER` is the narrower read-side path and has no command
  emission follow-up in this slice.
- Keep direct projection dispatch. Rejected because durable event delivery is a
  recorded runtime gap.

Consequences:

- Projection live updates gain the same durable local handoff shape as the
  first process-manager command handoff.
- Process-manager event reactors remain implemented through direct local
  `EventBus` execution until a later task routes them through durable inbox
  storage. Superseded by D-0073/T-0022b on 2026-07-10.
- Remaining event endpoint kinds stay explicit future tasks instead of hidden
  in a large abstraction.
- T-0024 later clarified that the aggregate import/importer portion of the
  aggregate event reactors/importers deferral is superseded by D-0075/T-0024
  after upstream ADR 0001 D1 dropped event import. Supported reactor delivery,
  projection catch-up, schedulers, retries, transport workers, and retained
  attempt history remain real deferred work.

## D-0073: Continue Event Inbox Handoff With Process-Manager Reactors

Status: Accepted

Date: 2026-07-10

Context: T-0022a integrated live projection subscriber inbox handoff using
`UPDATE_SUBSCRIBER`. The next smallest remaining event endpoint is the
process-manager event reactor path. Current Spine JVM
`ProcessManagerRepository.dispatchTo(ids, event)` sends each routed process
manager ID through `inbox().send(event).toReactor(id)`, which stores
`REACT_UPON_EVENT` event inbox rows. The TS runtime already executes
process-manager event reactors directly and already has local inbox handoff
machinery for process-manager commands and projection subscribers.

Decision:

- Run T-0022b as the next implementation slice.
- Move only live process-manager event reactors and event-commanding handlers
  behind durable local inbox handoff.
- Use `REACT_UPON_EVENT`, `TO_DELIVER`, the original event ID, the
  process-manager state type URL, and the routed process-manager ID.
- Drain locally and replay only the exact inbox row target.
- Preserve current process-manager state mutation/storage, produced event,
  produced command, tenant, and failure behavior.
- Keep projection catch-up, schedulers, retries, transport workers, and
  retained attempt history deferred. The then-open aggregate import/importer
  wording is superseded by D-0075/T-0024 after upstream ADR 0001 D1 dropped
  event import.

Alternatives considered:

- Build one generic repository event delivery engine. Rejected again as broader
  than the next JVM endpoint shape and contrary to the human reset against
  overengineering.
- Jump to aggregate import/importer work. Rejected at the time because
  process-manager event reactors reused the existing process-manager handoff
  and execution machinery. D-0075/T-0024 later removed aggregate import/importer
  work from the active roadmap.
- Leave process-manager event reactors as direct `EventBus` execution. Rejected
  because D-0072 explicitly left their durable inbox routing as a future task.

Consequences:

- Process-manager event reactions gain the same durable local handoff shape as
  process-manager commands and live projection subscribers.
- Remaining event endpoint kinds stay explicit later tasks instead of being
  hidden behind a generalized delivery abstraction. The aggregate
  import/importer part of this deferral is superseded by D-0075/T-0024 after
  upstream ADR 0001 D1 dropped event import.

## D-0074: Reconcile T-0022b Durable Status Before Next Slice

Status: Accepted

Date: 2026-07-10

Context: T-0022b was merged to `main` at `2fd6aace`, and post-merge
`pnpm --config.verify-deps-before-run=false verify` passed. Its work log already
recorded the integration, but the task brief and review log still said review
or integration was pending.

Decision:

- Run T-0023 as a docs/status-only reconciliation before the next implementation
  slice.
- Update only durable build-protocol records whose existing T-0022b evidence
  already proves integration and post-merge verification.
- Keep runtime, source, test code, and `human-review-1-jul.md` untouched.

Alternatives considered:

- Proceed directly to the next implementation slice. Rejected because stale
  durable status can mislead autonomous resumption.
- Broaden this into a historical log cleanup. Rejected because the immediate
  inconsistency is limited to the T-0022b task and review status.

Consequences:

- Future sessions can resume from truthful T-0022b durable status.
- The next implementation slice can start without re-reviewing already merged
  process-manager event inbox handoff work.

## D-0075: Remove Aggregate Import Work From Active Roadmap

Status: Accepted

Date: 2026-07-10

Context: Upstream Spine JVM ADR 0001 is accepted and D1 was revised on
2026-07-05 to drop event import. It removes `@Import`, `ImportBus`, import
endpoints/routing, and related test API, while retaining
`InboxLabel.IMPORT_EVENT` only as deprecated wire compatibility surface. D2
makes aggregate and aggregate-part `@Apply` a model-building error retained
only for detection. Local JVM notes still document the old path as
`ImportBus` routing to aggregate `@Apply(allowImport = true)` appliers and an
aggregate `IMPORT_EVENT` inbox endpoint, confirming the import path is tied to
the event-sourced aggregate applier model.

Decision:

- Run T-0024 as a docs/spec/log reconciliation before any new delivery slice.
- Remove aggregate event import/importer work from the active TS roadmap.
- Treat aggregate `@React` handlers as ordinary generated reactor handlers
  using current transaction semantics, not event-sourcing import/applier work.
- Keep `IMPORT_EVENT` label compatibility cleanup as a later delivery-label
  contract task. Do not remove `IMPORT_EVENT` or `CATCH_UP` runtime/proto
  surfaces in T-0024.
- Keep projection catch-up, transport-backed/background workers, retry
  monitors, retained attempt history, and production policy as real remaining
  gaps where already documented.

Alternatives considered:

- Treat aggregate importers as future runtime work. Rejected because upstream
  ADR 0001 D1 removes event import and the old JVM import path depends on
  aggregate `@Apply` appliers.
- Remove `IMPORT_EVENT` compatibility surfaces now. Rejected because the
  upstream ADR retains the label for wire compatibility, and TS compatibility
  behavior needs its own delivery-label contract task.
- Rewrite historical logs broadly. Rejected because old wording may remain
  when clearly historical; active roadmap/spec guidance is the risk.

Consequences:

- Active TS docs must not steer implementers toward `ImportBus`, aggregate
  importers, or event-sourced aggregate applier delivery.
- Later delivery-label work must decide the exact TS compatibility behavior for
  `IMPORT_EVENT` without reopening aggregate import/importer implementation.
- Normal delivery/runtime gaps remain explicit instead of being hidden by the
  import cleanup.

## D-0077: Keep Transport-Backed Delivery Workers Narrow

Status: Accepted

Date: 2026-07-10

Task: `T-0026`

Context: T-0022a and T-0022b completed durable inbox handoff for live
projection subscribers and process-manager event paths. T-0024 removed
aggregate import/importers from the active roadmap, and T-0025 made
`IMPORT_EVENT` unsupported for new inbox writes. The next implementation gap is
worker execution for existing durable rows, but the human has repeatedly warned
against over-engineering and asked that server-module work closely follow
Spine JVM concepts instead of inventing large TypeScript-only abstractions.

Decision:

- Implement T-0026 as the smallest framework-owned delivery worker boundary
  over existing `Delivery`, `DeliveryLoop`, `Inbox`, and `ShardedWorkRegistry`
  behavior.
- Reuse existing framework-owned replay endpoints for supported labels instead
  of introducing a generic repository delivery engine or production supervisor.
- Keep ZeroMQ endpoint topology, broker supervision, retry monitors, retained
  attempt history, conveyor/station hierarchy, and production retry policy out
  of this slice.
- Keep `CATCH_UP` out of worker execution unless the existing code already has
  a supported endpoint; do not invent projection catch-up semantics here.
- Keep end-user code free of framework envelopes, manual transactions,
  `@Apply`, schema-bearing decorators, and materialization helpers.

Alternatives considered:

- Build a full production delivery subsystem now. Rejected because it would
  combine several documented gaps and risk repeating the earlier
  over-engineering problem.
- Add a new public delivery API for application code. Rejected because delivery
  workers are framework runtime infrastructure, not an end-user handler concern.
- Implement catch-up semantics together with worker execution. Rejected unless
  already supported by existing endpoints, because read-side catch-up has its
  own roadmap semantics and should not be smuggled into this slice.

Consequences:

- T-0026 can make durable rows executable by a background/local worker without
  claiming full production supervision.
- Later tasks still own retry monitoring, retained attempt history, worker
  topology, and production policy.
- Reviewers must reject shallow abstractions or broad worker concepts that
  exceed this narrow scope.

## D-0076: Reject New IMPORT_EVENT Delivery Writes

Status: Accepted

Date: 2026-07-10

Context: D-0075 removed aggregate import/importer work from the active roadmap
but intentionally left `IMPORT_EVENT` runtime/proto compatibility untouched.
The current delivery package still exposes `IMPORT_EVENT` through the public
`DeliveryLabel` type and accepts it for new inbox writes, which can mislead
callers into believing event import remains supported runtime work.

Decision:

- Run T-0025 as the delivery-label contract cleanup slice.
- Define the public valid delivery labels for durable rows as
  `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, `REACT_UPON_EVENT`, and `CATCH_UP`.
- Reject new `IMPORT_EVENT` writes through public inbox write paths before
  durable rows are stored.
- Keep a narrow legacy stored-row recognition path for deprecated
  `IMPORT_EVENT` compatibility data, but fail closed instead of delivering it.
- Leave `CATCH_UP` and `TO_CATCH_UP` unchanged; projection/read-side catch-up
  is separate from ADR 0001 event import removal and from replay callback
  support.

Alternatives considered:

- Remove every `IMPORT_EVENT` mention now. Rejected because upstream ADR 0001
  keeps the label for wire compatibility, and existing stored data should not
  be misclassified as an unknown corrupt label.
- Keep `IMPORT_EVENT` in the public `DeliveryLabel` type. Rejected because it
  advertises a removed feature as supported input.
- Narrow `CATCH_UP` in the same slice. Rejected because catch-up is not event
  import and needs its own delivery/runtime decision if changed.

Consequences:

- Ordinary TypeScript callers cannot write `IMPORT_EVENT` without an explicit
  unsafe cast.
- Deprecated import rows remain recognizable compatibility data.
- T-0025 must update tests and docs/API wording without implementing import.

## D-0078: Reconcile Post-T-0026 Runtime Status Before Next Implementation

Status: Accepted

Date: 2026-07-11

Task: `T-0027`

Context: T-0026 landed the first narrow framework-owned delivery worker and
loop boundary for supported durable inbox labels, and post-merge verification
passed on `main` at `efbf379a`. Active docs still include broad remaining-gap
phrases around transport-backed worker execution, production worker
supervision, retry policy, and catch-up. Starting a new runtime feature from
stale public status would risk either under-crediting T-0026 or smuggling
production supervision/retry/catch-up behavior into the next slice.

Decision:

- Run T-0027 as a docs/status-only reconciliation before the next runtime
  implementation task.
- Update active roadmap, architecture, user, and package docs to distinguish
  the worker boundary that now exists from production gaps that remain.
- Preserve the T-0026 contract: supported worker replay labels are
  `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`; valid
  `CATCH_UP` rows remain pending and skipped; new `IMPORT_EVENT` writes remain
  unsupported and legacy stored rows fail closed.
- Keep runtime/source/test code, generated output, and `human-review-1-jul.md`
  untouched.
- Record storage-index/keyset continuation as a likely next implementation
  candidate after reconciliation, not as part of T-0027.

Alternatives considered:

- Proceed directly to retry monitoring, retained attempts, worker topology, or
  storage-index implementation. Rejected because active docs should first be
  truthful about the newly merged T-0026 boundary and the remaining production
  gaps.
- Broaden T-0027 into runtime cleanup. Rejected because the immediate risk is
  documentation/status drift, and behavior changes need their own task brief,
  JVM inspection, tests, and review loop.

Consequences:

- Future implementers can choose the next production-parity slice from accurate
  docs rather than stale "worker execution missing" language.
- Public docs keep the delivery worker boundary honest: local/framework-owned
  replay exists, while production topology, supervision, retry policy, retained
  attempt history, durable catch-up storage, and storage-index continuation
  remain explicit future work.

## D-0079: Add Storage Continuation Before Delivery Retry Policy

Status: Accepted

Date: 2026-07-11

Task: `T-0028`

Context: T-0026 made durable inbox rows executable through a narrow local
framework-owned delivery worker/loop. That implementation still used
`RecordQuery.offset` for pending-row scans, with boundary validation and
bounded rescans to avoid skipping work when earlier pending rows disappeared.
T-0027 reconciled active docs and recorded storage-index/keyset continuation as
the likely next implementation candidate. Spine JVM delivery reads inbox
storage page-by-page in chronological order, and its storage design keeps
`RecordStorage` as the single adapter seam for higher-level storage delegates.

Decision:

- Run T-0028 as a narrow storage continuation slice before retry monitors,
  retained attempts, production worker supervision, or transport topology.
- Add the smallest `RecordQuery`/`RecordStorage` continuation contract needed
  to page after a stable ordered row key.
- Preserve existing offset query support for current storage callers.
- Implement the continuation contract in the in-memory storage adapter.
- Use the continuation only for durable inbox pending-row scans in
  `Delivery`/`DeliveryLoop`.
- Keep production database adapters, broad query optimization, retry policy,
  durable catch-up storage, import work, and aggregate `@Apply` delivery out of
  scope.

Alternatives considered:

- Build production storage indexes/adapters now. Rejected because the immediate
  runtime hazard is moving-offset delivery continuation, and production storage
  adapters need their own capability and deployment design.
- Keep offset paging plus boundary probes. Rejected because it is more complex
  in delivery code and remains sensitive to filtered pending-set movement.
- Add a delivery-specific cursor outside storage. Rejected because the paging
  semantics belong at the record-storage seam already used by inbox storage.
- Start retry monitors or retained attempt history first. Rejected because
  reliable retry policy should build on stable bounded scan continuation.

Consequences:

- Delivery scanning can move toward stable keyset-style continuation while
  preserving existing scan limits, shard leases, claims, and fail-closed
  storage validation.
- The storage adapter seam deepens slightly, but remains one method family
  rather than a production index abstraction.
- Public docs must keep production storage adapters and retry/supervision gaps
  explicit after this task.

## D-0080: Retain Delivery Attempts Before Retry Monitors

Status: Accepted

Date: 2026-07-11

Task: `T-0029`

Context: T-0028 replaced moving-offset delivery scans with stable storage
continuations. Durable delivery can now retry failed rows by leaving them
`TO_DELIVER`, but the only failure evidence is the ephemeral
`DeliveryRun.failures` object returned to the caller. Spine JVM delivery routes
failed endpoint reception through `DeliveryMonitor.onReceptionFailure`, which
receives a `FailedReception` and chooses an action such as marking delivered or
repeating dispatch. The TypeScript runtime is not ready for monitor policy,
timers, backoff, worker supervision, or production topology, but later retry
policy needs durable facts rather than in-memory run results.

Decision:

- Run T-0029 as a narrow delivery-attempt retention slice after storage
  continuations and before retry monitors/workers.
- Persist sanitized, framework-owned attempt records for supported durable
  endpoint failures.
- Store only bounded delivery facts needed by later retry policy: message,
  shard/inbox identity, label, node, attempt time, accepted flag, and a stable
  failure stage/reason.
- Do not store raw `Any.value` payload bytes, user error objects, stack traces,
  or unbounded exception text.
- Keep failed inbox rows `TO_DELIVER` exactly as today; do not add immediate
  retry, backoff, timers, monitor callbacks, or cancellation policy.
- Keep `CATCH_UP` skipped and pending unless a later catch-up task explicitly
  owns those semantics. Keep new `IMPORT_EVENT` writes unsupported and legacy
  stored rows fail-closed.

Alternatives considered:

- Start retry monitors/workers now. Rejected because policy would either depend
  on ephemeral run failures or smuggle in storage format and supervision
  decisions in the same slice.
- Add full JVM-style `DeliveryMonitor` and `FailedReception` APIs now. Rejected
  because public monitor policy, repeat callbacks, and mark-delivered actions
  are broader than the current TypeScript delivery boundary.
- Record raw errors and payloads for debugging. Rejected because retained
  attempt history must be safe for production storage, bounded, and free of
  payload/error leakage.
- Start production storage adapters or worker supervision first. Rejected
  because both need attempt/retry semantics to be explicit before deployment
  policy is useful.

Consequences:

- Later retry policy can be built over durable, bounded failure facts.
- Public docs can stop saying no retained attempt history exists, while still
  keeping retry monitors, production supervision, topology, catch-up storage,
  and production adapters explicit future work.
- Delivery remains at-least-once/replay-safe; retained attempts are observation
  state, not a new delivery outcome or retry guarantee.

## D-0081: Summarize Retained Attempts Before Retry Policy

Status: Accepted

Date: 2026-07-11

Task: `T-0030`

Context: T-0029 retained bounded, sanitized delivery-attempt facts for supported
endpoint failures. The next retry-policy step needs to consume those facts for
one exact inbox message without reintroducing broad retained-attempt scans on a
hot path. Spine JVM exposes retry choices through `DeliveryMonitor` and
`FailedReception`, but TypeScript still intentionally lacks public monitor
policy, repeat callbacks, timers, scheduler ownership, production supervision,
transport topology, and durable catch-up storage.

Decision:

- Run T-0030 as an internal delivery-attempt summary/read slice before public
  retry monitors or scheduler workers.
- Add a package-internal exact-message summary path over the bounded retained
  attempt slots created by T-0029.
- Return deterministic sanitized facts useful to later retry decisions:
  retained attempts in order, count, latest attempt, latest stage/reason, and
  latest accepted flag.
- Read only the known per-message retention slots, not all retained attempts.
- Preserve fail-closed `DeliveryStorageCorruptionError` behavior for corrupt
  retained-attempt state.
- Keep `Delivery.drain()`, `DeliveryLoop`, and `DeliveryWorker` retry behavior
  unchanged; failed rows stay `TO_DELIVER`.
- Do not export public `DeliveryMonitor`, `FailedReception`, retry/backoff,
  scheduler, topology, durable catch-up, or production adapter APIs.

Alternatives considered:

- Add full retry monitors/workers now. Rejected because policy and scheduling
  need their own public API and lifecycle decisions after the summary facts are
  available.
- Use existing broad `DeliveryAttempts.read()` for retry decisions. Rejected
  because retry policy should not depend on global retained-attempt scans when
  it needs facts for one message.
- Store raw errors or payloads in the summary. Rejected because T-0029 made
  retained attempts safe by excluding raw payload bytes, user error objects,
  stack traces, and unbounded exception text.

Consequences:

- Later retry policy can make bounded per-message decisions from durable facts.
- The delivery API remains internal and observation-only for this slice.
- Reviewers must reject public retry APIs, scheduler behavior, catch-up
  semantics changes, import revival, production topology, or broad storage
  adapter work in T-0030.

## D-0082: Add Internal Retry Decision Before Monitor Policy

Status: Accepted

Date: 2026-07-11

Task: `T-0031`

Context: T-0029 retained sanitized delivery-attempt facts, and T-0030 added an
internal exact-message summary over those bounded retained slots. Later retry
monitors or scheduler workers now need a deterministic way to classify one
message as still retryable or exhausted without exposing public monitor actions
or scanning all retained attempts. Spine JVM failure handling is broader:
`DeliveryMonitor.onReceptionFailure(FailedReception)` returns actions such as
`markDelivered()` or `repeatDispatching()`, and `TargetDelivery` executes those
actions after failed dispatch outcomes. TypeScript should not expose that
public policy/action API until lifecycle, scheduling, and public monitor
ownership are designed.

Decision:

- Run T-0031 as a package-internal delivery retry-decision slice.
- Consume one `DeliveryAttemptSummary` and a bounded max-attempt configuration.
- Classify summaries as retryable while retained count is below the configured
  limit and exhausted at or above the limit.
- Return immutable, sanitized decision facts: decision kind, count, limit,
  latest retained stage/reason, and latest accepted flag.
- Keep the primitive observational only; it must not mutate inbox rows, mark
  messages delivered, repeat dispatch, schedule timers, or change worker
  behavior.
- Keep public `DeliveryMonitor`, `FailedReception`, repeat-dispatch,
  mark-delivered, backoff/scheduler ownership, production supervision/topology,
  catch-up storage, and production adapters out of scope.

Alternatives considered:

- Add full JVM-style `DeliveryMonitor` and `FailedReception` APIs now. Rejected
  because public action execution needs scheduler/lifecycle ownership and is
  larger than a bounded decision primitive.
- Integrate retry decisions into `DeliveryLoop` immediately. Rejected because
  T-0031 should not change failed-row `TO_DELIVER` behavior or introduce
  immediate retry/backoff semantics.
- Use broad retained-attempt reads for policy. Rejected because T-0030 created
  exact-message summaries specifically to avoid hot-path global scans.
- Run a docs-only reconciliation after T-0030. Rejected because public docs
  already describe the new retained summary boundary and remaining gaps.

Consequences:

- Later monitor or scheduler work can consume a small deterministic internal
  decision instead of re-deriving retry exhaustion from retained attempts.
- Retry policy remains internal and observation-only until a later task defines
  public monitor/action APIs and lifecycle ownership.
- Reviewers must reject attempts to add public retry APIs, timers, topology,
  catch-up semantics, production adapters, or delivery-loop behavior changes in
  T-0031.

## D-0083: Gate Exhausted Delivery Rows Internally Before Public Monitor Policy

Status: Accepted

Date: 2026-07-11

Task: `T-0032`

Context: T-0029 retained bounded, sanitized delivery-attempt facts; T-0030
added exact-message summaries; and T-0031 added an internal retry-decision
primitive that classifies one summary as retryable or exhausted. The next
smallest retry-policy step is to consume that primitive at the internal
delivery boundary. Spine JVM failure handling is public and action-oriented:
`DeliveryMonitor.onReceptionFailure(FailedReception)` returns actions such as
`markDelivered()` or `repeatDispatching()`, and `TargetDelivery` executes the
selected action. TypeScript still intentionally lacks public monitor/action
ownership, scheduler/backoff policy, production supervision/topology,
dead-letter semantics, and catch-up execution.

Decision:

- Run T-0032 as a package-internal delivery retry-exhaustion gate.
- Before invoking a supported endpoint callback, summarize retained attempts
  for that exact inbox message and apply `DeliveryRetryDecisions`.
- Use the retained-attempt ring size, 100, as the initial internal maximum
  attempt budget because it is the only durable retained history currently
  available and no public retry configuration exists yet.
- Treat exhausted supported rows as internal policy skips: do not invoke the
  endpoint callback and do not record another retained attempt.
- Leave exhausted rows pending `TO_DELIVER` for later public monitor,
  dead-letter, or mark-delivered policy.
- Keep retryable supported rows on the current delivery path.
- Preserve `CATCH_UP` pending/skip behavior and legacy `IMPORT_EVENT`
  fail-closed behavior.
- Do not export public `DeliveryMonitor`, `FailedReception`, repeat-dispatch,
  mark-delivered, backoff/scheduler, topology, catch-up, or production adapter
  APIs.

Alternatives considered:

- Add full JVM-style `DeliveryMonitor` and `FailedReception` APIs now. Rejected
  because public action execution needs lifecycle ownership and policy decisions
  beyond the internal exhaustion boundary.
- Integrate scheduler/backoff workers now. Rejected because production retry
  scheduling should build on a working internal exhaustion gate first.
- Mark exhausted rows delivered or dead-letter them now. Rejected because those
  are public policy outcomes, while this slice only suppresses further endpoint
  attempts after the bounded retained history is exhausted.
- Execute `CATCH_UP` rows here. Rejected because catch-up has its own storage
  and lifecycle task; current valid `CATCH_UP` rows remain pending and skipped.

Consequences:

- The delivery path stops repeatedly invoking known-exhausted supported rows
  while preserving durable state for later policy.
- Retry policy remains internal and conservative; no public monitor/action API
  or scheduler behavior is introduced.
- Reviewers must reject attempts to broaden T-0032 into public monitor actions,
  dead-letter policy, backoff/timers, production topology, catch-up execution,
  or production adapter work.

## D-0084: Set The Internal Reception Failure Outcome Policy

Status: Accepted

Date: 2026-07-11

Task: `T-0033`

Context: T-0029 through T-0032 added bounded sanitized attempt retention,
exact-message summaries, retry classification, and a fixed 100-attempt
pre-callback exhaustion gate. The current runtime keeps both endpoint callback
failures after retryable classification and exhausted supported rows pending
`TO_DELIVER`. Spine JVM instead
asks `DeliveryMonitor.onReceptionFailure(FailedReception)` for an action after
a failed dispatch outcome; its default action marks the message delivered, and
it also offers immediate repeat dispatch. TypeScript does not yet have public
monitor/action ownership, immediate repeat, scheduler/backoff, dead-letter
storage, or production supervision. The next implementation slice needs a
fixed internal outcome policy without promising those broader facilities.

Decision:

- Use only two internal action concepts in the internal implementation.
  `KEEP_PENDING` is the policy outcome that preserves `TO_DELIVER`; releasing
  its active row claim uses the existing cleanup path, not a separate action
  executor or failure category. `MARK_DELIVERED` means use the framework-owned
  claimed-row status transition to `DELIVERED`. These names are decision
  vocabulary, not TypeScript declarations, public exports, or a promise of a
  configurable action API.
- When a supported row classified as retryable then fails in its endpoint
  callback, use this sequence: (1) observe the endpoint callback failure;
  (2) execute existing claim cleanup, which realizes the `KEEP_PENDING`
  outcome while the active claim exists; (3) finalize one failure result as
  `ENDPOINT` if cleanup succeeds or `CLEANUP` with the aggregated callback and
  cleanup error if cleanup fails; (4) persist exactly one bounded sanitized
  retained attempt from that finalized result; and (5) return exactly one
  public `DeliveryFailure` and consume the existing failure budget once. Do
  not retain before cleanup, rewrite an earlier attempt, perform a second
  retention write, or emit a second failure.
- When the finalized retained attempt is attempt 100, retain it through the
  same single write. Exhaustion is observed only after a later claim, before
  that later pass invokes the callback. The retained facts remain limited to
  the T-0029 fields and continue to exclude payload bytes, user error objects,
  stack traces, and unbounded text. Ordinary attempt-retention write failure
  occurs after cleanup and remains observational under D-0080; it does not
  change the authoritative `TO_DELIVER` status or authorize a terminal status.
  Retained-state corruption still fails closed.
- This callback-failure policy does not select an action for claim,
  lease/fencing, attempt-retention infrastructure, cleanup, or status-update
  failures. Those stages preserve their existing outcomes and failure
  accounting. In particular, a callback that succeeds before the delivery
  status update fails is a `STATUS_UPDATE` failure, not an endpoint callback
  failure, and D-0084 does not apply `KEEP_PENDING` to it.
- If the existing cleanup path cannot release or clear the active claim after
  an endpoint callback failure, preserve its current `CLEANUP` classification
  and accounting in the one finalized result described above. Aggregate the
  original callback error with the cleanup error; the subsequent single
  retention write and single public failure use that finalized result. Do not
  emit a second action failure or add separate action-failure facts for failed
  `KEEP_PENDING` cleanup.
- For a supported row already classified as exhausted before callback
  invocation, select the fixed framework-owned `MARK_DELIVERED` action. Do not
  invoke the endpoint and do not retain another attempt. This adopts the Spine
  JVM default terminal outcome only after the TypeScript bounded retry budget,
  without adding a public monitor or custom action selection.
- Execute claim cleanup for the `KEEP_PENDING` outcome while the active
  delivery claim exists, before finalizing and retaining the callback-failure
  result. Execute the pre-callback exhaustion action after exact-message
  exhaustion classification and after the row has been claimed and
  synchronized with the active shard lease fence. No unfenced public
  `Inbox.markDelivered()` snapshot is an action executor for this policy.
- Immediate repeat dispatch is deferred. `KEEP_PENDING` permits only a later
  framework drain to reconsider the row; it does not recurse, schedule a run,
  promise backoff, or imply worker supervision.
- If the exhaustion-time `MARK_DELIVERED` transition fails and claim cleanup
  succeeds, report one delivery failure for that row and keep the durable inbox
  row's authoritative outcome pending `TO_DELIVER`. New action-failure facts or
  error details introduced for that successful-cleanup branch must be bounded
  and sanitized. The row must not be reported as delivered, the exhaustion
  context must remain available, and existing failure-budget accounting remains
  one failure. If claim cleanup also fails, preserve the existing cleanup
  exception: report one `CLEANUP` failure whose `AggregateError` contains the
  original mark error plus cleanup error, without promising that aggregate is
  frozen, bounded, or stack-free. The authoritative row remains `TO_DELIVER`
  and failure accounting remains one. This exception preserves existing cleanup
  aggregation and does not add a public action or error contract.
- D-0084 does not change the enclosing public `DeliveryFailure` contract. Its
  existing `message` remains a copied `DeliveryEndpointMessage` snapshot that
  may contain copied `Any.value` payload bytes, and its existing `error`
  remains `unknown`. T-0033 makes no claim that this enclosing failure is
  payload-free; any change to that public contract requires a later explicit
  task.
- T-0034 makes only the fixed pre-callback `MARK_DELIVERED` action executable:
  it claims and fence-synchronizes the exact exhausted row before internal
  finalization. The retryable callback `KEEP_PENDING` sequence remains the
  existing cleanup/finalize/one-attempt/one-failure path. Public monitor/action
  selection, immediate repeat, scheduler/backoff, dead-letter, supervision,
  topology, and adapters remain deferred.
- Preserve valid `CATCH_UP` rows as pending/skipped and preserve fail-closed
  handling of legacy stored `IMPORT_EVENT` rows. Neither path enters this
  supported-endpoint action policy.

Alternatives considered:

- Keep exhausted rows pending indefinitely. Rejected as the final policy
  because the bounded gate would permanently resurface the same poison row as
  failed work without a terminal framework outcome.
- Mark every callback failure delivered immediately, matching the JVM default
  at first failure. Rejected because T-0029 through T-0032 deliberately built a
  bounded durable retry budget; discarding a retryable row would bypass it.
- Repeat dispatch immediately. Rejected because recursive dispatch can consume
  an unbounded run and requires policy/lifecycle ownership not present in the
  TypeScript runtime.
- Add a public monitor, custom actions, or dead-letter outcome now. Rejected
  because each adds API, storage, and lifecycle commitments beyond this
  decision-only slice.

Consequences:

- The internal implementation has one deterministic outcome for an endpoint
  callback failure after retryable classification and one for pre-callback
  exhaustion, with a small claim-fenced execution boundary.
- Exhaustion will intentionally trade further retries for a terminal delivered
  status after 100 retained failures. No dead-letter record is implied, so the
  bounded retained attempt history remains the available durable diagnostic
  evidence.
- Runtime source, tests, public docs, APIs, generated files, and examples
  remained unchanged in T-0033. T-0034 now makes the fixed internal
  pre-callback exhausted-row `MARK_DELIVERED` outcome executable and current.
  Reviewers must reject prose that overclaims public `DeliveryMonitor`, custom
  actions, repeat dispatch, scheduler/backoff, dead-letter, supervision,
  topology, adapter, or other broader policy behavior.

## D-0085: Let ServerEnvironment Own Bounded Delivery Runs

Status: Accepted

Date: 2026-07-11

Task: `T-0035`

Context: T-0034 made the fixed internal exhausted-row `MARK_DELIVERED` outcome
executable. The current `DeliveryLoop.run()` is explicitly started for one
shard. Each direct drain is bounded, failure count is bounded, and skipped-only
scanning pauses after a bounded streak, but the whole loop run is not fully
bounded: supported rows appended continuously while useful work is delivered
can keep it draining without settling. `DeliveryWorker.start()` starts every
configured loop once, returns an aggregate-priority status plus ordered
per-shard loop results when all fulfill, and rejects if any loop rejects.
Neither type starts at server startup, reacts to a later durable write, or
guarantees a later run for a retryable row left `TO_DELIVER`. `stop()` prevents
later drains and `close()` awaits an active run without interrupting its current
drain. The optional `ServerEnvironment.delivery` property is only a closeable
facility today; that does not make it a scheduler. A framework owner must
connect these primitives to server startup, local durable-write notification,
observation, and orderly stop before delay policy or public monitoring is
designed.

Decision:

- `ServerEnvironment` is the sole framework owner for starting, retriggering,
  stopping, and observing delivery runs. It uses a package-internal delivery-run
  lifecycle seam around `DeliveryWorker`; the seam is an implementation detail,
  not another owner, an environment configuration surface, or a public API.
  Each environment instance has exactly one such seam across all attached
  servers.
- The accepted target makes each lifecycle-owned `DeliveryWorker.start()` call
  one-shot and epoch-bounded. The lifecycle seam may serialize starts and
  coalesce trigger requests that arrive while a run is active into at most one
  subsequent admitted request. One
  admitted request is a finite scan epoch: it captures an opaque per-shard
  continuation and an admission-time high-watermark, or an equivalent
  explicitly bounded fairness limit. That bound caps all reads, accepted
  callbacks, and delivered work in the epoch, not only skipped-row continuation;
  useful supported work cannot reset or extend it. Rows appended after
  admission are outside the epoch and rely on their coalesced or later readiness
  request. The epoch may require multiple one-shot worker runs, but each run
  remains bounded and stop is checked between runs. Reaching the epoch bound
  completes the request even when unsupported or newly appended rows remain
  pending. The seam must not turn one worker call into an unbounded background
  loop or recursively repeat dispatch.
- After contexts and delivery endpoints are assembled, but before network
  intake opens, `ServerEnvironment` installs local notification and admits and
  awaits one finite recovery scan epoch. Each worker start within that epoch is
  one-shot and bounded. The epoch considers pre-existing supported `TO_DELIVER`
  rows. A bounded `FAILED`, `PAUSED`, or `SKIPPED` result is an observed
  recovery outcome, not a startup claim that every pending row was completed.
  If work attributable to the attaching registration rejects, that server start
  fails before network intake opens. Startup cleanup follows the
  registration-scoped rollback rules below rather than closing a shared
  environment wholesale. Its attributed worker rejection and cleanup failures
  propagate or aggregate through the existing failed-start error model. Cleanup
  does not claim or delete durable pending rows; their later recoverability
  follows the environment/storage lifetime rules below.
- After each individual newly supported inbox row is durably persisted, the
  local write path notifies the same package-internal seam. This is a per-row
  durability boundary: each successful row emits independently of call,
  configured scope, or batch grouping. Every successful earlier row in a
  `receiveAll` or other batch remains notified when a later row rejects, while
  a rejected or unattempted write emits no readiness. Notification carries
  readiness only and uses a synchronous non-throwing package-internal callback;
  observer failure cannot reject a completed persistence, interrupt later batch
  writes, or replace the existing handoff result. It does not carry a timer,
  backoff value, monitor action, payload, error, or retry policy. Notifications
  during an active run merge idempotently into one pending admission containing
  every eligible canonical tenant/configured scope they identify. The pending
  set preserves tenant identity, deduplicates by canonical scope, and is bounded
  by the current tenant/configured descriptor/shard domain, not trigger or
  repeated-notification count. Legitimate growth may track current tenant or
  configuration cardinality; it cannot retain only the first or last scope.
  Thus disjoint writes and scopes from mixed fulfilled/rejected
  partitions remain eligible for one later bounded run without a concurrent
  package-internal/direct worker start.
- Before environment attachment owns a context, its existing immediate exact
  drain remains the compatibility owner. Environment attachment makes the
  ownership switch an atomic serialized barrier: it closes admission to new
  direct exact drains, waits for every already-admitted direct exact drain in the
  attaching scope to settle, installs readiness routing, and only then admits
  startup recovery or other environment-owned work. Once direct-drain admission
  closes, a supported row persisted before readiness routing is installed
  submits its canonical scope to a transition buffer bounded by the same current
  tenant/configured-scope domain as normal coalescing. It cannot fall back to
  direct drain. Route installation transfers each buffered scope exactly once
  into the generation's lossless pending admission before opening environment
  admission. Attachment and startup admission remain pending while an earlier
  exact drain is active. Every receive admitted after the switch uses durable
  persistence plus synchronous non-throwing readiness only and cannot invoke
  direct exact drain. Thus no durable row loses both owners, and direct and
  environment run owners cannot overlap for an attached context, row, or scope.
  Before the switch, existing exact-drain completion and error behavior remains.
  After it, the local handoff does not await or surface endpoint delivery
  outcome; lifecycle settlement/reporting owns that later outcome.
- Retryable failures left `TO_DELIVER` remain the responsibility of this same
  owner. `FAILED` records that later reconsideration is needed but does not
  immediately retrigger itself. A later package-internal retry-readiness policy
  must submit a trigger to this seam; selecting delay, backoff, jitter, timer,
  or attempt timing is a separate decision. No other framework part may start
  a delivery worker directly to provide that wakeup.
- Scheduling decisions use package-internal per-shard results, never only the
  aggregate worker status. An `IDLE` shard completes its part of the admitted
  epoch. Only a `PAUSED` shard remains eligible to continue that same epoch from
  its opaque continuation to the finite bound; `PAUSED` creates no readiness
  event. A `FAILED` shard and a `SKIPPED` shard are parked until a later external
  startup/new-work/retry-ready trigger, avoiding failure and contention spin. A
  `STOPPED` shard does not continue in the stopping generation. Therefore a
  worker result containing both `FAILED` and `PAUSED` continues only the paused
  shard, even though its aggregate status is `FAILED`.
- A fulfilled `DeliveryLoopRun` whose status is `FAILED` is an observed,
  non-rejected worker outcome. The lifecycle seam parks that shard for a later
  external startup/new-work/retry-ready trigger and relies on durable row and
  attempt history for diagnostics. It does not create a canonical parked
  rejection record, retain a cause object as lifecycle error state, fail server
  startup, or surface an error at detach/close merely because the fulfilled
  status is `FAILED`. After observing the bounded result, the lifecycle retains
  only the parked shard disposition/readiness obligation, not the result as an
  error. Startup recovery may therefore settle after observing `FAILED`, without
  claiming that the durable pending row completed.
- After a normally fulfilled worker start, an already-coalesced external
  readiness request remains eligible to be admitted according to those
  per-shard dispositions. Rejection is the exception: the rejected
  shard/obligation scope and overlapping coalesced readiness park, and neither
  may restart until a new external startup/new-work/retry-ready trigger arrives
  after the rejection. Disjoint readiness is not attributed to that rejection.
  None of these outcomes changes T-0034's row policy.
- An attaching startup-recovery obligation queued or coalesced behind a rejected
  sibling scope is ownership-partitioned using package-internal rejected-shard
  evidence. If every rejected scope is disjoint from the attaching
  registration's startup obligation, the lifecycle seam admits exactly that
  unaffected startup scope once after observing the rejection. It does not
  restart any rejected scope, requires no new external readiness event, and
  cannot recursively readmit the startup scope; the attaching startup awaits
  that one bounded run and settles from its result. If any rejected scope
  overlaps the attaching startup obligation, startup fails under the existing
  registration/generation failed-start rules. Thus sibling rejection cannot
  strand startup or create rejection spin.
- The first implementation successor must change the current loop/worker
  internals because
  `DeliveryLoop` presently clears its resume cursor when returning `PAUSED` and
  does not cap useful work to an admitted epoch, while `DeliveryWorkerRun`
  exposes ordered loop results but carries no package-internal shard identity,
  continuation eligibility, or progress obligation. The successor adds a
  package-internal worker/loop result and selective-start path that associates
  each shard with its finite bound, opaque progress, and disposition, and starts
  only eligible shards. When any loop rejects, this internal evidence preserves
  the rejected shard identity, each cause and its associated retained
  obligation scope, fulfilled-sibling dispositions, and last safe progress
  instead of discarding them behind one worker rejection. It must not expose the
  shard-control result, rejected-shard evidence, cursor, or epoch in public
  declarations, exports, monitor callbacks, or environment options.
- `DeliveryWorker.start()` may reject instead of returning an outcome. Every
  lifecycle-owned start attaches observation immediately so notification- and
  retry-triggered runs cannot create unhandled promise rejections. Such a
  rejection is recorded package-internally, clears the active-run slot, and
  preserves the admitted epoch, its last safe opaque progress, and any
  coalesced request. It does not immediately restart. A later external
  startup/new-work/retry-ready trigger resumes that retained obligation, so a
  persistent fault cannot create an immediate rejection spin; the only
  no-new-trigger path is the disjoint, already-admitted startup scope defined
  above. No public monitor, health, or error-reporting API is implied.
- Rejected starts use a finite package-internal canonical parked-record table;
  unresolved operational state remains distinct from cause reporting. Keys are
  only truthful owner plus canonical configured shard/obligation scope:
  registration-owned records are bounded by live registrations and their
  configured shards, generation-owned shard records are bounded by configured
  shards, and there is at most one additional generation-spanning shared record
  for an inseparable cause. The lifecycle never creates keys for arbitrary row,
  attempt, message, cause-combination, or scope subsets. Thus record count is
  bounded by live registration/configured-shard cardinality plus the one shared
  record, not by rejection count.
- Each canonical record retains one unresolved operational obligation state,
  at most one representative cause object with `unreported` or `reported`
  state, a bounded `reportedSinceResolution` flag, and a saturating nonnegative
  safe-integer occurrence count. A repeated rejection of an already-unresolved
  canonical key coalesces into that record, advances the count only up to
  `Number.MAX_SAFE_INTEGER`, and never appends cause objects or scope entries.
  While its representative is `unreported`, the deterministic first
  representative remains. After that representative is reported, a later
  rejection replaces it with exactly one new `unreported` representative in the
  same record and keeps the bounded reported flag; it does not preserve an error
  object history.
- Independently attributable causes from one rejected start canonicalize into
  their finite truthful owner/shard records and may therefore have different
  owners. Multiple causes targeting the same key use configured shard order and
  settled-cause order to choose the first representative deterministically and
  coalesce the rest into the saturating count. An inseparable combined cause
  coalesces into the sole generation-spanning shared record. Reclassification
  after registration removal moves/coalesces state into the canonical
  destination record, saturating its count and retaining at most one
  deterministic unreported representative; it never creates a scope-subset key
  or another cause collection.
- An aggregate is assembled only from representative causes eligible at the
  current lifecycle boundary; reporting it atomically marks exactly those
  representatives `reported` and sets their bounded reported flag. Each
  representative is surfaced at most once. A later rejection may install one
  new representative as above, but an already-reported cause object is never
  appended, chained, or surfaced again. Unrelated causes are never folded into
  another registration's failure merely because one worker promise rejected.
- A later externally triggered fulfilled start supersedes a parked record only
  for the same shard/obligation units that the start actually re-evaluates and
  returns package-internal non-rejected dispositions for. Omitted shards,
  `STOPPED` work that was not re-evaluated, and fulfillment for another
  registration or generation scope do not clear the record. A partially
  overlapping fulfilled start may consume separately recorded matching units,
  but cannot clear a broader registration- or generation-owned record until
  every unit in that record's remaining scope has been successfully
  re-evaluated. The newer per-shard dispositions then govern those units; no
  unrelated parked error is superseded. Successful matching re-evaluation
  consumes the resolved operational obligation and its parked record, including
  any associated reported or unreported cause state; a resolved unreported
  cause need not be surfaced. Consuming the record also discards its bounded
  occurrence/reporting scalars and sole representative cause reference.
- Detach, failed-start cleanup, last detach, and environment close still handle
  every eligible unresolved operational obligation even when its cause was
  reported earlier. They aggregate only eligible `unreported` causes and
  atomically mark those causes `reported` before or with propagation. A
  `reported` cause is never surfaced again, but its unresolved obligation stays
  parked until matching successful re-evaluation or truthful lifecycle
  consumption removes it.
- Servers attach to the one environment seam through package-internal
  registrations, reference counting, or equivalent generation tokens. Each
  attachment registers its endpoint dependencies and associated shard/work
  obligations, then submits startup recovery through the shared seam before
  that server opens network intake. A caller-owned environment may accept
  multiple registrations; additional servers reuse the same generation and do
  not create another delivery owner. A server-owned environment registration is
  package-internally exclusive to its owning server. Claiming ownership when
  another registration is live, or attaching a second server while the owning
  registration is live, rejects before registration, startup recovery, trigger
  admission, or any other delivery work is admitted. This exclusivity follows
  the existing server/environment ownership relation and adds no public option.
- Detaching one server stops readiness from that registration and serializes
  against active work before its contexts close. Every active-run rejection
  observed while establishing that barrier is first partitioned by the same
  registration/generation shard-obligation ownership rule as any other rejected
  start. After the barrier and before those dependencies close, ordinary
  non-last detach consumes only operational records owned by the departing
  registration plus generation-owned records made orphaned by removing it, and
  surfaces only their still-`unreported` causes. Sibling-owned errors and
  sibling progress/readiness remain intact. A
  generation-owned record whose remaining scope still includes any live shared
  or sibling obligation stays generation-owned and parked and is not included
  in that server's close aggregate. It is never relabeled as the departing
  registration's error. Last detach and environment close consume all remaining
  operational records and surface each still-`unreported` cause exactly once
  under the rules below.
- Failed startup atomically closes trigger/notification admission for only the
  attaching registration and removes that registration from the generation.
  The seam then prevents new work for its associated obligations and awaits
  every active worker/loop operation that can still invoke that registration's
  endpoint dependencies before those contexts close. Work unrelated to those
  dependencies need not be stopped. The general ownership rule assigns and
  consumes the failed registration's uniquely attributable rejection and
  rollback cleanup failures in that server's failed-start aggregate. A
  sibling-only parked error does not fail or contaminate this registration's
  startup. A generation-owned error that overlaps the attaching registration's
  recovery scope prevents that startup from claiming recovery success. The
  failed-start result aggregates each eligible `unreported` overlapping cause
  and atomically marks the original cause entry `reported`, without transferring
  ownership or consuming unresolved shared obligation/scope while live
  sibling/shared units remain. If one or more overlapping generation causes
  were already `reported`, startup rejects through the existing failed-start
  channel with exactly one fresh package-internal plain `Error` for that failed
  startup. Its fixed non-empty message is
  `Startup recovery is blocked by an unresolved shared delivery obligation.`
  The blocker has no custom type, code, exported declaration, `cause`, original
  error reference, wrapped/chained error, or original-cause detail. It is
  attributed to this startup registration, included and consumed in this
  failed-start result, and is never parked. The original generation cause stays
  `reported`, its unresolved operational scope stays parked, and no later
  boundary surfaces that original cause again. If the same failed startup also
  has unreported overlapping causes, those causes and the one blocker are
  aggregated together without duplicating any original cause. Rollback removes
  the failed registration's obligation units from the shared operational
  record: if live sibling/shared units remain, the obligation and cause-reporting
  state stay generation-owned and parked; if none remain, failed-start cleanup
  consumes the obligation and record, surfacing only causes still `unreported`.
  Fulfilled progress, registration-owned sibling errors, coalesced readiness,
  and pending epoch obligations belonging to unaffected registrations remain
  intact. If removing the failed registration leaves other registrations, their
  generation remains open and continues from its retained progress/readiness.
  If it was the first or sole registration, rollback becomes a last detach and
  quiesces that empty generation. A caller-owned environment remains reusable
  through a later fresh generation. A server-owned environment additionally
  closes permanently after quiescence, aggregating only still-unreported
  registration/startup/cleanup and generation causes consistently with the
  existing failed-start close model.
- The last server detach begins the authoritative generation-stop sequence
  below under the package-internal lifecycle gate. After that sequence consumes
  eligible operational records, reports still-`unreported` causes, and
  permanently retires the old generation, a caller-owned environment remains
  open without reusing its stopped worker/loops. A later attachment may create a
  fresh package-internal generation with newly constructed worker/loop
  instances, reinstall notification, and perform startup recovery for durable
  pending work. `ServerEnvironment.close()`
  first performs a package-internal live-registration check serialized with
  attach, detach, and close. If any registration is live, close rejects before
  permanently closing admission, stopping a worker, consuming parked errors, or
  shutting down a facility; the environment and every registration remain
  usable. The caller closes and awaits every attached `RunningServer` through
  its existing public `close()` method; each server's package-internal shutdown
  detaches its registration. The caller then retries `ServerEnvironment.close()`.
  No caller invokes detach directly. This refusal uses the existing close
  rejection channel and adds no public close API or option. The serialization
  gives races one order: if attach wins, close observes the live registration
  and rejects; if the zero-attachment close transition wins, concurrent or
  later attach rejects; if server close has not completed its internal detach,
  environment close rejects and may be retried after that `RunningServer.close()`
  settles.
- Once the serialized close transition observes zero registrations, the active
  integrated owner map also requires no current generation and no retained
  lifecycle owner. It permanently rejects later attachments and explicit stops,
  releases the lifecycle gate, and then closes owned facilities. It cannot
  create a later generation. The formerly accepted clause assigning permanent
  close the authoritative stop sequence for “any current generation” is
  superseded: T-0037d/e1/e2 retain every reachable generation-bearing operation,
  and close refuses those owners before mutation. When a server owns its
  environment, server close always detaches its sole exclusive registration
  before invoking environment close; the environment then closes with its
  owning server. No public attachment or lifecycle option is introduced.
- The authoritative generation-stop order for failed-start rollback, last
  detach, and reusable explicit generation stop is: under the lifecycle gate,
  atomically mark the generation stopping and close trigger admission and local
  notification; call the worker stop path so a `PAUSED` result cannot start
  another one-shot run; await already-active work without forcibly interrupting
  its current drain and establish that no old worker/loop can invoke an endpoint
  again; classify rejection; consume every operational record eligible at this
  boundary and report only still-`unreported` causes; then permanently retire
  the old worker, loops, and generation and perform fallible cleanup. Stop always
  precedes await, await establishes quiescence before classification, and
  classification plus record consumption/reporting precede permanent retirement/
  cleanup. Once stop/await succeeds, irreversible admission closure, stopped
  state, and proven quiescence mean the old instance can never start, accept
  notification, or invoke endpoints again. A later reporting or cleanup failure
  is aggregated but cannot reactivate or make that instance reusable; cleanup
  failure may only leak inert resources. A durable write racing after admission
  closes remains pending.
  After reusable last detach or explicit generation stop while the same caller-
  owned environment remains open, a later generation can recover it only after
  quiescence is established. Ordinary last detach clears its stopped,
  proven-quiescent retired current-generation slot through a finally-equivalent
  path before propagating a reporting or inert permanent-cleanup error, so a
  later attach can create one fresh generation without overlap. A failure that
  cannot establish quiescence is distinct: the old slot and every endpoint-
  dependent context, resource, and facility remain retained because endpoint
  safety is not proven. That unsafe state requires an explicit lifecycle retry;
  it cannot clear or replace the slot or close dependencies beneath possibly
  active work. The retry resumes the same stop transition: admission closure and
  stop are not duplicated, already-settled phases are not repeated, and only
  after quiescence is proven does it classify, consume/report eligible records,
  permanently retire/clean up exactly once, and clear the slot. It may then
  resume deferred server cleanup or permit exactly one later fresh attachment
  without old/new overlap. The initial failed attempt does not classify,
  consume/report, retire, clear the slot, or tear down endpoint dependencies.
  Reusable explicit generation stop obeys that same quiescence-failure retry
  boundary. Its failed attempt retains the unsafe current generation, live
  registrations, transition owner and readiness buffer, and every endpoint
  dependency. It performs no classification, consumption/reporting, retirement,
  or fresh-generation transition. Explicit retry resumes the same admission-
  closed, stopped operation without repeating admission closure or stop, proves
  quiescence, completes each remaining authoritative retirement phase exactly
  once, and then performs survivor/readiness-route rebind, transfer of every
  configured/startup/buffered/retained canonical scope into fresh pending
  admission, candidate publication, and later-write admission reopen exactly
  once, with one generation and no overlap. The formerly accepted permanent-
  close quiescence/unsafe-slot retry paragraph is superseded by integrated
  reachability: permanent close never owns a current generation, refuses every
  retained predecessor operation, and retries only incomplete facility closes
  after owner-free permanent admission. Refusal while registrations remain live
  is a separate pre-transition outcome.
  After permanent `ServerEnvironment.close()`, no generation of that same
  environment is possible. Recovery then requires a separately
  created environment/process over storage that remains externally available
  and persistent, if facility ownership and backend lifetime permit; this
  decision makes no recovery promise after environment-owned storage is
  permanently closed.
- The coordinator-instance primitive must retire in a `finally`-equivalent path
  even when the caller-supplied operational-record consumption/reporting step
  rejects. It preserves that failure, combines it with any stop, settlement,
  classification, or permanent-retirement cleanup failure under existing
  aggregation semantics, and exposes the combined failure only after retirement/
  cleanup is attempted in the authoritative order. Once stop/await establishes
  quiescence, admission is irreversibly closed, the instance is stopped, and no
  old worker/loop can invoke endpoints again. Reporting or cleanup failure cannot
  reverse that fail-closed postcondition; cleanup failure may leave only inert
  resources. A reusable lifecycle caller may therefore clear or replace its
  slot and complete any required fresh-generation transition before propagating
  the combined result. If quiescence itself cannot be established, the primitive
  reports that distinct unsafe result; replacement and endpoint-dependent
  teardown are prohibited until an explicit retry proves quiescence.
- Attach, detach, generation stop, and environment close use the same
  package-internal lifecycle gate. If attach linearizes before reusable last
  detach or explicit generation stop marks the generation stopping, it joins the
  current generation subject to ownership cardinality. An otherwise eligible
  attach that arrives after either reusable stop transition begins waits through
  complete old-generation stop, active-work settlement, rejection
  classification, record consumption/reporting, and permanent retirement. It
  never joins the stopping generation and no fresh worker overlaps the old one.
  After ordinary last detach, no registrations remain; the first later eligible
  attach creates exactly one fresh generation and startup recovery, and later
  eligible attaches join it. Reusable explicit stop is different because live
  registrations remain: that stop transition constructs the sole fresh
  candidate itself, even when no attach races, then rebinds routes, transfers
  canonical scopes,
  publishes, and reopens admission in the order below. An eligible attach racing
  explicit stop waits for and joins that transition-owned candidate; it never
  creates another. Such an attach rejects only if permanent environment close
  wins the serialized transition or independent ownership cardinality refuses
  it. No reusable-stop policy may reject it merely because retirement is in
  progress.
- Reusable explicit generation stop leaves registrations live, so retirement
  alone cannot complete that transition. Closing old-generation readiness
  installs one bounded canonical tenant/configured-scope transition buffer, or
  an equivalent persistence barrier, that owns readiness for writes from that
  close through the fresh recovery snapshot and readiness-route rebind. After
  old retirement, the explicit-stop transition constructs exactly one fresh
  candidate even without a racing attach. It first completes rebind of every
  surviving registration and readiness route to that candidate, retaining
  per-unit route progress. It then transfers every configured, startup,
  buffered, and retained canonical scope losslessly and exactly once into fresh
  pending admission with separate per-unit transfer progress, publishes the candidate, and only
  then reopens later-write admission. Thus a write persisted after fresh
  recovery captures its snapshot but before routes rebind still causes an
  eventual fresh-generation run without an unrelated trigger. Fresh-generation creation,
  complete route rebind, all-scope transfer, candidate publication, and
  admission reopen normally finish before T-0037e2 propagates an earlier
  retirement or reporting error once. Configured/startup/buffered/retained
  scopes are transferred and are never route-rebound. If fresh
  construction, route rebind, or transfer itself fails, the old generation stays
  admission-closed, stopped, and quiescent after permanent retirement/cleanup
  was attempted, no partial fresh generation is published, later-write admission
  stays closed, and the bounded canonical transition owner retains every not-yet-
  transferred scope. Construction failure before a candidate exists retains no
  candidate and may construct one on retry. Once construction succeeds, that
  same transition owner is the sole owner of the one constructed-but-unpublished
  candidate across rebind or transfer failure. Before returning a transition
  error, it awaits settlement of every bounded candidate startup/recovery unit
  already admitted, so no candidate endpoint invocation continues after error
  propagation. T-0037e2 preserves and truthfully aggregates the transition error
  with any earlier error; it does not self-loop. Only a later external lifecycle/
  readiness retry may resume that retained candidate, never construct a second
  one, complete exact-once registration/readiness-route rebind and all canonical-
  scope transfer, publish it,
  and reopen admission. An otherwise eligible attach racing the transition
  waits for that same eventual generation. The transition owner prevents an
  ownership gap while old quiescence and candidate settlement prevent old/new
  overlap. No surviving scope may return to the retired generation, and only
  permanent close or independent ownership cardinality may reject the attach.
  README and TypeDoc describe only observable `Server`, `RunningServer`, and
  `ServerEnvironment` behavior; they do not name or describe this package-
  internal explicit-stop operation.
- Server shutdown order is: stop that server's external network intake and
  sessions; detach its package-internal registration and serialize against
  active delivery work while its contexts and endpoint dependencies remain
  open; consume only the operational records eligible under that detach's
  ownership scope and aggregate only their still-`unreported` causes; then close
  its contexts and other endpoint resources. A non-last detach leaves the
  shared generation and live generation-owned records active for remaining
  registrations. Failure after its registration-scoped work barrier is
  established retains the departing registration's endpoint dependencies plus
  its unfinished cleanup and eligible reporting work for explicit retry. Retry
  resumes only cleanup and eligible reporting exactly once; it never stops or
  retires the shared generation, clears its slot, or closes sibling endpoint
  dependencies, contexts, resources, or facilities. Sibling generation
  identity, readiness, pending work,
  endpoints, and facilities remain active throughout; newly orphaned generation
  records follow the existing parked-versus-eligible partition. A last detach
  additionally quiesces the generation, consumes every remaining operational
  record, and includes every remaining `unreported` cause exactly once. If the
  server owns the environment, its sole registration is
  detached first; environment delivery facilities, transport, and storage close
  only after that quiescence and context/resource close. A shutdown that ends
  the generation or environment includes an earlier parked rejection even when
  no worker promise is active. An active rejection observed while shutdown
  awaits work is partitioned before aggregation: non-last detach includes only
  the departing registration's records and newly orphaned generation records,
  while live shared generation and sibling records remain parked. For a last
  detach, shutdown continues every remaining close after quiescence and
  propagates or aggregates all eligible reporting and inert cleanup failures
  consistently with the existing `RetryableCloseGroup` behavior. If last-detach
  quiescence cannot be established, shutdown retains the unsafe generation slot
  plus its endpoint-dependent contexts, resources, delivery facilities,
  transport, and storage for explicit retry; it does not close beneath possibly
  active work. That retry resumes the same last-detach shutdown without
  duplicating completed admission closure or stop, proves quiescence, then
  performs classification, eligible consumption/reporting, permanent
  retirement/cleanup, slot clearing, and remaining server cleanup exactly once.
  When startup failure occurs against a caller-owned environment and rollback
  cannot establish quiescence, the server opens no listener and retains every
  endpoint-dependent context and resource while leaving the caller-owned
  environment and its facilities open. Explicit retry of that same server
  cleanup resumes T-0037d's same failed-start rollback without repeating
  admission closure or stop, proves quiescence, completes the remaining
  rollback phases and safe slot clearing exactly once, and closes deferred
  server-owned contexts and resources exactly once. It never closes the caller-
  owned environment or facilities. That environment remains reusable for one
  later eligible fresh attachment and server without old/new overlap. This is
  distinct from server-owned environment continuation and teardown.
- Implement D-0085 in small sequenced successors. The smallest first successor
  is `T-0036 Package-Internal Delivery Epoch Progress`. It changes only
  package-internal `DeliveryLoop`/`DeliveryWorker` prerequisites: cap the full
  finite epoch across reads, callbacks, and deliveries; retain per-shard
  identity, disposition, and opaque continuation; selectively start only
  eligible shards so only `PAUSED` continues the current epoch; preserve
  fulfilled sibling progress when another shard rejects; and preserve each
  rejected shard's package-internal identity, cause, and associated retained
  obligation scope. T-0036 remains explicitly invoked. It does not assign
  registration/generation ownership, attach `ServerEnvironment`, start
  recovery, subscribe to post-persist
  notification, coalesce lifecycle readiness, retain parked lifecycle errors,
  or wire stop/shutdown. It adds no public cursor, epoch, shard-result, or
  lifecycle API.
- A separate later successor, expected as `T-0037` (Environment Delivery
  Lifecycle), consumes T-0036's fulfilled and rejected-shard evidence without
  reopening or duplicating worker/loop internals, and wires the one
  `ServerEnvironment` seam:
  attachment/generation cardinality, startup recovery, local post-persist
  notification, coalescing, parked operational-obligation/cause-reporting
  handling, and stop/shutdown ordering. T-0037 does not select retry delay,
  backoff, jitter, timer values, or public retry policy; retry timing remains a
  later decision and task.
- Public `DeliveryMonitor`, failure actions, scheduler APIs, process
  supervision, topology, adapters, catch-up, or health surfaces remain
  deferred throughout this sequencing.
- Preserve valid `CATCH_UP` rows as pending/skipped without using them as a
  trigger source, and preserve fail-closed legacy stored `IMPORT_EVENT` rows.
  Preserve T-0034's claim-fenced exhausted-row completion and its mark-failure
  outcomes unchanged.

Alternatives considered:

- Let `Server`, each bounded context, or write-side handoff code own worker
  starts. Rejected because ownership and shutdown would split across assembly,
  endpoint, and persistence paths.
- Treat `ServerEnvironment.delivery` as an existing scheduler. Rejected because
  its current contract and tests establish only optional closeable facility
  ownership.
- Treat `FAILED`, `SKIPPED`, or each `PAUSED` result as a fresh readiness event.
  Rejected because that can spin on retryable failures, another shard owner, or
  head rescans of unsupported rows and would choose repeat and delay policy
  accidentally. Continuing the already-admitted finite `PAUSED` epoch from its
  opaque progress is not a fresh event.
- Copy Spine JVM's singleton environment, per-message thread creation, public
  monitor actions, or immediate repeat callbacks. Rejected because the useful
  JVM evidence is environment-level delivery ownership and local write
  notification, not those Java-specific lifecycle and API choices.

Consequences:

- There is one place to serialize bounded runs, observe their outcomes, and
  quiesce delivery before endpoint, transport, and storage teardown.
- Startup and newly persisted supported work gain a compact local trigger path.
  Retryable pending rows have an explicit owner and future trigger destination,
  while retry timing remains deliberately undecided.
- Large finite unsupported prefixes cannot starve admitted supported tail work
  merely because one bounded loop run pauses, while admission-time epoch bounds
  prevent continuous unsupported or supported writes from creating an infinite
  epoch.
- Worker rejections have defined startup, notification, retained-progress, and
  shutdown behavior without creating a public observation surface.
- Canonical owner/shard records, one representative cause, and saturating
  scalars bound package-internal parked-rejection memory independently of repeat
  rejection count.
- Fulfilled `FAILED` is observed as a bounded shard disposition and parked for
  external retry readiness without becoming lifecycle cause-reporting state or
  a startup/close error.
- Mixed per-shard outcomes no longer make the aggregate priority accidentally
  rerun failed/skipped shards or abandon paused-shard progress.
- Shared caller-owned environments can outlive one server attachment and later
  start newly constructed worker/loop instances in a fresh generation without
  reviving stopped instances or creating a second delivery owner.
- Failed shared-environment startup has registration-scoped rollback and error
  ownership, so endpoint dependencies remain open until their active work
  settles while sibling registrations retain their progress, readiness, and
  lifecycle errors.
- Parked rejections have explicit registration or generation ownership and
  obligation-scoped supersession, so detach and shutdown surface each cause at
  the narrowest truthful lifecycle boundary without clearing or blaming
  unrelated work.
- Operational obligations remain distinct from one-time cause reporting, so an
  overlapping startup can report a cause once while shared unresolved work
  remains parked, and later lifecycle cleanup cannot report that cause again.
- Disjoint rejected sibling work cannot strand an already-admitted startup
  obligation: only the unaffected startup scope receives one bounded admission,
  while rejected scope remains parked without spin.
- Server-owned registration exclusivity and serialized live-attachment close
  refusal prevent another server or direct environment close from shutting down
  facilities beneath an admitted registration, without adding public lifecycle
  configuration.
- Recovery wording distinguishes reusable generation retirement from permanent
  environment/facility close and does not promise access after owned storage
  lifetime ends.
- The implementation order keeps the internal bounded-progress contract small
  and independently reviewable before environment lifecycle wiring consumes it;
  neither successor absorbs retry timing or public policy.
- T-0035 changes no runtime behavior. Until the successor lands, runs remain
  explicitly started one-shot operations with no automatic restart guarantee.

Active outcome clarification (2026-07-13): integrated T-0037d/e1/e2 ownership
evidence supersedes D-0085's former assignment of current-generation retirement
to zero-registration permanent close. Successful last detach already retires
and clears its generation; unsafe last detach and incomplete reusable stop retain
live registrations and their exact operation owners; failed-start rollback is
the only legal zero-registration/current-generation state and remains owned by
T-0037d until its explicit retry retires and clears that generation. Therefore
T-0037e3 admits permanent close only when serialization observes zero
registrations and no generation. It refuses every recognized retained owner and
treats any otherwise orphan generation as an invariant failure before mutation.
The accepted stop-before-await-before-classify-before-consume/report-before-
retire/cleanup order, quiescence retention, safe slot clearing, and cause-once
rules remain unchanged inside those predecessor owners. T-0037e3 adds no
generation-retirement caller; after its short owner-free permanent-admission
phase releases the lifecycle serial gate, the existing coalesced public close
attempt performs ordered owned-facility teardown outside that gate. Public
`ServerEnvironment.close()` behavior and all public exclusions remain unchanged.

Final implementation outcome (2026-07-14): T-0036 supplied the bounded
package-internal delivery evidence; T-0037a, T-0037b, T-0037c, T-0037d,
T-0037e1, T-0037e2, T-0037e3, and T-0037f integrated the environment-owned
readiness, recovery, detach, reuse, permanent-close, and server lifecycle in
that order. T-0038b then integrated same-host context transport composition
into the established server ordering. These outcomes add no public scheduler,
monitor, retry-timing, topology, adapter, or supervision policy.

## D-0086: Sequence Environment Delivery Lifecycle In Eight Children

Status: Accepted

Date: 2026-07-12

Task: `T-0037`

Context: D-0085 deliberately combined the complete environment-owned delivery
lifecycle so ownership, readiness, rejection handling, registration rollback,
generation retirement, and shutdown ordering would have one coherent semantic
contract. T-0036 has implemented and verified only D-0085's package-internal
finite-epoch and per-shard evidence prerequisite. The remaining successor is
too large for one careful implementation and four-lane review package: it
crosses context handoff, delivery coordination, bounded operational records,
environment registration, generation close, and server network lifecycle.

Current code facts constrain the sequence. `ServerEnvironment.delivery` is
only an optional closeable facility. Repository handoffs construct short-lived,
tenant-specific `Delivery` instances after persistence and immediately
exact-drain the received row. Built contexts retain the storage factory they
actually used behind `boundedContextAccess`, including a builder-selected
factory that differs from the environment default. `TenantIndex.all()` can
enumerate a multitenant context's recorded tenants, but startup does not use it
to assemble delivery work. `RunningHttp2Server.close()` currently stops network
intake and then closes one flat ordered closeable group; it has no delivery
registration barrier. T-0036 evidence and its verified behavior remain
unchanged and explicitly invoked.

Decision:

- Split D-0085's T-0037 successor into eight ordered implementation children:
  `T-0037a Context Delivery Attachment Seam`, `T-0037b Bounded Generation Run
Coordinator`, `T-0037c Parked Delivery Obligations`, `T-0037d Environment
Attachment And Startup`, `T-0037e1 Registration Detach Lifecycle`, `T-0037e2
Reusable Generation Stop`, `T-0037e3 Permanent Environment Close`, and
  `T-0037f Server Lifecycle Integration`. The former T-0037e brief is a
  superseded split-parent audit record and must not be implemented.
- The invariant map is exclusive. T-0037a owns package-internal built-context
  delivery descriptors, actual storage-factory access, startup tenant
  enumeration, endpoint/shard attachment facts, and per-successful-row
  post-persist readiness emission through a synchronous non-throwing internal
  notification seam. T-0037b owns serialized bounded generation runs, lossless
  bounded canonical-scope coalescing, T-0036 evidence
  interpretation, and the reusable authoritative coordinator-instance
  stop/await/retire primitive, including the fail-closed stopped/quiescent
  postcondition while preserving classify/consume/report-before-retirement
  order. T-0037c owns finite canonical operational
  obligation and cause-reporting records. T-0037d owns environment
  registration cardinality, attachment, startup recovery, and failed-start
  rollback, including invoking T-0037b's primitive and clearing/replacing the
  empty generation slot through a finally-equivalent path after sole/first-
  registration rollback when quiescence is established, even if reporting or
  retirement cleanup fails, so a caller-owned environment remains reusable.
  It must retain the slot and prohibit replacement if quiescence is not
  established. T-0037d independently owns explicit retry of that same caller-
  owned failed-start rollback: the failed attempt retains endpoint dependencies
  and performs no later authoritative phase, while retry does not repeat
  admission closure or stop, proves quiescence, completes classification,
  eligible consumption/reporting, permanent retirement/cleanup, and slot
  clearing exactly once, then permits one later eligible fresh attachment
  without overlap. T-0037d owns this caller-owned failed-start rollback state
  machine and its same-operation retry. T-0037f owns deferred server-level
  cleanup around that seam for caller-owned and server-owned startup failure,
  preserving each mode's distinct environment and facility ownership.
  T-0037d also owns the atomic
  ownership barrier that closes new direct exact-drain admission, awaits every
  already-admitted direct exact drain in the attaching scope, gives persistence
  during route installation one bounded transition readiness buffer, transfers
  buffered scopes exactly once into installed environment readiness, and only
  then admits startup/environment work, so no durable row loses both owners,
  the two run owners never overlap, and later receives use readiness only.
  T-0037e1 owns registration detach. Non-last detach and retry remain
  registration-scoped and non-retiring. Ordinary last detach invokes T-0037b's
  existing primitive, clears a proven-quiescent retired slot through a finally-
  equivalent path despite reporting or inert cleanup error, retains an unsafe
  slot when quiescence fails, and retries that same operation before one later
  first attach may create a fresh generation. It also owns detach/attach races.
  T-0037e2 owns the sole package-internal reusable explicit-stop entry point;
  server/handoff code cannot call the primitive directly. It creates the sole
  transition-owned fresh candidate even without a racing attach. Its four
  distinct ordered phases are: (1) rebind surviving registrations and readiness
  routes with per-unit checkpoints; (2) transfer configured, startup, buffered,
  and retained canonical scopes exactly once into fresh pending admission with
  separate per-unit checkpoints; (3) publish the candidate; and (4) reopen
  later-write admission. Canonical scopes are transferred, never rebound. One
  bounded transition owner covers writes through fresh recovery and both first
  phases. Construction/rebind/transfer failure publishes no candidate, keeps
  admission closed, retains bounded state, and permits only later external retry.
  After construction, retry resumes the same candidate and completed per-unit
  progress after admitted candidate work settles; it never constructs another
  candidate or self-loops. A racing eligible attach waits and joins that
  candidate. Reporting-failure and post-consumption retirement-failure tests
  must each complete rebind, all-scope transfer, publication, and admission
  reopen before propagating the original error exactly once. T-0037e3 owns live-
  registration and retained-owner close refusal plus owner-free zero-
  registration/no-generation permanent admission. It adds no generation-
  retirement/quiescence caller. Its short serialized callback may cancel only an
  eager stop that is both unadmitted and not completed, then commits permanent
  admission and releases the gate before the coalesced public close attempt
  tears down every owned facility while remaining closed. T-0037f
  alone integrates those seams with listener startup, network shutdown, contexts,
  resources, and owned facilities. For caller-owned failed startup, T-0037f
  resumes T-0037d's retained rollback through quiescence and exact-once deferred
  server cleanup while leaving the shared environment open and proving one
  later eligible fresh server attachment without overlap; server-owned
  continuation remains separate. T-0037d does not own
  ordinary detach or race policy; T-0037e1/e2/e3 do not reopen failed-start
  rollback or coordinator-instance retirement.
- The five distinct deterministic same-operation generation-retirement retry
  owners are: caller-owned failed-start rollback in T-0037d; ordinary last
  detach in T-0037e1; reusable explicit stop in T-0037e2; and server-owned
  startup cleanup plus caller-owned server cleanup in T-0037f. Each keeps its
  own slot, dependency, environment, and facility ownership duties. T-0037e3 is
  explicitly not a generation-retirement retry owner. Non-last detach is a
  separate non-retiring registration-scoped retry in T-0037e1: it cannot stop or
  retire the shared generation or clear its slot.
- Each active child depends on the preceding active child and receives its own
  branch, implementation log, review log, TDD cycle, focused verification, and four
  required review lanes when implementation starts. Candidate briefs do not
  create those unstarted artifacts. T-0037 remains a sequencing parent and
  changes no runtime behavior itself.
- T-0037a is the first handoff. It must expose one small package-internal
  `boundedContextAccess` descriptor/readiness seam grounded in built-context
  state. It does not start a worker, attach an environment registration, or
  replace the current exact-drain behavior before T-0037d owns the transition.
- Every active child preserves D-0085 rather than redesigning it: one environment
  owner; finite one-shot T-0036 runs; readiness after every successful
  individual row persistence and never a rejected write; one lossless pending
  canonical-scope union bounded by current canonical tenant/configured scope
  cardinality, never trigger or repeated-notification count; per-shard
  rather than aggregate scheduling; no spin from fulfilled `FAILED`/`SKIPPED`
  or rejected starts; bounded parked state; ownership-scoped startup/cleanup;
  one reusable stop-before-await-before-classify-before-consume/report-before-
  retire/cleanup coordinator primitive with non-overlapping lifecycle callers
  and a quiescence-gated replacement postcondition; and network, endpoint,
  transport, and storage close ordering.
- JVM evidence is adopted narrowly: delivery ownership belongs at environment
  level and local post-persist notification may submit readiness. The TS
  implementation must not copy a process singleton, per-message threads,
  repeat callbacks, public `DeliveryMonitor` actions, a catch-up station, or
  global storage-factory copying.
- Retry delay/backoff/jitter/timers, public monitor/scheduler/health surfaces,
  process supervision, transport topology/adapters, `CATCH_UP` as a trigger or
  delivery path, legacy `IMPORT_EVENT` support, and changes to T-0034 or T-0036
  remain outside all eight children.
- T-0037e3 may update README/TypeDoc only for behavior independently observable
  at its merge point, such as existing `ServerEnvironment.close()` behavior if
  publicly reachable without server detach. If the public close TSDoc ships, it
  must state that an in-use close rejects non-destructively and performs no
  owned-facility teardown, and the package README must carry matching observable
  wording. T-0037f alone documents caller-owned environment reuse after server
  detach and the full observable `Server`, `RunningServer`, and
  `ServerEnvironment` lifecycle. Public docs must not name or describe package-
  internal explicit generation stop.

Consequences:

- Review packages align with one ownership seam apiece while the complete
  D-0085 lifecycle remains ordered and traceable.
- The first child can prove context delivery facts and durable-write readiness
  without prematurely creating a second lifecycle owner.
- Later children consume stable predecessors instead of reopening loop/worker
  internals or combining server integration with obligation bookkeeping.
- This decision changes sequencing and durable documentation only. It does not
  claim any T-0037 child behavior is implemented.

Historical outcome clarification (2026-07-13; implementation status superseded
by the 2026-07-14 final outcome below): the eight-child sequence remains accepted,
but integrated ownership narrows the T-0037e3 child and supersedes its former
place in the generation-retirement retry-owner enumeration. T-0037d owns
failed-start generation retirement and retry, T-0037e1 owns last-detach
retirement and retry, and T-0037e2 owns reusable-stop retirement and retry;
T-0037f's then-pending accepted server-cleanup assignments remain outside this
clarification. T-0037e3 owns serialized live-registration/retained-owner refusal,
owner-free zero-registration/no-generation permanent admission, cancellation of
an eager stop queued behind that admission only while it is both unadmitted and
not completed, and the subsequent public close attempt's facility teardown. A
completed stop-first no-generation operation remains the normal owner of its
waiter settlement and is not cancelled. The admission/cancellation callback
completes and releases `EnvironmentAttachments.#serial` before
`RetryableCloseGroup.close()` starts, so a queued cancelled stop can run and
reject even while facility settlement is pending. This clarification preserves
D-0085 ordering in every generation owner and introduces no ninth child, public
surface, or new lifecycle decision.

Final implementation outcome (2026-07-14): all eight children are complete,
merged, and post-merge verified. Together with T-0036 they implement
D-0085's environment-owned bounded delivery lifecycle; integrated T-0038b
uses that completed lifecycle for same-host context transport composition.
The child sequence remains historical decomposition, not a public API or a
commitment to excluded policy.

## D-0087: Fence Subscription Activation With Persisted Ownership

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Context: T-0041 canonical review wave 4 proved that process-local removal
coordination cannot fence a second `SpineServices` instance sharing the same
durable subscription storage. Recovery currently CAS-deletes the inactive row
before remembering the subscription locally, so another instance can report a
successful cancellation while the winner retains an active process-local
stream. The same review also proved that arbitrary distinct unknown cancel IDs
create unbounded process-local removal operations and storage fan-out.

Decision:

- Keep the existing durable inactive-subscription representation compatible,
  and add package-private JSON-in-`Any` claim and cancellation-marker states.
  These are internal storage states, not public or generated Protobuf contracts.
  The shared record spec extracts the ID from all three states.
- Activation and recovery atomically CAS the exact inactive record to an exact
  persisted claim containing a unique owner token. The claim remains persisted
  for the process-local active stream's lifetime. A local record retains the
  exact claim value needed for later cleanup.
- Cancellation and terminal cleanup transition an exact owned claim, or an
  exact inactive record, to a cancellation marker and then conditionally remove
  that exact marker. Activation, recovery, and cancellation do not use
  unconditional deletion for lifecycle transitions.
- A cancellation that wins before activation returns success only after marker
  cleanup. Same-instance cancellation owns and removes its claim. A cancel that
  observes another instance's active claim returns `Code.Aborted` with
  `Subscription is active in another service instance.` because no cross-process
  channel can close that process-local stream truthfully.
- Same-ID cancels share one local removal operation. Two instances cancelling
  one inactive record may both succeed after absence is established. Missing-ID
  and confirmed-absent cancellation remain idempotent successes.
- Marker cleanup/storage failure returns `Code.Internal` with `Subscription
cancellation failed.` and leaves a marker when one was installed, so later
  activation remains fenced and a later cancellation can retry cleanup.
  Repeated concurrent changes use at most three state retries before
  `Code.Aborted` with `Subscription cancellation could not settle concurrent
storage changes.`
- Distinct non-local cancellation operations use a separate per-instance set
  bounded by `subscriptionLimit`. Same-ID work shares one slot. Overflow is
  rejected before any storage operation with `Code.ResourceExhausted` and
  `Subscription cancellation capacity is exhausted.` Known local cleanup keeps
  its normal subscription reservation until persistence settles and does not
  consume the unknown-cancellation pool.
- Recovery that observes a claim or cancellation marker never reserves,
  remembers, or attaches the subscription. It may conditionally clean a marker.
  Existing inactive records need no migration.

Consequences:

- A successful cancellation cannot coexist with an activation revived from the
  canceled persistent record. If remote activation already won, cancellation
  reports conflict instead of false success.
- Process crashes may leave an active claim without a live stream. Without a
  lease or cross-process liveness protocol, other instances cannot distinguish
  that stale claim from a live owner. Recovery remains blocked and remote
  cancellation remains `Aborted`; lease reclamation is a separate excluded
  feature.
- No public service, package export, `RecordStorage`, generated Protobuf,
  manifest, or lockfile change is introduced.

Clarification (2026-07-15): when an inactive-to-claim CAS reports an error,
the same storage handle reads once to reconcile it. Only byte-exact proposed
claims are adopted and continue activation; the exact prior inactive record
propagates the original error, while absent or changed valid states retain the
existing lost/canceled result. If the reconciliation read or decode fails, the
original CAS error is propagated but the exact local owner token and reservation
remain inert for same-instance `Cancel`; no attachment occurs. Foreign or stale
claims are never adopted.

## D-0088: Bound ZeroMQ Request Timeouts

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Decision: `ZeroMqTransportOptions.requestTimeoutMs` defaults to 2,000 when
omitted. Explicit values must be integers from 1 through 2,147,483,647; every
other value throws `TypeError: ZeroMQ transport requestTimeoutMs must be an
integer from 1 through 2147483647.` synchronously before filesystem or socket
work. This bounds request/reply send and receive waits only. `receiveTimeoutMs`
is unchanged, and no active cancellation of an already-sent request is added.

Consequences: callers cannot select zero, negative, fractional, non-finite, or
overflowing request timeouts that could permit an indefinitely blocked request
or close. The public type remains `number`; runtime validation is the contract.

## D-0089: Keep ZeroMQ Failure Observation Internal

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Context: Canonical review found that `ZeroMqTransportOptions` emits
`onBackgroundFailure` publicly even though its TSDoc and design treat it as an
adapter-private test/failure-observation hook. The initial release has no public
monitoring subsystem, while repository transport and cross-process tests still
need deterministic observation of background-loop failures.

Decision:

- The public `ZeroMqTransportOptions` contains exactly `requestTimeoutMs` and
  `receiveTimeoutMs`. Remove `onBackgroundFailure` from that interface rather
  than stabilizing or documenting a new public monitoring extension point.
- Preserve existing runtime failure observation, including swallowed observer
  exceptions, through a non-exported internal options extension. Repository
  tests may pass a locally typed structural value; no internal option type or
  observer is exported from `@spine-ts/transport/zeromq`.
- Keep the public factory signature and package export map unchanged. Add the
  existing published ZeroMQ subpath index as a distinct TypeDoc entry point and
  gate its exact six public names independently from the 17 root transport
  names. Explicitly reject the private observer from generated API metadata.
- Test-only liveness deadlines and cleanup bounds may prove request settlement
  before close completion. They do not introduce production timers,
  cancellation, monitoring, retry, or scheduler policy.

Consequences:

- This is an intentional pre-release source-contract correction with no runtime
  behavior removal for repository tests. Consumers receive a smaller truthful
  public options type and complete docs/export regression coverage for the
  already-published ZeroMQ subpath.
- Public logging callbacks, event emitters, health interfaces, and broader
  monitoring remain excluded. D-0087, D-0088, Protobuf contracts, dependencies,
  package entrypoints, and generated-output policy remain unchanged.

## D-0090: Bound Inactive Subscription TTLs

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Decision: `SpineServicesOptions.inactiveTtlMs` defaults to 30,000 milliseconds.
It preserves existing normalization: non-positive or non-finite values become
1; positive finite values are floored. After normalization, an effective value
above 2,147,483,647 throws synchronously before storage or timer work with
`TypeError: SpineServices inactiveTtlMs must not exceed 2147483647 milliseconds.`

Consequences: an accepted subscription has one absolute durable `expiresAtMs`
and one unref'ed expiry timer. Activation and cancellation still clear that
timer; recovery and expiry-cleanup failure retention remain unchanged. Expiry
cleanup failure has no automatic retry, and same-ID `Cancel` remains the
explicit retry path. No value capping, timer chunking, re-arming policy,
`queueLimit` behavior, or shared `positiveInteger()` behavior is introduced.

## D-0091: Bound Private Transport And Durable Record Bytes

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Decision:

- Every application-message-receiving ZeroMQ `Subscriber`, `Request`, and
  `Reply` socket sets the private native `maxMessageSize` option to 8,388,608
  bytes before any connect, bind, receive, send, or handler work. `Publisher`
  does not receive application messages and keeps its native
  `sendTimeout = -1`. No sender preflight or public transport option is added.
- Durable subscription JSON-in-`Any` state rejects `Any.value.byteLength`
  above 33,554,432 before UTF-8 decoding, JSON parsing, Base64 validation or
  expansion, and Protobuf decoding. The one guard applies to inactive, claim,
  cancellation-marker, and unknown internal stored type URLs because they
  converge on one JSON reader.
- The 8 MiB frame cap leaves more than 4 MiB headroom above current V8 envelope
  and accepted-reply encodings of a 4,194,304-byte Protobuf message. The 32 MiB
  durable cap covers current worst-case service-supported subscription
  encoding: 4,194,351 binary bytes, 5,592,468 Base64 bytes, and 30,758,240 JSON
  bytes with adversarial sixfold escaping, leaving 2,796,192 bytes headroom.

Consequences:

- No type URL, JSON property, Base64 representation, `Any`, Protobuf, storage
  interface, package export, or public option changes. Existing durable values
  at or below 32 MiB remain byte-for-byte compatible and need no migration.
  Values above 32 MiB become inert malformed state because they are outside the
  supported service-generated envelope.
- Oversized native frames are rejected by libzmq before V8 deserialization and
  handler invocation. Oversized durable values fail before parser/decoder work;
  existing malformed-row recovery/cancellation semantics keep them unchanged
  and fail closed while unrelated valid work continues.
- D-0087 through D-0090 remain unchanged. Deployment continues to own ingress,
  rate limits, same-host process isolation, and persistence-adapter integrity.

Clarification (2026-07-15): `maxMessageSize` is a per-ZeroMQ-frame limit. It
rejects an oversized individual frame before that frame's payload allocation,
but does not limit multipart frame count or aggregate multipart bytes and must
not be cited as an aggregate bound.

## D-0092: Reject Single-Frame Encoding As A Native Multipart Bound

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Context: SF-013 established that zeromq.js 6.5.0 materializes every part of an
inbound multipart ZeroMQ message as `Buffer[]` before returning from
`receive()`. Consolidating valid publish and request traffic into one frame
would bound each conforming message, but a peer could still append arbitrarily
many individually bounded or empty frames. JavaScript exact-one-frame
validation would run only after the complete multipart message had been
allocated. Delimiter-free route concatenation is also unsafe because canonical
routing keys are not prefix-free; a NUL delimiter removes that ambiguity but
does not remove the allocation bypass.

Decision:

- Do not adopt single-frame encoding as the SF-013 correction and do not
  describe `maxMessageSize` as an aggregate inbound-message bound.
- Preserve D-0088 and D-0091, including Publisher `sendTimeout = -1`, while
  applying D-0091's native limit only as a per-frame control.
- T-0041 remains release-blocked until the receiving implementation rejects an
  inbound part before allocation when either the permitted frame count or
  aggregate byte count would be exceeded. Subscriber and Reply require at most
  two parts and Request at most one; every inbound application message has an
  8,388,608-byte aggregate maximum.
- JavaScript exact-frame validation may be added as defense in depth, but is not
  native/V8 allocation prevention and cannot close SF-013.
- Without a native or replacement-binding control, the unbounded same-host DoS
  residual requires explicit human risk acceptance.

Consequences:

- No public/package/Proto/storage contract changes are accepted by this
  decision. Existing valid wire traffic and deployment responsibilities remain
  unchanged.
- Native dependency selection must account for cross-platform prebuilds,
  lockfile/install-script provenance, continuation after peer rejection, and
  focused SF-013 security review.

## D-0093: Use Protobuf Wire Encoding And Accept Multipart Trailer Risk

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Context: The SF-013 investigation established two separate facts. First,
`maxMessageSize = 8_388_608` is a maximum accepted size for each inbound frame;
it does not reserve or allocate 8 MiB for every ordinary frame. A small routing
key and small signal therefore retain their actual small buffer sizes. Second,
zeromq.js 6.5.0 materializes the complete multipart message before JavaScript
can ignore trailers, so consuming only the protocol prefix does not prevent a
peer from forcing native allocation with arbitrarily many individually valid
frames.

The human explicitly challenged the prior design and then selected the release
policy in these terms:

- "The 8MiB size just to send signals is bullshit. They are typically tiny."
- "Buf's implementation has Proto-compatible serialization mechanism. I don't
  understand why we don't use that, but use some generic V8 stuff. This is also
  not OK to me."
- "Use Buf's serialization, not V8's when dealing with Proto messages."
- "Keep 8 MiB as a hard upper limit."
- "Take only two first frames from the payload. Ignore the rest."
- "On this stage I don't care if someone breaks into our ZeroMQ server and
  feeds a lot of junk to it."

Decision:

- Protobuf signal messages crossing the ZeroMQ adapter use the generated Buf
  Protobuf schemas and binary encoding. Node V8 serialization must not encode
  or decode those Protobuf messages.
- Preserve `8_388_608` bytes as the hard inbound limit for each ZeroMQ frame.
  This is a rejection ceiling, not an expected frame size or a fixed per-send
  allocation.
- Preserve routing plus serialized signal as the normal two-frame publish and
  request wire shape. Receivers consume only the protocol-defined prefix,
  never more than the first two frames. A reply that defines one meaningful
  frame consumes that frame. Any later multipart frames are ignored.
- Accept SF-013 for the initial release: a process able to connect to the
  private same-host IPC endpoint can append unlimited individually bounded
  frames, and zeromq.js may allocate them before application code ignores them.
  Do not build or fork a native receive path for this release.
- After the framework, documentation, user guide, example, and release closure
  are complete, perform a separate Internet review of known ZeroMQ/libzmq and
  zeromq.js multipart-allocation issues and discussions. Report whether SF-013
  is already known, available workarounds, upstream proposals, and whether the
  project appears to have found a previously undocumented limitation.

Reasoning:

- Schema-aware Buf binary encoding preserves the actual Protobuf wire contract,
  avoids a Node/V8-specific object serialization layer, and makes payload size
  and compatibility reasoning correspond to generated message schemas.
- Eight MiB remains a conservative hard ceiling while ordinary signals retain
  their actual typically small allocations. The ceiling does not imply two
  8 MiB allocations per dispatch.
- Ignoring trailers gives deterministic application semantics for the accepted
  two-frame protocol. It does not mitigate native multipart allocation; that
  distinction remains explicit rather than being claimed as a security control.
- The remaining attack requires access to the private same-host IPC endpoint.
  The human accepts that availability risk at this stage and prefers completing
  the framework over introducing a native dependency fork or replacement.

Consequences:

- D-0092 remains technically accurate about zeromq.js allocation behavior, but
  its release-blocking disposition is superseded by this explicit human risk
  acceptance.
- T-0041 must implement and test Buf encoding for Protobuf signal envelopes,
  preserve the per-frame cap, and characterize prefix-only trailer handling.
- Because the change concerns a serialized boundary and may affect the public
  adapter-neutral transport contract, a bounded architecture split must first
  select the smallest compatible ownership seam and exact tests. It must not
  broaden the public API unnecessarily.
- SF-013 remains documented as an accepted Medium same-UID local availability
  residual. It is not described as fixed, bounded in aggregate, or prevented by
  ignoring trailers.
- The post-completion Internet review is a required follow-up, but it does not
  block initial project completion or T-0041 security acceptance.

Post-completion follow-up (2026-07-15): T-0043 records the public-source
research in
[`ZEROMQ_MULTIPART_LIMIT_RESEARCH.md`](research/ZEROMQ_MULTIPART_LIMIT_RESEARCH.md).
The evidence confirms that whole-multipart atomic/memory behavior is known and
documented, but the exact combination of a per-frame-only `MAXMSGSIZE`, no
aggregate frame/byte cap, and zeromq.js pre-JavaScript `Buffer[]`
materialization appears not to have a dedicated public upstream report in the
bounded search. That is a calibrated search result, not proof that Spine TS was
first. D-0093's wire policy and accepted release risk remain unchanged.

## D-0094: Correlate Transport Kinds With Protobuf Envelopes

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Context: D-0093 made ZeroMQ `command` and `event` frames concrete Buf binary,
but the adapter-neutral TypeScript contract still allowed callers to choose an
unrelated generic envelope for either kind. The concrete adapter cast that
generic to `Command` or `Event`, so the public type promised values the runtime
would not preserve. Canonical TypeScript/API review correctly rejected that
false promise. The same review found that manual `$typeName` detection for
successful replies was undocumented and appeared to reject arbitrary objects.

Decision:

- Add public conditional type `TransportSignalEnvelope<Kind, OtherEnvelope>`.
  It resolves `command` to generated `Command`, `event` to generated `Event`,
  and preserves `OtherEnvelope` for `query`, `subscription`, and `system`.
- Apply that conditional to publish/request operations and their handlers while
  preserving existing generic parameter order. Correct command/event uses stay
  source-compatible; incorrect arbitrary command/event envelopes become compile
  errors.
- Export `TransportSignalEnvelope` from the transport root. This is one
  intentional public type correction; the root export count becomes 18 and the
  ZeroMQ subpath remains 6. No codec option, schema registry, or public socket
  concept is introduced.
- Replace the manual reply-shape check with Buf's official `isMessage(value)`
  predicate without a schema argument. The ZeroMQ private reply wrapper rejects
  every generated-message-shaped successful reply instead of V8-serializing it.
  Do not introduce or special-case `Ack`.
- For this ZeroMQ reply seam, an object with a string `$typeName` is reserved as
  a Buf generated-message shape. Document that adapter behavior. A caller that
  needs a plain private result must not use the reserved generated-message
  discriminator.

Reasoning:

- Correlating kinds and envelopes makes TypeScript describe the actual wire and
  handler values; moving tests to another kind cannot substitute for an honest
  public contract.
- The conditional type preserves caller-selected values for kinds that have no
  Proto contract and avoids a larger codec-registration abstraction.
- Buf 2.12.1 implements `isMessage(value)` using the generated-message
  `$typeName` convention. Schema-specific checks for only `Command` and `Event`
  would permit another Proto message such as `Ack` to fall through to V8,
  contradicting D-0093 and the human's explicit no-V8-for-Proto rule.
- Reserving the discriminator on this private reply seam is smaller and more
  honest than inventing a public reply Proto or pretending arbitrary generated
  schemas can be encoded without their descriptors.

Consequences:

- Add compile-time coverage for command/event correlation, non-Proto generic
  preservation, generated-message acceptance, and plain-object rejection.
- Correct stale test generic kinds, assert the exact malformed-command failure,
  and prove the responder continues after rejected Proto reply values.
- Public wire docs state exact frame positions, per-frame ceiling versus actual
  allocation, private non-`Ack` replies, the reserved `$typeName` reply shape,
  mixed-version incompatibility, and the accepted aggregate residual.
- All four canonical lanes re-review the correction before focused final
  security review. D-0093's wire, cap, framing, and risk acceptance remain
  unchanged.

## D-0095: Narrow Transport Unions Through The Canonical Topic Kind

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Context: D-0094's distributive operation aliases reject invalid widened or
union topic/envelope pairs. TypeScript does not, however, propagate a check of
the nested `operation.topic.signalKind` discriminator to the outer operation
union. A valid widened handler therefore cannot recover the promised concrete
envelope type, and a widened topic is similarly awkward to consume.

Decision:

- Add public overloaded predicate `hasTransportSignalKind()` for transport
  operations and topics. It compares only the canonical
  `topic.signalKind` value and narrows the complete operation or topic to the
  selected kind.
- Keep operation object shapes, topic shapes, method generic order, and runtime
  wire behavior unchanged. The helper adds one root export, taking the
  transport root count from 18 to 19; the ZeroMQ subpath remains 6.
- Treat the predicate as a typed narrowing aid, not as validation of untrusted
  input or envelope content. It must not inspect or mutate the envelope.
- Mechanically prove the proposed generic `Extract` predicate with the project
  TypeScript version before acceptance. If it cannot narrow publish, request,
  and widened-topic cases as specified, return to architecture instead of
  adding duplicated state or reshaping the public contract.

Reasoning:

- A top-level operation `signalKind` would make native switch narrowing easy,
  but duplicates `topic.signalKind`, makes all existing operation literals
  source-incompatible, creates mismatch states, and requires runtime consistency
  validation.
- Making `TransportTopic` distributive does not solve nested-discriminant
  narrowing for the outer operation. Flattening the operation would cause
  broader public and adapter churn.
- An additive predicate preserves existing construction and inference while
  giving callers an explicit, standard TypeScript narrowing mechanism backed
  by the one canonical runtime kind.

Consequences:

- Add compile-time tests for command/event and reserved-kind operation
  narrowing, restricted-kind rejection, widened-topic/routing narrowing, and
  preservation of all invalid-pair regressions.
- Add small runtime tests proving true/false comparison through the canonical
  topic kind without envelope inspection or mutation.
- Document the helper and update exact TypeDoc/API export checks to 19/6. Do not
  commit generated documentation or declarations.
- Re-review style/maintainability, documentation, and TypeScript/API. Runtime
  performance/reliability remains unaffected; focused final security confirms
  the helper is not represented as input validation and that D-0093 remains
  unchanged.

## D-0096: Separate Transport Operation And Topic Kind Predicates

Status: Accepted

Date: 2026-07-15

Task: `T-0041`

Supersedes: D-0095's single overloaded-helper decision only. D-0094's
distributive kind/envelope correlation remains accepted.

Context: Repeated TypeScript/API review showed that one overloaded predicate
must choose a runtime path from overlapping structural shapes. Optional-`never`
exclusions reject known intersections but open/string-index types can erase
those negative constraints and restore false predicate guarantees. Exact-object
typing is not available for this public structural contract.

Decision:

- Remove unmerged `hasTransportSignalKind()` without a deprecated alias.
- Add `isTransportOperationKind()`, which always compares
  `operation.topic.signalKind`, and `isTransportTopicKind()`, which always
  compares `topic.signalKind`.
- Each predicate narrows only what its fixed path establishes. The operation
  predicate narrows the correlated operation union; the topic predicate narrows
  only top-level `topic.signalKind` and does not validate or narrow
  `topic.routing.signalKind`.
- Preserve every operation/topic shape and `SignalTransport` generic order.
  Both names satisfy the four-component public-name limit.
- Keep the predicates as typed narrowing aids, not validators of untrusted
  values or envelopes. Neither predicate inspects the envelope.
- Transport root exports become 20; ZeroMQ remains 6.

Reasoning:

- Function identity now selects the runtime path. Extra properties, open index
  signatures, and dual-shaped values cannot redirect either implementation.
- A single helper with `keyof` or negative-key exclusions remains unsound after
  widening to key-erasing structural supertypes. `NoInfer` controls inference;
  it does not create exact object types.
- Keeping only an operation helper leaves widened topics unresolved, while
  removing both helpers forces duplicated custom guards or casts throughout
  consumers.

Consequences:

- Compile and runtime tests cover widened/restricted publish, request, and topic
  inputs; open/index-signature types; dual-shaped values; invalid pair
  preservation; fixed runtime paths; zero envelope access; and an intentionally
  inconsistent widened topic proving unobserved routing remains widened.
- Remove optional-`never`, shape classification, collision precedence, and
  collision rejection from the D-0095 implementation. Update active API and
  release inventory counts from 19 to 20.
- Public helper runtime code changes. ZeroMQ, adapter, server, wire, frame,
  allocation, concurrency, lifecycle, and accepted SF-013 behavior do not.
- Re-review style/maintainability, documentation, and TypeScript/API.
  Performance/reliability remains N/A for stateless equality predicates.

## D-0097: Use Risk-Tiered Convergent Task Review

Status: Accepted

Date: 2026-07-21

Task: `T-0050`

Context: Recent tasks showed that mandatory four-lane review, comment-free
re-review, repeated skill discovery, strict child self-introspection metadata,
record-only corrections, and duplicate branch/post-merge full gates consumed
substantial time after substantive behavior had stabilized. The build protocol
already called for relevant lanes, but `CODE_QUALITY.md` contradicted it by
requiring all four reviewers for every task.

Decision:

- Classify tasks as micro, standard, or high-risk before selecting planning,
  ownership, review, logging, and verification depth.
- Preserve every existing project role. Invoke only specialist concerns
  affected by changed behavior or public claims; deterministic rules remain an
  orchestrator-dispatched mechanical function.
- Collect complete review waves, classify findings P0 through P3, apply one
  aggregated correction batch, and reopen only substantively affected lanes.
  Run at most two complete waves without waiving unresolved P0/P1 risk.
- Require explicit model/reasoning dispatch. Accept immutable configured role
  metadata when child self-introspection is unavailable; redispatch only an
  omitted field, wrong role, visible mismatch, or actual inherited fallback.
- Perform skill discovery once per stable task/role context while still
  requiring each role to read every selected governing skill.
- Run full verification once for runtime, test, contract, generated,
  dependency, or shared-build changes. Use focused deterministic gates for
  micro/documentation-only work and avoid duplicate post-merge full gates when
  the verified and merged trees are identical and no integration risk applies.
- Update records only at meaningful resumability boundaries. Micro tasks use a
  single concise record; record-only corrections do not trigger specialist
  review or self-referential closure commits.

Reasoning:

- Review depth should follow failure impact rather than file category alone.
- Existing specialist roles retain stronger domain judgment where it matters,
  while deterministic tools provide faster and more reproducible mechanical
  evidence.
- Reusing implementation context and aggregating findings avoids rediscovery
  and prevents one review cycle per isolated comment.
- Tree equality is stronger evidence than repeating a full coverage run solely
  because integration added a merge parent.

Consequences:

- Micro and documentation-only tasks complete substantially faster.
- Persistence, concurrency, lifecycle, contract, security, and other high-risk
  work retains deep planning, focused regressions, relevant Terra High review,
  and full verification.
- Every canonical concern still has a durable clean, accepted, or concrete N/A
  disposition. P0/P1 findings always block acceptance, and accepted P2 findings
  must be resolved.
- Final release-wide security review, worktree safety, and remote
  synchronization remain unchanged.

## D-0098: Use Direct mysql2 with an Explicit External-URL Acceptance Harness

Status: Accepted

Date: 2026-07-21

Task: `T-0051`, Packet 1

Decision:

- Add `mysql2@3.23.1` as the sole runtime database dependency for
  `@spine-ts/storage-rdbms`. Use its Promise pool and bound parameters behind
  private adapter code; its pool, connection, SQL, and type surface are not
  package-root exports.
- Keep public configuration driver-neutral: an explicit MySQL URL, bounded pool
  limits, and optional CA/certificate/key/reject-unauthorized TLS material.
  URL query/hash parameters are rejected rather than silently treated as driver
  configuration.
- Do not add Kysely or another query builder. Kysely `0.29.4` supports MySQL
  and PostgreSQL, but Packet 1 has a fixed normalized schema and dynamic SQL
  construction would be private/closed; its public type value would not offset
  a second abstraction and dependency. Reconsider only when a second concrete
  adapter proves a shared private compiler seam.
- Support MySQL `8.4` as the initial production/LTS floor. The recorded
  acceptance image is the Docker Official Image `mysql:8.4.10`, digest
  `sha256:c592c15aaf4a1961e15d82eb31ea5987dda862d1c4b1e93424438c0e91dc1f8d`.
- Use an explicit `SPINE_TS_MYSQL_URL` opt-in test harness. It neither starts
  Docker nor falls back to a fake or another URL. It creates and removes only
  the two fixed test tables in the supplied disposable database.

Evidence and consequences:

- Current npm registry metadata records mysql2 `3.23.1` as stable, with Node
  `>=8`, Promise/pool support, prepared statements, and bundled TypeScript
  declarations. The workspace requires Node `>=24`.
- MySQL's official lifecycle information identifies 8.4 as an LTS,
  production-grade series. The direct driver keeps pool ownership, DDL,
  InnoDB checks, binary comparison, and later transaction invariants local to
  one module instead of leaking a speculative generic SQL seam.
- The harness is real acceptance evidence only for its supplied MySQL/image
  combination. It is intentionally not a Testcontainers dependency: Docker
  daemon availability is environmental, and silent container startup/fallback
  would weaken credential and lifecycle ownership boundaries.

## D-0099: Stage JVM Feature Parity In Four Human-Gated Waves

Status: Accepted

Date: 2026-07-22

Task: `T-0052`

Decision:

- Implement the first parity wave against frozen `core-java` commit
  `a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b` and `delivery-server` commit
  `21f2901f393e552208b97166f4eaeb942f9f5172`, adapting observable behavior and
  supported extension points idiomatically rather than copying JVM internals.
- Wave 1 replaces `updateDraftState()` with `update()` and `tryUpdate()`, adds a
  Node `@spine-ts/client`, makes `BlackBox` the end-user testing API, completes
  Projection column/Query parity, implements JVM-equivalent `Environment` and
  singleton `ServerEnvironment`, and completes the approved `Delivery`
  behavior and multi-machine topology.
- Add `@spine-ts/delivery-client` and an in-memory Node
  `@spine-ts/delivery-server` that ports only upstream `simple-server`,
  including Inbox, Shard, Health, stale-session/config behavior, and the
  machine-facing Admin service/shard-status stream. Shared Protobuf contracts
  belong to `@spine-ts/proto`.
- Do not provide deprecation aliases. No real-world Spine TS usage requires a
  compatibility cycle, and the accepted public model replaces explicit
  per-server environment injection with `ServerEnvironment.instance()`.
- Defer recent state/event history and high-level Aggregate/Process Manager
  queries to Wave 2; packaging and live TS/JVM compatibility execution to Wave
  3; and human-facing browser/TUI administration to Wave 4. Each later wave
  requires a separate Q&A and approved plan.
- Exclude Redis, Hazelcast, every delivery-server module outside
  `simple-server`, and all human admin interfaces from Wave 1. Perform one
  relevant upstream-delta audit before Wave 1 closure.

Reasoning:

- The chosen order resolves missing end-user and runtime foundations before
  recent-history storage changes and deployment packaging depend on them.
- A standalone in-memory simple server proves the distributed protocol and
  lifecycle without prematurely coupling delivery coordination to a storage
  adapter or copying deployment-specific JVM modules.
- Human gates between waves keep active JVM changes, packaging topology, and
  administration UX from being decided speculatively.

Consequences:

- T-0052 must produce a frozen-source parity matrix and dependency-ordered
  task packets before Wave 1 implementation can start.
- Wave 1 may prove descriptor parity and real TS-client-to-TS-server gRPC
  behavior, but it must not claim live cross-runtime compatibility until the
  Wave 3 tests run.
- Existing low-level Aggregate and Process Manager ID queries remain; their
  new high-level Query/column guarantees are intentionally absent until Wave 2.

## D-0100: Match JVM Recent-History Semantics In Wave 2

Status: Accepted

Date: 2026-07-24

Task: Wave 2 planning

Decision:

- Add recent state history to Projection, Aggregate, and Process Manager
  repositories. Recording is opt-in and off by default for every entity kind.
- Add recent event history to Aggregates and Process Managers. Aggregate event
  history is always recorded; Process Manager event history is opt-in and off
  by default. Rejection events are not recorded.
- Expose history through the entity and repository facilities corresponding to
  Spine JVM. Do not invent a remote history-query service. High-level client
  queries continue to return current entity state.
- Use idiomatic asynchronous TypeScript entity APIs corresponding to
  `stateAt(time)`, `stateHistoryBackward(depth)`,
  `eventHistoryBackward(depth)`, and
  `eventHistoryContains(depth, predicate)`. Returned history collections are
  immutable and newest first.
- Preserve JVM visibility: the current unfinished dispatch is excluded, while
  earlier completed dispatches in the same delivery batch are immediately
  visible.
- Implement the JVM runtime enable/disable behavior for state-history
  recording. Document prominently that the facility is not designed as a
  routine runtime control and should normally be configured when constructing
  the repository.
- Retain history until the application performs explicit maintenance. Provide
  JVM-equivalent per-entity `trim(entityId, keepMostRecent)` and global
  `truncate(olderThan)` operations consistently across in-memory, Datastore,
  and RDBMS storage.
- Include the opt-in double-dispatch guard with configurable inspection depth.
  Process Managers require event-history recording when the guard is enabled.
- Generalize the Projection-specific column and Query DSL into an entity Query
  DSL covering Projections, Aggregates, and Process Managers. Remove
  Projection-specific public query/column terminology rather than retaining
  deprecated aliases.
- Storage contracts, persisted layouts, public APIs, examples, and tests may
  change atomically without migration or backward-compatibility machinery.
- Replace TS Aggregate snapshot and stored-event reconstruction with the common
  latest-state entity-record model used by Projection and Process Manager.
  Aggregate emitted events remain in a separate diagnostic/recent journal and
  are never a state-reconstruction source.
- State history is appended after every successful logical store, without a
  cross-storage atomicity guarantee. Immediate latest-state persistence may
  precede history; batched history may precede the deferred latest-state
  flush; partial failures do not roll back already-written rows.

Reasoning:

- These choices preserve current Spine JVM behavior and concepts while adapting
  storage access to asynchronous Node APIs.
- Entity-local history is distinct from the client Query service. Conflating
  the two would introduce a remote product surface that does not exist in Spine
  JVM and was not requested.
- Explicit maintenance keeps retention policy in the application domain and
  avoids hidden dispatch-path queries or speculative limits.
- There are no real-world Spine TS deployments requiring a deprecation or data
  migration cycle.

Consequences:

- Wave 2 planning must cover the shared entity-history model, every supported
  storage adapter, repository configuration and maintenance, Aggregate and
  Process Manager event journals, the double-dispatch guard, the generalized
  Query DSL, generated columns, client/server query execution, documentation,
  and behavior-focused tests.
- Live TS/JVM compatibility execution remains deferred to Wave 3. Wave 2 uses
  source and descriptor analysis rather than claiming cross-runtime evidence.
- Delivery/inbox replay remains independent and must not be removed with
  Aggregate reconstruction replay.

## D-0101: Publish Every Spine TS Package Under `@spine-event-engine`

Status: Accepted

Date: 2026-07-24

Task: Wave 2 planning

Decision:

- Rename every Spine TS workspace package from `@spine-ts/<name>` to
  `@spine-event-engine/<name>`.
- Update package manifests, workspace dependencies, TypeScript and generated
  imports, examples, scripts, documentation, API inventories, and validation
  gates atomically. Do not retain `@spine-ts/*` compatibility packages or
  aliases.
- Keep pnpm as the repository package manager. “NPM group” in this decision
  means the published package scope, not a switch from pnpm to the npm CLI.

Reasoning:

- All Spine framework packages should use the organization-wide
  `@spine-event-engine` publication namespace.
- With no real-world consumers, a single atomic rename is clearer and cheaper
  than maintaining two scopes or a deprecation bridge.

Consequences:

- The rename is a Wave 2 prerequisite because new history/query packages,
  imports, and documentation must not introduce additional `@spine-ts/*`
  references.
- Verification must mechanically reject remaining live `@spine-ts/`
  references while allowing historical build-protocol evidence to remain
  unchanged where rewriting it would falsify repository history.

## D-0102: Make Protobuf Model Packages Independently Composable

Status: Accepted

Date: 2026-07-26

Task: Wave 3 planning

Decision:

- Model each Bounded Context in an independently publishable npm package by
  default; small applications may combine models without changing the
  contract.
- A model package owns canonical `.proto` sources and ships those sources,
  generated ESM/declarations, a versioned `spine-proto-manifest.json`, and a
  generated `ProtoModule`. Canonical Proto imports use Proto file paths, never
  npm package names.
- Add `@spine-event-engine/proto-tools` with the `spine-proto` executable.
  Keep runtime schema/module types with `@spine-event-engine/proto`; keep
  registry composition and `Any` decoding with `@spine-event-engine/core`.
- Resolve explicitly declared model dependencies from installed manifests and
  shipped Proto sources, generate only owned messages, and link generated
  dependency imports to manifest-declared npm export subpaths.
- Each `ProtoModule` lists its own schemas and direct dependencies.
  `TypeRegistry.from(...modules)` traverses dependencies, deduplicates module
  identity, and rejects conflicting type names, type URLs, or module
  definitions.
- Applications list top-level model packages in one explicit
  `spine-proto.json`. `spine-proto compose` generates the application registry;
  there is no runtime package scanning or mutable global registration.
- Keep schema-directed `packAny()` and `unpackAny()`. Add
  `unpackAnyUsing(registry, packed)` for dynamic decoding; unknown type URLs
  and malformed bytes return `undefined`.
- Reject duplicate Proto paths/type names/type URLs, undeclared or incompatible
  dependencies, cycles, path/symlink escapes, and missing import ownership
  before replacing generated output.
- Do not publish to npm in Wave 3. Acceptance uses registry-equivalent tarballs
  and fresh repositories to prove cross-model imports, transitive dynamic
  decoding, and the absence of hidden `workspace:`/`file:` dependencies.

Reasoning:

- Package-local ownership mirrors JVM model JARs with ordinary npm dependency
  semantics. Explicit manifests supply the missing Proto-import ownership map
  without requiring this monorepo or a hosted Buf registry.
- A build-time tooling package avoids adding compiler/linker dependencies to
  runtime applications. Explicit structural module values keep composition
  deterministic and easy to inspect.

Consequences:

- Replace hard-coded example generation and dependency duplication with the
  shared workflow.
- Spine-native Proto sources and generated exports must satisfy the same
  manifest/module contract used by external model packages.
- Every maintained example migrates. The new Chat example proves two
  app-owned model packages and a cross-package Proto import.
- Browser interoperability, deployment packaging, and cluster-complete
  subscriptions remain Waves 4, 5, and 6.

## D-0103: Split Browser, Node, And React Client Responsibilities

Status: Accepted

Date: 2026-07-27

Task: Wave 4 planning / `T-0074`

Decision:

- Transform the current `@spine-event-engine/client` implementation into
  `@spine-event-engine/client-node`; do not discard and reimplement it.
- Add framework-neutral `@spine-event-engine/client-web` and separate
  `@spine-event-engine/client-react`. React remains a peer dependency of the
  adapter and does not enter the browser client's generic API or declarations.
- Do not publish a third `client-core` package. Share transport-neutral
  implementation internally. Keep Node-only Entity column code generation with
  `client-node`.
- Use gRPC-Web as the required universal browser protocol and Connect as an
  explicit optional optimization. Do not probe or silently fall back.
- Preserve Spine protocol verbs: post commands, send queries, create/activate/
  cancel subscriptions. Reserve `use...` for React-specific hooks that observe
  request or subscription state.
- Support current Chromium, Firefox, and WebKit. Do not claim Wave 4 support
  for legacy browsers, SSR, service workers, edge-worker runtimes, Suspense,
  normalized caches, or external state managers.

Reasoning:

- Separate transport clients preserve runtime boundaries, while a separate
  React package keeps generic browser consumers free of framework dependencies.
- Explicit protocol and domain verbs avoid hidden network behavior and preserve
  the Command/Query/Subscription service model.

Consequences:

- The browser and React packages require real-browser tests.
- The continuing Chat example uses React through `client-react`.
- No other JavaScript framework adapter is part of Wave 4.

## D-0104: Treat Subscriptions As Best-Effort Notifications

Status: Accepted; supersedes the earlier Wave 6 cluster-complete guarantee

Date: 2026-07-27

Task: Wave 4 planning / `T-0074`

Decision:

- Subscription updates are live notifications, not authoritative state.
- Promise no completeness, exactly-once delivery, global ordering, or complete
  intermediate Entity state history. Duplicates and missing updates are
  possible.
- Perform bounded automatic reconnect with separate visible lifecycle states.
  Re-send an authoritative Entity query after reconnect. Notify
  `gapPossible` and continue event subscriptions by default.
- Never retry commands automatically.
- If a framework-owned buffer overflows, terminate the stream instead of
  knowingly discarding buffered updates while reporting it healthy.
- Preserve subscriptions to explicitly exposed event types. Chat messages are
  Projection entities, not domain events.
- Wave 6 provides best-effort cross-node notification reachability. It does not
  provide the previously discussed cluster-complete-while-connected guarantee.

Reasoning:

- The current wire carries no resumable cursor or sufficient ordering contract
  for lossless reconnect. Authoritative Entity re-query is honest and simple;
  stronger delivery guarantees would be speculative.

Consequences:

- Every user, package, API, Chat, and agent-oriented guide must state the
  limitations prominently.
- React and browser APIs expose lifecycle and gap notifications separately from
  domain/entity updates.

## D-0105: Authenticate In A Standalone Protocol-Aware Gateway

Status: Accepted

Date: 2026-07-27

Task: Wave 4 planning / `T-0074`

Decision:

- Add `@spine-event-engine/auth` as the provider-neutral contracts and runtime
  for assembling a standalone authentication gateway in front of unmodified
  Spine TS or Spine JVM services.
- Bounded contexts configure no authentication routines. The gateway
  authenticates an application session, authorizes a typed `IncomingRequest`,
  resolves actor and tenant using the request signal, query/subscription
  details, safe transport facts, and application policy, rewrites
  `ActorContext`, and forwards native gRPC.
- Support opaque stored sessions and signed application-session tokens behind
  extension contracts. Support cookie and bearer transport. Validate the
  application session and authorize every request without forcing another
  external-provider login.
- Add standards-based OIDC, first-class configurable Google OIDC and GitHub
  OAuth web flows, and a provider extension seam. Keep provider access and
  refresh tokens server-side by default. Applications own external-identity to
  Actor mapping, tenant rules, provisioning, roles, sessions, and persistence.
- Return informational actor, tenant, and expiry to the client, but do not
  treat browser-returned values as proof. Reconstruct trusted context for every
  request. Reject a client actor/tenant mismatch before forwarding; when values
  agree, replace the object with a freshly constructed trusted
  `ActorContext`.
- Authenticate and authorize `Subscribe`, `Activate`, and `Cancel`
  independently. Do not freeze a general signed client-context token in this
  plan. The protected subscription-ownership mechanism remains subject to
  implementation evidence and final security review.
- Provide a configurable Envoy reference that exposes the gateway by default
  and documents the backend trust assumption. This is a template and secure
  default, not a claim that Spine controls or enforces user deployment.
- Freeze an unmodified JVM commit and prove browser → Envoy → auth gateway →
  TS/JVM commands, queries, Projection subscriptions, and exposed-event
  subscriptions. Freeze the commit during implementation preflight before the
  first production slice.

Reasoning:

- A generic edge authorization filter cannot safely inspect policy-relevant
  Protobuf messages and rewrite nested `ActorContext`. A protocol-aware gateway
  supplies one security boundary for both runtimes without changing JVM code.
- External sign-in and later application requests are different phases. A
  local application session prevents repeated Google/GitHub authentication
  while preserving per-request authorization.

Consequences:

- Wave 3 model registries are composed by gateways whose authorization policy
  inspects application messages.
- Documentation must cover sessions, revocation, cookies, CSRF/CORS, OAuth/OIDC
  callbacks, token storage, context trust, already-open stream revocation
  limits, Envoy customization, and backend-bypass consequences.
- Wave 4 creates and tests the Envoy template; Wave 5 productionizes it.

## D-0107: Parse Deployment YAML Structurally In Policy Tests

Status: Accepted

Date: 2026-08-03

Task: `T-0096`

Decision: Add the maintained `yaml@2.9.0` package as a root development
dependency for deployment-policy tests. This is the version already selected by
the Vite toolchain, so one compatible Vite type identity is installed. Tests
parse the Kubernetes multi-document resource, locate the Envoy ConfigMap, and
parse its embedded Envoy YAML before inspecting route objects.

Reasoning: Indentation-aware parsing rejects non-path route shapes, duplicates,
and hidden extra route items that a text scanner can skip.

## D-0106: Support Durable Gateway Coordination In Both Deployment Modes

Status: Accepted

Date: 2026-08-02

Task: Wave 5 planning / `T-0088`

Decision:

- Support combined gateway/application and standalone gateway deployments as
  first-class production modes. Multiple application replicas require the
  standalone mode; small production deployments may choose either.
- Require a durable, storage-neutral subscription registry in production in
  both modes. Gateway assembly receives this gateway-owned lifecycle dependency
  and its logical namespace explicitly. Supply a `StorageFactory`-backed
  implementation and retain the in-memory registry only for local development
  and tests; production startup rejects it.
- Coordinate two standalone gateway replicas with compare-and-set claims,
  finite leases, bounded recovery and cleanup, and cancellation fences.
- Persist logical subscription ownership across redeployment, but do not claim
  that a live stream survives. Reconnect, authoritative entity re-query, gaps,
  and duplicates retain the Wave 4 semantics.
- Keep application storage an application-code decision. Deployment templates
  pass configuration and secrets but never select a storage engine.
- Run exactly one in-memory `delivery-server/simple-server` replica. Do not add
  Redis, Hazelcast, or another durable delivery-server mode.
- Let `Server.run()` close `ServerEnvironment` after the last run-managed
  server closes. Multiple run-managed servers may share the environment, but
  run ownership cannot mix with externally start-managed servers. Keep
  `Server.start()` caller-managed.
- Provide TCP startup/readiness probes and no default application health or
  liveness endpoint. TCP readiness is listener readiness, not continuing
  dependency health.

Reasoning:

- Durable registry records are needed even for one gateway because logical
  subscriptions must survive gateway redeployment. Atomic shared ownership is
  also the smallest design that supports two gateway replicas without sticky
  routing.
- Storage-neutral infrastructure preserves the application's existing storage
  configuration across replicas and avoids a second configuration framework.
- Combined mode remains useful for small deployments, while standalone mode
  provides a migration path and the only supported multi-instance topology.

Consequences:

- Wave 5 must test two gateways and two application replicas with shared
  application-selected storage.
- Shared session signing, validation, and revocation settings become explicit
  deployment requirements.
- Production container, Compose, Kubernetes, and Envoy documentation must state
  lifecycle, readiness, durability, and subscription limitations without
  promising high availability from the in-memory delivery server.

## D-0108: Coordinate Delivery And Stand Across Application Nodes

Status: Accepted

Date: 2026-08-04

Task: Wave 6 planning / `T-0104`

Decision:

- Route Aggregate and Process Manager work through sharded Inbox persistence.
  Every application node observes delivery-server shard notifications, but only
  the lease owner dispatches a shard and drains it until empty.
- Make Stand observe domain and `EntityStateChanged` system events through the
  EventBus instead of relying on process-local state callbacks.
- Give Stand a configurable subscription registry. The built-in durable
  implementation uses the Bounded Context StorageFactory; a custom complete
  implementation may be supplied through the builder.
- Reconcile complete durable subscription snapshots every 10 seconds. Expire
  pending activation after 30 seconds through finite idempotent cleanup on each
  node. Physically delete cancelled subscriptions; retain no tombstone.
- Keep in-memory Stand subscriptions valid and emit a warning, not a startup
  failure, in production.
- Let one Gateway connect to all application nodes. Subscription notices remain
  best effort and Entity queries remain authoritative.
- Add a separate Distributed Message Board using two application nodes, one
  standalone Gateway, and the in-memory simple delivery server.

Reasoning:

- Shared Inbox storage plus an exclusive shard lease serializes one Entity's
  updates without tying clients or Gateways to the node that ultimately handles
  the signal.
- Shared subscription definitions allow the node that commits an event or
  Entity change to notify its local Stand. A multi-backend Gateway can then
  receive notices without promising completeness.
- Physical deletion and full snapshots keep storage bounded and permit every
  healthy node to converge without millions of cancellation tombstones.

Consequences:

- Wave 6 changes delivery, persistence, subscription, and Gateway lifecycle
  contracts and therefore executes as high-risk tasks T-0105 through T-0112.
- Wave 7 owns stronger horizontal semantics and redeployment/update behavior.
- Redis, Hazelcast, durable delivery-server modes, JVM builds, and npm
  publication remain excluded.

## D-0107: Fence Remote Delivery Ownership At Commit

Context: a remote shard session can expire or be released while an application
callback is running. Admin updates are wake-up hints, not an ownership proof.

Decision: identify every remote acquisition with one opaque worker value,
match release to that complete worker identity, and revalidate ownership at
the framework transaction commit boundary. A supervisor owns stream recovery:
it must complete a fresh snapshot before reopening live observation.

Consequences: no Proto or public method is added; one shard has one owner at a
time, while different shards retain no ordering guarantee.

## D-0109: Separate System Events From The Domain EventBus

Status: Accepted

Date: 2026-08-05

Task: System Context correction planning / `T-0113`

Decision:

- Build one internal System Context for every domain Bounded Context. Give the
  pair separate EventBuses, Stands, and event-storage namespaces while sharing
  one durable Stand subscription registry.
- Route every system event only through the System Context EventBus. A system
  event must never register with, traverse, or be stored by the domain
  EventBus/EventStore.
- Forget system events by default. Provide a narrow builder-level opt-in that
  persists them only in the System Context's storage namespace.
- Emit all copied system events corresponding to current TS operations:
  creation, state and lifecycle transitions, and accepted command/event
  dispatch. Keep `EventImported` compatibility-only and `MigrationApplied`
  dormant until their operations exist.
- Keep System Contexts internal. Domain Stand remains authoritative for
  queries; System Stand observes entity lifecycle events. Both subscription
  sources feed the same active stream through the shared definition registry.
- Make Message Board apply valid entity subscription payloads locally. Query
  only for initial state, recovery/gaps, inconsistent payloads, and after its
  own successful post while live updates are disconnected.

Reasoning:

- System events describe framework lifecycle and diagnostics rather than the
  domain event history. Mixing them into the domain EventBus violates that
  boundary even when a special path skips EventStore append.
- Payload-bearing subscription updates normally contain the exact changed
  state. Querying after each update discards useful protocol data and creates
  unnecessary load.

Consequences:

- The correction changes EventBus persistence, context assembly, Stand
  observation, subscription activation, shutdown, and current documentation.
- Implementation follows dependency tasks T-0114 through T-0119 in
  `build-protocol/planning/T-0113_SYSTEM_CONTEXT_PLAN.md`.
- Subscription delivery remains best effort; this decision adds no
  cluster-complete, replay-complete, or exactly-once guarantee.

## D-0110: Discover Scalable Application Nodes On GKE And GCE

Status: Accepted

Date: 2026-08-06

Task: Wave 7 planning / `T-0120`

Context:

- Wave 6 gives one Gateway a fixed list of application nodes. Wave 7 must let
  cloud infrastructure scale and replace those nodes without making the
  Gateway a scaling controller.
- GKE and GCE expose different discovery mechanisms. Cloud Run is outside the
  initial offering.
- The Gateway must not silently attach subscriptions to only an arbitrary
  subset of the running application nodes.

Accepted direction:

- Add platform-neutral `@spine-event-engine/deployment` plus separate
  `deployment-gke` and `deployment-gce` packages.
- Use headless-Service DNS on GKE with a configurable ten-second refresh that
  respects DNS TTL behavior.
- Use a storage-backed leased node registry on GCE. It receives an explicit
  `StorageFactory`, has a separate logical namespace, renews nodes every 20
  seconds, expires them after 60 seconds, and is read by the Gateway every 10
  seconds.
- Treat 32 application nodes as the default expected count, not a hard limit.
  Continue reconciling and using every discovered node when the expectation is
  exceeded. Use bounded connection concurrency rather than discarding nodes.
  Load tests publish tested capacity but do not impose an absolute maximum.
- Provide optional, operator-configured autoscaling templates. Spine TS does
  not make scaling decisions.
- Permit a minimal GCE topology to colocate the Gateway and simple delivery
  server while recommending separate production failure boundaries.
- Support same-version scaling, compatible rolling application replacement,
  explicit stop/start for incompatible logic, and an interrupting single-
  Gateway replacement.
- Let every GCE application process maintain its own leased registry record.
  The Gateway reads registry snapshots but does not register or clean nodes.
- Publish private GCE addresses by default and allow an explicit endpoint
  override.

Consequences:

- Wave 7 must include runtime discovery, reconciliation, Terraform, GKE/GCE
  guides, scale-to-zero behavior, and redeployment guidance.
- Multiple Gateways, operational logging adapters, the next `validation-ts`
  upgrade, and Datastore/RDBMS physical-layout tuning remain Wave 8 work. Wave
  8 emits an ERROR when node discovery exceeds its configured expectation;
  service continues across all nodes.
- Wave 7 implementation begins only after the completed dependency plan is
  explicitly approved.

## D-0111: Match Spine JVM Physical Storage Values

Status: Accepted

Date: 2026-08-09

Task: T-0146 planning and T-0147 through T-0150 implementation

Context:

- Wave 8 introduced TS-only ID/key encodings, free-form column value kinds,
  and provider paths that do not map stored values and query operands through
  one typed conversion.
- The human requires Spine TS and Spine JVM to share physical MySQL and
  Datastore storage, not merely agree on logical domain values.
- JVM retains the declared Proto type in `RecordColumn`, uses provider
  `ColumnMapping` conversion for both writes and queries, validates supported
  IDs through `Identifier`, and uses reversible `Stringifiers` where provider
  values are textual.

Decision:

- Preserve generated Proto ID and column schemas through the storage contract.
- Add JVM-shaped identifier and reversible stringifier behavior plus typed
  provider column mappings.
- Apply the identical provider mapping to stored column values, query
  operands, ordering, and continuation values.
- Match JVM's provider-visible default values, including compact Proto JSON for
  ordinary message values where JVM stores text, native Datastore scalar/blob/
  timestamp values, and the corresponding JDBC scalar/binary/numeric values.
- Replace TS-only raw message-ID binary and tagged key/ID formats during the
  provider cutovers. Keep serialized record bodies as standard Protobuf wire
  bytes.
- Require shared JVM/TS golden vectors and bidirectional provider fixtures;
  visually similar JSON is not compatibility evidence.
- Do not offer simultaneous old and new layouts. Existing Wave 8 data requires
  empty corrected storage or a separately approved offline migration.

Alternatives considered:

- Preserve TS-private encodings and translate at runtime: rejected because JVM
  cannot address or query the same physical rows and keys.
- Require only logical equality: rejected because provider equality operates on
  physical key/property/column values.
- Use generic `JSON.stringify()`: rejected because it does not guarantee the
  Protobuf JSON rules for enums, 64-bit values, bytes, well-known types,
  defaults, or field names.

Security impact:

- Tenant boundaries: mapping occurs only after the provider tenant database or
  namespace is selected; no Bounded Context or hidden scope value substitutes
  for tenant isolation.
- Validation and deserialization: schema-bound parsing rejects malformed or
  wrong-type persisted/query values instead of accepting arbitrary objects.
- Dependencies: use the repository's existing Protobuf-ES runtime; no new
  serializer dependency is approved by this decision.
- Secrets, IPC, and logging: no direct impact.

Consequences:

- T-0147 through T-0150 are one non-releasable breaking-layout correction.
- Record-column declarations and provider adapters must be schema-aware.
- MySQL and Datastore writes and queries must share one provider mapping.
- Compatibility tests must cover message/primitive IDs, all supported column
  categories, and both JVM-to-TS and TS-to-JVM fixtures.
- Active beginner documentation must explain the physical mapping without
  exposing internal codecs as user configuration.

## D-0112: Use Established Logging And JVM-Style Signal Conventions

Status: Accepted

Date: 2026-08-10

Task: T-0153 planning and the Wave 9 implementation train

Context:

- Server-side packages contain operational failure boundaries but do not share
  a structured logging contract. The isolated `warn` callback on
  `ServerEnvironment` cannot carry typed context or collector transports.
- Applications need the same established logging API as framework code, while
  retaining control of logger configuration, transports, and lifecycle.
- Command, Event, and Entity state-update routing is only partially implemented
  in Spine TS and is not publicly customizable like Spine JVM.
- Spine TS does not yet expose JVM-style semantic `(is)`/`(every_is)` routes or
  Event-field `@Where` filters.
- Command and Entity Proto models repeat `(required) = true` on ID fields even
  though Spine JVM treats the first declared field as implicitly required when
  the option is absent.
- Rejection generation and runtime dispatch already exist. The missing work is
  conformance and demonstration, not a parallel rejection mechanism.

Decision:

- Use LogLayer directly as the server-side framework and application logging
  API. Accept application-created loggers, derive child loggers, and leave
  lifecycle and transport configuration with the application.
- Pass environment children explicitly through attachment/runtime construction.
  Independently operated auth, delivery, and deployment components accept the
  same application-created `ILogLayer` in their existing options. Do not use a
  global logger or per-module fallback.
- Provide structured default output and prove application composition with
  LogLayer's official Google Cloud Logging transport. Do not wrap it as a Spine
  adapter. Keep the contract transport-neutral so later integrations such as
  Sentry do not require a Spine-specific logging facade.
- Log operational WARN and ERROR records once at the boundary that contains or
  terminates the failure. A logging failure never changes framework behavior.
- Permit stable domain and infrastructure identifiers in structured fields but
  prohibit every authentication secret, including credentials, tokens,
  passwords, cookies, authorization headers, signing keys, session secrets, and
  CSRF/OIDC secrets.
- Provide customizable routing for Commands, Events, and Entity state updates.
  Commands are unicast; Events and state updates may route to zero, one, or many
  Entity IDs.
- Evaluate an Event/state route once at signal acceptance, reject more than
  1,000 returned targets before any handoff, persist one validated target per
  Inbox row, and replay that stored target without invoking application route
  code again.
- For default Event routing, use a valid compatible producer ID. Fall back to
  the first declared Event field only when the valid producer type is
  incompatible. Fail when a producer claims the compatible type but is
  malformed.
- Support exact-message routes plus semantic `(is)` and `(every_is)` routes.
  Precedence is exact message, then `(is)`, then `(every_is)`, then default.
  Ambiguous or incomplete construction fails.
- Preserve descriptor `(is)`, descriptor `(every_is)`, and caller compatibility
  tag provenance separately. Generated handler metadata moves to a fail-fast
  version 2 for state subscriptions and `@Where`; stale version 1 registries are
  regenerated rather than silently accepted.
- Add an Event-handler method decorator `@Where` with the public fields
  `eventField` and `equals`. It supports nested paths and Stringifier-based
  literal conversion, and it applies only to Event-consuming `@Subscribe`,
  `@React`, and Event-to-command `@Command` handlers. Invalid declarations fail.
- Treat the first declared field in a Command or Entity state as implicitly
  required when no explicit `(required)` option is present. Redundant explicit
  declarations remain valid; an explicit option remains authoritative.
- Preserve the existing rejection mechanism and verify both approved rejection
  filename forms. Use Message Board to demonstrate the Wave 9 conventions.

Security impact:

- Logging changes the authentication-secret exposure boundary and therefore
  requires dedicated negative redaction tests and a final security review.
- Routing and filtering reject malformed types, paths, literals, and ambiguous
  registrations before dispatch. Custom routes cannot bypass tenant or Entity
  repository boundaries.
- Stable identifiers are operational correlation data and may still be
  sensitive. Applications choose collector access, retention, and transport
  policy; framework defaults never add payloads or secret-bearing envelopes.

Consequences:

- Logging, routing, filter, and implicit-ID changes are split into
  dependency-ordered review-sized tasks under
  `planning/WAVE_9_LOGGING_ROUTING_PLAN.md`.
- Public TSDoc ships with each runtime slice. Root/package READMEs,
  `docs/USER_GUIDE.md`, other product/example Markdown, repository-wide
  copyright-header correction, and multiple-Gateway behavior move to Wave 10.
- Browser logging, Sentry integration, Cloud Run, and npm publication remain
  outside Wave 9.

## D-0113: Generate TypeScript Message Interfaces And Route By Their Tokens

Status: Accepted

Date: 2026-08-13

Task: T-0178 planning and the Wave 11 implementation train

Context:

- T-0167A correctly removed TypeScript routing based on Java-only
  `(is).java_type` and `(every_is).java_type` values.
- The canonical upstream `spine/options.proto` now defines `ts_type` for both
  options and documents generated versus existing TypeScript interfaces.
- TypeScript interfaces disappear at runtime, so repository routing needs a
  generated, typed runtime identity without returning to arbitrary strings or
  generic semantic metadata.
- The human requires interface inheritance to stay inside the Proto model
  module, while allowing external property types, and requires generated
  TypeScript to carry generated/provenance notices but no copyright header.

Decision:

- Import and freeze the exact pinned upstream `options.proto` source.
- Run one automatic semantic post-generation phase after Buf and before atomic
  publication.
- Generate `(every_is)` interfaces only when `generate` is true. Resolve every
  `(is)` interface and non-generated `(every_is)` interface from ordinary
  authored source in the same model module.
- Require every interface parent to remain in that model module after realpath
  resolution. Permit external property types. Use the model module's
  TypeScript program as the compatibility authority.
- Emit generated companions under `generated/interfaces/`. The same exported
  name denotes the TypeScript interface in type position and an immutable
  runtime token in value position.
- Name the public token type `MessageInterface` and its supported low-level
  public factory `MessageInterfaces.define()`. Generated modules are its normal
  callers. The factory validates and freezes membership but is not a source-
  provenance authentication boundary.
- Reuse `.route(...)` for exact schemas and interface tokens across Command,
  Event, and state-update routing. Resolve exact schema first, then the first
  matching token in registration order, then the replacement/default route.
  Do not restore `routeSemantic()` or add `@Route`.
- Route application code once per accepted admission. Durable replay consumes
  stored typed Inbox targets and does not invoke application routing again.
- Demonstrate Event interface routing in To-Do with generated `TaskEvent`,
  authored `TaskAssignmentEvent`, and exact `TaskReassigned`; never introduce
  `TaskReassignmentEvent`.
- Give generated TypeScript deterministic generated/provenance notices and no
  CodeMatters copyright header. Preserve the authored-source copyright and
  exact-one-blank-line rule.
- Defer multiple-Gateway behavior wholly to Wave 19.

Alternatives considered:

- Route by Java type strings: rejected because Java names are not TypeScript
  contracts and this caused the T-0167A correction.
- Add `routeSemantic()` or arbitrary string keys: rejected as an unapproved
  parallel API that is easy to mistype.
- Search an entire dependency graph for interfaces: rejected because it makes
  generation ambiguous and permits hidden runtime-token ancestry.
- Infer the most-specific matching interface: rejected in favor of explicit,
  visible registration order after exact routes.
- Put authored interfaces in a special directory: rejected because they are
  normal application code.

Security impact:

- No network, authentication, secret, or tenant boundary changes.
- Compiler discovery and generated provenance must fail closed on realpath or
  symlink escape; generated output never includes absolute machine paths.
- The final Wave 11 release task runs the existing final security reviewer.

Consequences:

- T-0179 through T-0186 form one dependency-ordered Wave 11 train.
- Shared generator, Proto, core, and server changes use release verification;
  the isolated example and documentation tasks use bounded task profiles until
  evidence requires expansion.
- D-0112 remains authoritative for logging, `@Where`, implicit IDs,
  rejections, default routing, and durable replay. Its Java-semantic routing
  clause was superseded by T-0167A and this `ts_type` decision.

## D-0114: Bound Wave 12 Streams, Provider Queries, And Delivered Inbox Rows

Status: Accepted

Date: 2026-08-15

Task: T-0187 planning and the Wave 12 implementation train

Context:

- A real Message Board browser subscription can terminate after ordinary
  successive updates; current acceptance proves only one update written by the
  subscribing page.
- MySQL inherits the normalized query-plan fallback that can read a whole
  storage group and filter in Node, while positive nearby tests replace the
  production method.
- Delivered Inbox rows remain durable forever. `keepUntil` is already a
  deduplication boundary and cannot honestly double as infinite retention.
- Pinned Spine JVM delivery cleanup removes delivered rows when `keepUntil` is
  absent or elapsed, and its builder exposes a deduplication window rather than
  a second delivered-retention duration.

Decision:

- Preserve best-effort browser subscriptions as healthy long-lived streams:
  gaps or duplicates may occur and real disconnects may reconnect/re-query, but
  ordinary successive updates cannot complete the stream. Prove the correction
  with a passive real-browser viewer and another actor through the complete
  Gateway/gRPC-Web topology, isolating native production from forwarding before
  choosing the implementation boundary.
- Treat every advertised storage query capability as provider execution.
  MySQL must push every admitted normalized predicate, ordering, and limit into
  parameterized SQL contained by the selected tenant database and resolved
  storage-group table. It must reject unsupported plans before provider access
  and must never rescue an admitted plan with a full-group Node filter.
- Do not add offset to `NormalizedQueryPlan` in Wave 12. Its absence is an
  explicit unsupported matrix entry; the separate `RecordQuery.offset`
  behavior remains unchanged.
- Keep `keepUntil` as the optional serialized deduplication-protection
  deadline. A delivered row is cleanup-eligible when it is absent or no later
  than the cleanup time. Do not add an independent retention setting, new Proto
  field, or scheduler.
- Extend the exported `DeliveryInbox` persistence port with the optional,
  source-compatible
  `removeDelivered(message, session, options?): Promise<boolean>`. It succeeds
  only for an exact delivered snapshot while the supplied shard session remains
  current. Direct storage delegates to a provider-owned atomic cleanup seam:
  one memory critical section, one Datastore transaction, and one MySQL
  transaction or provider advisory fence shared with ownership mutations.
  Separate validation followed by deletion is forbidden. RemoteInbox omits the
  method because acknowledgement already removes its pending row. The persisted
  record and Protobuf layout do not change. Custom structural ports that omit
  the optional method remain compatible and own their retention behavior.
- Run cleanup as one page-limited operation under the existing environment
  delivery lifecycle and shard session. Verify ownership and exact deletion as
  one provider-atomic mutation, stop after cancellation, deadline, ownership
  loss, or the page bound, and provide cleanup capacity at least equal to successful
  bounded delivery plus one maintenance page on an otherwise empty owned drain.
- Make the base normalized provider-plan seam fail for unimplemented nonempty
  plans. Apply a provider fetch limit derived from the exact plan limit and
  `(candidateLimit ?? 10_000) + 1`. The public optional candidate limit thus has
  a finite shared default. Datastore advertises only provider-legal overlap and
  rejects nested/disjunctive or illegal inequality/order shapes before access.
- Require >=90% changed executable line and branch coverage, while recording
  real browser, live MySQL, Datastore, SQL statement, and physical row-count
  evidence separately from V8 accounting.

Alternatives considered:

- Repair the first plausible browser component before a boundary trace:
  rejected because the observed termination crosses browser, Envoy, Gateway,
  native service, Stand, and harness lifecycles.
- Advertise weak MySQL capabilities and retain Node filtering: rejected because
  even equality admission can have unbounded group cost and is not provider
  execution.
- Add normalized offset now: rejected because it broadens a public contract
  unnecessarily; the review asks for an explicit capability disposition, not a
  new feature.
- Add a separate delivered-retention duration: rejected because it invents a
  second concept absent from pinned JVM behavior and delays the required finite
  default.
- Delete delivered rows without fencing or in an unbounded maintenance sweep:
  rejected because a stale owner could delete another owner's records and a
  sustained backlog could monopolize resources.

Security impact:

- Subscription cleanup and bounded queues protect session/listener resources;
  authentication and authorization contracts do not change.
- SQL values remain bound parameters, identifiers remain schema-derived, and
  tenant/storage-group containment is mandatory for every statement.
- Inbox cleanup cannot cross tenant, shard, or current ownership boundaries and
  deletes only an exact eligible delivered snapshot.

Consequences:

- T-0188 through T-0194 form the dependency-ordered Wave 12 train described in
  `planning/WAVE_12_RUNTIME_CORRECTNESS_PLAN.md`.
- T-0188 through T-0192 implemented the browser, MySQL/Datastore, and Inbox
  decisions above; T-0193 owns the corresponding reader-facing reconciliation
  before T-0194 release closure. This decision remains the durable contract,
  not a future implementation proposal.
- Browser, MySQL, and Inbox runtime slices retain independent ownership;
  documentation follows their stabilized behavior and final release closure
  owns combined provider/runtime evidence and the final security review.
- Wave 13 through 19 features and Cloud Run receive no provisional API or
  implementation from this decision.
