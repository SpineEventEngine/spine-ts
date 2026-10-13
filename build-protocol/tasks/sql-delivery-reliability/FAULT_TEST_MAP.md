# SQL and publication fault-test reuse map

The initial reuse-map sections below describe the starting snapshot before implementation; their line numbers and old transaction/test claims are historical investigation guidance, not current framework status. Storage and delivery changes are recorded in IMPLEMENTATION.md and ACCEPTANCE.md. Later sections in this file identify remaining route gaps and subsequent live evidence.

## Assignment evidence

This is the orchestrator-dispatched mechanical test-analysis function, explicitly configured as **gpt-6-luna / medium**. Runtime introspection is unavailable; no runtime model metadata is exposed. Read-only source analysis only. No scripts, builds, tests, or runtime files were changed.

## SQL diagnostic and partial Entity-write faults

- **Closest live fixture: MySQL-family** — `packages/storage-mysql/test/mysql-integration.test.ts:322-397`, test “rolls back or retains the exact immutable Entity prefix at each injected boundary.” It seeds all four actual families (current Entity record, state history, diagnostic history, EventStore), discovers physical table names with `mysqlEntityTables(input)` and `mysqlRecordTableName(eventStoreRecordSpec)`, alters them to the configured engine, creates a unique `BEFORE INSERT` trigger per family via the separate admin URL, checks the resulting prefix, drops each trigger in `finally`, then retries. `mutation()` carries generated `EntityRecordSchema` and `EventSchema`; the Event payload in the file uses generated `ProjectCreatedSchema`. This is the direct scaffold for live SQL diagnostic-row and family-boundary failures.
- **PostgreSQL mock seam, not live failure** — `packages/storage-postgres/test/postgres-entity-commit.test.ts:386-420, 516-562` has `driver.fail(sql, error, after)` with named SQL boundary cases for state, diagnostic, delivery preflight/append, current write, and COMMIT. “rolls back every transaction boundary without publishing a partial commit” currently asserts ROLLBACK and zero durable writes. This is deterministic driver-double coverage only.
- **PostgreSQL live scaffold** — `packages/storage-postgres/test/postgresql-integration.test.ts:278-305, 436-478` already builds real storage, Entity commit, EventStore, and generated ProjectCreated Event histories, but it currently tests successful atomic commit/page behavior. It has a direct `pg.Pool` and uniquely named contexts/groups. It has no live SQL failure-injection trigger. Add a narrowly scoped trigger/function on the generated diagnostic-history table using the existing unique context; inspect resolved provider table names from the fixture before selecting the trigger target.
- **Diagnostic-column/schema fault** — Neither live suite currently changes a diagnostic column/schema. The MySQL admin trigger is the simplest deterministic diagnostic insert failure without invalidating the storage factory's layout validation. A malformed-column/schema case should be a separate scoped DDL fixture with restoration in `finally`; do not combine it with the trigger case or leave persistent layout damage. PostgreSQL can use a scoped `BEFORE INSERT` trigger that raises for the target diagnostic table; its mock driver already identifies the diagnostic preflight and append SQL.
- **Current atomicity assertions to replace or scope** — Replace the MySQL live test's expectation that InnoDB rolls back all four families and the PostgreSQL mock test's global “no partial commit” assertion for the new independent-write contract. Preserve the MySQL nontransactional prefix cases as useful prior-state observations, but change expected behavior to the specified state-history → diagnostic-Event → delivery-Event → current-state write sequence and continuation/retry semantics. Keep successful family serialization and immutable conflict checks.

## Acknowledgement trigger and execution-count seam

- The live shared Inbox is represented by `packages/server/src/delivery/inbox-records.ts:99-140` (`inboxRecordSpec` uses generated `InboxMessageSchema`), and `packages/server/src/delivery/inbox-storage.ts:160-185` implements `markDelivered` using record-storage compare-and-set. Thus the DB acknowledgement fault is a scoped trigger on an Inbox-row **UPDATE** (not the Entity diagnostic insert trigger).
- `packages/server/test/delivery/inbox-provider-cleanup.test.ts` already opens live MySQL/PostgreSQL provider factories and independently exercises Inbox rows, but currently covers delivered-row cleanup and stale session cleanup only. It has no acknowledgement failure trigger.
- `packages/server/test/delivery/delivery-worker.test.ts:972-1032` has in-memory monitor/worker cases for repeat-on-processing-failure and successful acknowledgement after retry. `1052-1123` tests failed mark and no-spin/independent-target behavior, but the primary failing row's handler also throws; that does **not** prove a successful handler followed by an acknowledgement-only failure avoids business rerun. `packages/server/test/delivery/delivery-builder.test.ts:485-548` has similar mocked mark-failure cases and no live SQL.
- Minimal adaptation: use the real provider Inbox/Delivery harness and an update trigger that rejects the first status transition. Count handler executions by a generated domain handler fixture (Project Event/ProcessManager or the existing Task Event fixture where that domain is relevant). Assert the handler's durable output once, Inbox remains pending after failed acknowledgement, and the next attempt retries acknowledgement according to the accepted policy without immediately rerunning committed business work. Do not infer this behavior from fake `markDelivered` callbacks.

## Event publication and repair fixtures

- **Domain and fanout topology:** `packages/server/test/repository/repository-routing.test.ts` has the richest typed Project routing and ProcessManager fixtures: `createProjectCreated`, generated `ProjectCreatedSchema`, Project Queue/Workflow state, `EventRouting`, and `createSplitPmRepo`. See the typed multi-recipient routing cases around lines 5,700-6,000 and failure cases around 3,931 onward. The local `ProjectCreatedSchema` is generated from the server test fixture; use it with Project recipient IDs/states rather than empty/generic Event payloads.
- **Known-ID repair seam:** the same file's `requireEntityInboxTarget(repository).replay(message)` and `requireProjectionInboxTarget(repository).replay(message)` helpers (definitions around 14,275 onward) replay a specific already-recorded Inbox message without rerouting. Existing tests around 5,742, 5,870-5,960, 7,290-7,410, and 8,800-8,835 verify replay, route-call counts, duplicate replay suppression, and recipient state. This is suitable for explicit known-recipient repair only. It does not prove discovery of interrupted publications or replay of an Event to a recipient whose Inbox row was never recorded.
- **Publication APIs:** `packages/server/src/runtime/signal-publisher.ts:83-115,140-160` separates produced `publishEvent`, committed `publishCommittedEvent`, and `redispatchStored`. `packages/server/test/bus/event-bus.test.ts:337-355, 650-730, 992-1025` checks EventStore append failure, already-stored dispatch without a second append, and stored accept failure. These are memory/double-backed bus semantics, not SQL publication-failure acceptance.
- **Retry/exhaustion closest tests:** `packages/server/test/delivery/delivery-worker.test.ts:972-1032` injects a handler dispatch failure and uses a `DeliveryMonitor` override to repeat; tests report attempt and ack counts. These are fake inbox/registry ports. There is no current live SQL test proving Event publication partial recipient fanout, retry exhaustion with an explicit terminal result, or repair after a known committed Event ID.
- **Partial fanout failure seam:** use the generated Project Event and two existing typed recipient handlers/routing setup; fail admission to one recipient after another Inbox admission succeeds, then inspect recipient Inbox rows and eventual handler counts. Separately inject recipient processing failures after admission; those are delivery failures, not publication failures. Retry the same known Event ID/payload through the accepted stored-Event path and count every recipient execution. Retained deduplication can suppress a repeated successful recipient; after Inbox cleanup or loss of retained deduplication, that recipient may run again. Do not assert that replay retries only the previously failed recipient. Existing EventRouting tests can supply routing and handler fixture patterns, but their in-memory Inbox is not proof of SQL results.
- **No invented discovery:** known-ID repair must begin with an Event ID known to come from a completed Entity save and must use current routing. The administrative API takes Event IDs; it does not require the caller to supply recipient IDs. Existing replay helpers operate on known Inbox rows; they do not establish automatic detection of missing rows, historical-recipient restoration, or sibling ordering.

## Keep versus replace

Keep storage-driver unit failures for fast deterministic SQL classification; keep live MySQL trigger patterns and Project domain fixture construction; keep valid EventBus stored-replay tests and DeliveryMonitor retry policy tests as focused contracts. Replace or explicitly narrow tests whose names/claims imply that all Entity family writes are atomic (`mysql-integration.test.ts`, `postgres-entity-commit.test.ts`, and relevant server routing tests at `repository-routing.test.ts:9703,9767`) when the accepted behavior is an observable prefix and retryable follow-up. Do not use test doubles as evidence of the real SQL acknowledgement or publication behavior.

## Remaining publication route acceptance

The new focused retry cases primarily prove Aggregate committed outputs and
explicit repair. Add actual failure/count assertions for Process Manager and
reactor outputs, externally posted Events, and System Events. First establish
which supported path stores the Event before dispatch and which admission result
it exposes; do not infer that every route has an Entity save. For Entity outputs,
record existence alone cannot prove the complete save. For a route with a completed
standalone append, document its actual committed boundary and supported Event-only
recovery. Reconcile any overly narrow wording that treats all saved Events as
Entity outputs with the implemented and tested scope, without adding discovery,
receipts, an outbox, or cross-record coordination. This is a pending verification
question, not a confirmed runtime finding or an approved new persistence contract.

### Corrected storage-path inspection

Read-only scanning function: explicit `gpt-6-luna` / `medium`; runtime metadata
unavailable. Parent rejected the initial inference that Entity delivery Events
use a separate record family. All providers open the shared `eventStoreRecordSpec`
for `EntityCommitInput.events` in the same domain storage context:
PostgreSQL `postgres/entity-commit.ts` `openEvents`, MySQL
`mysql/storage-factory.ts` Entity commit construction, memory
`memory/in-memory-entity-commit.ts` `openCommit`, and Datastore
`datastore/entity-history.ts` commit preparation. Aggregate and reactor saved
Events are therefore accessible to domain exact-ID repair. Live restart evidence
must still establish that path from a real successful Command.

Process Manager output (`repository.ts` `publishEvent`) and external intake use
the domain EventBus `acceptThenAppend` path: admission first, immutable append,
then recipient delivery. Raw publication currently has no three-attempt stored
publication loop. Test the actual after-append failure outcome and exact-ID repair
instead of inferring the Aggregate retry policy applies there.

System Events use a distinct `${domainName}_System` storage context and System
bus; storage is enabled only by `persistSystemEvents()`. `republishEvents` selects
the domain store and domain bus. No System repair path is established by this
API. Cover both configured persistence and forgetting behavior explicitly;
decide any necessary scoped correction from a regression, without claiming a
System recovery contract from the domain repair tests.

### Process Manager append-before-publication gap to reproduce

Parent source inspection after the map distinguishes a failure before domain
EventStore append from the after-append probe. In `repository.ts`,
`ProcessManagerExecutionSupport.#commitProcessManagerRecord` passes current state,
optional state history and optional diagnostic Events to `loaded.commits.commit`,
but omits `EntityCommitInput.events`. Both Command assignment
`#commitAndPublish` and Event reaction `#executeEntity` subsequently schedule raw
`publisher.publishEvent`. A failed domain append can therefore follow a
successful Process Manager state save without a corresponding shared saved
Event for exact-ID repair. Optional Entity diagnostic history is a different
family and is not the domain repair store.

Reproduce this precise boundary with generated Process Manager fixtures, actual
handler entry counts, Event IDs, and current/history/shared-Event state. A likely
bounded correction is to pass the produced Events through the existing
independent Entity commit delivery-Event field before current state, separately
from input diagnostic Events, then use truthful finite stored publication. This
is not approval for a new coordinator, outbox or persistence contract. The
existing Aggregate pattern supplies the candidate behavior; implementation and
focused review must establish it. Do not count a swallowed append failure as
successful publication or claim repair of a record that was never saved.

## Live external Event after-append repair evidence

The parent public-API probe `evidence/external-event-repair.mjs` passed all four dedicated SQL servers (`external-event-repair-attempt2.log`). The external Event is stored before a direct dispatcher fails, then a fresh context and provider repair its known ID with unchanged bytes. Two dispatcher-entry records recur on replay, including the previously successful recipient. This fixture bypasses repository Inbox deduplication intentionally and proves no stronger guarantee. It does not cross an OS restart, post a Command, cover ProcessManager pre-append failure, or establish System-context repair. Module hashes, PID, server versions and exact IDs are retained. The first path-resolution failure occurred before DB use.

## Saved-publication retry spacing gap

Parent spec/source check found a remaining concrete requirement: FIRST_SPINE_TS_DELIVERY_TASK.md's live-recovery direction explicitly requires a delay between finite stored-Event failures. SignalPublisher.#dispatchStored currently loops immediately after a rejected attempt. The three-attempt bound is correct but does not satisfy retry spacing. In the next publication route slice, add a finite cancellable delay between failed attempts (not after success or final exhaustion), test actual spacing, cancellation during the delay and timer cleanup, and document the supported policy. Reuse normal timer/lifecycle conventions; do not add persistent retry state or claim a restart-surviving schedule. This is independent of the active subscription correction.
