# Spine TS User Guide

This guide takes a new application from Protobuf schemas to a local Spine
server. It uses one `Tasks` bounded context and generated domain messages.
`@example/tasks-proto` is a consumer substitution: replace it with the package
name that publishes your generated Protobuf-ES output.

## 1. Install and generate

Spine TS is ESM-first and targets Node 24 LTS or newer. Install dependencies,
then generate the Protobuf-ES files before TypeScript builds your application.

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

    this.updateDraftState(() =>
      create(TaskSchema, {
        id,
        title: command.title,
      }),
    );
    return create(TaskCreatedSchema, { id, title: command.title });
  }
}

export class TaskWorkflowProcess extends ProcessManager<TaskId, typeof TaskWorkflowSchema, number> {
  @React
  requestOwnerNotification(event: TaskCreated): OwnerNotificationRequested {
    void event;
    const id = clone(TaskIdSchema, this.id);

    this.updateDraftState(() =>
      create(TaskWorkflowSchema, {
        id,
        ownerNotificationRequested: true,
      }),
    );
    return create(OwnerNotificationRequestedSchema, { id });
  }

  @Command
  notifyOwner(event: OwnerNotificationRequested): NotifyOwner {
    void event;
    const id = clone(TaskIdSchema, this.id);

    this.updateDraftState(() =>
      create(TaskWorkflowSchema, {
        id,
        ownerNotificationRequested: false,
      }),
    );
    return create(NotifyOwnerSchema, { id });
  }
}

export class TaskListProjection extends Projection<TaskId, typeof TaskListSchema, number> {
  @Subscribe
  include(event: TaskCreated): void {
    const id = clone(TaskIdSchema, this.id);

    this.updateDraftState(() =>
      create(TaskListSchema, {
        id,
        title: event.title,
        openTaskCount: 1,
      }),
    );
  }
}
```

The repository invokes each handler inside a framework-owned transaction.
`updateDraftState()` replaces only that active draft; accepted framework work
commits it to the entity and storage. `this.id` is the framework-provided routed
entity identity, so handlers do not extract or validate a target for routing.
Keep business decisions in these methods, but do not open, commit, or roll back
transactions yourself. Application handlers return only generated domain
messages.

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

Use `ServerEnvironment.local()` for development and tests. It supplies
in-memory storage and same-process transport. For a deployment-shaped assembly,
use `ServerEnvironment.production({ storageFactory, transport })`; both
facilities are required and remain caller-selected.

```ts
import { Server, ServerEnvironment } from "@spine-ts/server";
import { tasksBuilder } from "@example/tasks-domain";

const environment = ServerEnvironment.local();
const server = Server.atPort(0, { environment }).add(tasksBuilder);
```

The server gives its environment storage factory to added builders unless a
builder explicitly selected a storage factory. A supplied environment is
caller-owned by default. Set `ownsEnvironment: true` only when this server is
responsible for permanently closing it.

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
drains accepted work, detaches delivery, then closes contexts, added resources,
and any server-owned environment. Concurrent closes share work; a successful
close is idempotent. If close fails, call `close()` again to retry only the
unfinished cleanup. Caller-owned environments stay open after this server
closes and can be used by a fresh server with fresh contexts. A failed start is
terminal for that `Server` instance after its cleanup completes; create a new
server instance for a new attempt.

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
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";

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
timer work. Activation atomically
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
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";

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
observation. A post failure is recorded internally, is not reflected in the
`Ack`, and is not currently retried. Do not return rejection or service envelope
values from handlers.

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

Initial-release exclusions also include durable production storage adapters,
deployment/authentication/tracing hardening, retained update replay policy,
and broad production verification. The runnable to-do example is local and
single-process; it does not demonstrate a multi-process mode.

## Further reading

- [Root README](../README.md) for workspace commands and package boundaries.
- [Server package README](../packages/server/README.md) for supported public
  server APIs.
- [Testing package README](../packages/testing/README.md) for fixture details.
- [Transport package README](../packages/transport/README.md) for local IPC
  constraints.
- [API documentation](api/README.md) for public API semantics.
