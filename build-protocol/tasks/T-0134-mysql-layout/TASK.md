# T-0134: MySQL And MariaDB Record Layout

Status: Complete on the Wave 8 integration train; reviewed and verified

## Objective

Replaces the shared MySQL records/columns tables with one table per record
source, using JVM-compatible default names and native columns. Supports MySQL
and MariaDB transactional and nontransactional engines without receipts,
markers, compatibility aliases, or automatic user-column indexes.

## Classification

High-risk because this task replaces durable provider layout, public builder
contracts, schema diagnostics, transaction/failure semantics, and live-engine
coverage.

## Baseline And Ownership

- Baseline: reviewed and pushed T-0133 commit `62fa1dc9`.
- Branch: `task/T-0134-mysql-layout`.
- Worktree: `.worktrees/T-0134-mysql-layout`.
- Ownership: `packages/storage-rdbms/**`, its tests and package documentation,
  plus narrow task/review/work records. No Datastore, deployment, delivery,
  subscription, example, or JVM edits/builds.

## Architecture Assignment

- Existing requirements-splitter role, explicitly dispatched at
  `gpt-5.6-sol` / `high`.
- It must freeze the exact generic declarations for both table-name overloads
  and `CreateOperationFactory` before the first RED test, define one-table
  record layout/schema validation, and separate transactional rollback from
  deterministic nontransactional prefix behavior.
- The desktop surface may not expose independent runtime self-introspection;
  the immutable configured role/profile is accepted unless a mismatch or
  fallback is visible.

## Frozen Human Requirements

- Default table names are the source Proto full name with dots replaced by
  underscores; Entity and non-Entity sources are separate.
- One row stores the native Protobuf record bytes, row ID, framework columns,
  and declared `(column)` values. User columns are not indexed automatically.
- Existing tables are inspected at startup/use: missing or incompatible
  required columns and primary keys fail with diagnostics; harmless compatible
  additions are accepted; existing tables are never altered.
- `MysqlStorageFactory.newBuilder()` returns exported
  `MysqlStorageFactoryBuilder`. Required methods are `setOptions(options)`,
  record-only and grouped `setTableName(...)`, `useOperationFactory(factory)`,
  and asynchronous `build()`.
- Exact source-plus-record registration wins over record-only registration,
  which wins over the JVM default name. A record-only creation factory applies
  to every matching record type.
- Exported `CreateOperationFactory` receives the resolved table specification
  and returns the create-table operation.
- MySQL InnoDB rolls back an affected unit on failure. MyISAM and MariaDB Aria
  write immutable event/state-history/Event Store rows before current Entity
  state, reject with the original storage operation error after a partial
  prefix, create no retry claim/receipt, and allow an identical retry to finish
  idempotently. Divergent immutable collisions fail.
- Remove shared record/column tables, schema hashes/spec metadata, receipt
  behavior, and false atomicity claims for nontransactional engines. No
  migration or compatibility reader is required.

## Acceptance Contract

The architecture result will add the exact TypeScript declarations here before
implementation begins. No RED test may be written until those declarations,
resolved table-spec fields, engine behavior, and live-fixture matrix are
recorded.

## Frozen Public Contract

```ts
export interface MysqlStorageFactoryBuilder {
  setOptions(options: MysqlStorageOptions): this;

  setTableName<R extends Message>(recordType: GenMessage<R>, name: string): this;

  setTableName<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    name: string,
  ): this;

  useOperationFactory(factory: CreateOperationFactory): this;
  build(): Promise<MysqlStorageFactory>;
}

export class MysqlStorageFactory extends StorageFactory {
  static newBuilder(): MysqlStorageFactoryBuilder;
}

export type CreateOperationFactory = <I, R extends Message>(
  table: MysqlTableSpec<I, R>,
) => MysqlCreateOperation;

export interface MysqlCreateOperation {
  readonly sql: string;
}

export interface MysqlTableSpec<I, R extends Message> {
  readonly tableName: string;
  readonly sourceType: GenMessage<Message>;
  readonly recordType: GenMessage<R>;
  readonly idType: I extends Message ? GenMessage<I> : string;
  readonly groupName?: string;
  readonly columns: readonly MysqlColumnSpec[];
  readonly primaryKey: readonly string[];
}

export interface MysqlColumnSpec {
  readonly name: string;
  readonly mysqlType: string;
  readonly nullable: boolean;
  readonly defaultSql?: string;
}
```

- `MysqlStorageFactory.create()` is removed without an alias.
- Builder setters replace the value for the same registration; the last call
  wins. `build()` rejects missing options and returns an initialized factory.
- Ungrouped `setTableName(type, name)` matches `RecordSpec.sourceType`.
  Grouped `setTableName(sourceType, recordType, name)` matches
  `StorageGroup.name` plus `RecordSpec.recordType`; an exact grouped
  registration wins. Distinct identities resolving to one table name fail.
- Default ungrouped names replace dots in `sourceType.typeName` with
  underscores. Default grouped names replace dots in `group.name` and append
  the simple record type name. Names are quoted internally and invalid or
  over-64-byte names fail before SQL.
- `CreateOperationFactory` receives the fully resolved specification and
  returns SQL executed through a private connection. Driver types are not
  public. Without a custom factory, the adapter uses
  `CREATE TABLE IF NOT EXISTS`.

## Frozen Physical Layout

Each resolved record family owns one table with this required structure:

- `_scope VARBINARY(224) NOT NULL`;
- `ID VARBINARY(768) NOT NULL`;
- `bytes MEDIUMBLOB NOT NULL`;
- `_revision BIGINT UNSIGNED NOT NULL DEFAULT 0`;
- one nullable native SQL column per declared framework/user `RecordColumn`;
- `PRIMARY KEY (_scope, ID)` in that exact order.

`_scope` is an injective byte tuple containing a big-endian context-name byte
length, the exact UTF-8 context name, a single-/multitenant tag, and—only for a
multitenant context—a big-endian tenant byte length plus exact UTF-8 tenant.
The complete scope may not exceed 224 bytes; a canonical ID may not exceed 768
bytes. Oversized values fail before connection acquisition or SQL. No prefix,
truncation, normalization, digest, hash, surrogate key, or fallback is allowed.
The resulting 992-byte declared primary key fits MyISAM's 1,000-byte limit while
retaining the existing TS ID capacity.

Fixed names are reserved case-insensitively. Declared values map to stable
native SQL types; absent values are `NULL`. No declared user/framework column
receives an automatic secondary index. `_revision` supports cross-handle CAS
and is not compatibility metadata.

Tables are created and inspected lazily per resolved identity. Inspection
rejects missing/incompatible required columns or primary keys, incompatible
types/nullability/collation, harmful extra non-defaulted columns or unique
constraints, and engines other than InnoDB, MyISAM, or Aria. Compatible wider
capacity, nullable/defaulted/generated additions, harmless non-unique indexes,
and redundant unique indexes containing the complete primary key are accepted.
The adapter never executes `ALTER TABLE`.

Queries address one table, bind values, push declared-column filters/order,
include `_scope` in every predicate, and use `ID ASC` as the stable
tie-breaker. Continuations use the same canonical ID ordering. Protobuf payload
decoding uses `recordType`; masks remain post-decode.

## Accepted Key-Length Amendment

Live MySQL 8.4 proved the earlier three-part 1,535-byte primary key impossible
on MyISAM (`ERROR 1071`). Current Spine JDBC uses direct IDs and no digest,
fingerprint, or surrogate-key mechanism. The revised `_scope` plus direct `ID`
layout above is therefore the minimal collision-free cross-engine correction.
Schema inspection rejects the former three-part key, prefix keys, digest or
surrogate layouts, and wrong primary-key order. Live tests cover boundary
lengths, single/multitenant separation, Unicode/zero/trailing bytes, and the
same ID in different contexts and tenants.

## Frozen Commit Semantics

- If every participating table is InnoDB, one connection transaction validates
  input, compares/locks current state, writes immutable rows, writes current
  state last, and commits. Any failure rolls the unit back.
- If any participating table is MyISAM or Aria, one database advisory lock is
  keyed by database/context/tenant/Entity source/Entity ID. Existing immutable
  keys are preflighted before avoidable writes.
- The exact nontransactional prefix is state-history rows, diagnostic
  event-history rows, Event Store rows, then current Entity state.
- An absent immutable row is inserted; an identical row is a no-op; a divergent
  row fails. Failure leaves only the completed prefix, preserves the public
  storage-operation error, starts no retry, and stores no receipt/claim/marker.
- An identical later retry completes the missing suffix. If current already
  equals `next` and all immutable rows are identical, the result is committed;
  if current matches neither expected nor next, the result is conflict.

## Implementation Slices

1. Public builder, exact compile contract, table resolution, precedence, and
   creation callback.
2. One-table CRUD/CAS/query adapter and schema inspection.
3. Generated current/state/event/Event Store histories and transactional versus
   nontransactional commit behavior.
4. Live MySQL InnoDB/MyISAM and MariaDB InnoDB/Aria matrix, documentation, and
   package exports.

One existing implementer owns all overlapping production work. RED tests cover
each slice before production changes. No compatibility layer or PostgreSQL
implementation is introduced.

## Review And Verification

- Required review concerns: style/maintainability, TypeScript/API docs,
  performance/reliability, and documentation.
- Security is N/A unless a new trust or secret boundary appears.
- Verification: provider-focused coverage-enabled `verify:task`, MySQL and
  MariaDB live fixtures for InnoDB/MyISAM/Aria, and exact unavailable-engine or
  Docker blocker evidence when environmental support is genuinely absent.

## 2026-08-08 Schema-Correction Evidence

- `MysqlTableSpec` is now the canonical layout threaded by the factory into
  `MysqlRecordStorage`; one spec drives the creation callback, default DDL, and
  existing-table inspection. The resolver supplies the physical identity only;
  it does not derive DDL or compatibility rules.
- A parameterized record-storage matrix rejects missing/reordered primary keys,
  narrow/wrong native columns, nullability/default/collation mismatches,
  incompatible declared native columns, harmful required extra columns, and
  harmful unique constraints. It accepts capacity widening, nullable/defaulted/
  generated additions, non-unique indexes, and redundant unique indexes that
  contain the complete primary key. The provider still issues no `ALTER TABLE`.
- Fresh focused evidence: `pnpm --config.verify-deps-before-run=false exec
vitest run packages/storage-rdbms/test` passed 65 tests with 6 URL-gated live
  tests skipped; package `tsc --noEmit`, exact source ESLint, Prettier check,
  and `git diff --check` exited 0.
- Limitation: the focused non-live suite does not establish the Docker MySQL /
  MariaDB engine matrix or repository-wide `verify:task`; those remain with the
  orchestrator's next verification wave.

## 2026-08-08 Remaining-Correction Evidence

- Focused RED/GREEN covered pre-acquisition oversized query and CAS keys and
  Entity close/idempotence. The non-live suite now passes 66 tests with six
  URL-gated skips; package TypeScript, Prettier, and diff checks pass.
- Completion remains blocked by the live MySQL trigger fixture's hard-coded
  table name, an InnoDB concurrent immutable-prefix deadlock, the 90% all-
  metric coverage gate, and TSDoc/TypeDoc debt. No commit, push, or merge is
  authorized from this implementation context.

## 2026-08-08 Wave 2 Verification

- Provider coverage validation: 74 tests pass with 94.06% statements, 90.01%
  branches, 93.83% functions, and 95.82% lines.
- Live matrix: MySQL 8 InnoDB/MyISAM and MariaDB 11.4 InnoDB/Aria, each 7/7,
  including canonical-name trigger, Entity race, and present/absent CAS races.
- Package typecheck, changed lint, Prettier, TSDoc, docs audience, and diff
  checks pass. API inspection remains blocked by unrelated shared-train
  compilation failures; no commit/push/merge is in scope.

## 2026-08-08 Final Correction Verification

- Disabled-history commits fail fast; canonical Entity replays avoid current-row
  replacement; advisory lock identity includes database name.
- Live MySQL 8 InnoDB/MyISAM and MariaDB 11.4 InnoDB/Aria each pass 9/9.
- Provider coverage is 94.26% statements, 90.08% branches, 93.86% functions,
  and 95.87% lines. Typecheck, changed lint, Prettier, TSDoc, audience, and
  diff checks pass.

## 2026-08-08 Final Acceptance

- All required review concerns are clean after correction. Security remains N/A
  because this task introduced no authentication, authorization, secret, or
  deployment trust boundary.
- Final provider coverage passes 79/79 at 93.96% statements, 90.01% branches,
  92.98% functions, and 95.52% lines.
- The final live MySQL InnoDB suite passes 9/9. The accepted engine matrix also
  passes MySQL InnoDB/MyISAM and MariaDB InnoDB/Aria at 9/9 each; the final
  micro changes are typed test helpers and documentation only.
- Package TypeScript, strict changed-file lint, TSDoc, documentation snippets,
  documentation audience, Prettier, and diff checks pass.
- Repository-wide API/verification profiles remain unable to pass the stacked
  train's downstream Datastore/server/deployment compilation until T-0135 and
  later consumers are migrated. No T-0134 provider error is present.
