# Decision Log

Navigation: [README](README.md)

Future implementation must append every decision here or to a task-specific decision file linked from here.

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
