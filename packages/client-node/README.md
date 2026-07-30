# @spine-event-engine/client-node

Node transport factory and descriptor-backed Entity query foundations for Spine.

Browser/gateway behavior is documented in the
[browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md).

`Client.connectTo(url)` supplies a Node HTTP/2 transport to the shared
`@spine-event-engine/client-web` kernel and owns that session. `Client.usingTransport(transport)`
uses a caller-owned transport. Node is responsible only for that native
transport and request-ID source; request scopes, protocol operations, and
subscription lifecycle belong to the shared client.

```ts
import { Client } from "@spine-event-engine/client-node";
import { CreateTaskSchema } from "@example/tasks-proto/task_commands_pb";

const client = Client.connectTo("http://127.0.0.1:8080", { tenant: "tasks" });
await client.onBehalfOf("alice").post(CreateTaskSchema, { title: "Read client results" });
await client.close();
```

The public protocol verbs are `post`, `send`, `createSubscription`, `activate`,
and `cancel`. `send()` accepts a built Spine `Query`; `createSubscription()`
accepts a Spine `Topic`, returns an inactive handle, and `activate()` starts its
wire stream. Entity-column generation remains Node-only on the `./codegen`
subpath.

## Entity queries

The generated companion defines the only application columns accepted by an
Entity query. Generated code imports `GeneratedEntityColumns` from the
Node-only codegen subpath, while application code registers the definition and
uses `EntityQuery` for both predicates and compilation.

```ts
import { EntityColumn, EntityQuery } from "@spine-event-engine/client-node";
import { TaskViewColumnDefinition } from "@example/tasks-model/task_view_columns_pb";
import { TaskViewSchema } from "@example/tasks-model/task_view_pb";

const columns = EntityColumn.register(TaskViewSchema, TaskViewColumnDefinition);
const owner = "alice";
const query = EntityQuery.select({ schema: TaskViewSchema, columns, context })
  .where(EntityQuery.all(EntityQuery.eq(columns.owner, owner), EntityQuery.ge(columns.priority, 1)))
  .orderBy(columns.priority, "desc")
  .limit(20)
  .build();
```

`limit()` requires at least one `orderBy()` clause. Columns are immutable and
bound to their registered schema, so predicates cannot be reused for a
different Entity target. `EntityQuery` supports `eq`, `gt`, `lt`, `ge`, `le`,
`all`, and `either`; it packs declared values and the `version`, `archived`,
and `deleted` system columns into the Spine wire query.
