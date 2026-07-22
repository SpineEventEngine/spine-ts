# @spine-ts/client

Descriptor-backed client foundations for Spine Projection queries.

Generated Projection metadata is registered with
`ProjectionColumn.register(schema, generatedDefinition)`. Registration checks
the Projection entity kind, exact `(column)` fields, descriptor identity,
singular/non-oneof shape, and descriptor-derived comparison family. The result
is immutable and cached by schema identity.

The generated collection includes declared columns plus `version`, `archived`,
and `deleted`. Strings, numeric scalars, `google.protobuf.Timestamp`, and
`spine.core.Version` support ordering operators. Boolean, bytes, enum, and
other message fields support equality only.

Application code cannot construct arbitrary columns or author generated
definitions through the package root. `ProjectionQuery.select()` builds a
Projection-only frozen `spine.client.Query`; Aggregate and Process Manager
high-level factories remain deferred until Wave 2. Network execution belongs
to the later client facade or the generated `QueryService` client.

```ts
import { create } from "@bufbuild/protobuf";
import {
  ProjectionColumn,
  ProjectionQuery,
  all,
  either,
  eq,
  ge,
  gt,
  le,
  lt,
} from "@spine-ts/client";
import { ActorContextSchema, UserIdSchema } from "@spine-ts/proto";
import { TaskListColumnDefinition } from "@example/tasks-proto/task_list_columns";
import { TaskListSchema } from "@example/tasks-proto/task_list_pb";

const TaskListColumns = ProjectionColumn.register(TaskListSchema, TaskListColumnDefinition);

const query = ProjectionQuery.select({
  schema: TaskListSchema,
  columns: TaskListColumns,
  context: create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "guest" }),
  }),
})
  .byId("list-1", "list-2")
  .where(
    all(
      eq(TaskListColumns.archived, false),
      gt(TaskListColumns.openTaskCount, 0),
      lt(TaskListColumns.openTaskCount, 100),
      ge(TaskListColumns.openTaskCount, 1),
      le(TaskListColumns.openTaskCount, 20),
      either(eq(TaskListColumns.deleted, false), eq(TaskListColumns.archived, false)),
    ),
  )
  .mask("id", "openTaskCount")
  .orderBy(TaskListColumns.openTaskCount, "desc")
  .limit(20)
  .build();
```

The two `@example/*` imports are consumer substitutions, not packages shipped
by Spine TS. Replace `@example/tasks-proto/task_list_pb` with the consumer's
generated Protobuf-ES module that exports `TaskListSchema`, and replace
`@example/tasks-proto/task_list_columns` with its generated `*_columns.ts`
companion, which exports `TaskListColumnDefinition`. The application owns the
registered `TaskListColumns` collection created with `ProjectionColumn.register()`.

Repeated `orderBy()` calls preserve caller order; storage appends the entity ID
tie-breaker. Missing values sort first ascending and last descending. A limit
must be a positive integer and requires ordering. Runtime compilation rejects
foreign columns, wrong value/operator pairs, and unknown mask fields.

`QueryService.Read` returns each state packed as Protobuf `Any`. Unpack it with
the same generated schema used to build the query:

```ts
import { unpackAny } from "@spine-ts/core";
import type { QueryResponse } from "@spine-ts/proto/client";

declare const response: QueryResponse;

const states = response.message.map(({ state }) => {
  if (state === undefined) throw new Error("Query result state is required.");
  const decoded = unpackAny(state, TaskListSchema);
  if (decoded === undefined) throw new Error("Query result state type does not match TaskList.");
  return decoded;
});
```

Generated sources obtain their definition constructor from the dedicated
`@spine-ts/client/codegen` subpath. Application code should import only the
resulting generated definition and the root Projection API.

The package also installs `protoc-gen-spine-projection-columns` for Buf-based
generation. Run it after Protobuf-ES with the same output directory so the
`*_columns.ts` companions sit beside their generated message schemas.
