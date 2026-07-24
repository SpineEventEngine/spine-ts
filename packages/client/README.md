# @spine-event-engine/client

Node client facade and descriptor-backed Projection query foundations for Spine.

`Client.connectTo(url)` owns its HTTP/2 session; `Client.usingTransport(transport)`
leaves a caller-supplied Connect transport open. A client defaults to the `guest`
actor. Request scopes are immutable, so actor, tenant, and time-zone context cannot
leak between concurrent calls. Tenant and `zoneId` are fixed for the full client
lifecycle: nonempty strings and Protobuf inputs are validated and cloned when the
client is created. Omitting `zoneId` resolves Node's current nonempty system IANA
zone once; it does not change for later operations. Call `close()` once application
work is finished; it is idempotent and rejects work started after close begins.

```ts
import { create } from "@bufbuild/protobuf";
import { Client } from "@spine-event-engine/client";
import { CreateTaskSchema } from "@example/tasks-proto/task_commands_pb";

const client = Client.connectTo("http://127.0.0.1:8080", {
  tenant: "tasks",
  zoneId: "Europe/Lisbon",
});
const result = await client
  .onBehalfOf("alice")
  .post(CreateTaskSchema, create(CreateTaskSchema, { title: "Read client results" }));

if (result.kind === "error") console.error(result.error);
if (result.kind === "rejection") console.error(result.rejection);
```

For the system-zone default, omit `zoneId`; the selected zone remains stable for
both guest and actor scopes. Use a Protobuf ID when that better fits application
configuration; it is still copied at construction:

```ts
import { create } from "@bufbuild/protobuf";
import { Client } from "@spine-event-engine/client";
import { TenantIdSchema, ZoneIdSchema } from "@spine-event-engine/proto";

const client = Client.connectTo("http://127.0.0.1:8080", {
  tenant: create(TenantIdSchema, { kind: { case: "value", value: "tasks" } }),
  zoneId: create(ZoneIdSchema, { value: "Europe/Lisbon" }),
});
const guest = client.asGuest();
const alice = client.onBehalfOf("alice");
await client.close();
```

The `@example/*` import above represents the application's generated
Protobuf-ES module; replace it with the real module that exports the command
schema.

To observe immediate events caused by a command, pass one or more generated
event schemas. Subscribe completes and the activation consumer attaches before posting. The
accepted result exposes one bounded, single-consumer `AsyncIterable`; cancel it
when enough events have arrived:

```ts
import { TaskCreatedSchema } from "@example/tasks-proto/task_events_pb";

const abortController = new AbortController();
const observed = await client
  .onBehalfOf("alice")
  .post(CreateTaskSchema, create(CreateTaskSchema, { title: "Observe the result" }), {
    observe: [TaskCreatedSchema],
    signal: abortController.signal,
  });
if (observed.kind === "ok") {
  for await (const event of observed.events) {
    console.log(event.message, event.context);
    await observed.events.cancel();
  }
}
await client.close();
```

Refusal, post failure, caller abort, buffer overflow, and `Client.close()` clean
up observation automatically. Successful observation remains caller-owned.
Remote cancellation is internally bounded to one second. Explicit `cancel()`
reports cleanup failure; `Client.close()` completes owned-session shutdown and
then reports any cleanup failures it collected.

Projection state and event topics use the same request scope. Creation resolves
only after the server has accepted `Subscribe` and the activation consumer has
locally issued its first read. This is not a remote wire acknowledgement;
asynchronous activation failures reject iterator reads. Both handles are bounded, single-consumer async iterables;
an overflow is terminal and triggers remote cancellation. State topics support
IDs, equality predicates, nested `all()` / `either()` groups, and a field mask.
Range predicates, ordering, and limits are query-only. Event topics currently
accept only an abort signal because the frozen TS service accepts no event
criteria or mask.

```ts
import { create } from "@bufbuild/protobuf";
import { Client, ProjectionColumn, all, either, eq } from "@spine-event-engine/client";
import { TaskListColumnDefinition } from "@example/tasks-proto/task_list_columns";
import { TaskListSchema } from "@example/tasks-proto/task_list_pb";
import { TaskIdSchema } from "@example/tasks-proto/task_id_pb";
import { TaskCreatedSchema } from "@example/tasks-proto/task_events_pb";

const TaskListColumns = ProjectionColumn.register(TaskListSchema, TaskListColumnDefinition);
const subscriptionClient = Client.connectTo("http://127.0.0.1:8080", { tenant: "tasks" });
const states = await subscriptionClient
  .onBehalfOf("alice")
  .subscribeToState(TaskListSchema, TaskIdSchema, {
    ids: [create(TaskIdSchema, { value: "list-1" })],
    where: all(eq(TaskListColumns.archived, false), either(eq(TaskListColumns.deleted, false))),
    mask: ["id", "openTaskCount"],
  });
for await (const update of states) {
  if (update.kind === "state") console.log(update.state);
  else console.log("no longer matches", update.id);
  await states.cancel();
}

const events = await subscriptionClient.asGuest().subscribeToEvents(TaskCreatedSchema);
for await (const { message, context } of events) {
  console.log(message, context);
  await events.cancel();
}
await subscriptionClient.close();
```

Pass an `AbortSignal` in either subscription options object to stop it without
awaiting the handle, or call and await `cancel()` to observe remote cleanup
failure. Each handle buffers at most 32 decoded updates. The 33rd update ends
the handle with `ClientProtocolError` and starts remote cancellation; updates
are never silently discarded. A normally completed remote stream is simply
terminal—the frozen wire contract cannot distinguish a normal completion from
server-side overflow. Active updates are not replayed or reconnected after a
disconnect, so query current state before resubscribing. A `noLongerMatching`
state update identifies an entity that previously matched the criteria but no
longer does. `connectTo()` closes its owned HTTP/2 session in `close()`, while
`usingTransport()` never closes the caller-owned transport.

`post()` and `query()` return `ok`, `error`, or `rejection` for valid service
responses. Network and deadline failures remain Connect errors. Caller abort
rejects with the `AbortSignal` reason. The facade throws `ClientProtocolError`
when a successful wire response is malformed.

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
high-level factories remain deferred until Wave 2. Execute the built query with
`ClientRequest.query()` as shown below.

```ts
import { create } from "@bufbuild/protobuf";
import {
  Client,
  ProjectionColumn,
  ProjectionQuery,
  all,
  either,
  eq,
  ge,
  gt,
  le,
  lt,
} from "@spine-event-engine/client";
import { ActorContextSchema, UserIdSchema } from "@spine-event-engine/proto";
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

const queryClient = Client.connectTo("http://127.0.0.1:8080", { tenant: "tasks" });
const queryResult = await queryClient.onBehalfOf("alice").query(TaskListSchema, query);
if (queryResult.kind === "ok") {
  for (const { state, version } of queryResult.states) {
    console.log(state, version);
  }
}
await queryClient.close();
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
import { unpackAny } from "@spine-event-engine/core";
import type { QueryResponse } from "@spine-event-engine/proto/client";

declare const response: QueryResponse;

const states = response.message.map(({ state }) => {
  if (state === undefined) throw new Error("Query result state is required.");
  const decoded = unpackAny(state, TaskListSchema);
  if (decoded === undefined) throw new Error("Query result state type does not match TaskList.");
  return decoded;
});
```

Generated sources obtain their definition constructor from the dedicated
`@spine-event-engine/client/codegen` subpath. Application code should import only the
resulting generated definition and the root Projection API.

The package also installs `protoc-gen-spine-projection-columns` for Buf-based
generation. Run it after Protobuf-ES with the same output directory so the
`*_columns.ts` companions sit beside their generated message schemas.
