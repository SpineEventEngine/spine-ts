# Faster Entity saves and Inbox delivery

## Status and scope

Planning and independent review complete on `fix-publication-provenance`, extending the existing
publishing task at `74c6b5615`. The human approved implementation on 1 October
after the independent review. Implementation is now in progress.

Classification: high-risk implementation, because it changes persistence and
delivery coordination. Planning itself changes only project records. The
source evidence is in [findings.md](findings.md); the earlier publishing work
and its tests remain in scope and must not regress.

## Human-Imposed Requirements Ledger

- Keep all corrections in the current branch. Do not create a new branch,
  worktree, chat or pull request for this extension.
- Do not preserve an Entity expected-state conflict feature just because it
  was implemented. Remove that TS-specific mechanism; JVM storage does not
  require it. Keep normal Entity versions and automatic version advancement.
- Never copy all saved Entity states to save one Entity. Work only on the
  changed Entity and associated changed records.
- Compare with the latest official core-jvm source, not memory or stale docs.
  The inspected revision and precise source paths are recorded in findings.md.
- Review persistent providers as well as memory. Do not invent persistent
  deduplication stores, outboxes, retries or other speculative infrastructure.
- Move forward through Inbox pages like JVM, rather than restarting after
  every productive page. Preserve existing valid duplicate handling.
- Skip cleanup attempts for delivered records whose retention has not expired;
  retain required checks before actual deletion.
- The real 1,000-recipient in-memory scenario must take under one second.
  Timing a mocked handoff or raising a timeout does not meet that requirement.
- Follow AGENTS.md and the build protocol: explicit model routing, one writer
  for overlapping runtime files, simple documentation, meaningful domain
  fixtures, documented classes/methods/type parameters, short methods, focused
  checks before full verification, independent review and immediate pushes of
  any feature-branch commits. Preserve the existing version-only checkpoint.
- The human approved implementation after plan review. Runtime edits, focused
  and final verification, review and feature-branch pushes are now authorized.
  Publication and merging are not authorized.

## 1. Establish the before/after measurement

Use the existing domain-correct routing fixtures and real in-memory storage.
Recreate one Event routed to 1,000 distinct Process Managers, whose handlers
actually update state. Time from signal submission until delivery finishes;
verify all 1,000 final states outside the timed section. Exclude fixture/context
setup, but include routing, Inbox writes, dispatch, commits and acknowledgements.

Record Node version, hardware, coverage setting, retention/history settings
and worker count. Run without coverage or competing full builds: one warm-up
and five measured fresh-context runs, with each measured run below one second
as the target. Also retain 100/500-recipient cases to show how cost grows.
Coverage-suite duration is a separate number, not application throughput.
The target applies to this in-memory scenario, not an unmeasured promise for
every SQL deployment or arbitrary user handler.

Use deterministic operation-count assertions to prevent whole-map copying and
repeated prefix scans. Keep wall-clock measurement separate from ordinary
shared-runner correctness tests; report raw runs rather than hiding outliers.
If the target is missed, profile the remaining measured cost and revise the
bounded plan before proposing broader changes. Do not report success early.

Implementation measurement follow-up: the first two runtime slices reduced the
five 1,000-recipient runs from 4.04–4.29 seconds to 1.315–1.389 seconds. A CPU
profile identifies repeated schema-option work and record comparisons as
remaining candidates. The bounded follow-up may reuse already prepared values
within existing operation/storage-handle lifetimes. It must not skip validation,
change ordering or coordination, patch dependencies, or add a public cache/API.
Details and overlapping sample totals are in implementation-preflight-corrections.md.

## 2. Remove the unsupported Entity conflict mechanism

Change the internal Entity commit port to accept the new record and associated
history/events, without an expected previous storage record. Completion is
successful resolution; real storage errors still reject the operation. Remove
the conflict result and repository conflict branches for all Entity families.
Update memory, MySQL, PostgreSQL and Datastore together so the internal contract
does not temporarily disagree across packages.

This is not permission to remove unrelated safety checks: retain tenant/type
boundaries, closed-storage errors, history-version rules, event-ID uniqueness,
database transactions and native retry rules, shard coordination and Inbox
conditional updates. Inspect existing retry handling that accepts `next` as
already saved; preserve valid replay behavior without recreating expected-state
rejection under another name. Do not introduce new retries or lock layers.

These are three distinct outcomes: a different current Entity value alone does
not reject `next`; existing database transaction retries remain bounded as
before; divergent bytes under an existing immutable history/event key still
reject. Identical immutable replay remains accepted only where already supported
(memory currently rejects an existing delivery-event ID). SQL/Datastore seeing
`current === next` must still complete associated records, not return early.
Detecting a superseded retry or rejecting a stale current-state overwrite is
not an alternative way to restore the removed check.

Tests: provider commit succeeds without an expected record; normal update and
version/history behavior; unaffected tenant and Entity type; actual storage
failure; caller state rollback; event/history replay cases already supported;
Aggregate, Projection and Process Manager repository paths. Replace only tests
whose purpose is the rejected Entity conflict policy, not general concurrency
or duplicate-delivery tests. The port is exported from `storage/provider`, so
compile-check that entrypoint and every adapter against the revised declarations.
Rollback assertions apply to memory and transactional providers; the documented
MyISAM/Aria partial-write case is tested separately below.

## 3. Save only the affected in-memory records

Prepare and validate the next Entity record and only the supplied history and
delivery-event records before changing live storage. Copy mutable input values
where required so later caller mutation cannot alter stored data. Do not clone
or replace entire current/history/event collections, even with history enabled.

Apply the prepared changes together under the existing serialization rules,
without awaiting between visible memory changes. If a remaining mutation can
throw, retain only the affected previous entries and restore those on failure;
do not use a full-map backup. Check sequence numbers and existing indexes as
part of preparation/application. Do not add a general transaction framework.

Prepare keys, cloned values, materialized columns and all potentially throwing
validation before applying changes. Check collisions with affected live entries
and between records in the same input. A rollback restores complete entries,
including prior absence and materialized columns, without rerunning the failing
preparation logic. Do not call queue-acquiring write/history methods from inside
that same queue; reuse their record rules without recursive queue acquisition.

Tests: changed records saved together; a preparation failure leaves all live
records unchanged; any supported write-time failure rolls back affected entries;
unrelated records and tenants untouched; input isolation; histories on/off;
delivery-event uniqueness; existing serialization across asynchronous callers.
Large unrelated populations must not cause corresponding state copies.

## 4. Complete the Inbox scan before restarting

Keep the existing ordered cursor, including equal-time tie handling. Continue
from the last row read even when the page delivered messages. Remember progress
for the whole scan; at its end, restart only if that scan delivered messages.
Finish after a scan makes no progress. Preserve existing cancellation, shard
handoff, error propagation and direct/remote delivery paths.
An empty or partial final page ends a scan. Duplicate deletion alone does not
count as a delivered message or sustain a restart loop.

Retained delivered rows remain readable for duplicate recognition. Do not
switch to pending-only pages or add a persistent deduplication index. Preserve
the existing page-local retained identities and bounded recent-delivery cache,
using signal-plus-recipient identity: one Event reaching 1,000 recipients must
remain 1,000 deliveries. Do not add an unbounded scan-wide identity set or claim
duplicate protection at arbitrary distances beyond JVM's 1,000-entry recent
cache. Compare cases within and beyond that boundary against the baseline and
JVM source; record limitations instead of inventing a stronger guarantee. If
forward scanning regresses an actually supported case, resolve it before coding
further rather than weakening that case or adding machinery without discussion.

Tests: several productive pages after retained rows; no prefix reread after
each productive page; a second scan catches work inserted behind the cursor;
equal timestamps; deletion of the cursor row; empty and partial final pages;
deduplication within/across pages; retention expiry; cancellation and lost shard
access stop further mutations. Test both provider paging and runtime callers.
Include successful delivery followed by its duplicate while still cached,
same-page retained originals, a fresh delivery instance, cache eviction and
failed attempts that must not become successful-delivery evidence. Page-prefix
rereads should disappear; internal storage queries may still traverse records.
Do not claim constant-time or linear total query cost without measurement.

## 5. Avoid cleanup that cannot delete anything

Before per-record mutation checks or storage deletion, skip delivered rows with
a future retention deadline. Keep the authoritative storage-time check and
the required shard checks for records eligible for deletion. Use the existing
clock and retention policy consistently; test the exact expiry boundary.
Direct Inbox storage already accepts an injected clock; delivery currently has
separate wall-clock reads. Share the applicable clock through the existing
internal construction/adapter paths for both early cleanup and page-local
retained-row duplicate recognition, including remote-adapter wiring, without
adding a public clock service. Preserve TS's eligibility at `keepUntil <= now`;
do not silently change it to JVM's strict-past boundary. Page-local retained-row
protection uses `keepUntil > now`; the bounded recent-delivery cache has separate,
unchanged semantics. Test cleanup and duplicate recognition with an injected
clock ahead of and behind wall time, plus absent, future, past and equal
deadlines. Use a fresh delivery instance to isolate retained-row behavior from
recent-cache evidence in these tests.

Tests: future deadline produces zero deletion attempts and no per-record
mutation checks; expired and absent deadlines permit cleanup; a deadline or
shard change before the actual deletion cannot cause an invalid deletion.
Do not change storage schemas or retention configuration.

## 6. Persistent storage boundaries

MySQL, PostgreSQL and Datastore already avoid whole-state copying. Their change
is the internal Entity commit contract and its call sites, not a replacement
of native transactions. Run the affected provider tests on real MySQL,
MariaDB, PostgreSQL and the Datastore emulator using established local fixtures.
Run selected direct/remote delivery tests affected by shared paging changes.

MyISAM/Aria already provide locked writes rather than rollback across records.
Preserve that documented limitation in this correction. Do not claim universal
all-or-nothing database writes, remove support for these engines, or introduce
emulated database transactions. Tightening that support is a separate product
decision, not necessary to eliminate copying or expected-state rejection.
Preserve the current immutable write order: state history, diagnostic history,
delivery events, then current state. The existing MySQL integration test injects
failure at each boundary; retain it for InnoDB, MyISAM and Aria. An identical
storage retry may complete a partial write; neither Entity rollback nor automatic
handler replay can be claimed to undo or repair those durable partial records.

## Documentation and compatibility

Update active storage/server reference text, affected TSDoc, technical rules and
decision records to remove expected-state conflict claims and describe scan
continuation accurately. Mark the earlier T-0109 conflict decision superseded
where it is referenced as current; do not rewrite historical evidence as if it
never happened. Keep the earlier release-tool documentation intact.

No ordinary application API, Protobuf field, wire format, persisted record
layout or database migration is proposed. The provider-only port is nevertheless
published through `@spine-event-engine/storage/provider`: this is a breaking
type change for custom adapter authors. Update its declarations, TSDoc and
provider documentation together with all four bundled adapters. No compatibility
shim for old snapshots. If inspection reveals an additional application API or
schema consequence, revise this plan explicitly before implementing it.

## Work sequence, review and verification

1. Finish one bounded Astra/high architecture pass and a fresh Sol/medium
   independent plan review. Incorporate findings and ask only unresolved
   product questions. Completed before implementation authorization.
2. After implementation is authorized: establish the measurement, then use one
   Sol/medium implementer for the commit-port and in-memory changes. Update
   focused documentation with the relevant runtime slice.
3. The same writer implements scan continuation and cleanup. Remeasure real
   delivery. Independent read-only test analysis or docs review may run in
   parallel; no competing builds or overlapping code writers.
4. Before implementation review: formatting, diff checks, relevant typechecks,
   focused behavior/coverage tests and deterministic TSDoc/documentation checks.
5. Relevant independent review: Sol/medium performance/reliability,
   style/maintainability and TypeScript/API contracts; Luna/medium documentation.
   Collect one combined finding batch and return it to the same implementer.
   Final security review is not repeated for these storage changes unless the
   release authentication/security boundary changes; record that disposition.
6. After corrections converge: one full `verify:release`, required live-provider
   checks and archive-consumer proof for the combined release branch. Reuse
   outputs where supported; do not repeatedly run all tests to diagnose fixes.
   Require green CI for the final pushed SHA, not the previous green head.
7. Retain the existing snapshot.19 version-only commit if still unused at
   implementation completion. Recheck public registry versions before merge
   readiness; if used, choose the next common unused snapshot through a new
   version-only commit and separate pin/lockfile commit, without rewriting
   published history. Push each commit immediately. No publishing or merging.

## Questions and review status

No unresolved product questions remain. Preserve the documented MyISAM/Aria
limitation rather than expanding this task. The architecture pass and fresh
independent review are complete, and all accepted corrections are incorporated.
The independent reviewer identified the shared clock for cleanup and retained-row
duplicate recognition; Section 5 now covers both. See
[review dispositions](entity-save-delivery-review.md).

This is not implementation acceptance. Performance, provider verification and
final-head CI remain future work.

## Initial file and test scope

- Storage contract: `packages/storage/src/internal/entity-commit.ts`,
  `src/provider.ts`, memory commit/history/record helpers and their focused tests.
- Adapter callers: MySQL `src/mysql/storage-factory.ts`, PostgreSQL
  `src/postgres/entity-commit.ts`, Datastore `src/datastore/entity-history.ts`.
- Repository callers: `packages/server/src/repository/repository.ts` and the
  Aggregate/Projection/Process Manager commit behavior tests.
- Delivery: `packages/server/src/delivery/delivery.ts`, `inbox-storage.ts` and
  narrowly required clock/port plumbing, without a new public clock concept.
- Existing focused suites: `in-memory-entity-commit.test.ts`,
  `mysql-entity-commit-contract.test.ts`, `mysql-factory-commit-mocked.test.ts`,
  `postgres-entity-commit.test.ts`, Datastore `entity-history.test.ts`,
  `delivery-worker.test.ts`, `delivery-worker-runtime.test.ts`,
  `direct-inbox-records.test.ts`, `repository-routing.test.ts` and applicable
  history/provider-conformance tests. Add small dedicated files if that keeps
  scenarios readable; do not expand an already large routing file by habit.
