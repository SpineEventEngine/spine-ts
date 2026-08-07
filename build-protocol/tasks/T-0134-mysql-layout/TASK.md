# T-0134: MySQL And MariaDB Record Layout

Status: Ready for RED-first implementation

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

- `_context VARBINARY(512) NOT NULL`;
- `_tenant VARBINARY(255) NOT NULL`;
- `ID VARBINARY(768) NOT NULL`;
- `bytes MEDIUMBLOB NOT NULL`;
- `_revision BIGINT UNSIGNED NOT NULL DEFAULT 0`;
- one nullable native SQL column per declared framework/user `RecordColumn`;
- `PRIMARY KEY (_context, _tenant, ID)` in that exact order.

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
include context and tenant in every predicate, and use `ID ASC` as the stable
tie-breaker. Continuations use the same canonical ID ordering. Protobuf payload
decoding uses `recordType`; masks remain post-decode.

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
