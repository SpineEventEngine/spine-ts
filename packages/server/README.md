# Spine application server for Node.js

`@spine-event-engine/server` is the native Node.js runtime for a Spine Application.
Use it to assemble Bounded Contexts and expose native Connect/gRPC-compatible
services. Browser hosting is deliberately a separate entry point.

> **Experimental prerelease.** Install an exact snapshot while this API evolves:
> Snapshot releases may remove earlier prerelease import paths.

## Install and prerequisites

```bash
pnpm add @spine-event-engine/server@snapshot
```

Use Node.js in ESM mode. Before adding entities, generate your application
model and handler metadata with `@spine-event-engine/proto-tools`, then import
`generated/spine-bootstrap.js` before assembly. The small
example below has no entity handlers, so it is useful for proving that native
assembly, listener startup, and cleanup work locally.

## First native server

Build an Application, start a loopback listener on an ephemeral port, and close
the listener before the Application. `start()` installs no signal handlers, which makes
this shape appropriate for tests and hosts that manage shutdown themselves.

<!-- docs-snippet-path: packages/server/test/server/server-environment.test.ts -->

```ts
import { Application, BoundedContext, Server, ServerEnvironment } from "@spine-event-engine/server";

const environment = ServerEnvironment.newBuilder().build();
const application = await Application.newBuilder()
  .setServerEnvironment(environment)
  .add(BoundedContext.singleTenant("Tasks"))
  .build();
const running = await Server.atPort(0).setApplication(application).start();
try {
  // Native Command, Query, and Subscription services are now listening.
} finally {
  await running.close();
  await application.close();
}
```

Add generated Entities to a Bounded Context builder with `.add(EntityClass)`.
Pass that builder to Application. Application build sets up storage and transport,
assembles every Bounded Context, and registers shared reads before starting work.
Select `singleTenant(name)` or `multiTenant(name)` when declaring each Bounded Context.

By default, Application build prepares model structures and starts subscription
monitoring. Pass `{ createStorageStructures: false, startSubscriptionMonitoring: false }`
to defer both until first use, or disable either independently. Monitoring still
prepares its shared subscription registry when model preparation is deferred.
Required startup failure prevents the Application from serving. A lazy first-use
failure rejects that input and can be retried.

`application.createStorageStructures(...tenantIds)` prepares declared structures
across its open Bounded Contexts. With explicit IDs it selects multi-tenant Bounded
Contexts, without requiring those tenants to be registered. With no IDs it includes
single-tenant Bounded Contexts and the current registered tenants. The corresponding
`checkStructureCompatibility()` checks structures without creating them; other
startup services may already have prepared their separate storage.
Use `boundedContext.runtime.createStorageStructures()` or the corresponding check
to work on one Bounded Context. Administrative failure leaves an established
Application running. These calls neither create a database nor register a tenant.

## Give an Entity an application service

Spine normally constructs an Entity with its ID, state, version, and lifecycle
options. If your constructor also needs a service, supply `onCreate` when
registering the class. For example, the Projects application's Process Manager
uses an assignment-weight service:

<!-- docs-snippet-path: examples/projects/test/topology.test.ts -->

```ts
import { BoundedContext } from "@spine-event-engine/server";
import { TaskAssignment, type AssignmentWeightService } from "../src/index.js";

// Create shared services before starting the context.
const weights: AssignmentWeightService = { weightFor: () => 2 };
const builder = BoundedContext.singleTenant("Assignments").add(TaskAssignment, {
  // Forward Spine's options and add the service required by the constructor.
  onCreate: (options) => new TaskAssignment(options, weights),
});
```

The application's `src/index.js` imports its generated `spine-bootstrap.js`
before assembly, so `add(TaskAssignment)` finds the passive metadata for that
exact class.

Pass `builder` to Application and await Application build. The callback runs for each
fresh or restored Entity object, not just once per ID. It also works for
Aggregates and Projections, including Projection rebuilds. Return a fresh
instance synchronously and pass the supplied options unchanged. Application
services are not persisted; the application manages their initialization and
shutdown. Constructors that need only `EntityOptions` require no callback.

Explicit repositories accept `onCreate` in their options too. See the
[guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/USER_GUIDE.md#give-an-entity-an-application-service) for the
full story and the [reference](REFERENCE.md#entity-constructor-dependencies)
for the exact contract.

## Async handlers and Process Manager queries

An `@Assign`, `@Command`, `@React`, or `@Subscribe` handler may return its
usual result directly or through exactly one built-in `Promise<T>` layer. Its
in-memory Entity draft remains active until that promise settles. Nested `Promise<Promise<T>>`
results and structural or imported thenable lookalikes are rejected during handler
analysis. Storage writes happen in separate short operations after the handler succeeds.
A failed handler leaves previous persisted state unchanged and
suppresses produced output. An external HTTP request or other side effect may
already have happened.

Repository-backed Command and Event posting resolves after recipient Inbox
writes. Delivery starts immediately and handles the stored row separately, so
successful posting does not mean the handler has completed. Restart durability
depends on the configured storage provider; custom dispatchers define their own
completion contract. A committed Entity awaits one outgoing handoff attempt for
handler-produced domain Commands and Events. A failed attempt is reported without
rerunning successful source handling. Internal diagnostic publication remains
best effort.

New Inbox rows have no completion deadline. After a recipient is handled, the
first acknowledgement marks its row delivered and keeps that row for five
seconds as duplicate evidence. A pending row does not expire during a slow
handler. Cleanup can remove a delivered row once its deadline has passed.

Handler return declarations can use native unions for one of several results,
or fixed tuples for several ordered results. For example,
`CreateAccessGrant | ExtendAccessGrant` selects one Command, while
`readonly [AccessGrantCreated, AccessRequestCompleted?]` returns an Event and
possibly a second Event. Each actual result must be declared by that handler.
Arrays and local/imported aliases of these concrete message types are supported
too. `@Assign` returns Events, `@Command` returns Commands, `@React` returns
Events or `undefined`, and `@Subscribe` declares `void` or `Promise<void>`.
Event/rejection-input `@Command` also permits `undefined`, alone or alongside
concrete Command types. Only subscriptions accept `void`; required empty
results and unexpected returned values fail before Entity commit or publication.
See the [return-type guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/USER_GUIDE.md#choose-what-a-handler-returns)
for examples, optional results, and the restrictions for each decorator.

Every Entity's `version` is the generated Spine `Version`; the framework
advances it once when a successful dispatch produces Events or changes state or
lifecycle, not for a no-op.

Declare each domain rejection a command handler may throw. This registers the
rejection before the server starts, so a client can subscribe even when no
server handler consumes that rejection:

<!-- docs-snippet-path: examples/todo/src/index.ts -->

```ts
import { Assign, Throws } from "@spine-event-engine/server";
import type { CompleteTask } from "../generated/spine/examples/todo/task_commands_pb.js";
import type { TaskCompleted } from "../generated/spine/examples/todo/task_events_pb.js";
import { TaskAlreadyDone } from "../generated/spine/examples/todo/task_rejections.js";

class TaskAssignee {
  @Assign
  @Throws(TaskAlreadyDone)
  completeTask(command: CompleteTask): TaskCompleted {
    throw TaskAlreadyDone.create({ id: command.id });
  }
}
```

Place the primary handler decorator first for readability. Reversing the two
decorators has the same behavior.

Process Managers have protected read-only `select()` during a handler. Agents use
the generated `select(query).read()` form with the same actor, tenant, and
1,000-state limits. Aggregates do not expose handler-scoped queries.

For Process Manager's schema-and-columns query form:

```ts
import { EntityQuery, type EntityColumn } from "@spine-event-engine/core";
import { ProcessManager } from "@spine-event-engine/server";

type RequestView = import("@bufbuild/protobuf").Message<"RequestView"> & {
  id: string;
  status: string;
  createdAt: number;
};
declare const RequestViewSchema: import("@bufbuild/protobuf/codegenv2").GenMessage<RequestView>;
declare const RequestViewColumns: {
  readonly status: EntityColumn<typeof RequestViewSchema, "status", string, "equal">;
  readonly createdAt: EntityColumn<
    typeof RequestViewSchema,
    "createdAt",
    number,
    "equal" | "greaterThan"
  >;
};
abstract class RequestCoordinator extends ProcessManager<string, typeof RequestViewSchema> {
  protected async handleRequest(requestId: string): Promise<void> {
    const pending = await this.select(RequestViewSchema, RequestViewColumns)
      .where(EntityQuery.eq(RequestViewColumns.status, "pending"))
      .orderBy(RequestViewColumns.createdAt, "asc")
      .limit(10)
      .read();
    const one = await this.select(RequestViewSchema, RequestViewColumns).findById(requestId);
    void [pending, one];
  }
}
```

These reads are eventually consistent. `limit()` may not exceed 1,000, and
`all()` can be expensive for a large read model; prefer a targeted, ordered,
bounded query.

The Entity type identifies its Bounded Context among those registered with the same
`Server`. For example, an order process can query a product in a catalogue
Bounded Context without naming that Bounded Context. An Entity in another Bounded Context must allow
queries (`query` or `full` visibility). Registering the same Entity type in two
Bounded Contexts causes a startup error.

The [Orders example](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/orders/README.md#cross-context-order-review)
shows this in an Event handler and includes a runnable integration test.

Application queries use generated `_queries.proto` request/response companions.
Pass concrete `AppQueryHandler<Q, R>` instances in `ServerOptions.appQueries`;
generated metadata alone never enables a route. On direct app-node ingress,
`QueryService.Execute` validates the wire envelope and Q before dispatch.
Native and browser Gateways forward Execute to the app node; `ClientRequest.query(generatedQ)`
returns the wire `Response` and zero or one decoded paired results. Application code calls
`server.query(generatedQ, executionContext)` and receives the paired generated R.
The trusted execution context supplies the current `actorContext`, optional
verified principal and authority facts, and an optional cancellation signal.
For a Process Manager or Agent, inject a Server-bound query function through the
repository's `onCreate` callback and use `currentActorContext` only inside an
active handler. That actor metadata does not prove authentication. Source reads
from an application query use registered query-visible Entity routes and enforce
the destination's tenant membership; a handler that performs no source read has
no destination tenant to check. Direct calls do not run Server output filters.

The [typed callback example](REFERENCE.md#services-reads-and-lifecycle) shows
the repository `onCreate` injection and active handler call. The actor/tenant
snapshot supplies no verified principal or provider facts; the
[scoped integration test](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/test/entity/process-manager-querying.test.ts) shows
the complete repository setup.

Queries preserve the handler's actor and effective tenant; there is no tenant
override. Single-tenant execution uses `SINGLE_TENANT`, even when the request
omits a tenant field. A named tenant cannot query a single-tenant context: that
fails before reading. See the [query contract](REFERENCE.md#handler-routing-and-operations)
for the complete tenant rules and empty-result behavior.
Every multi-tenant Bounded Context uses `application.tenantIndex()`. The getter is
synchronous and returns the same index handle without storage I/O. Register each
accepted tenant through `await application.tenantIndex().keep(tenantId)` before
sending tenant-scoped work. Preparing a supplied TenantId can happen before this
registration. Request admission still rejects unregistered tenants.

The default index uses the Application environment's storage. A single-tenant
Application that never asks for tenant storage does not initialize it. Single-tenant
Bounded Contexts use `SINGLE_TENANT`, even when another Bounded Context uses the index.
Provider catalogs remain separate and do not determine tenant membership.
`PersistentTenantIndex.create({ storageFactory, group })` stores registrations
through the selected factory. Remote providers can retain them across process
restarts; memory storage remains process-local. Its async factory prepares supported structures by
default; set `createMissingStructures: false` when the application prepares
the selected record family separately before data access. Supply the index with
`Application.newBuilder().setTenantIndex(index)`. Application closes it after its
admitted work finishes; it leaves the separately supplied storage factory open.
Unknown tenants fail before reads or handlers run; input never registers them.

The [Orders application](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/orders/README.md)
demonstrates this setup with memory, PostgreSQL, and Datastore. Its PostgreSQL
launch uses separate shared, Northwind, and Contoso databases, validates persisted
membership against configured routing, and prepares supported structures before
opening the listener. Orders focuses on tenant storage and has no sign-in UI.
The [Fieldnotes application](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/fieldnotes/README.md)
demonstrates browser authentication and private data in a single-tenant Bounded
Context without a tenant index.

Use `EntityQuery.all(...)` when every predicate must match and
`EntityQuery.either(...)` when any branch may match.

## Draft with an Agent

An Agent is a stateful Entity that can ask a model for help while handling a
Command or Event. For example, a support Agent drafts a reply from ticket facts
and emits an Event for a person to review. It keeps provider credentials out of
the handler and records the model interaction. Like other Entities, its ID and
state are declared in Proto and its handlers use generated registration.

An Agent can read its recorded interactions and emitted domain Events through
its repository. See the [Agent execution reference](REFERENCE.md#agent-execution)
for history methods, paging, and live execution behavior.

Declare the Agent ID and state in Proto, with `option (entity).kind = ENTITY;`
on the state. The [Support example](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/README.md) includes
complete [domain Protos](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/proto/spine/examples/support/states.proto),
[a model definition](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/src/model.ts), and
[an Agent implementation](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/src/index.ts).

The handler invokes a typed model operation, updates its draft only on success,
and emits a domain outcome. This abbreviated declaration uses the example's
actual generated messages:

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: examples/support/src/index.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { Agent, Assign } from "@spine-event-engine/server";
import type { DraftSupportReply } from "../generated/spine/examples/support/commands_pb.js";
import {
    SupportReplySuggestedSchema,
    SupportReplyFailedSchema,
    type SupportReplySuggested,
    type SupportReplyFailed,
} from "../generated/spine/examples/support/events_pb.js";
import { SupportDraftStateSchema } from "../generated/spine/examples/support/states_pb.js";
import type { SupportTicketId } from "../generated/spine/examples/support/types_pb.js";
import { draftSupportReply } from "./model.js";

/** Proposes support replies for a person's review. */
class SupportDraftAgent extends Agent<SupportTicketId, typeof SupportDraftStateSchema> {
    /**
     * Drafts a reply from the submitted ticket facts.
     *
     * @param command Ticket facts and an explicit conversation.
     * @returns The proposed reply or a recorded failure outcome.
     */
    @Assign
    async draft(command: DraftSupportReply): Promise<SupportReplySuggested | SupportReplyFailed> {
        if (command.conversation === undefined || command.request === undefined)
            throw new TypeError("A draft requires ticket facts and a conversation.");
        const result = await this.ai.invoke(draftSupportReply, {
            call: "draft-support-reply",
            conversation: command.conversation,
            input: command,
        });
        const outcome = {
            id: this.id,
            request: command.request,
            conversation: command.conversation,
            operation: result.operationId,
        };
        if (!result.ok) return create(SupportReplyFailedSchema, outcome);
        this.update((state) =>
            Object.assign(state, {
                id: this.id,
                request: command.request,
                conversation: command.conversation,
                reply: result.value,
            }),
        );
        return create(SupportReplySuggestedSchema, { ...outcome, reply: result.value });
    }
}
```

<!-- prettier-ignore-end -->

Configure the registry outside the Entity. The Bounded Context requires persisted System
Events, and the Agent registration supplies its permitted capabilities. The
[example Bounded Context factory](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/src/index.ts)
assembles these settings with generated passive handler metadata. Supply the AI registry
through `ServerEnvironment.newBuilder().under(type, (configuration) => configuration.use({ ai: registry }))`
as a default, or
`BoundedContextBuilder.withAi(registry)` for one Bounded Context.

Posting a Command awaits acceptance. Model work and the resulting domain Event
arrive asynchronously afterward. The handling operation can await a model without
keeping a database transaction open. See the [Agent execution reference](REFERENCE.md#agent-execution)
for defaults and retained history.

## Native lifecycle and routing

`Server.run()` is the standalone process form: it handles `SIGINT`/`SIGTERM`
cleanup. `Server.start()` returns a `RunningServer` for an embedding host to
close. `ManagedServerApplication` is the Node-only complete-replica entrypoint;
it does not infer process or Delivery-shard counts.

Routes are declared by generated message schema or interface token. Exact
schema routes take precedence. Query results from `Stand` are authoritative;
subscriptions are live, best-effort notifications, so clients re-query after a
reconnect or a possible gap. Configure a storage provider for durable
application state and generated repository assembly; in-memory choices are
for local development and tests.

## Entity identifiers

An Entity ID can be a primitive value or a complete generated Protobuf message.
For a message-valued ID, the Entity state message declares that ID message as
its first field. Every field declared by the ID message, including nested
messages, is part of the identity.

```proto
message WorkItemId {
  spine.core.UserId owner = 1;
  int32 sequence = 2;
}

message WorkItem {
  WorkItemId id = 1;
  string title = 2;
}
```

Generated messages can have any declared identifier fields. For example,
`CommandId` is a generated message ID:

```ts
import { create } from "@bufbuild/protobuf";
import { type MessageId } from "@spine-event-engine/server";
import { CommandIdSchema } from "@spine-event-engine/proto";

const id = create(CommandIdSchema, { uuid: "task-42" });
const entityId: MessageId = id;
```

At routing, the generated ID is checked against the state field's declared
schema and its generated validation rules before durable use. When default
routing finds a message but the Entity ID type is primitive, define a custom
route that returns the intended primitive ID.

Without a custom route, Command routing uses the Command's declared first
field. Event routing uses a compatible producer ID when available and otherwise
uses the Event's declared first field. State-update routing selects the first
state field compatible with the Entity ID.

## Browser gateway setup

The server root has no browser options and does not load auth. To host a
browser-facing Gateway, install the optional auth peer and import the browser
entry point explicitly:

```bash
pnpm add @spine-event-engine/server@snapshot @spine-event-engine/auth@snapshot
```

```ts
import { BrowserServer, DurableSubscriptionBindings } from "@spine-event-engine/server/browser";
```

`BrowserServer.open(...)` composes a browser listener around a caller-managed
native server; `BrowserServer.run(...)` starts and manages a standalone or
combined browser host. Supply exact allowed origins, a session or intentional
public admission, authorization and trusted-context resolvers, finite limits,
and backend forwarding. Authenticated durable bindings are browser-host
infrastructure, not native `Server` state. See the [browser/auth extension guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
before exposing a backend to a browser.

For a standalone Gateway, call `BrowserServer.run` with a canonical
`backend.baseUrl` (or discovery), `origins`, `sessions`, `authorize`, `contexts`,
`clock`, and explicit `bindings`. Supply `credentials` with a
`BrowserCredentialReader` to select a browser auth engine. The reader and each
`authRoutes` entry declare `csrfHeaderNames`, `credentialCookieNames`, and
`stateCookieNames`; empty arrays state that a category is unused. The Gateway
validates those names before it starts listening, then checks raw headers before
calling the reader or a route. Preflight never calls the credential reader;
permitted origins receive credentialed CORS headers covering the configured CSRF
fields and Connect protocol headers. Connect stops waiting for a reader and
does not forward its late result when the request is cancelled or its deadline
passes. The reader receives no abort signal, so its underlying work may continue.
This setup does not construct a
`ServerEnvironment` or Bounded Context. Close the returned server at shutdown.

## Native reader admission

Native authentication is configured through `ServerOptions.services.readerAdmission`.
Use `direct` to authenticate native callers, or `forwarded` to verify signed
assertions from a Gateway. For signed browser forwarding, configure the matching
`BrowserServerOptions.forwardingProof` issuer. The server verifies the proof and
forwarding peer before admitting reader facts.

For an application listener reachable only by trusted components, set
`services.readerAdmission: "trusted-network"` on the receiving Server and
`BrowserServerOptions.forwarding: "trusted-network"` on the Gateway. The Gateway
sends its admitted principal and authority facts without a proof. The listener
checks the envelope and operation, then trusts those facts. Anyone able to reach
that listener can assert another principal, so restrict its network access.
ActorContext does not authenticate a reader.

With neither admission adapter configured, the native server remains public and
supplies no authenticated principal or authority facts. It rejects internal
reader metadata. A trusted-network listener also admits native calls without
reader metadata, supplying an empty reader. Existing read filters and application
policy decide what those calls may access. A signed-only listener still requires
a valid proof. A trusted-network listener rejects proof-bearing metadata.

Subscribe, Activate, Cancel, and cleanup carry the admitted reader identity.
Activation and cancellation compare the current reader with the subscription's
stored identity. The host supplies an operation signal before authentication and
closes it after unary work or the complete Activate stream. A direct authenticator
can return a separate `invalidated` signal for local logout and session expiry.
See [native reader admission](REFERENCE.md#native-reader-admission) for signatures
and managed application configuration.

## Limits

This package does not create an identity provider, browser session store,
authorization policy, TLS configuration, or deployment topology. It does not
guarantee replay, gap repair, exactly-once subscription effects, or
cluster-complete notification delivery.

## Next steps

- [Detailed coding-agent reference](REFERENCE.md)
- [Authentication gateway](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/auth/README.md)
- [Message Board application](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/message-board/app/README.md)
