# Wave 2 JVM Parity Plan

Status: Approved for autonomous implementation

Task: `T-0068`

Authoritative source:

- `SpineEventEngine/core-java` at
  `026266f15d866464a99386fa891d5c8ec39f854e`.

This plan freezes the observable behavior, internal storage seams, task
ownership, and verification sequence for Wave 2. The human approved the
requirements and autonomous start on 2026-07-24.

## Parity Rule

Implement behavioral and conceptual Spine JVM parity with idiomatic
TypeScript. Do not reproduce Java-only structure or add speculative
abstractions. There are no production Spine TS consumers, so superseded
package names, persistence models, and public APIs are removed atomically
without aliases, persisted-data migration, or a deprecation period.

## Parity Matrix

| Area                         | Current JVM or accepted authority                                                  | Current Spine TS                                                                               | Wave 2 target                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Package scope                | Human decision applies to every live package                                       | Fourteen `@spine-ts/*` packages and 952 live references                                        | Atomic `@spine-event-engine/*` cutover with no aliases                      |
| Current entity storage       | Aggregate, Projection, and Process Manager use durable latest-state entity records | Aggregate uses snapshots and stored-event reconstruction; Stand stores raw PM/Projection state | One internal latest-state `EntityRecord` hierarchy for every entity kind    |
| Aggregate restoration        | Load the latest state; stored events are not a reconstruction source               | Snapshot plus event-tail replay through appliers                                               | Remove snapshot/replay/applier persistence paths; restore latest state only |
| State history                | Repository-configured, off by default, all entity kinds                            | Absent                                                                                         | Versioned state records, opt-in, immutable newest-first reads               |
| State-history write          | Append after each successful logical store                                         | Absent                                                                                         | Preserve immediate and batched non-transactional ordering exactly           |
| Event history                | Aggregate always; Process Manager opt-in; Projection none                          | Aggregate event store participates in restoration                                              | Separate diagnostic/recent journal; never reconstruct state from it         |
| Same-batch reads             | Exclude unfinished dispatch; include earlier completed dispatches                  | Absent                                                                                         | Match JVM cache and persistence visibility                                  |
| Runtime state-history switch | Supported by JVM but not intended as routine runtime control                       | Absent                                                                                         | Exact switch behavior with an explicit usage warning                        |
| Retention                    | Application-managed `trim` and `truncate`                                          | Absent                                                                                         | Equivalent async maintenance on all adapters                                |
| Double dispatch              | Optional guard inspects recent event history; default depth 100                    | Absent                                                                                         | Add to Aggregate and eligible Process Manager repositories                  |
| Query DSL                    | Entity columns and queries target all queryable entity kinds                       | Projection-specific public names; Aggregate/PM low-level ID paths                              | `EntityColumn` and `EntityQuery` over shared current records                |
| Remote history               | No JVM remote history client API                                                   | Absent                                                                                         | Remains absent; remote queries return current state only                    |
| Wire query                   | Existing `spine.client.Query`                                                      | Existing generated contract                                                                    | Preserve unchanged                                                          |
| Cross-runtime execution      | Deferred by the human                                                              | Not proven                                                                                     | Remains Wave 3                                                              |

## Frozen Contracts

### Shared latest-state records

All entity kinds persist one internal record shape containing:

- the entity state;
- canonical entity ID;
- version in one durable representation;
- lifecycle status;
- physical identity derived from storage context, tenant, state type, and
  record purpose.

`EntityRecordStorage` owns current rows. `Stand` may remain a routing and query
facade, but it does not own a separate raw-state representation. Aggregate
loading reads the latest record directly and never reconstructs state from
events.

`RecordSpec` gains a required `readonly storageKey: string` constructor field.
T-0070 updates every existing constructor call in the same shared-contract
commit, so the workspace is never left with an optional/default identity.
Construction rejects an empty, surrounding-whitespace, or control-character
key. Entity storage keys are created by one internal helper from the Protobuf
state `typeName` and a closed record-purpose value:

- `<state-type>:current`;
- `<state-type>:state-history`;
- `<state-type>:event-history`.

The exact backend scope is the length-delimited tuple of canonical Bounded
Context name, canonical tenant ID bytes, and `storageKey`. Length-delimited
encoding prevents separator ambiguity. Changing context, tenant, state type,
or purpose therefore changes physical scope. Each provider atomically creates
and durably stores a scope-to-fingerprint metadata binding before first use.
The deterministic fingerprint covers the record schema, ID schema/kind, and
declared column names/types. Independent factories and processes compare the
persisted binding; an incompatible reopen fails before row access, while
compatible equivalent specifications address the same data. In-memory
backends enforce the same rule in backend-shared state, not a factory-local
map. No identity depends on a JavaScript object or constructor instance.

State history reuses an entity-record-compatible representation with versioned
identity. Event history stores emitted `Event` messages in a separate journal.
Adapters must not infer identity from JavaScript object identity or generated
constructor identity.

### History APIs and configuration

Entity-facing APIs are protected and asynchronous, with these exact
declaration contracts for entity ID `I` and state `S`:

```ts
protected stateAt(time: Timestamp): Promise<Readonly<S> | undefined>;
protected stateHistoryBackward(depth: number): Promise<readonly Readonly<S>[]>;
protected eventHistoryBackward(depth: number): Promise<readonly Readonly<Event>[]>;
protected eventHistoryContains(
  depth: number,
  predicate: (event: Readonly<Event>) => boolean,
): Promise<boolean>;
```

`Timestamp` and `Event` are the generated Spine Protobuf types. `stateAt`
returns `undefined` when retained history cannot answer the question. History
methods return cloned history messages newest first. Each message clone is
top-level `Object.freeze`d, matching TypeScript's top-level `Readonly<T>`, and
the containing array is separately frozen. Each invocation owns fresh clones.
`eventHistoryContains` returns only a boolean. No public history-entry wrapper
is introduced because JVM entity APIs expose states and events, not storage
metadata. Every depth must be a positive safe integer; invalid depths reject
before storage access.

The current unfinished dispatch is excluded. Earlier completed dispatches in
the same batch are visible. Cache population retains only complete entity
version groups; a requested result may stop at its requested item depth.
Continuation is exclusive by entity version, short reads establish exhaustion,
and a discontinuous append clears the instance cache without failing dispatch.

State history is configured per repository and defaults off. Runtime switching
matches JVM behavior, but documentation must state that it is not designed for
routine runtime use. Aggregate event history is unconditional. Process Manager
event history is opt-in and defaults off. Projection event history does not
exist. Rejection events are excluded.

The framework owns public `EntityStateHistoryStorage<I, S>` and
`EntityEventStorage<I>` types. Repository subclasses obtain them through
protected `stateHistoryStorage()` and `eventStorage()` accessors, and may
expose domain-specific maintenance methods. The exact maintenance declarations
are:

```ts
interface EntityStateHistoryStorage<I, S> {
  trim(entityId: I, keepMostRecent: number): Promise<void>;
  truncate(olderThan: Timestamp): Promise<void>;
}

interface EntityEventStorage<I> {
  truncate(olderThan: Timestamp): Promise<void>;
}
```

`trim` is not exposed by event storage. State-history `trim` retains the
highest-version records, accepts zero as purge, and rejects negative or
non-safe-integer counts. Both storage types expose `truncate`, which removes
only records created strictly before the boundary. Maintenance returns only
after the selected deletions are durable or rejects with the underlying
failure.

No automatic retention policy or unbounded public scan setting is introduced.

### Exact state-history durability semantics

The implementation and tests must not claim cross-storage atomicity:

- `afterStore` appends state history after every successful logical entity
  store;
- on an immediate path, the latest-state row may already be durable before the
  history append;
- in batched delivery, latest-state persistence may be deferred while each
  logical-store history row is written immediately, so history may become
  durable first;
- a history failure fails dispatch, but already-written latest/history data is
  not rolled back;
- a pending latest-state write may still exist when history fails;
- a history row may remain when a later batch flush fails;
- every successful intermediate logical store is retained in history even when
  only the final current state is flushed.

### Aggregate cutover

Wave 2 removes the TS aggregate event-sourcing persistence model:

- delete snapshot persistence and reconstruction from stored events;
- delete replay/tail loading, replay errors, and replay-only readiness paths;
- remove persistence-driven event-applier registration/execution and exports;
- load and store the shared latest-state record;
- keep normal event posting and delivery independent;
- record emitted Aggregate events only in the diagnostic/recent journal;
- migrate examples and fixtures that currently depend on reconstruction.

Delivery inbox replay, Process Manager inbox replay, and Projection catch-up
are unrelated and remain intact.

### Double-dispatch guard

The guard is opt-in and inspects the recent diagnostic event journal. Its
default depth is 100 and a positive configured depth replaces that default.
Process Managers may enable it only when event history is enabled. Registration
must fail before side effects when required journal support is absent.

Like JVM, this is a bounded, best-effort backstop rather than a durable atomic
claim or an exactly-once guarantee. Dispatch for one live entity instance is
serialized and the instance cache exposes earlier completed dispatches in the
same batch. Two machines that concurrently read the same durable history may
both pass before either journals an event. A failure before journaling leaves
no guard marker; a retry is then eligible to run. A failure after the event
journal write can make a retry look duplicate even if later persistence or
publication failed. Delivery remains the primary deduplication mechanism.
Documentation and concurrent/failure tests must demonstrate these boundaries
and must not market the guard as cross-machine atomic deduplication.

### Generic entity query

Projection-specific public query and column names are replaced atomically by
`EntityQuery` and `EntityColumn`. This includes the package root, public
`./codegen` subpath, declaration exports, generator source/templates/imports,
and the executable renamed to `protoc-gen-spine-entity-columns`. The generated
helper is `defineGeneratedEntityColumns`; every related public type uses Entity
terminology. Generated declared columns support Aggregate, Projection, and
Process Manager state types. All execute against shared current records, so
`version`, `archived`, and `deleted` come from durable data rather than
process-local defaults.

The existing `spine.client.Query` wire contract and current-state-only remote
semantics remain unchanged. No history route or remote history API is added.

## Dependency-Ordered Autonomous Tasks

Every task uses an isolated branch/worktree, one owner for overlapping
production files, behavior-first tests, deterministic checks before review,
one complete relevant review wave, one aggregated correction batch, immediate
push after every commit, reviewed integration to `main`, focused post-merge
verification plus tree equality, and immediate `main` push.

### T-0069 — Atomic npm namespace cutover

Ownership: all live manifests, imports, scripts, generated-source templates,
examples, user documentation, API inventories, and namespace validation.
Historical protocol evidence remains unchanged when rewriting it would falsify
the record.

Acceptance:

- Rename all fourteen workspace packages and every live non-historical
  `@spine-ts/*` reference to `@spine-event-engine/*`.
- Update 226 inventoried live files and 952 inventoried references as one
  repository-wide cutover.
- Keep pnpm and the existing workspace topology.
- Provide no alias, redirect package, deprecated export, or dual-scope support.
- Add a deterministic gate rejecting live `@spine-ts/` references.
- Prove workspace resolution, generated imports, examples, tests, declaration
  generation, and user-guide snippets under the new scope.

Exclusions: history, storage layout, and repository semantics.

Verification: namespace scan, frozen install, generation/provenance, full
build/test, package-resolution fixtures, declarations, and documentation
snippets. Style, API, and documentation review apply; reliability is N/A
unless tooling introduces a runtime path.

### T-0070 — Shared entity-record and history-storage foundation

Ownership: shared storage contracts, in-memory implementation, conformance
fixtures, and storage-contract documentation. The owner freezes
`RecordSpec.storageKey`, the current entity record, state/event history ports,
ID/version/lifecycle representation, ordering, retention, tenant isolation,
and adapter fixtures.

Acceptance:

- One current-record port represents Aggregate, Projection, and Process
  Manager state, ID, version, and lifecycle.
- Make `RecordSpec.storageKey` required and migrate every framework, delivery,
  example, and test caller in the shared-contract commit.
- Validate the canonical physical-scope tuple and compatibility fingerprint
  before opening storage.
- Equivalent specs with the same logical key address the same data.
- Current, state-history, and event-history rows cannot collide.
- In-memory current/history adapters pass the complete conformance suite.
- State temporal ordering, complete groups, trim, truncate, and tenant
  isolation match the frozen contracts.
- No Aggregate snapshot/event-reconstruction API or old-data migration is
  introduced.

History identity and ordering are frozen as follows:

- a state-history row key is canonical entity ID bytes plus entity version
  number;
- an event-history row key is the event ID, and its query correlation key is
  the canonical packed producer/entity ID from `Event.context`;
- state windows sort by entity version descending, creation time descending,
  then canonical state-row-key bytes descending;
- event windows sort by producer entity version descending, event creation
  time descending, then canonical event-ID bytes descending;
- `stateAt` sorts by creation time descending, entity version descending, then
  canonical row-key bytes descending;
- state and event continuation use the JVM-style exclusive
  `startingFromVersion`: every row at or above that entity version is excluded;
  no public or generic cursor API is added;
- when an item depth cuts an event version group, the incomplete group is not
  cached; a deeper read deterministically re-reads that group using the same
  total order before it can continue below the group;
- provider queries and in-memory ordering use the same total-order comparator.

History rows are immutable per key. A retry compares canonical stored content,
including the original creation timestamp: identical content is a no-op and
divergent content for the same state key or event ID fails deterministically
instead of replacing history. These keys and comparisons prevent duplicate or
rewritten rows after retry. Failure-injection conformance covers failure before
and after latest-state write, each history write, and batch flush, and proves
stable `stateAt`, `trim`, and backward reads after retry. Already-written rows
remain as specified by the partial-failure contract.

Maintenance is internally paged/chunked with provider-native key-only
selection and deletion; it must not use the public finite query materialization
path and adds no generic cursor API. Batch size is bounded and
adapter-internal. `trim` serializes with state-history writes for its entity, so
a concurrent append is not accidentally deleted. `truncate` fixes the time
boundary supplied by the caller, processes eligible rows in stable key order,
and is idempotently resumable after any completed chunk; concurrent eligible
appends are not guaranteed to be observed until a later invocation. Close
rejects new maintenance, lets an active bounded chunk settle, then aborts
further chunks with the standard closed-storage error.

The shared contract commit is the parallelization gate. Only after it is
reviewed, committed, and pushed may two isolated owners proceed:

- **T-0070D — Datastore adapter:** only
  `packages/storage-datastore/**` and its adapter documentation/tests.
- **T-0070R — RDBMS adapter:** only `packages/storage-rdbms/**` and its adapter
  documentation/tests.

Adapter owners do not edit shared contracts. Each adapter must pass the same
current/state/event-history conformance suite and its provider-specific
integration tests. Integration of both adapters precedes T-0071.

Exclusion: repository execution paths are not cut over in T-0070.

Verification: focused storage packages, in-memory conformance, provider
integration, failure injection, full build/test at shared-contract freeze and
after both adapters integrate. Style, API, documentation, and reliability
reviews apply to the shared contract; each adapter receives affected-lane
review. Provider conformance includes large histories, durable fingerprint
enforcement across independent factories/processes, same-key incompatibility
rejection, tuple non-collision, identical/divergent retry, every
partial-failure stage, concurrent append versus trim/truncate, bounded
resumability, and close during maintenance.

### T-0071 — Repository cutover, histories, and dispatch guard

One implementation owner executes three slices in order.

#### Slice 1: Aggregate storage reshape

- Move Aggregate load/store to shared latest-state records.
- Remove snapshots, event reconstruction, replay/tail loading,
  persistence-driven appliers, obsolete exports/errors, aliases, and tests.
- Replace replay tests with latest-state restart tests.
- Preserve event posting/delivery and journal Aggregate events separately.
- Migrate examples and fixtures.

Gate: no Aggregate snapshot/reconstruction path, public export, or test remains,
and restart succeeds using only the current record.

#### Slice 2: Projection and Process Manager current-state parity

- Make `Stand` delegate current persistence to shared records.
- Persist durable version and lifecycle.
- Preserve inbox replay and Projection catch-up behavior.

#### Slice 3: Histories and guard

- Add state history to all entity kinds.
- Add unconditional Aggregate and opt-in Process Manager event history.
- Implement protected history reads, repository maintenance, runtime switching,
  caching, and the exact durability semantics.
- Add the opt-in double-dispatch guard and its configuration checks.
- Cover intermediate batched stores, short reads, cache discontinuity,
  immutable results, switch behavior, failure injection, rejection exclusion,
  restart, and journal/guard behavior.
- Prove same-instance/same-batch duplicate detection and document/test the
  deliberate cross-machine race and failure/retry limitations of the
  best-effort guard.
- Add TypeDoc and positive/negative declaration fixtures for the exact
  protected history methods and public history-storage maintenance types.

Exclusions: public generic query rename, remote history, compatibility aliases,
and old persisted-data readers.

Verification: focused repository/entity tests after each slice, removal scans
after Slice 1, declaration/API checks, examples, provider-backed restart and
failure tests, then full build/test. All four specialist review concerns apply;
security is recorded at Wave 2 closure unless a new trust boundary appears.

### T-0072 — Generic Entity Query DSL and Wave 2 closure

Ownership: client Query/column public APIs, code generation, server execution,
shared current-record query seam, examples, end-user guide, API inventory, and
the final authoritative-JVM delta audit.

Acceptance:

- Replace Projection-specific names with `EntityQuery` and `EntityColumn`
  without aliases.
- Rename the root exports, `./codegen` exports and declarations,
  `defineGeneratedEntityColumns`, generator/templates/imports, and executable
  `protoc-gen-spine-entity-columns`; reject every residual public
  Projection-query/column symbol or entrypoint.
- Generate declared columns for Aggregate, Projection, and Process Manager
  schemas.
- Execute all entity queries through the shared latest-state contract.
- Read version and lifecycle columns from durable records.
- Preserve the existing Query wire contract and current-state-only remote
  behavior.
- Remove residual snapshot/replay/applier accommodation from source, exports,
  declarations, docs, and examples.
- Document current storage, history configuration and reads, maintenance,
  runtime-switch warning, partial-failure semantics, event journals, guard
  configuration, and generic queries with compilable snippets.
- Audit the pinned JVM source and disposition every relevant delta.

Exclusions: remote history routes, compatibility/data migration, publishing,
live JVM interoperability, packaging/deployment, and human administration.

Verification: compile-time negative/positive fixtures, generated-code
determinism, all query targets/operators, provider integration, executable
guide snippets, full repository verification and coverage gate. All specialist
lanes and final security review receive recorded dispositions.

## Ownership and Review Cadence

- T-0069 runs alone because its namespace changes touch the whole repository.
- T-0070 has one shared-contract owner. Datastore and RDBMS adapter owners run
  in parallel only after the contract is frozen and only in disjoint package
  trees.
- T-0071 runs after both adapters integrate and uses one stable owner for
  overlapping repository/entity code.
- T-0072 runs after repository cutover so the public query path has one common
  persistence contract.
- Mechanical findings are corrected before specialist dispatch.
- Each task collects one complete relevant review wave before one correction
  batch. Only substantively affected lanes are re-opened.
- Full verification runs at T-0069 closure, T-0070 shared-contract freeze,
  T-0070 adapter integration, T-0071 closure, and final Wave 2 closure.

## Explicit Deferrals

- Remote history APIs and client history routes are not part of Spine JVM
  parity and are not planned.
- Persisted-data migration and compatibility aliases are intentionally absent.
- Live TS/JVM compatibility tests, packaging, containerization, and
  multi-machine deployment work remain Wave 3.
- Human-facing delivery administration, browser UI, and TUI remain Wave 4.
- Package publication is a separate explicitly authorized operation; Wave 2
  only prepares package identities and repository artifacts.
