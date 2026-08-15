# Wave 12: Runtime Correctness And Bounded Delivery

Status: Requirements split accepted; pending specialist review

## Authority And Baseline

This plan implements only the Wave 12 portion of the binding strict agentic
review. Its exact verified baseline is
`7b8a631ecb33210e5da4da9ffa2d8eb8aa59d497`, the value of `origin/main` after
fetch on 2026-08-15. T-0187 is classified high-risk because the work crosses a
real browser stream, Gateway/native transport lifecycles, SQL capability and
cost contracts, persistent Inbox deletion, shard fencing, public TypeScript
configuration, provider execution, and release verification.

The complete human requirements are preserved verbatim as an auditable ledger
in [`T-0187`](../tasks/T-0187-wave12-plan/TASK.md). The strict review result is
binding: C-01, X-01, D-01, and the Wave 12 part of P-04 are true/open; S-04 is
the sole false finding. Similar names, test-only helpers, local behavior, source
inclusion in V8, and `catchUpReadSide()` do not earn distributed/provider/
Projection acceptance credit.

## Scope And Exclusions

Wave 12 corrects:

1. a passive browser subscription that terminates during ordinary successive
   Message Board updates;
2. MySQL normalized query-plan admission and provider execution;
3. unbounded delivered Inbox storage;
4. current documentation affected by those stabilized behaviors.

Wave 12 adds no provisional API or implementation for cross-context event
exchange, package/SPI publication, registry integrity or tenant admission,
Projection catch-up, secure distributed defaults, Cloud Run, or multiple
Gateways. Those remain in Waves 13 through 19 in the binding order. The root
README remains repository-entry documentation and is not a Wave 12 feature
manual.

## Accelerated Autonomous Execution Model

After T-0187 is reviewed, verified, merged, post-merge checked, pushed, and
remotely closed, the orchestrator starts three isolated implementation streams
from the same freshly verified `origin/main`:

| Stream          | Task chain                                      | Exclusive initial ownership                                                             |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Browser         | T-0188 RED/isolation -> T-0189 proven-owner fix | Message Board interop harness/tests, then only the runtime family proven faulty         |
| Query providers | T-0190                                          | normalized query policy/execution, MySQL/Datastore query adapters and query conformance |
| Inbox cleanup   | T-0191 exact atomic removal -> T-0192 lifecycle | delivery ports/lifecycle, new provider cleanup seams, cleanup/fencing conformance       |

Each stream has one bounded implementation owner in its own worktree/branch,
explicit `gpt-5.6-terra`/medium dispatch, no child subagents, and no permission
to revert or overwrite another stream. Review-only lanes run concurrently after
each stream's mechanical checks. The primary checkout remains coordination-only.

Potential provider overlap is explicitly serialized: T-0190 owns existing
MySQL/Datastore `record-storage.ts` query code until its reviewed endpoint is
available. T-0191 may build provider-neutral, memory, server, and new adjacent
provider-cleanup modules concurrently but cannot edit those owned record-storage
files. If atomic cleanup genuinely requires them, the Inbox stream waits for
T-0190's endpoint, rebases/merges without rewriting published history, then
takes a recorded ownership handoff. No two production writers own one file.

Every checkpoint commit is pushed. Because remote policy forbids declaring any
task closed while another unique remote branch exists, parallel branches remain
active/in-progress evidence until the complete reviewed train is ready. The
orchestrator then integrates the three streams in dependency-safe order,
reconciles every unique ref, and declares task closure only after all task
branches are contained in `origin/main`, deleted, and the remote again exposes
exactly `main` and no tags.

Provider/runtime commands sharing generation, coverage, ports, Envoy, browsers,
emulators, or databases remain serialized. This preserves deterministic proof
while implementation, focused unit checks, documentation research, and
specialist reviews consume independent capacity. T-0193 documentation begins
as soon as all three behavior endpoints stabilize; T-0194 alone owns final
cross-stream security/release convergence.

Planning estimate at T-0187: 35-50 total agent-hours and 16-24 uninterrupted
elapsed hours with three streams, assuming live MySQL, Datastore emulator,
Chromium/Envoy, and remote authentication remain available. Provider/browser
verification, dependency-safe integration, and final release/security gates are
the irreducible serialized tail.

## Frozen Contract Decisions

### Browser subscription lifecycle

- The supported proof topology is a real browser using gRPC-Web through Envoy,
  the standalone Gateway, its dynamic/native subscription forwarding, and the
  Message Board application server. A Node transport test is supporting proof,
  not browser acceptance.
- Best-effort means notification gaps and duplicates are possible and a real
  disconnect may reconnect and re-query. It does not permit a healthy stream to
  complete after ordinary updates.
- The first browser task is RED/isolation before repair. It must determine
  whether native subscription production remains active while Gateway
  forwarding ends. No component is preselected as the root cause.
- Cancellation, iterator return, session disposal, reconnect attempts, Gateway
  relay closure, Stand attachment, and bounded delivery queues must all reach a
  terminal state on explicit cancellation, page closure, real disconnect, and
  server shutdown.

No public or serialized browser API is approved. A correction should remain
inside an existing lifecycle contract unless the RED trace proves that contract
cannot express the required behavior.

### Normalized MySQL query plans

MySQL must override both capability admission and plan execution. Every plan it
admits is pushed into one parameterized SQL statement scoped to the already
selected tenant database and resolved storage-group table. The shared Node
evaluator may validate provider output or apply a mask only where the provider
cannot return a partial Protobuf body; it may not rescue a full-group fetch.
The public optional `candidateLimit` has a shared finite default of 10,000.
The provider fetch bound is the smaller safe bound derived from an exact plan
limit and `(candidateLimit ?? 10_000) + 1`, so the caller can detect a candidate
overflow without materializing an unbounded result. The base RecordStorage
implementation must reject an unimplemented nonempty provider plan instead of
inheriting the current full-group fallback.

The Wave 12 capability matrix is:

| Plan feature       | MySQL Wave 12                                                                                            | Datastore participation              | Contract                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| ID set             | Admit and push down                                                                                      | Existing pushdown conformance        | Bound placeholders; empty IDs reject                                                     |
| Equality           | Admit and push down                                                                                      | Existing pushdown conformance        | Typed provider mapping for operands                                                      |
| Comparisons        | Admit for mapped orderable columns and push down                                                         | Existing supported operators         | Reject unsupported value/column shapes before query                                      |
| Composite `all`    | Admit and parenthesize conjunction                                                                       | Existing overlap                     | No Node fallback                                                                         |
| Composite `either` | Admit and translate to bounded parenthesized SQL                                                         | Reject: no genuine Datastore overlap | Never issue an unfiltered provider query                                                 |
| Ordering           | Admit and push down with stable ID tie-breaker                                                           | Existing overlap                     | Declared mapped columns only                                                             |
| Limit              | Admit and push down                                                                                      | Existing overlap                     | Positive bound; never only a post-fetch slice                                            |
| Mask               | Admit only with complete-record fetch plus post-fetch mask when candidate SQL is otherwise fully bounded | Existing overlap                     | Mask is not permission to full-scan                                                      |
| Offset             | Not a `NormalizedQueryPlan` feature                                                                      | N/A to this contract                 | Do not add it in Wave 12; `RecordQuery.offset` remains a separate existing provider path |
| Candidate limit    | Enforce explicit value or shared 10,000 default through provider fetch bound plus defensive result check | Existing overlap                     | Never materialize beyond the finite bound                                                |

This is a public TypeScript contract correction but not a serialized change.
Unknown columns, incompatible operands, unsupported plan shapes, unsafe
identifiers, and unbounded features fail before provider access. User values
are bound parameters. Only schema-derived, validated table/column identifiers
may be interpolated.

Datastore must advertise only its real overlap: IDs, equality, a provider-legal
single inequality column, flat conjunction, inequality-compatible ordering,
limit, and mask. Nested/disjunctive or provider-illegal inequality/order shapes
reject before any unfiltered read.

The table primary key supports ID access. Operators are responsible for indexes
on declared native columns used by workload filters and ordering. Package
reference documentation must state expected equality/range/composite/order
indexes and the cost consequence of omitting them; the runtime must still bound
result materialization.

### Delivered Inbox cleanup

`keepUntil` remains one optional serialized deduplication deadline. It is not a
retention duration. A delivered row is cleanup-eligible when `keepUntil` is
absent or `keepUntil <= now`, matching pinned JVM cleanup semantics. Pending,
scheduled, catch-up, retryable, and delivered-but-still-protected rows are not
eligible.

There is no independent operator-configured delivered-row retention period in
Wave 12. Adding one would invent a second concept absent from the pinned JVM
builder and would delay finite cleanup. Existing producers that require a
deduplication interval continue to write `keepUntil`; the framework's current
repository handoff retains its 30-second deduplication window. A direct message
without `keepUntil` receives JVM's zero-window behavior.

The exported `DeliveryInbox` persistence port gains one source-compatible
optional method:

```ts
removeDelivered?(
  message: InboxMessage,
  session: DeliveryWorkSession,
  options?: DeliveryOperationOptions,
): Promise<boolean>;
```

It returns `true` only when the exact matching delivered snapshot was removed
under the same still-current shard session and `false` when ownership is stale,
the row is absent/not delivered, or the snapshot no longer matches. Direct
Inbox storage delegates to a provider-owned atomic delivery-cleanup seam modeled
after the existing atomic Entity commit seam. Memory uses one critical section;
Datastore uses one transaction over session and Inbox entities; transactional
MySQL locks/verifies the session and conditionally deletes the Inbox row in one
transaction. A supported nontransactional MySQL mode must use one provider
advisory fence shared by pickup/renew/release and cleanup or reject cleanup
configuration explicitly. Separate validation followed by deletion is
forbidden.

`RemoteInbox` omits the optional cleanup method because its successful
acknowledgement already removes the pending row and leaves no delivered row to
retain. Its existing Remove RPC therefore needs no Wave 12 semantic or
Protobuf change.

Cleanup is an internal bounded delivery phase, not a new public CleanupStation,
Proto field, monitor action, timer, or scheduler. It:

- selects one page no larger than the delivery page size for the currently
  owned shard;
- orders deterministically for continuation;
- deletes only an exact delivered snapshot while atomically proving the shard
  session remains current;
- stops on ownership loss, cancellation, deadline, or page bound;
- runs within `ServerEnvironment`'s existing delivery lifecycle and is awaited
  during shutdown;
- supplies at least one cleanup page per processed delivery page plus one
  maintenance page for an otherwise empty owned drain, so sustained successful
  delivery cannot outpace cleanup capacity.

Cleanup may run after a bounded delivery page while the same session is held,
and it must also make progress on a shard that contains only already-delivered
eligible rows after crash/restart. A stale owner cannot delete after another
owner acquires the shard, including when ownership transfer races between an
ordinary validation point and deletion. The existing public page-size bound controls cleanup;
no new retention or cleanup-frequency configuration is approved.

The optional member preserves source compatibility for existing structural
`DeliveryInbox` implementations. Built-in local persistence provides it and
receives the bounded cleanup guarantee. RemoteInbox removes on acknowledgement;
a custom implementation that omits the method remains valid but owns its own retention and is explicitly not
advertised as receiving framework cleanup. Consumer-facing compile tests and
TSDoc freeze this limitation. No Protobuf wire layout changes.

## Current-State Execution Traces And Test Gaps

### C-01 trace

`browser.spec.mjs` -> browser `entry.ts` -> `TopicSubscription` -> browser
gRPC-Web -> Envoy -> native Gateway relay -> `SubscriptionGateway` ->
`InMemorySubscriptionBindings` -> `DynamicSubscriptionCreator` /
`DynamicUnaryForwarder` -> `NativeSubscriptionCreator` -> application
`SubscriptionService.Activate` -> `SpineServices.#activate()` -> durable
subscription record -> Stand `SubscriptionRuntime` / observer -> bounded
`SubscriptionDelivery` -> reverse path to browser iterator.

The present browser and Node topology acceptances consume one update and let
the subscribing actor write it. They do not prove a passive viewer survives
three writes, distinguish native production from Gateway forwarding, or assert
all active-stream/cancel/dispose counters return to zero.

### X-01 trace

Entity query plan -> `RecordStorage.queryPlanEntries()` ->
`StorageQueryPolicy.validate()` -> MySQL inherited
`queryPlanRecordEntries()` -> `queryRecordEntries({})` -> full resolved table ->
materialize native columns -> `StorageQueryEvaluator` in Node.

MySQL has a separate parameterized `querySql(RecordQuery)` path, but normalized
plans do not use it. Entity commit-contract tests replace
`queryPlanEntries()` with stubs. The live MySQL suite proves the separate
`RecordQuery` path only. Datastore already advertises explicit capabilities and
uses provider pushdown, so its overlapping behavior supplies a second
provider-conformance participant rather than evidence for MySQL.

### D-01 trace

repository/context handoff -> `Inbox.receive()` -> `InboxStorage.admit()` ->
direct provider RecordStorage -> delivery worker/coordinator -> `Delivery.drain()`
-> shard pickup -> page read -> handler -> ownership validation -> exact
pending-to-delivered CAS -> row remains forever.

Deduplication scans delivered rows and treats `keepUntil` as protection, but no
port or lifecycle deletes expired delivered rows. Existing tests omit expiry
boundaries, stale-owner delete fencing, eligible-only selection, restart-only
cleanup, live providers, and sustained bounded-growth evidence.

## Failing-Before Proof Designs

### Browser RED

Add a two-page/two-tab browser harness API. Tab A creates and activates the
subscription and performs no command writes. Tab B (or a separate authenticated
actor page) posts three sequential valid messages only after Tab A reports an
active stream. Tab A must observe three distinct successive snapshots in order
without reconnect being forced by test code. Capture native production and
Gateway forwarding counters after every write. The baseline is RED if native
updates continue but the browser iterator ends, or if both terminate after an
ordinary update. Bound readiness, each update, cancellation, and shutdown;
assert zero leaked active streams/sessions after cleanup.

### MySQL RED

Create a production-path conformance case that obtains the real
`MysqlRecordStorage` and calls `queryPlan()`/`queryPlanEntries()` without
replacing either method. Seed matching and nonmatching rows in the same group,
plus separate groups/tenants where supported. Capture actual driver SQL and
parameters in the unit contract and execute the same cases against live MySQL.
Baseline RED must show either capability rejection or an unfiltered full-table
statement. Assert admitted equality/comparison/composition/order/limit are in
SQL, unsupported plans fail before the query, and no statement can see another
group or tenant.

### Inbox RED

Use the real `InboxStorage` over the shared RecordStorage provider conformance
fixture. Write pending, delivered protected, delivered exactly expired, and
delivered unprotected rows across two shards. A bounded cleanup call for one
owned shard must delete only its eligible exact snapshots. Baseline is RED
because no operation exists. Then exercise crash/reopen, retry/duplicate,
expiry equality, concurrent owner change, stale fence, and repeated sustained
delivery/cleanup cycles. Record physical row counts, not merely API outcomes.

## Dependency-Ordered Implementation Tasks

### T-0188 — C-01 Browser RED And Boundary Isolation

**Dependency:** T-0187 only. This diagnostic checkpoint must precede production
subscription edits.

**Ownership:** `examples/message-board/web/test/interop/browser/{entry.ts,browser.spec.mjs}`,
`examples/message-board/web/test/interop/{harness.mjs,topology.test.mjs}`, and
task evidence only.

**Functional acceptance:** on the exact baseline, a passive Chromium viewer
performs no writes while another tab/actor posts three sequential messages
through Envoy, Gateway, and native gRPC; await three distinct ordered updates;
run the equivalent three-update native activation directly against the backend;
record active-stream/update/cancel/dispose/binding counters after each boundary;
classify native production, Gateway forwarding, or browser consumption; close
every page, iterator, subscription, client, context, server, Gateway, and Envoy
on success, failure, and timeout. No production candidate is edited before the
RED/isolation evidence is durable.

**Tests/evidence:** real browser and direct-native topology commands run
sequentially. Production changed-source coverage is N/A because only diagnostic
test/harness code changes; any executable harness change receives focused
coverage where supported. Live evidence remains separate from V8.

**Documentation/review/security:** task evidence only. Performance/reliability;
style if the harness changes materially; docs/API N/A. Authentication policy is
unchanged and existing cookie/CSRF and actor isolation assertions remain.
Verification: cheap preflight plus focused topology/browser commands.

### T-0189 — C-01 Bounded Fix At The Proven Owner

**Dependency:** T-0188 classification.

**Ownership:** exactly the implicated family: server service/Stand for native
failure, auth Gateway/relay/bindings for forwarding failure, or `client-web`
for browser-consumption failure. Do not edit all candidate families
speculatively.

**Functional acceptance:** T-0188's RED becomes a passing regression; three
passive-viewer updates arrive without stream completion or reconnect; real
disconnect recovery still reconnects/re-queries and command retry remains
forbidden; bounded queue overflow still terminates explicitly; abort, iterator
return, remote cancel/dispose, active-stream decrement, binding removal, and
shutdown all settle within bounds. Focused tests cover the exact changed
terminal/lifecycle branch.

**Coverage/evidence:** >=90% changed executable lines and branches plus the real
browser proof separately. **Documentation:** lifecycle TSDoc if changed;
reader-facing prose waits for T-0193. **Review:** style and
performance/reliability; TypeScript/API if declarations change; documentation
if claims change. Authorization/context rewriting, if touched, is explicitly
security-relevant. Verification: cheap preflight, focused coverage, then
`verify:release` because shared subscription/auth/client behavior changes.

### T-0190 — X-01 Production Normalized-Plan Execution

**Dependency:** T-0187; independent of browser files.

**Ownership:** `packages/storage/src/{record/record-storage.ts,query/*}`,
MySQL plan execution, Datastore capability/pushdown correction, shared
conformance, provider tests, and provider README/reference sections.

**Functional acceptance:** real baseline MySQL calls—never method replacement—
show comparison rejection and equality/ID full-group fallback. A separate
Datastore diagnostic probes nested/disjunctive and provider-illegal inequality/
order shapes through the production planner and records whether current code
rejects, translates safely, or issues an unfiltered read; the plan does not
prejudge that baseline result. Passing acceptance rejects every unsupported
shape before provider access with zero provider calls. The frozen matrix becomes
executable: MySQL supports IDs, five comparisons,
flat/nested ALL/EITHER, ordering, limit, and mask; Datastore supports only IDs,
equality, one inequality column, flat ALL, compatible ordering, limit, and mask.
Base storage rejects unimplemented nonempty provider plans and applies the
10,000 default when no explicit candidate bound exists. Every MySQL
selection is bound `WHERE`, ordering is `ORDER BY`, and exact/candidate bounds
become bound `LIMIT`; unsupported plans make zero provider calls. Tenant
selection precedes table access, names are declared/validated, and values are
parameters. Live MySQL exercises the production plan method; Datastore emulator
executes genuine overlap. Document primary-key behavior and operator-provisioned
filter/order indexes.

**Tests:** storage policy/execution/conformance, MySQL unit/commit/live suites,
and Datastore pushdown/emulator suites. **Coverage/evidence:** >=90% changed
lines/branches; captured SQL and live providers are separate evidence and run
sequentially. **Documentation:** provider README/REFERENCE and API TSDoc; no
root README. **Review:** all four specialist lanes. Security covers parameter
binding, identifier validation, tenant/group containment, and cost bounds.
Verification: cheap preflight, focused coverage, then `verify:release` and
sequential provider profiles.

### T-0191 — D-01 Exact Retention Persistence Contract

**Dependency:** T-0187; independent of browser/MySQL implementation files.

**Ownership:** `delivery-ports.ts`, `inbox-storage.ts`, `inbox.ts`, an internal
provider-owned delivery-cleanup capability/registration modeled after atomic
Entity commits, memory/MySQL/Datastore implementations, direct Inbox/provider
conformance, and public TSDoc/export/type tests. RemoteInbox and delivery-server
removal are evidence-only and unchanged because remote acknowledgement already
removes pending rows.

**Functional acceptance:** exact delivered snapshots delete through
CAS-to-undefined; pending, scheduled, catch-up, changed/replaced, malformed,
and still-protected rows never delete; `keepUntil === now` is eligible; absent
`keepUntil` is immediately eligible after delivery; repeated removal is
idempotent; a stale snapshot cannot delete a changed row. Ownership verification
and exact deletion are one provider-atomic operation. Tests transfer ownership
at the former validate/delete gap and prove zero stale deletion. Persisted
bytes/columns stay unchanged. The optional method signature above is
source-compatible, is frozen by a consumer type test, and documents the
custom-port retention limitation plus RemoteInbox's remove-on-ack behavior.
Shared conformance runs with memory, live MySQL, and Datastore emulator.

**Coverage/evidence:** >=90% changed lines/branches; live provider CAS/delete
evidence separate. **Documentation:** port/storage TSDoc; full prose waits for
T-0193. **Review:** all four specialist lanes. Exact deletion, tenancy, group
containment, and malformed records are security-relevant. Verification: cheap
preflight, focused coverage, then `verify:release` and sequential providers.

### T-0192 — D-01 Shard-Fenced Bounded Cleanup Lifecycle

**Dependency:** T-0191 exact removal contract.

**Ownership:** `packages/server/src/delivery/delivery.ts`, minimal
worker/environment wiring only if proven necessary, and fencing/worker/restart/
retention/provider-backed tests. No scheduler or public cleanup owner.

**Functional acceptance:** cleanup runs only inside an acquired shard session;
reads bounded delivered pages; invokes the provider-atomic ownership-plus-exact-
removal operation for every row; stops on ownership loss; and supplies at least one cleanup page
per processed delivery page plus one maintenance page for an empty owned drain.
Failures leave eligible rows durable/retryable and do not affect pending work.
Tests cover crash before/after delete, restart, duplicate, expiry equality,
retry, two-owner race, replacement fencing, and sustained fake-clock batches
larger than one page reaching a finite row-count bound. Live MySQL and Datastore
use two independently opened handles to the same tenant/group. Remote delivery's
existing remove-on-ack path remains a zero-delivered-row case.

**Coverage/evidence:** >=90% changed lines/branches; physical row counts and
live providers separate. **Documentation:** lifecycle TSDoc; prose waits for
T-0193. **Review:** style and high-depth performance/reliability; API only if
T-0191's port changes again. Destructive fenced mutation is in final security
scope. Verification: cheap preflight, focused coverage, then `verify:release`
and sequential provider profiles.

### T-0193 — Wave 12 Documentation Convergence

**Dependency:** accepted T-0189, T-0190, and T-0192 behavior.

**Ownership:** affected package/example references,
`docs/{USER_GUIDE.md,api/README.md,architecture/README.md}` including stale
To-Do wording, and build-protocol specification/architecture/completion/decision
records. Root README is excluded absent a genuine repository-entry change.

**Functional acceptance:** describe only implemented browser, MySQL, and Inbox
behavior; preserve best-effort/gap language while denying ordinary healthy
termination; publish the exact MySQL matrix, offset exclusion, candidate bound,
parameterization, live profile, and index expectations; distinguish dedup
protection from shard-owned cleanup with no second retention/timer promise;
call `catchUpReadSide()` only a local reset/replay helper; keep domestic/external
exchange and enrichment unimplemented; preserve first-field routing and
non-event-sourced Aggregate truth; reject every Wave 13-19 claim.

**Tests/coverage:** deterministic snippets, links, terminology/prohibited-claim
scans, TypeDoc/API, format/diff. Executable checker changes require >=90%.
**Review:** documentation, TypeScript/API, and reliability for behavior/cost;
style N/A unless tooling changes. Security N/A except truthful tenant/trust
wording. Verification: cheap preflight plus `verify:task -- --no-tests` unless
tooling changes.

### T-0194 — Wave 12 Release Convergence

**Dependency:** T-0188 through T-0193 accepted and integrated in order.

**Ownership:** convergence evidence/record corrections only. Defects return as
one correction batch to the existing relevant implementation context.

**Acceptance:** map all findings to retained RED and passing-after evidence;
run combined cheap preflight; real browser/Envoy, live MySQL 8.4, then Datastore
emulator sequentially; inspect >=90% changed-source line/branch evidence
separately; collect all four specialist lanes as one wave; run the existing
final security reviewer; reopen only substantively affected lanes; run exactly
one converged `pnpm verify:release`; integrate from a clean worktree, perform
protocol-required post-merge proof, and push main. Reconcile every remote ref
without losing unique work, delete contained completed branches and all tags,
and freshly prove only `origin/main` and no tags. The protected primary checkout
remains untouched. Only then may Wave 13 begin.

## Verification And Evidence Rules

- Provider/runtime suites sharing generation, emulator, database, ports,
  browsers, Envoy, or coverage execute sequentially.
- Each implementation task runs deterministic/mechanical checks before review
  and its selected expensive profile once after correction convergence.
- V8 coverage proves executed TypeScript only. Browser topology, SQL statements,
  live MySQL, Datastore emulator/cloud, cross-process behavior, and physical row
  counts are recorded as separate evidence.
- Changed executable lines and branches require at least 90% focused coverage.
- Documentation follows stabilized code and never claims a deferred feature.
- Every canonical review concern receives a clean/accepted/N/A disposition with
  a concrete reason.

## Critical Path

```text
T-0187 plan
  |-- T-0188 browser RED --> T-0189 browser fix --|
  |-- T-0190 MySQL query plans -------------------|--> T-0193 docs --> T-0194 closure
  `-- T-0191 exact removal --> T-0192 cleanup ----|
```

The three streams have independent file ownership but are integrated
sequentially. Documentation waits for all runtime contracts. Release closure
waits for all preceding tasks and supplies the only Wave-wide release/security
gate.
