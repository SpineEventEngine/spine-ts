# Entity queries and signal routing

Status: Original cross-context work is implemented and locally release-verified.
The approved repository-query and generated-DSL extension has received standalone
plan review. One field-selection decision remains; the extension is not
implemented. GitHub CI remains unverified.
Updated: 29 September 2026.
Branch: `cross-context-queries`.
Base: official `origin/master`, `2324311be8c23024f66cb2ba702fbe99a99e7dfb`.

## Human-Imposed Requirements Ledger

- A Process Manager query finds the context registering its target Entity by
  type URL, without an application-supplied context name. Keep `select()`.
- Search only contexts registered with the same `Server`; no remote discovery.
- Reject duplicate Entity type registrations across those contexts before
  processing begins. Name the type and both contexts in a simple error.
- Every operation has an effective tenant, including single-tenant operations.
  Follow the latest official JVM sources, not memory or old research notes.
- Preserve the triggering signal's tenant. Reject an incompatible destination
  before reading; never substitute its tenant. No tenant-switching API.
- A named tenant can query a multitenant context for that tenant, but cannot
  query a single-tenant context. `SINGLE_TENANT` can query a single-tenant context
  or its identically named partition in a multitenant context.
- Missing records are empty results, not tenant mismatch. Omitted wire tenant
  fields may remain valid in single-tenant mode; execution resolves the identity.
- Keep snapshot publication advancing only `snapshot`, not `latest`.
- No new dependencies, outbox, speculative infrastructure or unrelated repairs.
- Use simple documentation, comments in examples, and domain-correct Proto types.
  Retain framework `ProcessManager`; do not suffix application names with Manager.
- Document all classes/methods/generic parameters in touched authored production
  files, separate declarations with blank lines, and obey the 35-line callable
  limit and Proto layout rules. Never hide fixtures in encoded descriptors.
- Follow the current protocol's worktree, explicit model routing, immediate
  pushes, version-only commit, independent review and verification rules.
- Do not create or merge a PR, publish packages or change npm tags.
- Add query-based routing for every supported Entity/signal combination: Commands
  to Aggregates and Process Managers; Events, including rejections, to Entities
  with corresponding handlers; state updates to Projections. Do not introduce
  new handler combinations, such as Commands handled by Projections.
- Routing queries search only the repository receiving the signal, never other
  repositories or contexts. This is separate from cross-context PM handler reads.
- Provide `findIds(query)`, `findStates(query)` and `find(query)` for the same
  typed Entity query. Return typed IDs, generated state messages and actual
  application Entity instances respectively. Never substitute state messages
  or wrapper objects for Entity instances returned by `find()`.
- Permit application code to inspect returned Entities and filter them before
  returning recipient IDs. Restore Entities using normal construction, configured
  dependencies, stored Version and lifecycle; finding them must not invoke signal
  handlers or save changes.
- Routing callbacks receive query access to the receiving repository as their
  third argument, retaining message and context as their first two arguments.
  Support asynchronous routing while preserving existing synchronous callbacks.
- Remove the 1,000-recipient rejection. Deliver to every selected distinct
  recipient. Above 1,000 recipients, print a warning through the existing logger
  and its console output. Warn in routing after manual filtering/deduplication,
  not in any repository find method. Exactly 1,000 does not trigger the warning.
- Do not replace the removed ceiling with another fixed match-count ceiling,
  silent truncation or partial success. Application-requested limits remain
  deliberate query criteria; existing unrelated transport bounds are not waived.
- Include the generated query DSL revamp in this same task and branch. A normal
  model-generation run must emit ready-to-import queries for all three Entity
  families, with column registration performed automatically on import.
- Users import one generated query entry point, such as `OrderCardQuery`, and
  call `OrderCardQuery.create().customerId().is(value).build()`. Generate typed
  methods from `(column)` definitions and JVM-like comparison/grouping methods.
  No manual column registration, schema/column pairing, second generation command
  or per-application handwritten query helpers are required.
- Build queries without choosing a tenant or actor. Execution supplies the
  current operation context; no tenant-switching API is introduced. Keep one
  shared query description usable by repository, PM and client query execution.

## Original cross-context scope and design

This is high-risk work: tenant isolation and cross-context startup/shutdown
behavior change. The prior Astra/high architecture pass and fresh standalone
Sol/medium plan review are complete for the original slice. The extension below
changes public query and routing contracts and requires its own plan review.

Use common effective-tenant handling at existing execution/query/storage
boundaries. Do not create a Process Manager-only exception or rewrite persisted
partition keys merely to represent the effective tenant as a `TenantId`.
Single-tenant storage already has a distinct internal boundary.

Share a small internal type-to-context lookup with client query routing. Keep
registered schema, columns and context together; target registration governs
validation. Do not merge internal/public response formats or use loopback HTTP.
Install lookup before delivery recovery and update existing captured runtime
bindings. Standalone contexts retain local reads; separate Servers stay isolated.

Foreign targets require `query` or `full` visibility, checked before storage.
Existing local/public visibility behavior is outside this scoped correction.
Unknown, hidden and tenant-incompatible targets are errors, not empty results.
Preserve actor context, query predicates, masks, ordering, limits, lifecycle
filtering, cloned results and handler-scoped read-only access.

Startup duplicate validation and partial route installation belong inside
retryable cleanup for constructed contexts/resources. During shutdown, stop
admission and drain accepted handlers across every context before closing any
Stand. Reuse existing lifecycle operations, without a new lifecycle framework.

## Original implementation sequence and acceptance (completed locally)

1. Add failing focused tests and implement common effective-tenant resolution.
   Prove named-tenant separation, single-tenant identity, omitted wire fields,
   mismatch before storage, and valid empty results.
2. Add shared target lookup and route handler reads. Prove all Entity families
   when queryable, local/foreign reads, standalone fallback, Server isolation,
   duplicate registrations in either order, visibility and unknown targets.
3. Connect startup and two-phase shutdown. Prove recovery sees complete routes;
   failed validation starts neither recovery nor listening and cleans up; a
   handler paused before querying another context completes during shutdown
   regardless of registration order. Preserve retryable close behavior.
4. Add a real two-context example and focused integration tests for command,
   event/rejection and restored Entity handler queries. Keep user-facing docs,
   package reference and TSDoc accurate about tenants and eventual consistency.
5. Run cheap preflight, collect all relevant independent review concerns, fix
   accepted findings, then run `verify:release` once after convergence. Inspect
   changed-source coverage and require at least 90% global coverage.
6. Bump all workspace versions to one verified-unused snapshot in a version-only
   commit, update pins/lockfile/docs separately, push every commit immediately,
   and verify exact remote state. Confirm final-SHA CI when a human-created PR
   exists; do not create one to bypass that restriction.

## Original source evidence

Latest official JVM revision freshly fetched during analysis:
`ea3067b137938ac0beb6920c39d11e300976fcc9`.

- `tenant/SingleTenantIndex.java`, `TenantAware.java` and its operation tests:
  single-tenant execution resolves to `SINGLE_TENANT`.
- `TenantAwareRunner.java` is internal; operation/function bases are SPI, not
  ordinary application tenant-switching APIs (repository README policy).
- `query/QueryingClient.kt`, `procman/ProcessManager.kt` and repository configure:
  JVM handler queries stay local; requested cross-context behavior extends that.
- `stand/QueryValidator.java`: query visibility is required.
- `VisibilityGuard.java` and `TypeDictionary.java`: inspected guards are local
  and the public dictionary overwrites duplicates; do not claim a proven JVM
  server-wide rejection. TS server-wide rejection is the user's explicit rule.

At the original TS baseline, PM reads bind to `runtime.stand`, public services build a
type-to-context map, and storage uses `TenantBoundary.single`. Server shutdown
closes contexts sequentially. The completed original implementation addresses these
specific paths, not invent a parallel query language or tenant framework.

## Original estimate and review

Active work: 1.5–2.5 hours, plus CI waiting. Runtime and focused tests:
0.8–1.3 hours; example/docs: 0.2–0.4; preflight, reviews, corrections, release
verification, version integration and reporting: 0.5–0.8.

One Sol/medium implementer handles overlapping production/test/example files.
Existing style, API and reliability reviewers use Sol/medium; documentation
review uses Luna/medium. Mechanical verification uses Luna/low (medium for
classification). Final security review, if required at release acceptance, uses
Sol/high. No child spawns children. All dispatches explicitly name both fields.

The work log records skill checks, verification and remote state. The review log
records independent findings and all four canonical concern dispositions.

## Extension: repository queries during routing

### Problem and expected result

A CustomerNameChanged Event contains a customer ID, not the IDs of every order
card that displays the customer's name. Its receiving Projection repository
should find matching cards and deliver the Event to their IDs. A Command may
similarly carry an external order reference rather than an Aggregate ID.

`findIds(query)` returns matching IDs without constructing application Entities.
`findStates(query)` returns detached generated state messages, also without
constructing Entities. `find(query)` returns correctly restored instances of
the receiving repository's Entity class. The latter permits application filtering:

```typescript
const routing = EventRouting.create(OrderCard).route(
  CustomerNameChangedSchema,
  async (event, context, repository) => {
    // Query the receiving repository using the Event's tenant automatically.
    const query = OrderCardQuery.create().customerId().is(event.customerId).build();
    const cards = await repository.find(query);

    // Inspect an ordinary state field before selecting the final recipients.
    return cards.filter((card) => card.state.customerName !== event.newName).map((card) => card.id);
  },
);
```

This is proposed syntax, not currently working code. Passing the application
Entity class lets TypeScript infer its ID, state and application methods; an ID
type alone cannot describe the instances returned by `find()`. Preserve existing
ID-only routing declarations for callbacks that do not use repository queries.
The schema, query and Entity names describe an illustrative order-card model.
Concrete examples must supply its generated imports and domain-correct Proto
declarations. Compile-time tests must prove that `find()` retains application
methods and rejects queries for a different receiving Entity type.

The third argument provides reads bound to this routing invocation:

- `findIds(query)`: `Promise<readonly Id[]>`.
- `findStates(query)`: `Promise<readonly State[]>`.
- `find(query)`: `Promise<readonly InstanceType<EntityClass>[]>`.

These names stand for types inferred from the supplied Entity class, not extra
type arguments application code must provide. Do not expose unrelated repository
maintenance or write operations. Once routing finishes, a retained reference
must not start new reads. No general tenant-selecting repository API is required.
Returned Entities are not running inside a handler transaction; reading them
does not persist application changes or invoke signal handlers.

The same built query may be passed to any of the three methods. Reject queries
for another Entity type, even if its fields happen to have compatible shapes.
Find existing stored records; do not create missing Entities. Reads must not
implicitly require public query visibility on the receiving repository.
Use the existing repository storage/query facilities rather than routing these
local reads through public Stand services or the cross-context PM lookup.

Resolve and validate the incoming tenant before any query. Bind it separately
for each asynchronous routing invocation; never change a shared repository's
current tenant. Empty results are legitimate; database or query failures are
errors, not empty results. A Command still selects exactly one ID. An Event or
state update may select none, one or many. Applications must explicitly decide
what to do when a Command lookup has zero or several matches; never choose the
first result automatically.

Read saved state at query time, without promising atomicity with later handler
execution. Preserve recorded targets during Inbox replay instead of rerunning
the query. Await the entire route before handing off recipients. Pending routes
must participate in existing shutdown draining and failure handling. Do not
introduce an outbox or claim new crash-atomic multi-recipient delivery guarantees.

Direct `routeCommand()` and `routeEvent()` calls must await asynchronous routing
too. Continuing to accept synchronous callbacks does not make those execution
methods synchronous. Document and update their call sites and test both direct
routing and signal admission while a lookup is pending.

For the new repository methods, follow JVM's stored-record lifecycle selection:
exclude archived and deleted records by default only when neither IDs nor
lifecycle conditions are specified. Explicit IDs or lifecycle predicates,
including nested conditions, suppress that implicit filter. Apply lifecycle
selection before sorting and any requested limit. Preserve restored flags; a
read must never revive an Entity. Keep existing Process Manager and public-query
defaults unchanged: this policy belongs to repository execution, not to the
shared query description.

After validation and stable deduplication, warn once per routing evaluation
when more than 1,000 recipients remain, identifying signal, repository and count.
Keep warning policy out of `find*()` and do not repeat routing just to warn on
replay. Retain all chosen recipients. Examine lower-level candidate budgets and
result slicing so an existing storage/query bound does not silently defeat this
requirement. Bounded internal batches are acceptable; dropping later batches or
imposing a replacement total-result ceiling is not.

Use an explicit exhaustive-read policy for receiving-repository lookups. Merely
omitting `candidateLimit` is insufficient: current policy defaults to 10,000
candidates, memory has its own scan bound, and Datastore has a configured bound.
Cover memory, PostgreSQL, MySQL and supported Datastore query shapes. Across
internal pages, apply filtering, sorting and an explicit application limit to
the complete result, not independently to each page. Unsupported query shapes
must fail clearly, never produce partial results. Preserve existing bounded
public/PM queries and transport batch sizes; split larger recipient sets into
as many transport batches as needed. Test later-batch failure using existing
recorded-target delivery guarantees, without promising new all-or-nothing
multi-recipient delivery.

### Generated query interface

Generate a companion for each eligible state, for example an `OrderCardQuery`
export in `order_cards_query.ts`, corresponding to `order_cards.proto`.
One module may export multiple named Entity queries when the Proto file contains
multiple Entity states. The ordinary generation command includes this output.
Discover eligible nested messages too. Generate deterministic names and detect
collisions between model names and query operations; do not silently omit a
column named `build`, `either` or `constructor`. Use a documented escaped
accessor where needed. Preserve existing rejection of reserved system column
names. Test nested-name collisions and identifiers such as `order_id`.

Importing the query module registers its columns and binds its schema. It does
not access storage, choose a tenant or execute a query. Repeated imports and
equivalent generated descriptors must not introduce conflicting registrations.
Keep generated registration connected to the used query export so package
bundling does not accidentally remove necessary initialization.

`create()` returns a fresh builder. `build()` returns a typed, independent query
description that later builder edits cannot change. Copy mutable input values
such as message IDs, timestamps, versions and byte arrays when building it, so
later changes to those inputs cannot change the query either. Do not put actor
or tenant selection into this description. Infer the Entity ID, state and column
types; users should not have to repeat schema or column type arguments. Use the
repository's canonical ID-field definition, not a property assumed to be `id`.

Generate field accessors and only valid comparison methods:

- `customerId().is(value)` for equality.
- `totalAmount().isGreaterThan(value)`, `isGreaterOrEqualTo(value)`,
  `isLessThan(value)` and `isLessOrEqualTo(value)` for ordered values.
- Successive conditions mean AND; `either((q) => ..., (q) => ...)` means OR,
  including nested combinations supported by the existing query representation.
- Preserve ID filtering, ordering, explicit positive limits, returned-state
  fields, and the version/archived/deleted columns without exposing raw metadata.
- Reject wrong value types and foreign-Entity columns at compile time and check
  malformed inputs at runtime. Reuse existing supported column kinds; this task
  does not add joins, collection columns or full-text search.

Use the existing common query compiler and storage plans; no parallel query
engine, runtime discovery, schema monkey-patching or new library is needed.
Generated application code must depend on common/browser-safe runtime query
support, not on the server or a Node-only client. Move the column generation
work into the normal `proto-tools` flow rather than retain a Todo-only workaround.
Keep public package exports, generated declarations and generation fingerprints
consistent. Query generation must work in an external model package too.

Repository execution obtains its context from the current routing invocation.
PM execution continues using the current handler context and the approved
cross-context rules. Client execution obtains context from its existing caller
configuration. Define the common query value before implementing its consumers:
the repository methods, `this.select(query).read()` in a Process Manager, and
the existing client request's `send(query)` accept that same value. Preserve
existing supported overloads. Build actor, tenant and wire-request metadata at
execution, not in the shared description. Test reuse of one query concurrently
in different tenants and preserve each execution path's visibility and limits.
This extends existing entry points rather than adding another query engine.

### Remaining user decision: selected fields and complete Entities

A query may request only some state fields. Should `find(query)` nevertheless
restore complete Entities? Recommendation, pending user approval: yes.
`findStates(query)` would return only the selected fields; `findIds(query)`
would ignore state-field selection; `find(query)` would restore full state and
explicitly document that it ignores field selection.

For example, a query selecting only a customer's name must not accidentally
leave out the saved delivery address that `OrderCard.canShip()` needs. The
alternative is to follow JVM's masked-record restoration, returning Entities
with omitted fields represented by Protobuf defaults; application methods and
state validation can then encounter incomplete state. This is a visible
behavioral choice, not an implementation detail. Record the user's answer before
implementation and test the selected behavior for all three find methods.

### Remaining implementation sequence and tests

1. Freeze the typed query and class-aware routing contracts after the remaining
   user decision. Define PM/client acceptance alongside repository acceptance.
   Test ID/state/application-method inference, supported existing overloads,
   foreign-Entity rejection and independent queries, including mutable inputs.
2. Integrate automatic query generation and registration into the normal model
   pipeline. Test all Entity families, fresh external consumers, repeated imports,
   package exports, browser-safe dependencies and regeneration after Proto edits.
   Include nested Entities, accessor/name collisions, non-`id` identifier fields,
   stale-output cleanup, failed-generation rollback and output fingerprints.
3. Implement exhaustive repository-query execution and lifecycle selection in
   memory, PostgreSQL, MySQL and supported Datastore paths. Test more than 10,000
   matches, a sparse match after 10,000 candidates, Datastore reads spanning its
   current 1,000 bound, global ordering/explicit limits across pages, archived
   and deleted records, explicit IDs and nested lifecycle conditions. Preserve
   existing PM/public query limits and lifecycle behavior.
4. Implement the three receiving-repository reads with tenant isolation, exact
   return types, detached states and normal Entity restoration/constructor hooks.
   Test empty results, query failures, wrong Entity queries, Version/lifecycle,
   application read methods, selected-field behavior and no unexpected handlers
   or writes. Test missing runtime binding, overlapping tenants and attempts to
   reuse routing read access after the callback has finished.
5. Connect asynchronous exact-schema, interface and default routes, including
   state updates, to direct dispatch, acceptance and durable Inbox delivery.
   Test every legal Entity/signal pairing, sync compatibility, overlapping tenant
   requests, failure before delivery, recovery and shutdown while a query waits.
   Remove recipient ceilings and handle complete query results. Test 0, 1, 1,000,
   1,001 and more than the existing storage candidate bound, duplicate IDs, manual
   filtering below the warning threshold, one warning above it, and replay with
   recorded recipients after stored data changes. Cover local and remote delivery
   exceeding one transport batch, including later-batch failure. No silent
   adapter-dependent truncation or new multi-recipient atomicity claim.
6. Complete PM/client integration using the contract fixed in step 1, update Todo and
   the routing example, and remove manual registration from affected application
   code. Update guides and all touched TSDocs with real generated imports and
   commented examples. Explain Entities versus state messages and query timing.
7. Run scoped checks and changed-source coverage, then relevant independent
   reviews. Return one accepted finding batch to the retained implementer. After
   corrections converge, run `verify:release` and exact-tarball consumer checks.
   Preserve the original cross-context regressions; its earlier passing result
   is not evidence that this extension is verified. Confirm final-SHA CI when
   a PR is available. Recheck snapshot availability before release readiness;
   do not add a second version bump merely because this is another task slice.

This extension is high-risk because it changes public generated contracts,
asynchronous routing, tenant-scoped storage reads and delivery. One existing
requirements splitter completed the independent architecture/plan pass with
explicit Astra/high and no inherited history or memory. Implementation later
uses one Sol/medium writer; scoped mechanical checks use Luna/low or medium;
relevant specialist profiles remain as specified above. No child spawns children.

Current authorization is to write and review this plan, then ask remaining
questions; it does not authorize implementing the extension in this turn.
Planning/review estimate: 0.2–0.35 hours. The implementation estimate will be
broken down after review resolves any material contract choices.

### Extension source evidence

Latest JVM source inspected on 29 September remains
`ea3067b137938ac0beb6920c39d11e300976fcc9` in official `core-jvm`:
`RecordBasedRepository.java` distinguishes `find(EntityQuery)` and
`findStates(EntityQuery)`; `AggregateQueryingTest.java` demonstrates generated
Entity-specific field accessors and nested conditions. These sources support
the shape of the proposal, not a claim that all execution details already match.

Current TS evidence: `packages/core/src/query/entity-query.ts` provides typed
predicates, builders and compiled plans; `entity/entity-column.ts` validates
registered definitions; `packages/client-node/codegen/generate-entity-columns.mjs`
generates column definitions, not fluent Entity-specific queries. The normal
`packages/proto-tools/src/generation/generator.ts` Buf phase does not include
that generator. Todo's `buf.gen.custom.yaml` and `src/entity-columns.ts` add
generation and registration manually. Repository routes are synchronous and
Event/state-update callbacks reject more than 1,000 IDs. Existing PM reads also
have a separate 1,000-result slice; do not reuse that execution path for uncapped
repository routing queries or silently extend the routing decision to unrelated
APIs without recording the intended scope.

The independent review checked these execution details in particular:

- `packages/storage/src/query/query-policy.ts:231` and
  `packages/storage/src/record/record-storage.ts:188`: candidate policy.
- `packages/storage/src/memory/in-memory-entity-history.ts:375` and
  `packages/storage-datastore/src/datastore/record-storage.ts:553`: provider
  bounds that must be accounted for, not assumed removed by the routing change.
- Latest JVM
  [EntityRecordStorage.java](https://github.com/SpineEventEngine/core-jvm/blob/ea3067b137938ac0beb6920c39d11e300976fcc9/server/src/main/java/io/spine/server/entity/storage/EntityRecordStorage.java#L264):
  lifecycle defaults and explicit-ID/lifecycle-condition exceptions.
- Latest JVM
  [ToEntityRecordQuery.java](https://github.com/SpineEventEngine/core-jvm/blob/ea3067b137938ac0beb6920c39d11e300976fcc9/server/src/main/java/io/spine/server/entity/storage/ToEntityRecordQuery.java#L95)
  and
  [RecordBasedRepository.java](https://github.com/SpineEventEngine/core-jvm/blob/ea3067b137938ac0beb6920c39d11e300976fcc9/server/src/main/java/io/spine/server/entity/RecordBasedRepository.java#L310):
  field selection and Entity restoration relevant to the remaining question.
