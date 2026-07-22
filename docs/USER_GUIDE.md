# Spine TS User Guide

This guide takes a new application from Protobuf schemas to a local Spine
server. It uses one `Tasks` bounded context and generated domain messages.
`@example/tasks-proto` is a consumer substitution: replace it with the package
name that publishes your generated Protobuf-ES output.

## 1. Set up repository sources and generate

Spine TS is ESM-first and targets Node 24 LTS or newer. This repository is the
current supported setup: its workspace packages are private at version `0.0.0`,
so they are not packages to install from a registry. Clone the repository, run
the workspace commands below, and use workspace dependencies while developing
alongside the sources. A future published consumer distribution will document
its own registry installation instructions; do not infer `pnpm add` commands
from this source-repository guide.

Install the repository dependencies, then generate the Protobuf-ES files before
TypeScript builds an application in the workspace:

```bash
pnpm install
pnpm proto:generate
pnpm typecheck:build
```

In this repository, `proto:generate` produces ignored Protobuf-ES output and a
handler registry for the included application. A consumer must run its own
Protobuf-ES generation and its equivalent handler-registry build step whenever
its `.proto` files or decorated handlers change. The registry source belongs
under the consumer's ignored `generated/handler/` directory and its compiled
JavaScript must be present under `dist/generated/handler/` before startup.

The framework registry tool is build-time tooling. Its required inputs are the
consumer TypeScript project, its generated source directory, and a generated
output path. This repository's build workflow is an executable reference; do
not copy its repository-relative paths into an installed application.

## 2. Model domain messages

Use a stable package and `type_url_prefix`; model IDs as generated messages;
and make each aggregate, process-manager, or projection state an entity. Put
the route ID first in command and event messages. Apply Spine validation
options to required fields, and mark immutable entity fields `set_once`.
Projection query fields need the `column` option.

`task_state.proto` — IDs and entity states:

```proto
syntax = "proto3";

package acme.tasks.v1;

import "spine/options.proto";

option (type_url_prefix) = "type.acme.tasks";

message TaskId {
  string value = 1 [(required) = true];
}

message Task {
  option (entity).kind = AGGREGATE;

  TaskId id = 1 [(required) = true, (validate) = true, (set_once) = true];
  string title = 2 [(required) = true];
}

message TaskWorkflow {
  option (entity).kind = PROCESS_MANAGER;

  TaskId id = 1 [(required) = true, (validate) = true, (set_once) = true];
  bool owner_notification_requested = 2;
}

message TaskList {
  option (entity).kind = PROJECTION;

  TaskId id = 1 [(required) = true, (validate) = true, (set_once) = true];
  string title = 2 [(required) = true];
  int32 open_task_count = 3 [(column) = true];
}
```

### Projection columns

Projection code generation emits a descriptor-backed definition next to the
state schema. Register that value once and reuse the returned immutable column
collection. The imports and exported declaration below come from
`examples/todo/src/projection-columns.ts`, so their relative paths resolve from
that application source file. The final property-access lines illustrate the
inferred column API and are not part of that source file:

```ts
import { ProjectionColumn } from "@spine-ts/client";
import { TaskListColumnDefinition } from "../generated/spine/example/todo/v1/task_list_columns.js";
import { TaskListSchema } from "../generated/spine/example/todo/v1/task_list_pb.js";

export const TaskListColumns = ProjectionColumn.register(TaskListSchema, TaskListColumnDefinition);

TaskListColumns.openTaskCount; // number, ordering operators
TaskListColumns.version; // spine.core.Version, ordering operators
TaskListColumns.archived; // boolean, equality only
TaskListColumns.deleted; // boolean, equality only
```

| Protobuf column value                                | Comparison operators  |
| ---------------------------------------------------- | --------------------- |
| string and numeric scalar                            | equality and ordering |
| `google.protobuf.Timestamp` and `spine.core.Version` | equality and ordering |
| boolean, bytes, enum, and other message              | equality only         |

Repeated, map, and oneof fields are rejected. The root API does not let
application code construct arbitrary string columns or authored definitions.
This packet provides Projection column metadata only: Aggregate and Process
Manager factories, a query DSL, and query execution are not yet included.
The repository's `proto:generate` workflow runs the
`protoc-gen-spine-projection-columns` executable shipped by `@spine-ts/client`
after Protobuf-ES for every example target. Installed projects can add that bin
as a local plugin in their Buf generation template.

`task_commands.proto` — commands (the filename ends in `commands.proto`):

```proto
syntax = "proto3";

package acme.tasks.v1;

import "acme/tasks/v1/task_state.proto";
import "spine/options.proto";

option (type_url_prefix) = "type.acme.tasks";

message CreateTask {
  TaskId id = 1 [(required) = true, (validate) = true];
  string title = 2 [(required) = true];
}

message NotifyOwner {
  TaskId id = 1 [(required) = true, (validate) = true];
}
```

`task_events.proto` — events (the filename ends in `events.proto`):

```proto
syntax = "proto3";

package acme.tasks.v1;

import "acme/tasks/v1/task_state.proto";
import "spine/options.proto";

option (type_url_prefix) = "type.acme.tasks";

message TaskCreated {
  TaskId id = 1 [(required) = true, (validate) = true];
  string title = 2 [(required) = true];
}

message OwnerNotificationRequested {
  TaskId id = 1 [(required) = true, (validate) = true];
}
```

The framework derives message roles and routing from generated descriptors. An
application supplies domain messages and field data; it does not supply
framework routing metadata.

## 3. Write domain handlers

Handlers are public instance methods with bare decorators, an explicit generated
domain-message type for their first parameter, and an explicit return type.
The registry generator uses those types. `@Assign` accepts a generated command
and returns generated events; `@Command` accepts an event and returns generated
commands; `@React` accepts an event and returns generated events or `void`; and
`@Subscribe` accepts an event and returns `void`.

This is an illustrative but typeable consumer fragment: it needs the shown
generated package from section 2. `@example/tasks-proto` is a substitution, not
a package provided by Spine TS.

```ts
import { clone, create } from "@bufbuild/protobuf";
import {
  Aggregate,
  Assign,
  Command,
  ProcessManager,
  Projection,
  React,
  Subscribe,
} from "@spine-ts/server";
import {
  NotifyOwnerSchema,
  OwnerNotificationRequestedSchema,
  TaskCreatedSchema,
  TaskIdSchema,
  TaskListSchema,
  TaskSchema,
  TaskWorkflowSchema,
  type CreateTask,
  type NotifyOwner,
  type OwnerNotificationRequested,
  type TaskCreated,
  type TaskId,
} from "@example/tasks-proto";

export class TaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  @Assign
  create(command: CreateTask): TaskCreated {
    const id = clone(TaskIdSchema, this.id);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskSchema, {
          id,
          title: command.title,
        }),
      ),
    );
    return create(TaskCreatedSchema, { id, title: command.title });
  }
}

export class TaskWorkflowProcess extends ProcessManager<TaskId, typeof TaskWorkflowSchema, number> {
  @React
  requestOwnerNotification(event: TaskCreated): OwnerNotificationRequested {
    void event;
    const id = clone(TaskIdSchema, this.id);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskWorkflowSchema, {
          id,
          ownerNotificationRequested: true,
        }),
      ),
    );
    return create(OwnerNotificationRequestedSchema, { id });
  }

  @Command
  notifyOwner(event: OwnerNotificationRequested): NotifyOwner {
    void event;
    const id = clone(TaskIdSchema, this.id);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskWorkflowSchema, {
          id,
          ownerNotificationRequested: false,
        }),
      ),
    );
    return create(NotifyOwnerSchema, { id });
  }
}

export class TaskListProjection extends Projection<TaskId, typeof TaskListSchema, number> {
  @Subscribe
  include(event: TaskCreated): void {
    const id = clone(TaskIdSchema, this.id);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskListSchema, {
          id,
          title: event.title,
          openTaskCount: 1,
        }),
      ),
    );
  }
}
```

The repository invokes each handler inside a framework-owned transaction.
`update()` synchronously mutates the live active draft and returns its resulting
state; use it when the handler has already decided the transition is valid. A
throw after a partial `update()` mutation propagates and does not roll that
partial mutation back. Use `tryUpdate()`
when a proposed mutation must be checked before it is applied: it mutates a
deeply independent scratch draft, returns an immutable empty array on success
or immutable constraint violations on failure, and leaves the live draft
unchanged on validation failure or a thrown error. Mutators must be synchronous;
async/thenable results are rejected. Unrelated errors are not converted to
validation results. Accepted framework work commits the
draft to the entity and storage. `this.id` is the framework-provided routed
entity identity, so handlers do not extract or validate a target for routing.
Keep business decisions in these methods, but do not open, commit, or roll back
transactions yourself. Application handlers return only generated domain messages.

```ts
import { clone, create } from "@bufbuild/protobuf";
import { Assign, Aggregate } from "@spine-ts/server";
import {
  RenameTaskRejectedSchema,
  TaskIdSchema,
  TaskRenamedSchema,
  TaskSchema,
  type RenameTask,
  type RenameTaskRejected,
  type TaskId,
  type TaskRenamed,
} from "@example/tasks-proto";

class ValidatingTaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  @Assign
  rename(command: RenameTask): TaskRenamed | RenameTaskRejected {
    const id = clone(TaskIdSchema, this.id);
    const violations = this.tryUpdate((draft) => {
      draft.title = command.title;
    });

    return violations.length === 0
      ? create(TaskRenamedSchema, { id, title: command.title })
      : create(RenameTaskRejectedSchema, { id, violation: [...violations] });
  }
}
```

## 4. Generate and load the handler registry

The generated registry bridges the bare decorator declarations to repository
assembly. Do not hand-write it or load it yourself. Compile it with the rest of
the application, then point the context at the trusted compiled application or
package root that contains `generated/handler/generated-handler-registry.js`.

```ts
import { BoundedContext } from "@spine-ts/server";
import { TaskAggregate, TaskListProjection, TaskWorkflowProcess } from "@example/tasks-domain";

export const tasksBuilder = BoundedContext.singleTenant("Tasks")
  .add(TaskAggregate)
  .add(TaskWorkflowProcess)
  .add(TaskListProjection)
  .withGeneratedRegistryRoot(new URL("..", import.meta.url));
```

This practical fragment requires `@example/tasks-domain` to be the consumer's
compiled domain package and `import.meta.url` to be in its `dist/` output.
Call `buildAsync()` during server assembly; it imports the registry, checks its
metadata, and creates the default repositories. A missing, unreadable, or stale
registry stops assembly before the listener opens.

## 5. Assemble storage, contexts, and an environment

`ServerEnvironment` is a process singleton. Local Node environments use
in-memory storage and same-process transport by default. Configure a deployment
before the first server is constructed with `when(...).use(...)`. Production
selection requires `NODE_ENV=production` to be set before the first
`Environment` or `ServerEnvironment` resolution (including `Server.atPort()`),
and then requires both storage and transport.

```ts
import type { StorageFactory } from "@spine-ts/storage";
import type { SignalTransport } from "@spine-ts/transport";
import { EnvironmentType, Server, ServerEnvironment } from "@spine-ts/server";
import { tasksBuilder } from "@example/tasks-domain";

// Start this process with NODE_ENV=production.
declare const storageFactory: StorageFactory;
declare const transport: SignalTransport;

ServerEnvironment.when(EnvironmentType.Production).use({ storageFactory, transport });
const server = Server.atPort(0).add(tasksBuilder);
```

The server gives the singleton storage factory to added builders unless a
builder explicitly selected a storage factory. Closing a server never closes
process facilities; call `await ServerEnvironment.instance().close()` during
explicit process shutdown.

## 6. Start and close the server

`start()` builds contexts, completes finite startup recovery, opens context
transport intake, and only then opens the HTTP/2 listener. The default host is
`127.0.0.1`; port `0` asks the OS for a free port.

```ts
const running = await server.start();

try {
  console.log(running.baseUrl);
  // Run clients while the listener is open.
} finally {
  await running.close();
}
```

`close()` stops listener intake and sessions, closes context transport intake,
drains accepted work, detaches delivery, then closes contexts and added
resources. It does not close shared process facilities; after every server has
detached, call `await ServerEnvironment.instance().close()` during process
shutdown. Concurrent closes share work; a successful close is idempotent. If
close fails, call `close()` again to retry only unfinished server cleanup. A
failed start is terminal for that `Server` instance after its cleanup completes;
create a new server instance for a new attempt.

## 7. Post commands and read acknowledgements

Use the generated Spine `CommandService` through a Connect or gRPC client.
`Post` returns an `Ack` after command intake, validation, and the command
handler's immediate work; it is not proof that every resulting projection,
process-manager reaction, or subscription update has completed. Wait for the
specific observable consequence through a query, subscription, or test poll.

The following client setup is illustrative and typeable after substituting the
application's generated service package and a concrete valid `postRequest`
fixture. The fixture must contain the generated Spine command-service request
for a valid generated domain command, including its caller-selected command ID
and actor context.

```ts
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { CommandService } from "@spine-ts/proto/client";

const commands = createClient(CommandService, createGrpcTransport({ baseUrl: running.baseUrl }));
declare const postRequest: Parameters<typeof commands.post>[0];
const ack = await commands.post(postRequest);
```

Treat an OK acknowledgement as acceptance for the supported immediate path.
The framework may continue follow-up work asynchronously.

## 8. Query and subscribe to state

Use the generated `QueryService` for registered aggregate or projection state.
It supports ID-target reads and projection `include_all` reads. Projection
queries can use declared proto `column` names, equality filters, field masks,
ordering, and positive limits from `1` through `1000` when ordering is present.
When the format is absent or its wire limit is zero, the framework applies a
1,000-row storage safety cap without requiring ordering. Invalid criteria fail
before state storage is read, and tenant selection is applied before this cap.

Use `SubscriptionService.Subscribe`, then `Activate`. `Cancel` accepts the
returned `Subscription` message, not its opaque ID alone; pass that message
when the client is finished. State topics support ID and equality filters;
event topics currently support `include_all`. Inactive subscription records
are storage-backed and have a default TTL of 30 seconds. Non-positive or
non-finite values become 1, positive finite values are floored, and an effective
TTL above 2,147,483,647 milliseconds throws synchronously before storage or
timer work. Client rejection updates redact rejected-command payload forms and
throwable stack; internal generated subscribers retain full defensive context.
Activation atomically
replaces the inactive row with an owner claim before attaching delivery and
retains the claim while active; updates from before activation are not replayed.
Cancel removes an inactive row or same-instance claim through a marker. A claim
owned by another service instance returns `ABORTED`; a crashed owner may leave a
stale claim because this release has no claim lease or automatic reclamation.
Active streams and queued updates are process-local, with a
default queue cap of 100 updates. Exceeding that cap closes the stream and
discards its queued updates. `SpineServicesOptions.subscriptionLimit` defaults
to 100 and bounds pending, inactive, active, and recovered subscriptions owned
by that `SpineServices` instance; configure a positive safe integer for
instance-local capacity planning. Each instance has an independent limit, so
this is neither a process-wide nor a distributed quota. Unknown-ID cancellation
work uses a separate internal pool with the same bound. Pool exhaustion returns
Connect `RESOURCE_EXHAUSTED` before storage access. If known-local durable
cancellation persistence fails, `Cancel` returns Connect `INTERNAL` with
`Subscription cancellation failed.`, retains that instance's capacity, and the
client should retry `Cancel` with the same returned `Subscription` message
containing its ID. This
retry guidance applies only to an ID returned by `Subscribe`; cleanup after an
initial failed `Subscribe` stays internal and uses the inactive TTL when its
timer can be retained. If inactive-expiry cleanup fails after its timer is
cleared, the instance retains its local record and capacity with no automatic
retry; explicit `Cancel` with that same returned `Subscription` message
containing its ID can retry persistence cleanup. Active streams and their queues are not recovered or replayed after
disconnection or process restart, so clients must query current state when they
need a fresh view.

This client setup is illustrative: supply generated `Query` and `Topic`
fixtures targeting a registered state schema, then use the three clients.

```ts
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { QueryService, SubscriptionService } from "@spine-ts/proto/client";

const transport = createGrpcTransport({ baseUrl: running.baseUrl });
const queries = createClient(QueryService, transport);
const subscriptions = createClient(SubscriptionService, transport);
declare const query: Parameters<typeof queries.read>[0];
declare const topic: Parameters<typeof subscriptions.subscribe>[0];

const response = await queries.read(query);
const subscription = await subscriptions.subscribe(topic);
const updates = subscriptions.activate(subscription);
try {
  // Consume `updates` while this client needs the live view.
  void updates;
} finally {
  await subscriptions.cancel(subscription);
}
```

## 9. Handle invalid input and domain rejection

Send domain commands through the command service and inspect the returned
`Ack`. Invalid accepted payloads return `COMMAND_VALIDATION_ERROR` with packed
`spine.validation.ValidationError` details before dispatcher execution.
Framework-controlled state-transition validation returns
`COMMAND_STATE_TRANSITION_VALIDATION_FAILED` with validation details.

For a domain rule failure, throw the generated companion for a top-level message
declared in a `rejections.proto` file. Repository execution rolls back before
scheduling the typed rejection event independently. `CommandService.Post`
returns an OK acceptance acknowledgement. If the independently scheduled post
succeeds, an already-active `SubscriptionService` stream with queue capacity
may receive the rejection asynchronously; saturation or closure can prevent
observation. Its client event envelope preserves the typed rejection and
ordinary event metadata, but redacts rejected-command payload forms and
throwable stack.
Framework-generated internal subscribers still receive the full defensive
`EventContext`. A post failure is recorded internally, is not reflected in the
`Ack`, and is not currently retried. Do not return rejection or service
envelope values from handlers.

After the consumer project's pnpm Proto generation step, a handler saved as
`src/handlers/task.ts` can use the generated project-root paths below:

```ts
import { create } from "@bufbuild/protobuf";

import { TaskAlreadyDone } from "../../generated/spine/example/todo/v1/task_rejections.js";
import { TaskIdSchema } from "../../generated/spine/example/todo/v1/task_id_pb.js";

throw TaskAlreadyDone.create({
  id: create(TaskIdSchema, { value: "task-42" }),
});
```

Invalid payloads, transition-validation failures, and unexpected technical
errors remain non-OK acknowledgements with their existing error contracts.

## 10. Test the real paths

`@spine-ts/testing` provides `BoundedContextFixture` for in-process black-box
tests over a built context. It posts commands, reads queries, polls eventual
query results, and activates subscriptions through the same service adapters.
Use it for focused application behavior, including asynchronous projection
consequences. It does not start a listener or replace a network client.

This practical test shape requires a built `tasksContext` and generated service
message fixtures from the consumer test-support package.

```ts
import { BoundedContextFixture } from "@spine-ts/testing";
import {
  createTaskRequest,
  taskListQuery,
  taskListTopic,
  tasksContext,
} from "@example/tasks-test-support";

const fixture = new BoundedContextFixture(tasksContext);
const updates = await fixture.subscribe(taskListTopic);
const ack = await fixture.post(createTaskRequest);
const response = await fixture.readEventually(taskListQuery);
await updates.close();
void ack;
void response;
```

Also run a real loopback test: start `Server` on port `0`, create Connect clients
with `createGrpcTransport({ baseUrl: running.baseUrl })`, and exercise command,
query, and subscription services. This verifies the actual HTTP/2 service
boundary; it needs an environment that permits loopback listeners.

Network request and response messages default to a 4,194,304-byte uncompressed
limit. Configure `Server.atPort(port, { readMaxBytes, writeMaxBytes })` only when
the application needs a different finite bound; both values must be integers
from 1 through 4,294,967,295. These framework bounds complement, rather than
replace, deployment ingress and rate limits.

## 11. Delivery, IPC, and release limits

Process-manager reactions and projection `@Subscribe` handler delivery use
framework-owned durable handoff. This server-side entity-handler delivery is
separate from the client-facing `SubscriptionService` streams in section 8;
those active client streams and their queues are process-local. A handler can
be invoked more than once when ownership changes or a prior invocation cannot
be conclusively finalized, so handlers must make side effects replay-safe and
tolerate at-least-once delivery.

A failed supported delivery callback may remain pending after framework
cleanup. No automatic retry scheduler or monitor revisits that row. Durable
handoff records the work, but it is not an autonomous eventual-delivery
guarantee.

The ZeroMQ adapter is available only at `@spine-ts/transport/zeromq` for local
IPC on one host. Treat its IPC directory and every frame as trusted runtime
data: share it only with same-host peers that already trust each other, and
keep the canonical directory beneath a non-attacker-writable parent. POSIX
directories must be owned by the effective user with exact mode `0700`; final
links are rejected, while immutable root-owned macOS `/tmp` and `/var` aliases
are canonicalized. The adapter rechecks the directory immediately before
native bind/connect, but pathname ZeroMQ cannot eliminate substitution after
that check. The adapter has no transport-owned retry loops and
provides no retry or restart guarantee. It also does not provide remote
transport, durable redelivery, exactly-once delivery, process supervision,
broad health checks, or production topology.

Initial-release exclusions include deployment/authentication/tracing hardening,
retained update replay policy, and broad production verification. Local IPC has
child-process test coverage, but the runnable to-do application is not a public
production multi-process topology.

## 12. Develop with Google Cloud Datastore

`@spine-ts/storage-datastore` is an optional implementation of the public
`@spine-ts/storage` port. It uses the official Google Cloud Datastore client
against Google Cloud Datastore or Firestore in Datastore mode; it does not use
Firestore Native APIs. The adapter belongs at server/context composition. Keep
domain handlers, aggregates, process managers, and projections dependent on
the provider-neutral `StorageFactory` boundary.

The package is a private workspace package in this repository, not a registry
installation target. Build the workspace first, then use the current package
roots in a workspace application:

```bash
pnpm install
pnpm typecheck:build
```

### Configure the factory and credentials

Inject a configured Google client when the application owns its creation and
lifecycle. This is appropriate when you need explicit project, emulator,
credential, or transport configuration. The factory and storage handles never
invoke teardown or close on an injected client; the caller retains any
applicable client/resource lifecycle in its own shutdown path.

```ts
import { Datastore } from "@google-cloud/datastore";
import { DatastoreStorageFactory } from "@spine-ts/storage-datastore";

const client = new Datastore({ projectId: "orders-development" });
const storageFactory = new DatastoreStorageFactory({ client });
```

For ordinary caller-chosen Google client options, `create()` owns only the act
of constructing the client; it does not establish an adapter credential policy
or invoke client teardown:

```ts
import { DatastoreStorageFactory } from "@spine-ts/storage-datastore";

const storageFactory = DatastoreStorageFactory.create({
  projectId: "orders-development",
  // credentials or keyFilename may be supplied here when the Google client needs them.
});
```

Application Default Credentials are supported only to the extent supported by
the Google client. Pass `credentials` or `keyFilename` as Google client options
when that is the selected deployment configuration. Never log credentials,
private keys, or stored payload bytes. Transaction failures that contain
credential-, payload-, or secret-like provider messages are exposed as the
redacted `Datastore transaction failed.` error; do not treat that redaction as
a complete logging policy.

Compose the factory through `withStorageFactory()` or an environment, not in a
handler. The runnable [Datastore orders example](../examples/datastore-orders/)
keeps its domain topology provider-neutral and creates the adapter only at this
composition boundary.

```ts
import { BoundedContext } from "@spine-ts/server";
import type { StorageFactory } from "@spine-ts/storage";
import { TaskAggregate, TaskListProjection, TaskWorkflowProcess } from "@example/tasks-domain";

export function tasksBuilder(storageFactory: StorageFactory) {
  return BoundedContext.singleTenant("Tasks")
    .withStorageFactory(storageFactory)
    .add(TaskAggregate)
    .add(TaskWorkflowProcess)
    .add(TaskListProjection)
    .withGeneratedRegistryRoot(new URL("..", import.meta.url));
}
```

This uses the consumer substitution introduced at the start of the guide and
the entity classes from section 3. Do not call storage-provider APIs from a
domain handler.

### Tenant slices, IDs, records, and indexes

For a multitenant `StorageContext`, a non-blank `tenantId` becomes the Datastore
namespace. A missing or blank tenant ID fails before provider work. Single-
tenant contexts add no per-tenant namespace; any default namespace configured
on the Google client remains provider behavior. Treat tenant identity as part
of the application's context construction and test isolation boundary.

The adapter stores a private flat entity for each record: canonical Protobuf
binary payload plus the record's declared indexed columns. Storage-slot IDs are
reversibly and canonically encoded for keys, stored metadata, ID filters,
continuations, and returned entries. The encoding preserves `undefined`,
`bigint`, arrays, and object IDs regardless of object-property insertion order.
It is an adapter implementation detail, not an identifier format for clients
or other Datastore users.

Indexed record-column values support strings, finite Datastore-compatible
numbers, booleans, `null`, and exact signed 64-bit `bigint`. Other column value
types, non-finite numbers, and out-of-range `bigint` values fail before a
provider RPC. Define only the columns your queries need, and deploy Datastore
composite indexes for each production combination of equality filters and sort
orders. The adapter does not create or deploy those indexes.

### Queries have pushdown and a finite reconciliation bound

`RecordQuery` ID constraints become Datastore key filters; supported equality
filters and requested sorts become provider filters and orders. The adapter
always adds a deterministic key tie-breaker. It fetches the complete provider
candidate set within the finite scan bound before it applies canonical
equality, typed continuations, offset, and requested limit locally once.

Every provider query is limited to `maxClientSideScan + 1`: the default scan
budget is `1000`, and a custom positive finite integer is configured through
the constructor with an injected client (not through `create()`). The extra row
is a sentinel. If it is returned, `DatastoreQueryLimitError` is thrown before
local continuation processing and no partial result is returned. A
continuation therefore cannot page around candidate-set overflow: provider
filters must keep the complete candidate set within the configured bound.
There is no unlimited setting and no adapter-specific generic cursor API.

```ts
import { Datastore } from "@google-cloud/datastore";
import { DatastoreStorageFactory } from "@spine-ts/storage-datastore";

const boundedStorageFactory = new DatastoreStorageFactory({
  client: new Datastore({ projectId: "orders-development" }),
  maxClientSideScan: 500,
});
```

### Writes, batches, compare-and-set, and closure

Normal `write()` replaces one record. `writeAll()` materializes all records
before persistence and sends them in order in groups of at most 500 mutations.
It is not an all-or-nothing multi-group transaction: if a later group fails,
earlier groups can already be stored, and the application must use an explicit
recovery strategy appropriate to its workflow.

`compareAndSet(id, expected, next)` is transactional for one storage slot
across independently opened handles sharing the backing store. It returns
`false` when the current payload does not match `expected`; `next: undefined`
performs a conditional delete.

Retriable Datastore transaction conflicts (code 10) receive at most three total
attempts. That is the initial attempt plus at most two retries with bounded
exponential delay and jitter. Other errors propagate, except sensitive-looking
transaction messages are redacted as described above. This is a single-slot
primitive, not a general multi-record transaction API.

Closing a `StorageFactory` prevents new storage creation; it does not close
existing storage handles. Closing a storage handle prevents future operations
on that handle, while independently opened handles remain separately closeable.
Neither operation invokes teardown or close on an injected Google client, and
the adapter does not invoke client teardown for a client made by `create()`
either. Arrange application shutdown so servers/contexts finish their own
closure before the caller tears down any shared client/resource.

### Emulator-first verification and limited cloud smoke

Use the emulator for adapter development. Start Firestore in Datastore mode,
then point the official client at it:

```sh
gcloud emulators firestore start --database-mode=datastore-mode --host-port=127.0.0.1:8081
DATASTORE_EMULATOR_HOST=127.0.0.1:8081 \
  DATASTORE_PROJECT_ID=orders-emulator \
  pnpm --filter @spine-ts/storage-datastore test:emulator
```

The adapter's emulator suite uses unique kinds and removes only its own data;
it does not reset a shared emulator. The package's ordinary tests use an
injected narrow client fake, so emulator tests are opt-in. For a deliberately
credential-gated cloud smoke check, select a disposable configured project:

```sh
DATASTORE_CLOUD_TEST=1 DATASTORE_PROJECT_ID=orders-smoke \
  pnpm --filter @spine-ts/storage-datastore test:cloud
```

The smoke test creates one unique kind and removes its record in `finally`.
It is evidence for that credential/project combination only. Emulator and cloud
smoke execution do not prove production composite-index deployment, all
transaction limits, all cloud consistency behavior, resilience under provider
outages, or a Firestore Native integration. See the
[`@spine-ts/storage-datastore` README](../packages/storage-datastore/README.md)
for the adapter contract and its current verification commands.

## 13. Develop with MySQL RDBMS storage

`@spine-ts/storage-rdbms` is the workspace's MySQL-first durable
`StorageFactory` adapter (tested with MySQL 8.4.10/mysql2 3.23.1). PostgreSQL
is not supported.

### Configuration and TLS

The URL names a MySQL database and rejects unsupported URL options. The public
options are `url`, `connectionLimit`, `connectTimeoutMs`, and TLS `ca`, `cert`,
`key`, and `rejectUnauthorized`. Create and always close its owned pool:

```ts
import { MysqlStorageFactory } from "@spine-ts/storage-rdbms";

const url = process.env.MYSQL_URL;
if (url === undefined || url.trim().length === 0) throw new Error("MYSQL_URL is required.");
const factory = await MysqlStorageFactory.create({
  url,
  connectionLimit: 8,
  connectTimeoutMs: 5_000,
  tls: { rejectUnauthorized: true },
});
try {
  // Supply factory to the provider-neutral context composition below.
} finally {
  await factory.close();
}
```

It is composed through the provider-neutral factory/`ServerEnvironment` seam,
not mysql2. Single-tenant contexts share one scope; multitenant operations need
a non-blank current `tenantId` and are isolated. It stores Protobuf payloads in
fixed `spine_ts_records`/`spine_ts_columns` tables, creates/verifies them at
startup, and executes `CREATE TABLE IF NOT EXISTS` on every factory creation.
The account therefore always needs that DDL permission plus normal DML
privileges. Use a dedicated database/account.

CRUD, ordered all-or-nothing `writeAll`, and slot-addressed payload CAS are
transactional. Supported canonical IDs are nullish values, booleans, finite
numbers, bigint, strings, bytes, arrays, and plain objects. Their canonical
scope, tenant, and slot encodings are limited to 512, 255, and 768 bytes; a
materialized column name's canonical encoding is limited to 255 bytes. Indexed
columns accept null, boolean, finite number, signed-64
bigint, and strings up to 256 JavaScript UTF-16 code units (encoded into fixed
768-byte sortable data). Queries push IDs,
AND filters (value arrays are OR), materialized-column sorting/keysets, offset,
and limit into MySQL; missing columns match nothing and dotted payload paths
are rejected. The lookup index helps equality/order, while filesort and large
offsets can still be costly. Provider errors are sanitized; closing a factory
blocks new operations, closes live handles, then drains its pool; an operation
already admitted may finish and release before the shared close promise drains
the pool. The account needs `CREATE TABLE IF NOT EXISTS` with its FK/index,
information-schema reads, and transactional `SELECT`/`INSERT`/`UPDATE`/`DELETE`;
precreating tables does not remove schema verification.

One query accepts at most 256 `ids`, 32 filters, 64 values per filter, eight
sort fields, and 2,048 total bound values. The adapter rejects these fixed,
non-configurable structure limits before it acquires a pool connection.

### Composition, tenancy, schema, and privileges

The domain stays provider-neutral. Supply the factory at context/environment
assembly, never from a handler:

```ts
import { BoundedContext } from "@spine-ts/server";
import type { StorageFactory } from "@spine-ts/storage";

function orders(storage: StorageFactory) {
  return BoundedContext.singleTenant("Orders").withStorageFactory(storage);
}
```

`ServerEnvironment` can supply this factory to server/context assembly. Scope
includes context name, tenant mode, and record type; single tenant uses the
canonical null tenant key, while multitenant requires a nonblank current
`tenantId`. Startup creates/verifies
fixed tables and fails closed on incompatible metadata; it has no migrations.
A dedicated account needs CREATE TABLE IF NOT EXISTS (FK/index), information-
schema reads, and transactional SELECT/INSERT/UPDATE/DELETE.

### IDs, columns, transactions, and errors

Only materialized column names and `id` are queryable. A name not materialized
for a record matches no rows. `writeAll` is one transaction and later duplicate
slots win; CAS compares deterministic Protobuf payload bytes and addresses the
supplied slot even when the body has another logical ID.

```ts
import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-ts/storage";

const spec = new RecordSpec({
  schema: StringValueSchema,
  extractId: (record) => record.value.slice(0, 1),
  columns: [new RecordColumn("state", (record) => record.value)],
});
const records = factory.createRecordStorage({ name: "Orders", multitenant: false }, spec);
await records.write(create(StringValueSchema, { value: "a-open" }));
await records.writeAll([create(StringValueSchema, { value: "a-paid" })]);
await records.compareAndSet("a", create(StringValueSchema, { value: "a-paid" }), undefined);
```

```ts
await records.queryEntries({
  filters: [{ column: "state", value: ["a-open", "a-paid"] }],
  sort: [{ field: "state", direction: "asc" }],
  offset: 0,
  limit: 20,
  after: { values: [{ field: "state", value: "a-open" }], id: "a" },
});
```

Filters are ANDed; value arrays are OR/IN. `ids` and returned entries use
actual slots. Missing columns match no rows. Keysets require the complete sort
tuple; unspecified ordering uses a binary slot tie-break. MySQL can filesort
some orderings and large offsets are costly.

`MysqlStorageConfigurationError`, `MysqlStorageConnectionError`,
`MysqlStorageSchemaError`, `MysqlStorageDataError`, and
`MysqlStorageOperationError` are sanitized public error classes. Query LIMIT
uses mysql2's parameterized `query()` route because server-prepared JS-number
LIMIT binds are rejected; it never interpolates values. Pool-close failures are
reported as `MysqlStorageConnectionError`; repeated close calls still return
the same rejecting promise.

### Lifecycle, verification, and future engines

Run the opt-in disposable-database proof with
`SPINE_TS_MYSQL_URL='mysql://user:password@127.0.0.1:3306/spine_test' pnpm --filter @spine-ts/storage-rdbms test:mysql`.
It creates and removes only the adapter tables; do not log credentials.

## Further reading

- [Root README](../README.md) for workspace commands and package boundaries.
- [Server package README](../packages/server/README.md) for supported public
  server APIs.
- [Testing package README](../packages/testing/README.md) for fixture details.
- [Transport package README](../packages/transport/README.md) for local IPC
  constraints.
- [Datastore adapter README](../packages/storage-datastore/README.md) for
  provider configuration, query bounds, and emulator/cloud test limits.
- [MySQL RDBMS adapter README](../packages/storage-rdbms/README.md) for the
  durable adapter's exact limits, lifecycle, and local MySQL proof.
- [Datastore orders example](../examples/datastore-orders/README.md) for a
  provider-neutral application composition and loopback load specimen.
- [To-do application guide](../examples/todo/USER_GUIDE.md) for the runnable
  local application workflow and its distinct topology limits.
- [API documentation](api/README.md) for public API semantics.
