# Wave 1 JVM Parity Plan

Status: Proposed implementation plan; implementation requires explicit human start approval

Task: `T-0052`

Frozen sources:

- `SpineEventEngine/core-java` at
  `a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b`;
- `SpineEventEngine/delivery-server` at
  `21f2901f393e552208b97166f4eaeb942f9f5172`.

This is the durable decision map and execution sequence for the first
post-release JVM-parity wave. It defines observable behavior, TypeScript seams,
task ownership, verification, and explicit exclusions. It does not authorize
implementation until the human says to start Wave 1.

## Parity Rule

Implement behavioral and conceptual parity with idiomatic TypeScript. Preserve
public/SPI/experimental JVM behavior that matters to users, extensions, or the
wire. Do not copy Java/Kotlin implementation structure, overloads, executors,
assertion subjects, deprecated aliases, or other platform artifacts. There are
no real-world Spine TS users, so repository-wide cutovers replace superseded
APIs atomically without a deprecation cycle.

## Frozen-Source Parity Matrix

| Area                  | Frozen JVM behavior or accepted authority                                                        | Current Spine TS                                                                 | Wave 1 target                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity update         | The human-approved API is authoritative over the frozen JVM source                               | `updateDraftState()` replaces the transaction draft; validation occurs at commit | Remove it; add protected `update(mutator): State` and `tryUpdate(mutator): readonly ConstraintViolation[]` with scratch/apply-on-valid semantics     |
| `tryUpdate` atomicity | Validate a scratch state before applying                                                         | No equivalent                                                                    | Invalid transitions and thrown mutators leave the real draft structurally unchanged; validation failures are returned and unrelated errors propagate |
| `Environment`         | Environment type selects settings and supports deterministic testing                             | No direct public equivalent                                                      | Add public Node-only environment types and stable process selection                                                                                  |
| `ServerEnvironment`   | Process singleton, lazy facilities, node identity, deterministic test reset                      | Explicit `local()` / `production()` instances passed through server options      | `instance()` singleton; no public per-server injection or compatibility alias; process shutdown owns terminal facility close                         |
| Projection columns    | Declared `(column)` fields plus `version`, `archived`, and `deleted`                             | Raw storage columns and partial descriptor recognition                           | Public typed Projection columns, including system columns; deterministic unsupported-field rejection                                                 |
| Query DSL             | IDs, nested ALL/EITHER, equality and range comparisons, masks, ordering, positive ordered limits | Internal equality-oriented record query                                          | Public Projection-only builder compiling to canonical `spine.client.Query`; repeated ordering is supported                                           |
| Query execution       | Target, filter, order, mask, and version-aware responses                                         | Low-level Stand/storage path                                                     | Validate and execute the full Projection surface; preserve Aggregate/PM low-level ID paths                                                           |
| Client command        | Guest/actor and tenant context, post-and-forget/response observation, explicit lifecycle         | No public client package                                                         | Node `@spine-ts/client` Promise API with cancellation and close ownership                                                                            |
| Client query          | Fluent entity/query execution                                                                    | No public facade                                                                 | Typed Projection query execution with immutable state/version results                                                                                |
| Client subscriptions  | Entity/event topics, filters, no-longer-matching IDs, cancellation                               | Service primitives and test fixture only                                         | Bounded `AsyncIterable` subscription handle with explicit cancellation and cleanup                                                                   |
| `BlackBox`            | End-user context/actor/tenant/time-zone, input, query/subscription, output/state observation     | Public `BoundedContextFixture` leaks runtime-shaped concepts                     | Runner-neutral public `BlackBox`; immutable observations and predicate-based eventual waits; fixture becomes internal                                |
| `Delivery`            | Builder defaults, inbox, exclusive shard pickup, repeated paging, completion/failure monitoring  | Strong internal delivery, lease, attempt, worker, and loop machinery             | Preserve/deepen internals; add canonical public `DeliveryBuilder`, `Delivery`, monitor/observer seams, and environment defaults                      |
| Scheduler             | Shard observation and environment-owned scheduling                                               | Caller-managed loops                                                             | Bounded production scheduler with coalesced wake-ups and deterministic drain/stop                                                                    |
| Supervisor            | Ongoing shard discovery/recovery and worker ownership                                            | No complete production owner                                                     | Own scheduler, remote watch, recovery/rescan, restart policy, cancellation, and close                                                                |
| Delivery Protobuf     | Core delivery plus simple-server Inbox/Shard/Admin services and health                           | Custom TS delivery types; server contracts absent                                | Copy exact frozen transitive closure into `@spine-ts/proto`, curate exports, and prove normalized descriptor parity                                  |
| Delivery client       | Inbox/shard operations, paging, pickup/release/expiration, Admin updates                         | None                                                                             | Public `@spine-ts/delivery-client` and server-delivery adapters                                                                                      |
| Simple-server Inbox   | In-memory write/remove/find/page/newest behavior                                                 | None                                                                             | Standalone Node `@spine-ts/delivery-server`, in-memory only                                                                                          |
| Simple-server Shard   | Exclusive pickup, stale takeover, manual release                                                 | Local CAS registry only                                                          | Serialized in-memory state with deterministic clock and concurrent-worker proof                                                                      |
| Simple-server Admin   | Snapshot plus server-streamed shard updates; `created` ACK precedes updates                      | None                                                                             | Same handshake and update ordering, cancellation cleanup, bounded slow-subscriber queues                                                             |
| Health                | `Check`; unknown named service is `NOT_SERVING`; `Watch` unimplemented                           | None                                                                             | Match the frozen implementation exactly                                                                                                              |
| Configuration         | Port 8484, inbound 4 MiB, processing timeout 0/off; positive integer seconds enables             | None                                                                             | Parse once, validate before bind, explicit options with environment fallback                                                                         |
| TS multi-machine      | Shared delivery server coordinates application machines                                          | No remote topology                                                               | Two isolated TS application processes compete for shared shards and recover stale ownership                                                          |
| Live TS/JVM           | Shared contracts make it possible                                                                | None                                                                             | Deferred to Wave 3; Wave 1 must not claim live cross-runtime proof                                                                                   |
| Human administration  | Separate operator surface                                                                        | None                                                                             | Deferred to Wave 4                                                                                                                                   |

### Source-conflict dispositions

- Automatic stale pickup uses strict `elapsed > timeout`; manual expired-session
  release uses `elapsed >= timeout`.
- Health checks for an unknown named service return `NOT_SERVING`, following
  implementation rather than the contradictory Proto comment.
- Query ordering supports the Protobuf's repeated `order_by`; do not reproduce
  the JVM high-level builder's effective last-ordering limitation.
- Health `Watch` remains `UNIMPLEMENTED`.
- Existing client Protobuf files that differ only in prose or copyright still
  require authoritative provenance and normalized descriptor comparison.

## Recommended Module Seams

### Environment and process facilities

- `Environment.instance()` owns the selected nominal environment type.
- `ServerEnvironment.instance()` owns lazy process facilities, stable process
  node identity, and terminal shutdown.
- Configuration follows JVM-equivalent environment-type registration rather
  than per-server constructor injection.
- Environment-type changes after facility resolution fail, preventing
  split-brain settings.
- Deterministic reset/configuration is exported only from a testing surface.
- Singleton-mutating tests run serially and always reset state.

### Projection columns and query

- Public typed `Column<T>` metadata and the predicate/query builder live in
  `@spine-ts/client`.
- The DSL compiles to generated `spine.client.Query`; Protobuf remains the wire
  boundary.
- Server/storage code receives one internal normalized query plan, never client
  builder objects.
- Descriptor metadata validates field and operator compatibility before
  storage work.
- No high-level Aggregate/PM column/query factory exists before Wave 2.

### Delivery topology

- Existing server delivery domain code remains independent of gRPC.
- `@spine-ts/delivery-client` provides inbox/work-registry adapters behind
  server-owned delivery ports.
- The scheduler consumes local inbox notifications and remote Admin shard
  updates; the supervisor owns scheduler, watch, rescan, recovery, cancellation,
  and shutdown.
- The simple server owns coordination, persistence, and machine administration;
  application nodes continue to own dispatch endpoints.
- The application signal transport is not reused as the delivery-server
  persistence protocol.

### BlackBox

- Public methods return immutable observation records and support
  predicate-based eventual waits.
- No Vitest, Jest, Chai, or assertion-subject types occur in public
  declarations.
- The existing fixture may be reused internally.
- `BlackBox` idempotently closes every context, client, and subscription it
  creates.

### RPC and trust boundary

- Use the existing ConnectRPC Node stack if the pinned version implements all
  frozen unary and server-streaming descriptors. Record a dependency decision
  before adding any other RPC runtime.
- The Wave 1 simple server is an unauthenticated trusted-network component.
- Enforce inbound byte/page limits, deadlines/cancellation, allowlisted `Any`
  decoding, safe metadata, and bounded stream queues.
- Never log signal payloads, actor credentials, or arbitrary metadata.

## Dependency-Ordered Autonomous Tasks

Every task uses an isolated task branch/worktree, one existing bounded
implementer, behavior-first tests, relevant specialist review, task-branch
push, main integration, post-merge verification proportionate to integration
risk, and immediate main push. P0/P1 findings block closure; accepted P2
findings are corrected. Full verification runs at the change-sensitive cadence
below rather than after every documentation-only correction.

### T-0053 — Frozen Protobuf and descriptor intake

Ownership: Proto sources, `packages/proto`, generation scripts/tests, and the
provenance manifest only.

Acceptance:

- Copy the exact Wave 1 client, core delivery, and delivery-server transitive
  Proto closure from the frozen commits without handwritten upstream edits.
- Record repository, commit, source path, checksum, and canonical URL for every
  copied file.
- Compare the complete deterministic normalized `FileDescriptorSet`. Preserve
  file/package/import identity; message, field, enum, service, and method names;
  field numbers, wire/scalar/message/enum types, labels, oneofs,
  `proto3_optional`, map-entry structure, packed/default/JSON-name semantics;
  extension ranges, extensions, custom options including type-URL options; RPC
  input/output types; and client/server streaming shape. The only excluded
  field is `source_code_info`; any further exclusion requires a recorded
  compatibility argument.
- Add mutation fixtures proving that each compatibility-relevant descriptor
  category above changes the comparison result.
- Replace the current public `./generated/*` package-export wildcard with the
  exact stable entrypoints `@spine-ts/proto/client`,
  `@spine-ts/proto/delivery`, and `@spine-ts/proto/delivery-server`, alongside
  the existing curated root. Migrate repository consumers to those entrypoints;
  keep transitive-only contracts private unless a supported surface requires
  them.
- Add positive resolution fixtures for every supported entrypoint and negative
  fixtures proving arbitrary generated paths and transitive-only runtime APIs
  are not package exports.
- Existing client Proto files are exact frozen copies or proven
  descriptor-equivalent; drift checks are deterministic.

Verification: provenance, generation, normalized descriptor diff, package
build/typecheck, and full repository verification. TypeScript/API and
documentation review are required; style is required only if tooling code
changes; runtime reliability is N/A with a recorded no-runtime-path reason.

### T-0054 — Transactional `update` and `tryUpdate`

Ownership: server entity/transaction modules, all repository call sites,
focused tests, and the handler-state user-guide section.

Acceptance:

- `update()` returns the resulting state.
- `tryUpdate()` returns an immutable empty array on success or immutable
  violations on invalid transition.
- Scratch state is deeply independent. Invalid transitions and thrown errors do
  not mutate the active draft; sequential calls start from the current draft.
- Existing lifecycle/no-transaction guards remain coherent.
- Remove `updateDraftState()` and migrate every source, test, example, and
  public guide occurrence atomically with no alias.
- Document both APIs with compilable inline handler snippets, validation/error
  behavior, scratch-state atomicity, and the choice between `update()` and
  `tryUpdate()`.

Verification: focused mutation/rollback/error tests, server checks, and the
next scheduled full gate. Style, API, documentation, and atomicity/reliability
review are required.

### T-0055 — `Environment` and singleton `ServerEnvironment`

Ownership: environment/server lifecycle modules, a testing-only reset surface,
server tests, examples, and affected docs.

Acceptance:

- One stable `Environment` and `ServerEnvironment` exists per canonical module
  graph; facility resolution is lazy and concurrency-safe.
- The `@spine-ts/server` root exports `Environment`, `EnvironmentType`,
  `ServerEnvironment`, and `ServerEnvironmentSettings`. Production
  configuration is `ServerEnvironment.when(type).use(settingsOrFactory)`, and
  runtime access is `ServerEnvironment.instance()`.
- The exact testing-only subpath `@spine-ts/server/testing` exports
  `resetServerEnvironmentForTest()`. Tests reconfigure through the production
  `when(...).use(...)` API after reset; reset is not exported from the package
  root.
- Changing the environment after first resolution fails clearly; node identity
  remains stable until reset/process end.
- Multiple servers share facilities. Closing one server does not close shared
  facilities; explicit process shutdown closes once and attempts all cleanup.
- Test reset disposes prior facilities and restores defaults deterministically.
- Remove `ServerOptions.environment`, `local()`, `production()`, and ownership
  option aliases; migrate all call sites in the same task.
- Positive/negative declaration and resolution fixtures prove the supported
  root/testing entrypoints, absence of test controls at the root, and that every
  supported import path reaches the same singleton instances. Include
  concurrent resolve/reset/close race tests.

Verification: concurrent resolution, sibling-server, startup failure, cleanup,
reset-isolation tests, package checks, and full verification. All four
specialist lanes are required.

### T-0056 — Projection column model

Ownership: `@spine-ts/client` skeleton, descriptor metadata, `packages/storage`
canonical normalized predicate/query plan and capability-validation contract,
and the Projection-column guide section.

Acceptance:

- Projection schemas expose declared columns plus `version`, `archived`, and
  `deleted` with matching type/runtime metadata.
- Repeated, map, and unsupported column fields fail at registration with stable
  actionable errors.
- Aggregate/PM high-level columns are not exported.
- Existing low-level record/ID interfaces remain only where already supported.
- Public `ProjectionColumn<Schema, Name, Value, Operators>` values come only
  from generated/descriptor-backed typed column metadata; public queries do not
  accept arbitrary strings. The column value type determines the allowed
  comparison operator set.
- Negative compile fixtures reject unknown/non-column names, unsupported field
  kinds, wrong comparison values/operators, and Aggregate/PM high-level column
  factories.
- Document declared/system columns and supported value/operator combinations
  with compilable Projection snippets and explicit Wave 2 limitations.

Verification: compile-time API fixtures, scalar/enum/message descriptor tests,
and package checks. Style, API, and documentation review are required;
reliability covers metadata caching; execution performance is N/A.

### T-0057 — Projection Query DSL and server execution

Ownership: client Query DSL, query validation/compilation, server conversion,
and provider implementations/conformance in `packages/storage`,
`packages/storage-rdbms`, and `packages/storage-datastore`, plus the Query DSL
guide section. T-0056's normalized plan is the sole policy contract.

Acceptance:

- By-ID, nested ALL/EITHER, `=`, `>`, `<`, `>=`, `<=`, masks, repeated ordering,
  and limits round-trip through Protobuf.
- Limits are positive and require ordering. Unknown columns, invalid
  operator/type pairs, and invalid masks yield stable protocol errors.
- Multi-column ordering is deterministic with an ID tie-breaker; null ordering
  follows the frozen contract.
- Responses contain matching states and versions.
- Projection-only high-level targeting is enforced. Supported adapters behave
  consistently: in-memory evaluates the complete normalized plan, MySQL
  compiles it to parameterized SQL, and Datastore pushes down legal operations
  then uses the accepted strictly finite materialization/post-filter path with
  its documented overflow error. Invalid field/operator capabilities fail once
  in shared validation before provider work; adapters do not invent policy.
- Document construction, nesting, masks, repeated ordering, limits, results,
  adapter behavior, and Projection-only scope using compilable public snippets.

Verification: golden descriptors, predicate truth tables, storage contract
suite, real network query integration, and full verification. All four lanes
are required.

### T-0058 — Public client command/query facade

Ownership: `packages/client` transport/client lifecycle, command/query APIs,
tests, README, and package graph.

Acceptance:

- Support guest defaults, explicit actor and tenant context, command posting,
  and Projection queries.
- Separate application/protocol outcomes from transport failures.
- Immediate event observation is cancellable and cannot leak after post
  failure.
- Supplied transports remain caller-owned; internally created transports close
  once. Client close rejects new work and drains/cancels owned work.
- No server implementation types leak through declarations.

Verification: transport contracts, real TS command/query integration,
cancellation/close races, declaration checks, and package/full gates. All four
lanes are required.

### T-0059 — Public client subscriptions

Ownership: client topic/subscription API and bounded stream adapter.

Acceptance:

- Entity-state and event subscriptions support frozen filters; state updates
  include no-longer-matching IDs.
- Handles implement `AsyncIterable`, explicit cancel, and terminal error.
- Buffering is bounded with documented overflow behavior; cancellation reaches
  transport/server.
- Client close terminates every active subscription exactly once.
- Actor/tenant context matches command/query behavior.

Verification: ordering/filter/overflow/cancellation races, server failures,
client-close integration, and full verification. All four lanes are required.

### T-0060 — Runner-neutral `BlackBox`

Ownership: `packages/testing`, its tests, examples, and testing docs only.

Acceptance:

- Public `BlackBox` creates and owns a context/client and supports actor,
  tenant, time zone, command/event input, Projection query, and subscriptions
  wherever the runtime supports them.
- Observations are immutable; eventual waits accept caller predicates and
  timeouts.
- Close drains owned clients/subscriptions/context and is idempotent.
- Public declarations contain no test-runner dependency.
- `BoundedContextFixture` is internal and unadvertised; no alias is required.

Verification: the same contract under Node's test runner and the repository
runner, declaration dependency scan, and full verification. Style, API,
documentation, and lifecycle/reliability review are required.

### T-0061 — Public `DeliveryBuilder` and `Delivery`

Ownership: existing server delivery core, its public exports, and focused tests.

Acceptance:

- Builder configures storage, work registry, strategy, monitor, page/batch
  bounds, and local scheduling mode through meaningful TS seams; defaults come
  from singleton server facilities.
- Existing fencing, attempt bounds, failure isolation, and exclusive shard
  pickup remain intact.
- Paging repeats until exhaustion or cancellation; session release occurs in
  `finally`; completion/failure observation is deterministic.
- Delivery drains, endpoint invocations, RPC adapters, lease renewal, and
  monitor callbacks accept a shared `AbortSignal` and deadline. A fenced epoch
  prevents a callback that settles after abort or lease loss from committing an
  outcome. Detached late settlements are observed so they cannot produce an
  unhandled rejection.
- Do not expose deprecated JVM getter aliases or unsupported catch-up APIs.

Verification: defaults, concurrent pickup, lease/failure, paging, monitor, and
abort/fenced-late-settlement tests plus scheduled full verification. All four
lanes are required.

### T-0062 — Public delivery client and remote adapters

Ownership: new `packages/delivery-client`, generated RPC adapters, tests, README,
and package graph.

Acceptance:

- Cover single/batch Inbox writes/removes, find, paged reads, newest pending,
  pickup, release, and release-expired.
- Supply inbox/work-registry adapters for `DeliveryBuilder` and expose the Admin
  shard-update stream to the supervisor.
- Deadline, cancellation, and owned/supplied channel lifecycle are explicit;
  server validation, transport failure, and an outcome that became unknown
  after mutation admission remain distinguishable.
- Automatic retries are limited to side-effect-free reads, health checks, and
  reconnecting Admin observation. Mutable RPCs are never automatically retried
  unless the frozen contract proves idempotency; after deadline/cancellation or
  a dropped response following admission, return a sanitized
  `DeliveryOutcomeUnknownError` and expose the read/session operation
  needed to reconcile before another mutation.
- Bound page sizes and allowlist decoded `Any`; generated transport details do
  not leak from the stable facade.

Verification: mock RPC, retry eligibility, timeout-before-admission,
timeout-after-commit/dropped-response reconciliation for every mutation family,
cancellation, declaration, fake-server integration, and full verification. All
four lanes are required.

### T-0063 — Production delivery scheduler and supervisor

Ownership: server delivery scheduling/supervision modules and lifecycle tests,
consuming only the accepted T-0062 delivery-client ports.

Acceptance:

- At most one drain per shard/process is active; notifications during a run
  coalesce into one follow-up drain.
- Global concurrency and pending-shard storage are finite. When capacity is
  full, known shards remain coalesced; an unseen shard is not retained and sets
  one bounded `rescanRequired` condition. The next available capacity or
  periodic rescan rediscovers skipped work, so overflow never silently loses
  eventual recovery and never evicts an active shard.
- Supervisor owns one start/stop lifecycle, bounded cancellable Admin-watch
  restart through T-0062, periodic recovery/rescan, and stale-session recovery.
- Close stops admission and propagates abort/deadline through scheduler, loop,
  endpoint/RPC, and lease work. After the grace bound it fences active epochs,
  stops lease renewal, attempts session release, reports a structured shutdown
  timeout, and completes without accepting late results; a later close retry
  observes retained cleanup rather than duplicating it.
- Structured failures do not expose payloads.

Verification: fake clock, known- and distinct-shard storms, overflow/rescan/
remove through close, reconnect, lease loss, permanently blocked endpoint,
post-timeout fencing, late settlement, cleanup retry, and resource-bound tests;
full gate with T-0061/T-0062. All four lanes are required.

### T-0064 — In-memory simple-server core

Ownership: new `packages/delivery-server` in-memory state plus Inbox/Shard
services and tests.

Acceptance:

- Inbox write/remove/find/page/newest ordering and status match frozen behavior;
  duplicate writes and missing removals are deterministic.
- Serialized mutation prevents torn batch/count/shard state.
- Cancellation is honored only before entry to the serialized mutation
  boundary. Once admitted, a mutation completes atomically even if the client
  disappears; tests drop each mutable RPC response after commit and prove the
  T-0062 reconciliation path observes committed state without a duplicate
  mutation.
- Pickup is exclusive under concurrency. Automatic takeover uses `>`; manual
  expiration uses `>=`; zero disables automatic timeout.
- Restart loses all state intentionally and documentation says so.
- Redis, Hazelcast, and all non-simple-server modules are absent.

Verification: deterministic clock, high-contention pickup, paging, duplicate ID,
and concurrent mutation tests. All four lanes are required.

### T-0065 — Admin, health, configuration, and standalone lifecycle

Ownership: delivery-server Admin/health/config/entrypoint modules, tests, and
executable documentation.

Acceptance:

- Admin snapshot reports current shard/count state. Streaming emits exactly one
  `created` ACK before updates and discards pre-ACK changes.
- Slow subscribers are bounded and terminated with a stable resource error;
  cancellation removes resources.
- Health `Check` handles empty/all, known, and unknown-name `NOT_SERVING`;
  `Watch` remains unimplemented.
- Defaults are port 8484, inbound 4 MiB, timeout 0/off; invalid configuration
  fails before binding.
- Startup/shutdown and signal handling are one-shot and idempotent; shutdown
  marks non-serving, stops admission, closes streams, then closes the server.
- Bind host and trusted-network boundary are explicit.

Verification: RPC conformance, streaming race/backpressure, configuration,
port-collision, signal, and repeated-shutdown tests plus full verification. All
four lanes are required.

### T-0066 — Multi-machine TS-to-TS parity suite

Ownership: integration/e2e fixtures and test documentation only.

Acceptance:

- Launch one standalone simple server and at least two isolated application
  processes using only public APIs and generated descriptors.
- Both compete for one shard and only one valid session owns it; messages from
  either machine are discovered and dispatched.
- Killing/stalling the owner proves configured stale takeover; explicit release
  and supervisor restart also work.
- Assert Admin update ordering/counts and health transitions.
- Clean all processes, ports, streams, and temporary state after success or
  failure.

Verification: run the focused suite twice for flake detection, then full
verification. Reliability, style, and documentation review are required;
TypeScript/API is N/A unless contracts change.

### T-0067 — Documentation, upstream delta audit, and Wave 1 closure

Ownership: public/package documentation, examples, completion records, and
delta-audit evidence. Any adopted runtime delta becomes a separately owned and
reviewed correction.

Acceptance:

- Document client, environment configuration, `BlackBox`, Delivery topology,
  simple-server configuration/lifecycle/trust boundary, handler-state
  `update()` / `tryUpdate()`, Projection columns/Query DSL, examples, and every
  exclusion with compilable public snippets and explicit limitations.
- Compare current upstream heads with both frozen commits and classify every
  relevant delta as adopt now, defer to its wave, or out of scope. Adopted
  semantic changes reopen affected implementation/review lanes.
- Run generated drift, descriptor, declaration, lint, typecheck, tests,
  coverage, build, docs, and release-readiness gates.
- Run the existing final security reviewer over public/network/resource
  boundaries.
- Record all canonical review dispositions, limitations, and Wave 2/3/4
  handoffs; merge, post-merge verify, and push every task branch and `main`.

Review: documentation and API required; final security required. Style and
reliability reopen if the delta audit causes substantive changes.

## Full Verification Cadence

- T-0053, T-0055, T-0057, T-0059, T-0060, T-0062, T-0063, T-0065,
  T-0066, and T-0067 run the full repository gate because they change generated
  inputs, shared lifecycle, storage/query semantics, public/network streaming,
  distributed concurrency, or final integration.
- T-0054, T-0056, T-0058, T-0061, and T-0064 may use focused gates before
  review, but their accepted tree must be covered by the next listed full gate.
- Post-merge full verification may be replaced by tree-equality plus focused
  integration checks only when the protocol's identical-tree/no-integration-
  risk criteria apply. Remote push remains mandatory after every commit.
- Before T-0053 begins, rerun the existing full suite twice or durably classify
  the observed canceled-Connect cleanup race as baseline evidence.

## Explicit Deferrals And N/A Mappings

- Wave 2: recent state/event history and high-level Aggregate/PM columns/query.
- Wave 3: packaging/deployment and live bidirectional TS/JVM compatibility.
- Wave 4: human browser/TUI/other administration.
- Redis, Hazelcast, MySQL, Datastore, and durable recovery are excluded as
  delivery-server persistence modes, and every upstream delivery-server module
  outside `simple-server` is excluded. Existing MySQL and Datastore application
  storage adapters remain in T-0057 query-conformance scope.
- JVM assertion subjects, Java overload proliferation, deprecated names,
  executor/channel types, projection catch-up APIs, and generated per-entity TS
  classes are N/A platform/implementation details.
- Authentication/authorization and public-Internet hardening are not Wave 1
  product features; the unauthenticated server is restricted and documented as
  trusted-network only.

## Migration And Rollback

- Remove replaced APIs and migrate all repository usage in their owning packet;
  do not add aliases.
- The singleton migration is atomic across environment types, server creation,
  examples, and tests.
- Query index/schema changes include rebuild/clear instructions rather than a
  durable backfill compatibility layer.
- In-memory delivery-server state has no data migration.
- Copied Proto files are immutable inputs. Roll back the intake packet rather
  than editing wire definitions locally.
- Keep environment, query, client, testing, and delivery commits independently
  revertible; never combine unrelated migrations into one task commit.

## High-Risk Assumptions And Review Gates

- Enforce one canonical package import path so duplicate ESM module graphs do
  not create multiple process singletons; package-resolution fixtures prove
  every supported public entry reaches the exact same instances.
- Serialize global-environment tests and reset in cleanup paths.
- Map comparisons by Protobuf field kind; never use a generic lexicographic
  fallback.
- Every adapter uses the same stable ID tie-breaker for deterministic sorting.
- Decode `Any` through the registered-schema allowlist with byte bounds.
- Bound Admin/subscription queues, scheduler concurrency, pending shards,
  timers, retries, and shutdown waits.
- Represent distinct-shard overflow with one bounded rescan condition, not an
  evicting or per-shard overflow queue.
- Backoff is cancellable and jittered without one unbounded timer per shard.
- Do not expose payloads or actor metadata in logs/errors.
- Frozen `ReleaseShard` contains a worker ID, while its JVM implementation
  releases by shard without verifying that ID. Wave 1 defaults to exact frozen
  behavior within the trusted-network boundary. If final security review
  rejects it, the ownership check is an explicit behavioral deviation that
  must be decided, recorded, and included in Wave 3 compatibility expectations.
- The transitive Proto closure may include environment/catch-up/time contracts
  whose runtime modules remain excluded. Intake them only for descriptor
  closure; do not export unsupported runtime APIs.

No pre-implementation human decision is open. The shard-release behavior is a
known final security review gate, not a planning blocker.
