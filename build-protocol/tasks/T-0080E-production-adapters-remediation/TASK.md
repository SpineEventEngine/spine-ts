# T-0080E: Remediate production storage and delivery adapters

## Status

Complete.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080D.
- Required by: T-0080N and T-0080O.

## Objective

Remediate authored APIs and behavior ownership in the Datastore/RDBMS storage
adapters and standalone delivery server without changing persistence, lifecycle,
or delivery semantics.

## Classification

High-risk when exported contracts, persistence code, resource lifecycle, or
delivery behavior is moved; otherwise standard.

## Human-Imposed Requirements Ledger

- Complete concise TSDoc, third-person callable summaries, and parameter/result
  coverage apply to owned public APIs.
- Authored names have no more than four semantic components.
- Standalone behavior belongs to cohesive types/objects or has an exact
  necessity disposition.
- Use Spine/JVM-familiar concepts and avoid invented wrappers, utilities, and
  error-detail hierarchies.
- Runtime persistence, connection, shutdown, and delivery behavior must remain
  equivalent.
- Generated output is not edited and Spine JVM is not built.

## Ownership

- `packages/storage-datastore`, `packages/storage-rdbms`, and
  `packages/delivery-server`, including owned tests/docs/quality partitions.
- Exact downstream import fixes for their exported names, serialized before
  another owner edits the consumer.

## Acceptance Criteria

1. Owned authored sources have zero TSDoc/name debt and exact dispositions for
   every remaining standalone function.
2. Public names/docs are concise and match actual adapter/server behavior.
3. Refactors preserve query translation, transactions, type serialization,
   connection ownership, server start/close, and failure cleanup.
4. No generic `Utils`/facade is introduced merely to collect former functions.
5. Focused persistence, adapter, delivery-server lifecycle, and public-export
   tests remain green.
6. Shared/root updates are serialized; this slice does not opportunistically
   modify another active production/example lane.

## Exclusions

- No schema migration, new datastore/RDBMS feature, delivery topology, retry
  policy, or deployment work.
- No server-framework or delivery-client cleanup.
- No final shared generation/API manifest closure.

## Verification And Review

- Focused package tests, typecheck, package TypeDoc/export audit, lint/format,
  relevant checker partitions, and `git diff --check`.
- Style/maintainability, documentation, and TypeScript/API-doc lanes are
  relevant.
- Performance/reliability is relevant for persistence, connection, server
  lifecycle, cleanup, and delivery paths.

## Planning Endpoint

- Immutable base: `7551024a86ccc8100d70ea7a03db208371b8f4a2`.
- Initial exact inventory: 205 TSDoc entries, six semantic-name entries, and
  175 standalone-function entries.
- Existing role: requirements splitter.
- Scope: map each standalone cluster to a cohesive existing/new owner, identify
  public renames and exact downstream repairs, preserve persistence and
  lifecycle invariants, define bounded implementation order, and specify
  focused verification. No source edits.
- Expected/configured model: `gpt-5.6-sol`.
- Expected/configured reasoning: high.
- Both fields are explicit in dispatch. Runtime metadata is recorded when
  exposed; otherwise the immutable configured role/profile and introspection
  limitation are accepted absent a visible mismatch or fallback.

## Accepted Implementation Plan

- The planning role completed under explicit `gpt-5.6-sol` / high
  configuration. Runtime introspection is unavailable; no visible mismatch or
  fallback occurred.
- One intentional public break is made atomically with no aliases:
  `createInMemoryDeliveryServerCore()` becomes `InMemoryDelivery.create()`,
  `InMemoryDeliveryServerCore` becomes `DeliveryCore`, and its options become
  `DeliveryCoreOptions`. Generated long names use concise local import aliases
  only.
- One implementation owner works seven sequential batches:
  1. delivery wire values, state, limits, and admission;
  2. delivery handlers, administration, health, and assembly;
  3. public delivery core, configuration, process, shutdown, and server
     lifecycle;
  4. Datastore canonical values, record/query execution, transactions, and
     result decoding;
  5. Datastore entity history and factory documentation;
  6. MySQL canonical values and entity history;
  7. MySQL factory, query compiler, schema verification, and connection
     lifecycle.
- The owner maps all 175 standalone entries to cohesive named objects or
  private class methods. No necessity entry is expected to remain.
- Durable keys, encoded values, DDL, schema verification, query pushdown and
  sentinels, retry/commit boundaries, Datastore ownership, MySQL locks and
  leases, admission bounds, admin buffers, listener idempotency, and shutdown
  order must remain byte-for-byte or behaviorally equivalent as applicable.
- Each batch clears only its exact ledger entries and runs focused tests,
  package typecheck, cleanup/TSDoc enforcement, formatting, and diff integrity.

## Implementation Assignment

- Existing role: implementer.
- Ownership: all T-0080E production source, owned tests/docs/ledgers, and only
  exact direct consumer repairs required by the delivery public rename.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch. Runtime metadata follows the standard
  acceptance policy.
- The implementation remains one uncommitted task batch until deterministic
  checks and the complete relevant review wave pass.

## Delivery Public Contract Checkpoint

- `InMemoryDelivery.create()`, `DeliveryCore`, and `DeliveryCoreOptions`
  replace the old public core factory/types atomically with no aliases.
- Direct delivery-server and delivery-client consumers, README claims,
  API-doc expectations, and focused public/core tests use the new API.
- Focused tests pass 31/31 and delivery-server typecheck plus diff integrity
  pass. The regular filtered pnpm entry point is blocked by the recovered
  workspace package-pattern metadata; the installed Vitest runner supplied the
  accepted focused evidence.
- Remaining delivery-server debt is 120 TSDoc entries, three semantic-name
  entries, and 49 standalone functions. The same implementer continues the
  remaining delivery batches under explicit `gpt-5.6-terra` / medium.

## Delivery State And Admission Checkpoint

- `DeliveryMessages`, `DeliveryShards`, and `DeliveryWorkers` own wire
  identity/copy behavior; state lookup/capacity decisions, configured limits,
  and admission abort construction now belong to their cohesive runtime
  owners.
- The four owned files have zero TSDoc and zero standalone debt. State and
  admission tests pass 7/7; delivery-server typecheck, TSDoc, cleanup,
  formatting, and diff checks pass.
- Exact wire keys/clones, atomic capacity decisions, FIFO admission and bounds,
  abort behavior, commit linearization, and close rejection remain unchanged.
- Remaining delivery-server debt is 63 TSDoc and 39 standalone entries.

## Inbox Replacement Assignment

- Reason: the original implementation context completed the atomic
  `InboxHandlers.create` consumer migration and passed 15 focused tests, but
  then returned three times without starting the explicitly bounded internal
  helper/TSDoc migration. No writer remains active and all partial work is
  preserved.
- Existing role: implementer.
- Ownership: only `packages/delivery-server/src/core/inbox-service.ts`, its
  direct tests, and exact debt entries. Existing direct consumer repairs remain
  unchanged.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch; runtime metadata follows the standard
  acceptance policy.

## Inbox Completion Checkpoint

- `InboxHandlers`, `InboxMessages`, `InboxShards`, `InboxTime`, and
  `InboxResponses` own all Inbox construction, validation, ordering, and
  response behavior. All 15 former helpers and all Inbox TSDoc/name debt are
  cleared.
- Inbox/transition/assembly tests pass 15/15. Delivery-server typecheck, TSDoc,
  cleanup, scoped lint/format, and diff checks pass.
- Timestamp/version/UUID ordering, strict `when_received > since`, page bounds,
  validation, and response limits remain unchanged.
- The replacement implementer used explicit `gpt-5.6-terra` / medium; runtime
  introspection is unavailable with no visible mismatch.

## Shard Completion Checkpoint

- `ShardHandlers`, `ShardInputs`, `ShardTime`, and `ShardErrors` own all former
  Shard helpers and construction; exact core/assembly/test consumers use the
  new owner.
- Shard/transition/assembly tests pass 17/17 with delivery-server typecheck,
  TSDoc, cleanup, scoped lint/format, and diff checks clean. The file has zero
  TSDoc/name/function debt.
- Automatic and manual expiry boundaries, worker-agnostic release, validation,
  and error behavior remain unchanged.

## Assembly Completion Checkpoint

- `DeliveryAssembly.create()` replaces the former factory without an alias;
  exact server and test consumers use the owner.
- Assembly/admin/transition/server-config tests pass 13/13 and all scoped
  deterministic checks pass. Assembly has zero exact debt.
- One shared `InMemoryDeliveryState` and `MutationAdmission` boundary remains
  common to Inbox, Shard, Admin, and assembled resources.

## Delivery-Server Completion

- All delivery-server TSDoc, semantic-name, and standalone-function ledgers are
  zero. Public/core, state/admission, admin, Inbox, Shard, health, assembly,
  configuration, server lifecycle, shutdown, and process ownership are
  complete.
- The full delivery-server suite passes 63/63 with local loopback/process
  capability; direct delivery-client response-loss tests pass 7/7.
  Delivery-server build/typecheck, API-doc, TSDoc, cleanup, lint, formatting,
  and diff checks pass.
- Synchronous configuration validation, precedence/read-once behavior,
  start/close coalescing, terminal failure, reached-resource cleanup, and
  Health→admission→Admin/subscribers→listener/sessions shutdown order are
  preserved.
- The successful implementation profile was `gpt-5.6-terra` / medium. Runtime
  introspection is unavailable with no visible mismatch or fallback.

## Datastore Record/Query Assignment

- Existing role: implementer.
- Ownership: only Datastore `value-codec.ts`, `record-storage.ts`, their direct
  tests, and exact ledger rows.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch. The owner preserves canonical encoding,
  pushdown/sentinel semantics, CAS retry bounds, and batch behavior.

## Datastore Record/Query Completion

- All 35 helpers belong to the planned canonical-value, ordering, pushdown,
  local-result, record-value, transaction, and result owners. Both files have
  zero exact debt.
- Focused Datastore storage/query tests pass 31/31 with package typecheck,
  scoped lint, TSDoc, cleanup, formatting, and diff checks clean.
- Canonical encoding, all-or-nothing pushdown, provider sentinel/overflow,
  bounded CAS retries/redaction, and 500-record grouping remain unchanged.
- The configured implementer profile was `gpt-5.6-terra` / medium; runtime
  introspection was unavailable with no visible mismatch.

## Datastore History Assignment

- Existing role: implementer.
- Ownership: Datastore `entity-history.ts`, `storage-factory.ts` documentation,
  direct history tests, and exact ledger rows.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch. Durable keys, retry/ack
  reconciliation, bounded trims/truncation, and client ownership are frozen.

## Datastore History Completion

- State/Event history, truncation, row/key/input/value/result ownership and
  factory documentation are complete. All Datastore TSDoc/name/function debt is
  zero.
- Focused history tests pass 40/40. Package typecheck, TSDoc, cleanup,
  formatting, and diff checks pass.
- Durable keys, bounded retry/lost-ack behavior, eight-row causal trims and
  high-water truncation, transaction boundaries, and caller-owned clients are
  unchanged.
- Emulator/cloud verification is unavailable because no service or credentials
  are configured. Local behavioral evidence is complete.

## MySQL Values/History Assignment

- Existing role: implementer.
- Ownership: MySQL `value-codec.ts`, `entity-history.ts`, exact internal factory
  call repairs, direct tests, and exact ledgers.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch. Durable schema/value shapes, entity
  locks, trim/truncation chunks, unknown commit handling, and lease settlement
  are frozen.

## MySQL Values/History Completion

- Canonical MySQL values, integer width, history schema values, entity
  inputs/errors, lock naming, and history table ownership are complete. Both
  files have zero exact debt.
- Mocked codec/history/storage behavior passes 110/110 tests with RDBMS
  typecheck, TSDoc, cleanup, scoped lint, direct formatting, and diff checks
  clean.
- Durable codec/schema shapes, one-connection locks, 128-row trim/truncation,
  unknown commit handling, and lease settlement remain unchanged.
- Live MySQL is unavailable because no server is configured. The root formatter
  subprocess cannot find `prettier`; direct local Prettier verified the owned
  files unchanged.

## MySQL Factory Assignment

- Existing role: implementer.
- Ownership: MySQL `storage-factory.ts`, its direct unit/integration tests, and
  exact remaining T-0080E ledgers.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch. DDL/schema verification, SQL binding,
  query candidates, transactions, duplicate ordering, close/lease lifecycle,
  and pool drain behavior are frozen.

## Final Implementation Gate

- All T-0080E ledgers are empty: 205 TSDoc, six name, and 175 standalone
  entries are resolved.
- TSDoc, cleanup, API-doc, affected build/typecheck, scoped lint/format, and
  diff checks pass.
- The complete behavior gate passes 20 files / 251 tests. Three live-service
  files / 25 tests are skipped because Datastore/MySQL services and credentials
  are not configured.
- The admin pre-review lint correction converted two static-only owners to
  frozen object literals; 11 focused tests and all deterministic checks pass.

## Specialist Review Assignments

- Style/maintainability: existing reviewer,
  `gpt-5.6-terra` / high.
- TypeScript/API documentation: existing reviewer,
  `gpt-5.6-terra` / high.
- Documentation: existing fixed reviewer,
  `gpt-5.6-luna` / medium.
- Performance/reliability: existing reviewer,
  `gpt-5.6-terra` / high.
- Security: N/A because authentication, credentials, transport exposure, SQL
  binding policy, and trust boundaries did not change.
- Every configurable dispatch supplies explicit model/reasoning. The fixed
  documentation role is immutably Luna/medium because the surface does not
  accept a Luna override. Runtime metadata follows the standard acceptance
  policy.

## MySQL Factory Completion

- `EntitySchemaVerification`, `RecordSchemaVerification`, `MysqlOptions`,
  `MysqlQueries`, `MysqlColumns`, and `MysqlRecords` now own the former
  factory helpers; all T-0080E TSDoc, semantic-name, and standalone ledgers
  are empty.
- Direct RDBMS typechecking and mocked factory/codec tests pass (110/110).
  SQL remains constants plus bound values; schema DDL and exact verification,
  query sentinel/order behavior, transactional writes/CAS, and lease-aware
  shutdown are unchanged.
- Live MySQL is not configured (`SPINE_TS_MYSQL_URL` is absent), so the live
  integration suite remains intentionally skipped.

## MySQL Values/History Completion Checkpoint

- `CanonicalMysqlValues`, `MysqlIntegers`, `EntityHistoryTables`,
  `EntityValues`, `EntityInputs`, `EntityErrors`, and the private entity lock
  name owner replace the exact former standalone declarations.
- Canonical encoding, schema/DDL, entity scope and fingerprints, transactional
  128-row trim/truncation chunks, lock lifetime, release/destroy settlement,
  and provider-error sanitization remain unchanged.
- Focused codec and non-live storage tests pass; live MySQL verification is
  not configured in this worktree.

## Datastore History Completion Checkpoint

- `StateHistory`, `EventHistory`, history maintenance, row/key/input/value, and
  result handling retain the existing durable behavior while their former
  standalone declarations are no longer recorded as standalone debt.
- The owned Datastore history and factory source has zero exact TSDoc and
  standalone-function debt. Cleanup enforcement, TSDoc enforcement, scoped
  formatting, and diff integrity pass.
- Focused history tests pass 40/40 with package typechecking. Emulator/cloud
  verification is not configured because no service or credentials are
  supplied.
- Durable length-delimited keys, three-attempt retry and lost-ack
  reconciliation, divergent retry rejection, eight-row trim/truncate chunks,
  causal revisions, independent transaction boundaries, and injected-client
  ownership remain unchanged.

## Reviewed Endpoint

- All relevant specialist concerns are closed: style/maintainability,
  TypeScript/API documentation, documentation, and performance/reliability.
  Security remains N/A because no security boundary or binding policy changed.
- All three debt ledgers are empty. Package typechecks, scoped lint, TypeDoc/API
  exports, TSDoc, cleanup, formatting, and diff integrity pass.
- The final behavior gate passes 20 files / 251 tests. Three live-service files
  / 25 tests are skipped because Datastore and MySQL services are not
  configured.
- T-0080E is accepted for commit and push. T-0080F is the next umbrella slice;
  final integration into `main` remains reserved for T-0080O.
