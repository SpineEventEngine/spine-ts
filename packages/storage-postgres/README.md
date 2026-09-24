# PostgreSQL storage for Spine TS

`@spine-event-engine/storage-postgres` stores Spine TS records in PostgreSQL.
It is a separate provider package; the existing `storage-mysql` package remains
the MySQL provider. PostgreSQL support currently targets PostgreSQL 16 or newer,
with live acceptance recorded against PostgreSQL 16.15 and 18.6.

This is an experimental snapshot package. Use Node 24 or newer. For the precise
public API and operational rules, see the [coding-agent reference](REFERENCE.md).

## Install

```sh
pnpm add @spine-event-engine/storage-postgres@snapshot @spine-event-engine/storage@snapshot @bufbuild/protobuf
```

Create the database and schema before starting the application. The adapter
creates and checks its private tables; it does not create databases or schemas.

## First write and read

```ts
import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-event-engine/storage";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";

const factory = await PostgresStorageFactory.newBuilder()
  .setOptions({ url: "postgresql://user:password@127.0.0.1:5432/spine_app" })
  .build();
const records = factory.createRecordStorage(
  { name: "Tasks", multitenant: false },
  new RecordSpec({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (record) => record.value,
  }),
);

try {
  await records.write(create(StringValueSchema, { value: "task-42" }));
  const stored = await records.read("task-42");
  if (stored?.value !== "task-42") throw new Error("The record was not stored.");
} finally {
  records.close();
  factory.close();
}
```

The URL must include a database name. Use `postgres:` or `postgresql:` URLs;
credentials should come from the deployment environment. TLS options, pool
limits, connection timeout, and an explicit schema are configured through the
factory options. When no schema is supplied, the factory resolves
`current_schema()` once and uses that validated schema for all later operations.

For multitenancy, configure one database and pool per complete generated
`TenantId`. A schema is not a substitute for the database boundary. Duplicate
tenant or database targets are rejected during construction.

## Lifecycle and operations

Tables are initialized lazily and checked against the expected PostgreSQL
layout. Each acquired client is released and each transaction is completed or
rolled back. Call `factory.close()` when the application stops; it is
idempotent and drains live handles and pools. A closed factory cannot create new
handles.

The provider supports record CRUD, compare-and-set, immutable append, Entity
state and event history, delivery cleanup, declared-column filtering, sorting,
limits, offsets, and continuations through the common storage API. It uses
PostgreSQL `BYTEA`, parameterized `$1`-style values, and PostgreSQL's configured
text collation. Collation ordering can differ from JavaScript ordering, so
applications should choose and document their database collation deliberately.

`google.protobuf.Timestamp` columns are epoch nanoseconds in `BIGINT`, and
`spine.core.Version` columns are numeric `INT`. Generated names use the JVM
physical-name renderer: ASCII unquoted spelling folds to lowercase, names are
limited to 63 UTF-8 bytes, and case-folded or byte-limit collisions are rejected
before the database is accessed.

## Live integration checks

The live suite is opt-in and requires an already running PostgreSQL service.
No container or database is started automatically:

```sh
SPINE_TS_POSTGRESQL_URL='postgresql://user:password@127.0.0.1:5432/spine_test' \
SPINE_TS_POSTGRESQL_TENANT_A_URL='postgresql://user:password@127.0.0.1:5432/spine_tenant_a' \
SPINE_TS_POSTGRESQL_TENANT_B_URL='postgresql://user:password@127.0.0.1:5432/spine_tenant_b' \
  pnpm --filter @spine-event-engine/storage-postgres test:postgresql
```

The tenant URLs must name two distinct databases; separate schemas in one
database do not prove the multitenant boundary.

Use `test:postgresql:16` or `test:postgresql:18` when the URL points to the
corresponding server major. The repository's initial acceptance ran both
commands successfully against PostgreSQL 16.15 and 18.6.

Use a dedicated database account with DDL, metadata, and DML permissions. Keep
URLs and credentials out of source control, configure TLS for production, and
plan backups, monitoring, and migrations separately.
