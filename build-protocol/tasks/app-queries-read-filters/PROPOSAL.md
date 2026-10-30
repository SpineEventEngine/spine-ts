# App Queries, read-side filters, validation, and automatic discovery in Spine TS

This proposal adds two application APIs and removes the need to pass generated-registry paths to each Bounded Context:

- **App Queries:** Protobuf requests handled by application code registered with `Server`.
- **ReadSideFilters:** typed functions that can change or remove returned domain messages. Register them with `Server`, with individual Bounded Context builders, or with both.

The existing build also generates `generated/spine-metadata.ts` and discovers the metadata supplied by application dependencies. Discovery describes available types and classes; the application still chooses which classes and instances to register.

This work also closes the validation gaps in the existing TS services. App Queries must receive the same complete input validation from their first implementation.

The comparison below uses **current Spine JVM master `f2926a58`**, checked against **Spine TS master `3135caaa2`**. JVM 1.9 is not the baseline for these decisions. Code marked as proposed describes the API to implement.

## Where App Queries and filters are registered

App Query handlers are registered **only with Server**. No App Query registration is added to ServerEnvironment or BoundedContext.

Filters have two independent installation points:

| Installed on             | Applied to                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Server`                 | Domain data returned through that Server's gRPC read-side services: Entity-query results, App Query results, Entity subscription updates, and Event subscription deliveries. |
| A BoundedContext builder | Domain data supplied by that Bounded Context's read side, including direct/internal reads and its subscription deliveries.                                                   |
| Both                     | Each installation applies at its respective boundary.                                                                                                                        |

Protocol acknowledgements, error reports, and subscription-control messages are not domain records to remove. Filters process the returned domain messages, not the transport envelope or its status.

Proposed setup, after the application's ordinary environment configuration:

```ts
import "../generated/spine-bootstrap.js";

const accessFilter = new IssueAccessFilter(projectAccess);

const issues = BoundedContext.singleTenant("Issues")
  .add(IssueProjection)
  .addReadSideFilter(accessFilter);

const support = BoundedContext.singleTenant("Support")
  .add(SupportProjection)
  .addReadSideFilter(accessFilter);

const server = new Server({
  contexts: [issues, support],
  appQueries: [new TopIssuesHandler()],
  readSideFilters: [accessFilter, new IssueAssignedAccessFilter(projectAccess)],
  port: 8080,
});

const running = await server.start();
```

`appQueries`, `readSideFilters`, and the builder's `addReadSideFilter` are proposed additions. The generated bootstrap import replaces per-context registry paths, as explained below. Server already accepts Bounded Context builders and builds them during startup.

The same filter instance can be registered with several contexts and the Server. Its invocation state must stay in method arguments, not in mutable instance fields such as “current principal.” Separate invocations may run concurrently.

Registering the same instance at both boundaries means it can run twice on the same data: once as the BC supplies it, and once as the Server returns it. There is no implicit deduplication across these independently requested installations.

All registrations are ready before the corresponding boundary accepts work. Existing BC policies are part of Stand. Server policies and App Query handlers are local to that Server, not process-wide environment settings.

## Define an App Query in Protobuf

```proto
// issue_queries.proto
syntax = "proto3";
package example.issues;

import "spine/options.proto";
import "example/issues/identifiers.proto";
import "example/issues/issue_view.proto";

message SummarizeTopIssues {
    message Query {
        ProjectId project = 1 [(required) = true, (validate) = true];
    }

    message Response {
        repeated IssueView issues = 1;
    }
}
```

The `_queries.proto` suffix identifies these declarations. Each operation has nested Query and Response messages. No marker option or `optional` keyword is introduced.

Use the existing code-generation procedure for all these messages. The existing type registry, AnyPacker, StringifierRegistry, and validation support must recognize them just like every other application Proto type.

Protobuf-ES currently emits flat TypeScript names. The existing generation procedure should also expose the grouped names used here: `SummarizeTopIssues.Query`, `.Response`, `.querySchema`, and `.responseSchema`. These are aliases of the generated types and schemas, not different Proto messages.

The existing generation procedure has a Proto stage and a TypeScript handler-analysis stage. Extend both within that procedure:

- The Proto stage records Q/R schema pairing and emits the grouped exports. It also emits a public type-level association keyed by Q's literal `$typeName`: Q maps to R in an augmentable `AppQueryResponses` interface exported by `@spine-event-engine/core`. The grouped generated module includes that declaration automatically. This lets separately compiled clients infer R without importing server handlers.
- The existing TypeScript analysis stage records each AppQueryHandler subclass with its Q and R schemas. Server matches each explicitly supplied instance to its class description, then builds its Q type URL → instance dispatch table. TypeScript generics alone cannot provide this runtime information.

Reject mismatched Q/R declarations during generation. Reject missing or inconsistent metadata before Server starts listening. Several classes may implement the same Q/R pair, but registering two implementations for the same Q on one Server is an error. Two different Server instances may select different implementations. The browser-facing schema/type association contains no handler-class imports. No public AppQueryDefinition object or second generation procedure is needed.

## How generated metadata and automatic discovery work

Today, `generated/handler/generated-handler-registry.ts` describes classes and their handler methods. The Bounded Context builder loads its compiled file using `withGeneratedRegistryRoot(...)`. It does not automatically collect the corresponding files from dependency packages. When assembling classes that require this metadata, omitting the root is an error; there is no framework default that finds every package.

Rename and broaden that generated file to **`generated/spine-metadata.ts`**, compiled as `generated/spine-metadata.js`. The broader name matters because an App Query declaration is a Proto request/result pair, not a handler.

The file contains separate kinds of information:

| Information                                         | Example                                                         | What it enables                                                          |
| --------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Proto model metadata, using the existing registries | IssueView, IssueAssigned, SummarizeTopIssues.Query and Response | Packing, unpacking, validation, stringification, and looking up schemas. |
| Existing Entity and standalone-handler descriptions | IssueProjection and its event-handling methods                  | Assembling explicitly registered domain classes.                         |
| App Query declarations                              | SummarizeTopIssues.Query → SummarizeTopIssues.Response          | Knowing the request/result relationship.                                 |
| App Query implementation descriptions               | TopIssuesHandler implements that Q/R pair                       | Connecting an explicitly registered instance to its request type.        |

These are descriptions, not active registrations. Discovering TopIssuesHandler does not construct it or expose its query over a Server. Discovering an Entity does not assign it to a Bounded Context. Filters are installed explicitly too.

Use the **existing generation procedure** to produce this file. Extend the existing Proto generation and TypeScript analysis steps; do not introduce a separate App Query generator or a second AnyPacker/StringifierRegistry path. Existing Proto generation configuration still describes the model inputs. Automatic metadata discovery removes the additional runtime registry-root wiring.

### Find participating dependency packages during the build

Give each participating package a conventional export, proposed here as `<package-name>/spine`, pointing to its compiled spine-metadata.js. For example:

```json
{
  "name": "@example/issues",
  "exports": {
    ".": "./dist/src/index.js",
    "./spine": "./dist/generated/spine-metadata.js"
  }
}
```

This illustrates the new export; preserve the package's other exports and declaration mappings.

The application build walks its declared runtime dependency graph using normal package resolution. A package with this export contributes metadata. A package without it contributes none. Traverse transitive dependencies as well, so the app need not list every indirect model or handler package again. Do not import or execute dependency modules merely to discover which packages participate.

Each package generates metadata for declarations in that package. The application composes those descriptions; it does not re-analyze dependency source files or attempt to reconstruct handlers from declaration files. Build workspace dependencies before the application, and publish their generated output with their normal package artifacts.

The application generation step produces **`generated/spine-bootstrap.ts`** with static imports of the discovered metadata. It includes the application's local spine-metadata.ts too, even when the application has no local handlers. One dependency reached through several paths is included once. Conflicting Proto definitions or inconsistent descriptions fail with a diagnostic naming the packages; no arbitrary “first package wins” rule.

```text
issues package:   generated/spine-metadata.js ─┐
accounts package: generated/spine-metadata.js ─┤
shared models:    generated/spine-metadata.js ─┼→ generated app bootstrap
app declarations:generated/spine-metadata.js ─┘       → application startup
```

The application imports that bootstrap before assembling contexts or starting its Server:

```ts
// app/src/main.ts
import "../generated/spine-bootstrap.js";
```

That is the one startup integration point. The dependency list is generated. There is no per-BC root and no runtime walk of the current directory or node_modules. A bundled application keeps the bootstrap import and its registration effects; packaging tests must verify that a bundler does not remove them.

At runtime, the bootstrap makes passive descriptions available through the framework's metadata lookup, keyed by the actual class constructors. Existing Proto registries receive the collected model information. The BC builder finds metadata for a class passed to `.add(...)`; Server finds metadata for the class of an instance passed in `appQueries`.

This shared metadata contains no active handlers, policies, tenant state, or reader identity. Each Server creates a separate dispatch table from its registered instances. Each BC uses the classes and filters registered with it. Directly building a BC after importing the bootstrap works without first constructing a Server.

If a required class description is absent, startup fails with the class and package named in the error. It should explain whether generation, package publication, or the bootstrap import is missing. It must not silently omit that class. Metadata imports declaration modules, not application entrypoints that start Servers; generation must reject an import cycle that would make this arrangement unusable.

The generated client-facing model exports remain separate from server implementation imports. A browser that imports SummarizeTopIssues receives its schemas and Q/R typing, without importing TopIssuesHandler or the server bootstrap.

### One package containing the whole application

```text
app/
  proto/issue_queries.proto
  src/issue-projection.ts
  src/top-issues-handler.ts
  src/main.ts
  generated/spine-metadata.ts
  generated/spine-bootstrap.ts
```

The ordinary build produces the metadata and bootstrap. Main imports the bootstrap, adds IssueProjection to a BC, and registers a TopIssuesHandler instance with Server. No registry location is supplied.

### Several packages, with handlers in one package

```text
issue-model/       Proto messages and generated schemas
identity-model/    Proto messages and generated schemas
app/               Entities, handlers, and startup code
```

The model packages contribute their Proto metadata. The app contributes its Entity/handler and App Query implementation descriptions. Its bootstrap collects all of them. Application startup uses exactly the same registration code as the single-package case.

The current Message Board example has this general shape: its model package supplies Proto models, while the application package contains handlers. Today MessageBoardApplication.createContext() calculates and passes its generated-registry root. Under this proposal, that root calculation disappears and the app entrypoint imports the generated bootstrap.

### Several packages containing Entities and handlers, with all BCs constructed in the app

This layout must work without requiring dependency packages to construct Bounded Contexts:

```text
issues/       IssueProjection and TopIssuesHandler
accounts/     AccountProjection
app/          imports both packages and constructs both Bounded Contexts
```

```ts
// app/src/main.ts — proposed setup
import "../generated/spine-bootstrap.js";
import { IssueProjection, TopIssuesHandler } from "@example/issues";
import { AccountProjection } from "@example/accounts";

const issues = BoundedContext.singleTenant("Issues").add(IssueProjection);

const accounts = BoundedContext.singleTenant("Accounts").add(AccountProjection);

const server = new Server({
  contexts: [issues, accounts],
  appQueries: [new TopIssuesHandler()],
  port: 8080,
});

await server.start();
```

The bootstrap finds metadata in both dependency packages. The app's `.add(...)` calls determine which classes go into which BC. It does not matter that the builder lives in app while the classes live elsewhere.

One BC can also combine compatible classes from several packages:

```ts
const issues = BoundedContext.singleTenant("Issues")
  .add(IssueProjection) // @example/issues
  .add(IssueActivityProjection); // @example/issue-activity
```

Both descriptions come from the generated bootstrap. Normal BC consistency checks still apply. A package boundary does not decide the Bounded Context boundary.

The current Orders cross-context example constructs multiple BCs from classes in one package, so it is not sufficient proof of this last case. Add a multi-package example with the builders in app and handler classes in dependencies, including a BC assembled from more than one dependency.

### Migrate the current generated file

Update the generator, metadata types, loader, package exports, generated-source checks, build/container outputs, examples, and tests together. Remove the old generated-handler-registry output when regenerating, so stale files cannot become a second source of metadata.

The intended API uses bootstrap discovery instead of withGeneratedRegistryRoot. Treat removal of that method and the generated-file rename as a documented migration: update existing examples and consumers in the same change. Do not introduce a new Server generatedRegistryRoot setting. Keep unrelated, still-useful explicit registry construction APIs; this change concerns locating and composing generated application metadata.

## Write the handler

```ts
abstract class AppQueryHandler<Q extends Message, R extends Message> {
  abstract execute(query: Q, context: AppQueryContext): R | Promise<R>;
}
```

```ts
class TopIssuesHandler extends AppQueryHandler<
  SummarizeTopIssues.Query,
  SummarizeTopIssues.Response
> {
  async execute(
    query: SummarizeTopIssues.Query,
    context: AppQueryContext,
  ): Promise<SummarizeTopIssues.Response> {
    const issues = await context
      .select(
        IssueViewQuery.create()
          .project()
          .is(query.project!)
          .completed()
          .is(false)
          .orderBy("priority", "desc")
          .limit(10)
          .build(),
      )
      .read();

    return create(SummarizeTopIssues.responseSchema, {
      issues: [...issues],
    });
  }
}
```

The handler assumes an existing Projection whose state declares the queried columns. For example, its state definition includes:

```proto
message IssueView {
    option (entity).kind = PROJECTION;
    option (entity).visibility = FULL;

    IssueId id = 1 [(required) = true, (validate) = true];
    ProjectId project = 2 [(column) = true];
    bool completed = 3 [(column) = true];
    int32 priority = 4 [(column) = true];
    string internal_note = 5;
}
```

This belongs in the state Proto file importing spine/options.proto and the application's identifier definitions. IssueId and ProjectId are distinct domain identifiers; their definitions specify their value constraints. IssueViewQuery is the generated Entity-query builder for those marked columns. IssueProjection is the application's registered Projection implementation.

The `!` accommodates the generated TS field type. It emits no runtime check. The server has already rejected an absent required project before invoking execute. The handler does not repeat request validation.

`EntityQueryDescription` already exists: it describes the Entity type, predicates, ordering, and limit. It does not supply a trusted authenticated identity. `context.select(description)` binds that existing description to the current actor/tenant and performs the read.

AppQueryContext supplies the handler with that read capability and its trusted execution information. ReadSideContext supplies filters with information about why data is being returned. There is no extra QueryContext/Definition hierarchy.

## Receive and validate App Queries on the app node

Add this method to the existing query_service.proto:

```proto
service QueryService {
    rpc Read(Query) returns (QueryResponse);
    rpc Execute(AppQuery) returns (AppQueryResponse);
}
```

Spine supplies these messages:

```proto
// spine/client/app_query.proto
syntax = "proto3";
package spine.client;

import "google/protobuf/any.proto";
import "spine/options.proto";
import "spine/client/query.proto";
import "spine/core/actor_context.proto";
import "spine/core/response.proto";

option (type_url_prefix) = "type.spine.io";

message AppQuery {
    QueryId id = 1 [(required) = true, (validate) = true];
    google.protobuf.Any message = 2 [(required) = true];
    spine.core.ActorContext context = 3 [(required) = true, (validate) = true];
}

message AppQueryResponse {
    spine.core.Response response = 1 [(required) = true];
    repeated google.protobuf.Any message = 2;
}
```

```text
External request
    → transport decoding and authentication
    → trusted context forwarded to the app node
    → Server's Execute service
        → validate AppQuery envelope
        → resolve and decode registered Q
        → validate Q and its declared nested constraints
        → perform tenant/support/permission checks
        → call handler
            → Entity read
                → producing BC's filters
                → handler receives surviving records
        → Server filters the returned R
        → encode AppQueryResponse
```

Execution and authoritative validation happen after authentication on the app node. The gateway forwards; it does not run handlers or filters. Extend existing gateway, native/browser transport, and node-coordinator routing to recognize Execute and preserve trusted identity and error details.

The envelope check and the Q check use the shared validator. The mandatory root Q check cannot be bypassed by generic Any handling. Unknown Q types and undecodable Q payloads are rejected before dispatch.

Deep validation follows declared rules: `required` enforces presence; `validate` descends into a nested message. Repeated elements, map values, and oneof rules must work as declared. Do not invent constraints on fields that do not declare them. For example, current Filter.value and IdFilter.id have different recursion annotations.

Validate the detached request that will actually be dispatched. Internal callers must not be able to mutate it after validation. Invalid requests invoke neither the handler nor its reads.

Successful App Query execution returns one R. If a filter removes the whole R, it returns zero entries in AppQueryResponse.message, matching the existing Entity-query empty-list convention. An R containing an empty issues list is still one R. No automatic removal of that parent occurs.

Invalid Query/AppQuery constraints fail with INVALID_ARGUMENT and the existing INVALID_QUERY reason; an unsupported App Query type uses UNSUPPORTED_QUERY_TARGET. Both carry structured Spine details. Unexpected handler/read/filter/validator faults fail with sanitized INTERNAL; recognized authentication, tenant, cancellation, or availability errors retain their appropriate status. No technical failure becomes an empty successful result.

## Write a typed ReadSideFilter

```ts
class IssueAccessFilter extends ReadSideFilter<typeof IssueViewSchema> {
  constructor(private readonly access: ProjectAccess) {
    super(IssueViewSchema, { nested: true });
  }

  async filter(issue: IssueView, context: ReadSideContext): Promise<IssueView | null> {
    if (!(await this.access.canRead(context.principal, issue.project))) {
      return null;
    }
    if (!(await this.access.canReadPrivateDetails(context.principal, issue.project))) {
      issue.internalNote = "";
    }
    return issue;
  }
}
```

ProjectAccess is application code. It decides how to treat authenticated and unauthenticated readers and the authority facts available for them.

The generic gives the callback its TS message type. The schema passed to super supplies runtime metadata. Spine indexes installed filters by the registered Proto type URL, including its registered prefix. Application code does not switch over every possible response type.

Each matching filter receives a detached mutable Proto message. It may change fields, return a same-type replacement, or return null. Matching filters run in registration order; each receives the previous result. Null stops that occurrence's chain.

Spine checks the replacement's type and serializability. It does not reapply full Entity-state constraints after filtering: removing a field is an intentional possible result. Stored state, retained handler objects, and other consumers must remain unchanged.

There are no automatic masking rules. The author chooses how the model represents a removed value. Identifier fields are editable too; delivery identity is retained separately where the subscription protocol needs it.

### What the callback knows

ReadSideContext contains:

- The original Query, AppQuery, or Subscription and its Topic.
- Actor and effective tenant.
- Authenticated principal and authority-provided information, when present.
- The BC supplying the current result, when there is one.
- Cancellation information.
- Parent and field information for nested matching.

For a child Entity read within an App Query, it includes that read and the enclosing AppQuery. Direct/history reads describe their real call instead of fabricating a network Query.

ActorContext is not proof of authentication. A request cannot assert its principal by putting claims in Q or a header. Trusted authentication ports establish and forward that information.

**That forwarding is not implemented today:** the gateway uses the authenticated principal for authorization but forwards only ActorContext in the request. ActorContext alone cannot populate an authenticated filter context.

Extend the existing internal forwarding contract for Read, Execute, and subscription creation/activation. After authentication, carry the principal and authority facts in a package-internal context envelope over the authenticated gateway-to-app-node connection. The app node accepts that envelope only from its configured trusted forwarding peer. Public ingress strips or rejects client-supplied copies of the internal metadata. Provider credentials are not forwarded.

Direct native clients authenticate through the configured app-node authentication adapter; they cannot turn arbitrary metadata into a forwarded identity. Where authentication is deliberately absent, supply no authenticated principal or provider facts. Existing public-admission markers do not become proof of provider authentication.

Bind subscription execution to its verified reader context, including reconnect/activation, and propagate that context into BC reads and filters. A client-supplied subscription ID is not proof of reader identity. Keep the forwarding, authentication, and principal-resolution components replaceable. There is no provider polling or guaranteed live identity information.

An absent principal is valid when authentication is not required. Existing required actor/timestamp fields still follow their Proto rules; absence of a principal does not waive them.

## Match nested messages when requested

```ts
super(UserDetailsSchema); // Direct returned messages only.
super(UserDetailsSchema, { nested: true }); // Direct and nested messages.
```

For a Project with `UserDetails author = 42`, nested matching supplies the UserDetails value and its containing Project. The parent is a detached read-only Proto snapshot for inspection. To change the Project itself, register a Project filter.

Within each installed scope, process a message's matching filters first, then visit the children of the surviving/replacement message. Newly added children are visited. Traverse through intermediate types even if they have no filters. Use deterministic field/map traversal and preserve repeated-element order.

The transport envelope does not make domain data nested. An Entity result and an Event's domain payload are roots. IssueView objects inside an App Query Response.issues field are nested; the IssueAccessFilter example enables that explicitly.

| Null returned for                  | Effect                                                |
| ---------------------------------- | ----------------------------------------------------- |
| Entity-query record                | Remove the record from the result list.               |
| Entire App Query R                 | Return an empty successful App Query result list.     |
| Subscription Entity state          | Emit no_longer_matching using the original Entity ID. |
| Subscription Event payload         | Omit that Event from this subscriber's delivery.      |
| Singular message field             | Clear that field.                                     |
| Repeated message element           | Remove the element.                                   |
| Message-valued map entry           | Remove the entry.                                     |
| Active message-valued oneof member | Clear the selection.                                  |

Child removal never automatically removes its parent.

Nested Any values are decoded through the existing application registry and matched as their domain type. Preserve the original registered type URL when repacking. Removing the payload removes the corresponding field/element/entry. If nested filtering requires inspecting an unknown or undecodable payload, fail the read rather than return it unfiltered.

Filters match exact Proto types. Copying IssueView fields into another message type does not automatically attach IssueView filters to that type. Register a filter for the other type or reuse the domain message.

## How the two filter scopes interact

```text
Entity query through Server:
    BC read → BC filters → Server filters → client

App Query through Server:
    handler reads BC A → A filters ─┐
    handler reads BC B → B filters ─┴→ handler builds R
                                      → Server filters → client

Subscription through Server:
    BC observes source update → BC filters → Server filters → subscriber

Direct internal Entity read:
    BC read → BC filters → internal caller
```

Server filters do not run on every internal BC read. They run when data leaves through that Server's gRPC read-side services. Therefore a Server-only filter can hide an App Query's final response without hiding its source records from the handler. Install a BC filter when those source reads must also be restricted.

The final R belongs to the App Query, not automatically to any one BC. Do not guess a BC from a message's type and reapply that BC's filters to the entire response.

Each boundary processes the whole returned message tree under its installed rules. A Server filter does not rerun BC filtering on a replacement it creates. Filter authors are trusted application code; Spine does not track copied values through arbitrary computations.

BC history reads follow BC filters too. Preserve their original continuation/cursor even when filtering makes a page empty. Persistence hydration, replay, and restoration are not returned read-side views and must not be redacted.

## Use queries from clients and server-side code

Proposed external API:

```ts
const query = create(SummarizeTopIssues.querySchema, { project });
const result = await client.onBehalfOf(actor).query(query);
const [response] = result.message;
```

The generated type association lets ClientRequest.query infer response as SummarizeTopIssues.Response or undefined. Its result preserves AppQueryResponse's response field and exposes message as a readonly array of decoded R values, constrained at runtime to zero or one. The client checks the returned payload's registered R type before decoding it. Types absent from the generated association are not accepted by the typed overload; malformed/unregistered requests are still rejected by the server.

Invalid requests and technical failures reject the call, with different statuses and structured details.

Existing Entity queries keep their existing client send API:

```ts
const entityQuery = IssueViewQuery.create().project().is(project).build();

const states = await client.onBehalfOf(actor).send(entityQuery);
```

Their results automatically pass through the relevant BC and Server filters; callers do not select the filters.

For application code, including Process Managers and Agents, expose a proposed Server entry point using the same registered handlers:

```ts
const result = await server.query(query, executionContext);
```

executionContext comes from the current trusted framework execution. Bind this capability to the appropriate Server when supplying it to an Entity/Agent; do not locate a process-wide handler registry through ServerEnvironment. Internal execution performs the same request validation and BC-filtered child reads.

A direct call is not a gRPC return, so Server-installed output filters do not run solely because server.query was called. If application code requires a policy on BC data regardless of its caller, install it on that BC. An internal validation failure is a structured local failure, not a fabricated gRPC exchange.

## Event subscriptions already exist—and must be filtered

Yes: both current JVM and current TS support subscribing to Events. TS also has a client overload that accepts several generated Event schemas and combines their subscriptions into one logical client handle.

Subscribe to a domain Event using the existing client API:

```ts
const subscription = await client
  .onBehalfOf(actor)
  .createSubscription([IssueAssignedSchema], { kind: "event" });

await subscription.activate();

for await (const delivery of subscription.updates) {
  if (delivery.kind !== "update") continue;
  const update = delivery.update.update;
  if (update.case !== "eventUpdates") continue;

  for (const envelope of update.value.event) {
    if (envelope.message === undefined) continue;
    const event = AnyPacker.tryUnpack(envelope.message, IssueAssignedSchema);
    if (event !== undefined) {
      showAssignment(event); // Application UI code.
    }
  }
}
```

Install a typed Event filter using the same API as an Entity-state filter:

```ts
class IssueAssignedAccessFilter extends ReadSideFilter<typeof IssueAssignedSchema> {
  constructor(private readonly access: ProjectAccess) {
    super(IssueAssignedSchema, { nested: true });
  }

  async filter(event: IssueAssigned, context: ReadSideContext): Promise<IssueAssigned | null> {
    return (await this.access.canRead(context.principal, event.project)) ? event : null;
  }
}
```

For each delivered Event, Spine filters the decoded domain payload, then repacks it into the existing Event envelope. BC filters run for the BC supplying the Event; Server filters run before its gRPC delivery. Retain Event ID and delivery metadata; do not change the stored Event or the Event sent to domain handlers.

Null suppresses this Event for this subscriber. It does not retract an Event previously delivered, cancel the subscription, or emit Entity no_longer_matching. If all Events in a data update are removed, omit that data update; retain activation acknowledgements and other protocol control signals.

Event Topic criteria are evaluated against the original Event before read-side filtering. Nested payload matching works exactly as for other result messages. Grouped Event subscriptions preserve the scope of each child subscription and its producing BC.

Existing Event subscriptions do not perform Entity-style authoritative state recovery. This proposal does not add Event replay or promise that filtered-out Events will be delivered later.

## Entity subscription removals keep their existing meaning

TS already emits no_longer_matching when an Entity stops satisfying a Topic. Reuse that mechanism when a ReadSideFilter removes its returned state.

Using the Entity query from the preceding example, the existing subscription API is:

```ts
const topic = create(TopicSchema, {
  id: create(TopicIdSchema, { value: `t-${crypto.randomUUID()}` }),
  target: entityQuery.build().target,
});

const subscription = await client.onBehalfOf(actor).createSubscription(topic, {
  kind: "entity",
  authoritativeQuery: () => entityQuery.build(),
});

await subscription.activate();
for await (const delivery of subscription.updates) {
  handleEntityDelivery(delivery); // Application code handles updates/recovery.
}
```

The client adds the actor context. Each call constructs a fresh Topic. Cancel either kind of subscription with `await subscription.cancel()` when finished.

```text
Original Entity update
    → existing Topic matching
    → BC filtering
    → Server filtering, for a gRPC subscriber
        → state survives: send filtered state
        → state becomes null: send no_longer_matching with original ID
```

Preserve original ID/version separately from the editable payload. A removal already produced by Topic matching or BC filtering passes through as a protocol notice; there is no remaining domain state to give to an Entity filter. Server filtering must not accidentally drop that notice.

Removing only a nested field sends the modified state. No delivered-ID ledger is required before sending a removal. Each subscription has a separate Topic/consumer context; one user's result must not mutate another's.

Keep existing authoritativeQuery recovery after a possible Entity-update gap. That query follows ordinary BC and Server filtering. Do not add a global client cache, change user-held objects, or add a new initial query/subscription handoff.

Async filters must preserve update order, bound queued work, and stop delivery after cancellation. A filter failure fails the affected read/stream; it never causes unfiltered fallback. Bound nested traversal and reject cyclic/unserializable replacements.

## Current JVM versus current TS: validation and errors

A gRPC failure and an error inside a successful response are different outcomes. For example, JVM rejects an invalid Query through gRPC, but normally reports an invalid Command through its Ack.

In the tables, **Done** means the stated behavior exists in TS. **Not done** names the missing work. Some rows contain both because validation and error reporting are separate responsibilities.

| Input or outcome                                                            | Latest JVM master                                                                                                                                                                                                                                                                                                                                      | Current TS and required work                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid Entity Query with no matches                                          | Successful `QueryResponse` with an empty `message` list.                                                                                                                                                                                                                                                                                               | **Done.** Preserve this representation of an empty result.                                                                                                                                                                                                                                                                        |
| Query violates declared Proto constraints                                   | Stand validates Query, including declared nested constraints. QueryService catches the validation exception and returns gRPC `INVALID_ARGUMENT`; the structured Spine error is in `spine-error-bin`.                                                                                                                                                   | **Not done.** Run the shared validator on the complete Query before reading. Replace in-response validation errors with `INVALID_ARGUMENT` and structured details.                                                                                                                                                                |
| Query has invalid criteria, field names, filter values, ordering, or limits | Stand and query processing perform semantic checks in addition to Proto validation.                                                                                                                                                                                                                                                                    | **Done in substantial part:** TS already checks these contracts. **Not done:** preserve those checks while moving their invalid-input outcomes to the RPC error channel. Generic Proto validation does not replace them.                                                                                                          |
| Query target is unsupported                                                 | Stand has `UNSUPPORTED_QUERY_TARGET`. However, a type absent from service routing produces a raw `UnknownEntityStateTypeException` before that path; the service does not give all unsupported-target cases one explicit status.                                                                                                                       | **Done:** unsupported targets are rejected. **Not done:** replace the error `QueryResponse` with structured `INVALID_ARGUMENT` / `UNSUPPORTED_QUERY_TARGET`. This makes TS's status consistent; it does not copy JVM's routing-dependent exception behavior.                                                                      |
| Query execution fails technically                                           | QueryService forwards the exception through `onError`; it does not return an empty result or an error QueryResponse. Unexpected exceptions have no explicit Spine status mapping here.                                                                                                                                                                 | **Not done.** TS currently converts most read failures into an in-response `QUERY_READ_ERROR`. Fail the RPC instead. Preserve recognized statuses; use sanitized `INTERNAL` for unexpected faults.                                                                                                                                |
| Invalid domain Command payload                                              | CommandBus validates the decoded domain message. Rejection is an error Ack with `CommandValidationError.INVALID_COMMAND` and validation details; transport can complete successfully.                                                                                                                                                                  | **Done:** payload validation and error Ack. **Not done:** align the current `COMMAND_VALIDATION_ERROR` string and missing enum code with the existing Proto error contract.                                                                                                                                                       |
| Invalid Command envelope                                                    | CommandValidator explicitly checks nonempty Command ID, nondefault payload and context, plus declared ID/payload constraints. It returns an error Ack. It does not recursively validate every CommandContext field merely because the context exists.                                                                                                  | **Not done completely.** Validate envelope requirements and explicitly require nonempty `CommandId.uuid` before every dispatcher, including custom dispatchers. Keep payload validation and Ack reporting. No UUID-format rule is implied.                                                                                        |
| Unsupported Command type                                                    | CommandService returns an error Ack for an unsupported resolvable Command type. Malformed type extraction may fail earlier.                                                                                                                                                                                                                            | **Done:** unsupported types produce an error Ack. Preserve the channel; align error type/code where needed.                                                                                                                                                                                                                       |
| Invalid Entity or Event subscription Topic                                  | Stand validates Topic constraints and target support. SubscriptionService forwards the exception through `onError`; it does **not** use QueryService's structured `INVALID_ARGUMENT` mapper.                                                                                                                                                           | **Done:** manual Topic/target/filter checks reject many invalid requests using `INVALID_ARGUMENT`. **Not done:** complete declared nested validation and structured `INVALID_TOPIC` / `UNSUPPORTED_TOPIC_TARGET` details. Using the structured status consistently is an intentional improvement over JVM's subscription adapter. |
| Malformed Subscription passed to Activate or Cancel                         | A request reaching Stand is validated, including its Topic. Failures are forwarded as exceptions, without QueryService's explicit status/trailer conversion. Routing can fail earlier.                                                                                                                                                                 | **Not done.** TS mostly uses the ID for lookup: a missing ID can complete Activate silently or make Cancel succeed. Validate the complete request before lifecycle work and reject malformed input with structured `INVALID_ARGUMENT` / `INVALID_SUBSCRIPTION`.                                                                   |
| Activate a well-formed but unknown subscription ID                          | A routed Stand checks its registry and raises `UNKNOWN_SUBSCRIPTION`. If target routing falls back across contexts, each attempted Stand checks its registry; a failed check can fail activation. The service forwards the exception.                                                                                                                  | **Not done; decision settled:** TS currently completes without updates for an unknown/expired ID. Change this to gRPC `NOT_FOUND` with the structured `SubscriptionValidationError.UNKNOWN_SUBSCRIPTION` reason. Keep successful idempotent cancellation separate.                                                                |
| Cancel a well-formed but unknown subscription ID                            | With a known target route, Stand raises UNKNOWN_SUBSCRIPTION, ordinarily becoming gRPC UNKNOWN. In the no-target-route fallback, it completes without emitting a Response when no registry contains the ID. The pinned gRPC-Java transport turns that missing unary response into INTERNAL. Neither path defines a successful idempotent cancellation. | **Done as an intentional TS behavior:** unknown/already removed IDs return OK. Preserve idempotent cancellation. Do not reproduce JVM's route-dependent behavior.                                                                                                                                                                 |
| Event submitted to the internal EventBus                                    | JVM validates the Event envelope and its payload through declared nested validation; invalid Events produce an error Ack with `INVALID_EVENT`. There is no public Event.Post RPC here.                                                                                                                                                                 | **Done:** decoded domain payload validation. **Not done:** close envelope-validation gaps before acceptance/delivery, preserving TS's internal error contract rather than inventing a public Event RPC.                                                                                                                           |
| Invalid Entity state                                                        | JVM rejects the state through Entity/transaction validation.                                                                                                                                                                                                                                                                                           | **Done:** TS has state and transition validation. Preserve it. A filtered outgoing view is not a new state to persist or revalidate.                                                                                                                                                                                              |
| Bytes cannot be decoded as the RPC request                                  | The pinned gRPC-Java Protobuf marshaller raises INTERNAL for an invalid binary Protobuf sequence, before domain validation.                                                                                                                                                                                                                            | **Done:** the pinned Connect binary parser also raises INTERNAL; its JSON parser uses INVALID_ARGUMENT. The auth gateway can reject malformed input earlier with INVALID_ARGUMENT. Preserve these layer-specific decode/size errors; they are not field-constraint reports or empty results.                                      |

**What does a raw JVM exception mean on the wire?** Ordinary gRPC-Java handling maps an exception without a status-bearing cause to `UNKNOWN`. That is the expected result of the raw exception paths above, not an explicit status selected by Spine's subscription service. It also carries no `spine-error-bin` added by that service. The Query validation path explicitly selects `INVALID_ARGUMENT` and serializes the Spine error. The cancellation INTERNAL result follows from the service code and its pinned gRPC-Java 1.85.0 transport: completing a unary RPC without a response is a protocol error. These wire conclusions are source-derived, not results of executing a JVM server.

Technical Command failures need separate treatment too: JVM's bus can acknowledge acceptance before dispatch completes. TS's existing Command error handling must not be replaced by the Query error policy. Business rejections remain distinct from invalid input and technical faults.

### Shared validation and error details

| Capability                                      | Latest JVM / declared contract                                                                                                                                                            | Current TS and required work                                                                                                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nested validation                               | Required presence and recursive validation are separate declared constraints.                                                                                                             | **Done in the validation library:** nested messages, repeated messages, map values, and oneof rules are supported. **Not done at all service boundaries:** Query, Topic, and Subscription must actually invoke the shared validator.                        |
| Application types inside annotated `Any` fields | Validation must be able to inspect known application message types where recursive validation is declared.                                                                                | **Not done generally.** The pinned TS validator uses a schema's descriptor dependencies, not the application's full registry. Extend the shared integration/library to use the existing application registry. Do not write an App Query-specific validator. |
| Malformed bytes in a known nested `Any`         | A known payload that cannot be decoded must not silently bypass its required validation.                                                                                                  | **Not done.** The pinned validator skips failed Any unpacking. Distinguish unknown types allowed by the model from malformed known payloads; reject the latter.                                                                                             |
| Existing bundled constraint options             | Declared constraints must execute, including the either/or rule for TargetFilters.                                                                                                        | **Not done completely.** TS's bundled TargetFilters uses deprecated `required_field`, ignored by its validator. Existing Query/Subscribe checks compensate. Migrate that declaration to the supported equivalent and keep semantic checks.                  |
| Required collections                            | The bundled rule documentation also excludes missing-valued elements/values.                                                                                                              | **Not done completely.** The dependency only checks that the collection is nonempty. Correct the shared rule and test it; current route-specific ID checks already reject some such cases.                                                                  |
| Validation engine/configuration failure         | This is a server failure, not proof that the client's fields violate a constraint.                                                                                                        | **Not done.** TS currently turns every validator exception into a synthetic constraint violation. Keep rejection, but report technical failure through the operation's technical-error channel.                                                             |
| Structured Query validation failure             | JVM sends a `spine.base.Error` with enum-qualified type, numeric code, diagnostic message, and a packed `ValidationError` in `Error.details`. It serializes Error into `spine-error-bin`. | **Not done for Query validation.** Add this error mapping and native trailer, retain Connect typed details, and preserve both through gateway/coordinator/client forwarding.                                                                                |
| Unknown tenant                                  | This is distinct from malformed Proto input.                                                                                                                                              | **Done in TS:** confirmed unknown membership can return `NOT_FOUND` with structured `TENANT_UNKNOWN` details. Preserve it. Missing/inapplicable tenant checks also remain; do not relabel all tenant failures as invalid fields.                            |
| Authentication failures                         | They are separate from input constraints.                                                                                                                                                 | **Done in configured TS auth paths:** `UNAUTHENTICATED` / `PERMISSION_DENIED`. Preserve them and extend routing to Execute.                                                                                                                                 |

The last two rows preserve existing TS behavior; they are not claims that JVM's tenant/auth integration has the same status mapping.

TS also exposes authentication-context resolution and separate delivery/health services. Their inputs already have transport, credential, record, size, and lifecycle checks. They are not additional domain-query RPCs. This work preserves those contracts; it does not route delivery administration through App Query validation or result filtering.

## Unknown subscription activation is an explicit error

The decision is settled: a well-formed activation request for a subscription that no longer exists fails with **UNKNOWN_SUBSCRIPTION**.

Use `SubscriptionValidationError.UNKNOWN_SUBSCRIPTION` in the structured Spine Error, carried by gRPC `NOT_FOUND`. The enum reason is the application-visible diagnosis; NOT_FOUND is its transport status. This status mapping is the TS design, not a claim that current JVM explicitly selects it.

| Request                                                         | Result                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Malformed Subscription in Activate or Cancel                    | INVALID_ARGUMENT with INVALID_SUBSCRIPTION and validation details.  |
| Well-formed Activate with an unknown or expired ID              | NOT_FOUND with UNKNOWN_SUBSCRIPTION.                                |
| Well-formed Cancel with an unknown or already removed ID        | Successful OK response, preserving idempotent cancellation.         |
| Activation whose reader is not authorized for that subscription | Authentication/authorization failure; an ID alone grants no access. |

An already active, still registered subscription is not an unknown subscription. Preserve the existing duplicate-activation contract; do not classify every branch that currently ends without updates as UNKNOWN_SUBSCRIPTION.

A direct RPC caller observes the error. The managed client already recovers a lost stream by subscribing again, rather than indefinitely activating the same ID. Recognize UNKNOWN_SUBSCRIPTION explicitly and use that existing bounded recovery path. A replacement subscription uses a fresh server-issued ID. Entity subscriptions perform their existing authoritativeQuery recovery; Event subscriptions report a possible gap and do not invent replay. Cancellation still stops recovery, and exhausted recovery exposes the terminal error.

Do not treat malformed requests, denied access, or every NOT_FOUND as a reason to recreate a subscription. Classify the structured error reason, preserving the existing special handling for an unknown tenant.

## Implementation and acceptance

1. Close the existing validation/status gaps in the tables, using shared validation and error conversion. Keep Command Ack semantics and existing tenant/auth distinctions.
2. Rename the generated file to spine-metadata.ts; extend existing generation for _queries.proto Q/R pairing, grouped exports, and class descriptions. Generate dependency discovery/bootstrap through that same build. Include every generated message in existing general registries.
3. Add Execute and Server-only App Query registration, then extend app-node routing, authentication context forwarding, and client/internal invocation.
4. Add typed filters to BC builders/Stand and Server with the separate boundaries above. Cover Entity queries, App Queries, Entity subscriptions, Event subscriptions, and BC read-side history.
5. Test invalid inputs directly at server boundaries, bypassing client builders. Prove handlers, reads, and subscription mutations did not run.
6. Test native/browser error round trips, nested validation including Any, filter scoping, same filter at multiple installations, independent consumers, Event suppression, Entity removals, reconnection, cancellation, and empty results.
7. Compile single-package and multi-package applications, including BCs constructed in app from dependency classes and one BC spanning several packages. Test transitive discovery, diamond dependencies, conflicting/stale/missing metadata, bootstrap initialization, compiled package exports, bundling, and multiple Servers selecting different implementations. Compile separate browser/Node clients to prove handler-class association, Q/R inference, and exported declarations. Update ClientRequest, client-node exports, proto/client service exports, Server's public API, and their API documentation. Test authenticated forwarding, direct native authentication, absent principal, and rejected forged internal identity.

8. Change unknown activation to NOT_FOUND / UNKNOWN_SUBSCRIPTION, update managed-client classification, and test Entity/Event recovery plus malformed, duplicate-active, expired, cancelled, and unauthorized cases separately.

Existing Query clients must be updated to handle RPC failures instead of in-response validation/technical errors. Direct callers and fixtures must supply the required context fields rather than weakening the Proto rules.

## Questions

No further product decision is required for this version. Unknown activation, Server-only App Query registration, the two filter installation scopes, the generated filename, and automatic discovery are included as agreed. The remaining work is implementation and verification of these contracts.
