# Wave 9 Logging, Routing, And Model-Conventions Plan

Status: Approved; pending T-0153 integration

Date: 2026-08-10

Planning task: T-0153

## Outcome

Wave 9 makes server-side operation observable, brings all signal-routing
scenarios to the approved Spine JVM behavior, adds Event-field handler filters,
and removes repeated required-ID boilerplate from Commands and Entity states.
It also verifies the existing rejection behavior and demonstrates the complete
set of conventions in Message Board.

The Wave does not rewrite product documentation. Public API TSDoc ships with
the corresponding runtime change; root/package READMEs,
`docs/USER_GUIDE.md`, other product/example Markdown, repository-wide copyright
headers, and multiple-Gateway behavior move to Wave 10. Canonical
build-protocol execution records remain permitted in Wave 9.

## Fixed Boundaries

### Logging

- LogLayer is the logging API used by framework and application server code.
- The framework accepts an application-created logger and derives child
  loggers. It does not close, replace, or reconfigure the supplied logger.
- Framework packages use LogLayer directly. Wave 9 does not create a Spine
  logger facade, logging package, global singleton, or logging Proto protocol.
- The public injection is `ServerEnvironmentSettings.logger?: ILogLayer`.
  It replaces the legacy `warn` callback; no compatibility callback remains.
- `ServerEnvironment` immediately snapshots `logger.child()`. The application
  constructs, retains, flushes, and closes its logger and transports.
- T-0154 owns one package-private propagation path. The environment passes its
  `ILogLayer` child explicitly through attachment/runtime construction options
  into contexts, buses, repositories, services, and lifecycle coordinators.
  Objects created before attachment receive the child only in their existing
  attachment/start runtime binding. There is no global logger, mutable static,
  public framework logger type, or per-module fallback.
- Independently operated auth, delivery-server, and deployment top-level
  components accept the same application-created `ILogLayer` through the exact
  public options listed below. Internally constructed auth components receive
  an environment child. Caller-constructed deployment components snapshot the
  logger supplied in their own options; the environment does not mutate them or
  inject retroactively. These packages use the same private emission rules
  locally; none imports a Spine logging facade.
- The default server configuration emits structured records suitable for
  collector agents. Wave 9 also proves application composition with LogLayer's
  official Google Cloud Logging transport. Spine TS does not wrap or rename it
  as a framework adapter.
- When no logger is supplied, the server constructs a private LogLayer with
  `new StructuredTransport({ logger: console, level: "warn", stringify: true,
messageField: "message", dateField: "timestamp", levelField: "severity",
levelFn: (level) => level.toUpperCase() })`. It emits one JSON record per
  event. WARN and ERROR use the corresponding console methods and therefore
  stderr. Tests assert the exact stream and field names.
- WARN and ERROR records are emitted once at the boundary that contains or
  terminates the failure. Intermediate code that only rethrows does not log.
- A logging transport or plugin failure cannot alter the framework outcome.
- Stable tenant, actor, Entity, command, event, shard, worker, node, and
  subscription IDs may appear as structured attributes. Tokens, passwords,
  cookies, authorization headers, signing keys, session secrets, CSRF/OIDC
  secrets, and other authentication secrets never appear in log messages or
  attributes.
- Framework attributes are positively allowlisted: `tenantId`, `actorId`,
  `entityType`, `entityId`, `commandType`, `commandId`, `eventType`, `eventId`,
  `shardId`, `workerId`, `nodeId`, `subscriptionId`, `contextName`, `operation`,
  a stable `reasonCode`, and a bounded `count`.
- Dynamic textual attributes are included only when their UTF-8 encoding is at
  most 256 bytes; oversized values are omitted, never truncated. `operation`
  and `reasonCode` are framework constants matching
  `[a-z0-9][a-z0-9_.-]{0,63}`. `count` is included only when it is an integer
  from 0 through 2,147,483,647. Sanitization happens before calling LogLayer.
- Framework records never attach exception objects or their messages, stacks,
  or causes; signal payloads; state/context envelopes; arbitrary metadata;
  request/response bodies; configuration or environment dumps; headers;
  cookies; or any credential/session material.
- A private fault-contained emitter catches synchronous logging failures and
  observes promise-like rejections. Business paths never await logging and
  logger failures are never logged recursively. This helper is not a public
  logging abstraction.
- Browser-side logging and Sentry integration are outside Wave 9.

Operational disposition is fixed as follows:

| Result | Boundary                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WARN   | A retryable, degraded, cleanup, reconciliation, discovery-refresh, or best-effort diagnostic/system-event failure is contained and work continues.     |
| ERROR  | Accepted work or a signal is permanently dropped, or a background delivery, Stand, or subscription task terminates or cannot progress.                 |
| No log | Validation and domain failures, empty routes, filter misses, normal close/cancel/duplicate outcomes, rethrows, surfaced failures, and logger failures. |

A checked TypeScript containment manifest spanning server, auth, delivery, and
deployment tests classifies each actual suppression or fire-and-forget boundary
by stable ID, source path, operation, disposition, and focused test. An adjacent
`spine-log-boundary: <id>` comment binds source and manifest one-to-one. A
TypeScript-AST checker detects empty `catch` clauses, detached/voided `.catch()`
calls, `.catch()` callbacks that return an empty/boolean/undefined sentinel, and
explicit rejection callbacks that convert failure to a fulfilled sentinel. It
rejects a missing/duplicate/stale ID and has positive, negative, nested, and
false-positive fixtures. `Promise.allSettled()` and a catch that rethrows are
explicit exemptions. More complex containment clauses remain enumerated in the
reviewed manifest even when the narrow checker cannot infer their semantics.
This is not a regex over every `catch` or fire-and-forget call.

### Routing

- Commands are routed to exactly one Entity ID.
- Events and Entity state updates are routed to zero, one, or many Entity IDs.
  An empty result deliberately suppresses delivery to that repository.
- Every repository can install exact-message routes and replace its default
  command, Event, or state-update route as applicable.
- State-update routing uses the existing Entity-state subscription,
  `UPDATE_SUBSCRIBER` handler role, and System EventBus path. It does not create
  a second state-update bus or public signal type.
- Generated handler registries move from contract version 1 to version 2.
  Version 2 adds `state-subscription` to `GeneratedHandlerKind` and adds
  `where?: { readonly eventField: string; readonly equals: string }` to each
  generated handler record. State subscriptions use the new kind; Event
  subscriptions retain `event-subscription`. Ingestion supports version 2 only
  after the cutover and rejects version 1 with
  `UNSUPPORTED_REGISTRY_VERSION`; clean generation is mandatory, so old
  metadata can never silently ignore state or filter semantics.
- The default Event route uses the producer ID when its declared and decoded
  type is compatible with the repository ID type. A valid producer ID of an
  incompatible type falls back to the first declared Event field. A producer
  that is absent, or that claims the compatible type but is malformed, fails;
  it does not fall back.
- Exact-message routes precede semantic routes. Message-level `(is)` routes
  precede file-level `(every_is)` routes. Ambiguous registrations fail when the
  repository is built.
- Semantic tags are non-empty, case-sensitive Java type names. `TypeRegistry`
  automatically extracts and deduplicates descriptor `(is)` and `(every_is)`
  metadata. Caller-supplied compatibility tags cannot impersonate either
  descriptor source for routing.
- `TypeMetadata` preserves provenance through separate public
  `isTypes: readonly string[]`, `everyIsTypes: readonly string[]`, and existing
  `semanticTags: readonly string[]` members. `semanticTags` becomes explicitly
  compatibility-only. `TypeRegistryLookup` gains `findByIs(javaType)` and
  `findByEveryIs(javaType)` returning immutable metadata lists; routing consumes
  only these descriptor-backed lookups.
- Duplicate exact or semantic registrations fail. If several registrations
  apply within the highest selected semantic tier, repository construction
  fails. An exact registration suppresses lower tiers.
- The default Command route reads the first field in descriptor declaration
  order. It must be singular, non-map, ID-compatible, valid, and non-default.
  Custom IDs are still validated.
- The default state route selects the first field whose type is compatible with
  the receiving repository ID type. This intentionally differs from the
  implicit-required policy, which considers only the declaration-first field.
- Non-empty Event/state results are copied, stable-deduplicated, frozen, and
  fully ID-validated.
- A route may return at most 1,000 entries, matching the existing bounded server
  page/query scale. The raw array length is checked before iteration, then IDs
  are validated and stable-deduplicated. Overflow or any invalid ID rejects the
  complete route before a single Inbox handoff is admitted.
- Event and state routing is evaluated exactly once for an accepted signal. The
  immutable validated target plan is passed from admission to dispatch and one
  durable Inbox row is persisted per target. Replay validates and uses the
  target stored in that row; it never invokes application routing code again.
  Side-effecting test routes and changed external state across restart prove
  this rule.

### Event handler filters

- `@Where` is a TypeScript method decorator. It applies only to Event-consuming
  `@Subscribe`, `@React`, and Event-to-command `@Command` handlers.
- Its public shape is:

  ```ts
  @Where({
    eventField: "board",
    equals: '{"value":"announcements"}',
  })
  ```

- `eventField` accepts a nested Event field path. `equals` is converted through
  the field type's Stringifier. The same Stringifier registry therefore governs
  persisted/query values and handler-filter literals where the same generated
  value type is involved.
- A matching filtered handler has precedence over the unfiltered handler for
  the same Event and Entity class. If no filter matches, the unfiltered handler
  is the fallback. If neither exists, the Event is ignored by that class.
- Invalid paths, unsupported field types, invalid literals, incompatible
  decorators, and conflicting filter fields fail during generated-registry or
  repository construction. They are never ignored at dispatch time.
- One `@Where` is allowed per method. The build analyzer accepts only the exact
  `eventField` and `equals` keys with statically analyzable string literals; it
  rejects spreads, computed keys, and variable objects.
- Paths use Proto source field names. Intermediate fields must be singular
  messages; the terminal field must be a supported singular scalar, bytes,
  enum, or message field.
- Literal conversion accepts raw strings, exact booleans, canonical finite
  numbers, bigint-compatible integer text, standard base64 bytes, enum names or
  valid numbers, and compact Proto JSON for messages. Expected values are
  parsed and canonicalized once. Missing optional/intermediate values do not
  match.
- For one Entity class and Event type, filtered handlers use one field path,
  canonical values are unique, and at most one unfiltered fallback exists.

### Implicit IDs and rejections

- The first field by Proto declaration order in a Command or Entity state is
  implicitly required only when that field has no explicit `(required)`
  option. An explicit `true` is redundant but valid; an explicit option remains
  authoritative.
- The implicit policy supports the same ID field categories as Spine JVM:
  string, bytes, enum, message, and those supported base types under collection
  cardinality. Numeric and boolean primitives are excluded.
- Empty strings, bytes, collections, and maps; zero enums; and absent/default
  messages fail with the existing validation violation shape and first-field
  path. Events, rejections, and ordinary messages are excluded.
- Apply the rule before Command routing/handler dispatch, including durable
  replay, and before any Aggregate, Projection, or Process Manager state commit.
- Explicit `false` disables the implicit validation rule but does not make an
  unusable declaration-first Command ID routable; applications then need a
  custom Command route.
- Existing rejection generation and runtime behavior are audited before any
  change. Wave 9 keeps one mechanism: generated throwable companions, Entity
  rollback, typed rejection Events, and client-visible rejection outcomes.
- A single command, Event, or rejection file for a domain package uses
  `commands.proto`, `events.proto`, or `rejections.proto`. When a package needs
  several such files, names use the `<domain-entity>_...proto` form.

## Frozen Public API

Logging injection is exactly:

```ts
import type { ILogLayer } from "loglayer";

export interface ServerEnvironmentSettings {
  // Existing settings remain.
  readonly logger?: ILogLayer;
}
```

The other independently running boundaries add the same optional property,
imported directly from LogLayer and never re-exported through a Spine alias:

```ts
export interface DynamicUnaryOptions {
  // Existing options remain.
  readonly logger?: ILogLayer;
}

export interface SubscriptionGatewayOptions {
  // Existing options remain.
  readonly logger?: ILogLayer;
}

export interface DeliveryServerOptions {
  // Existing options remain.
  readonly logger?: ILogLayer;
}

export interface ScheduledNodeDiscoveryOptions {
  readonly reader: NodeSnapshotReader;
  readonly scheduler?: NodeScheduler;
  readonly intervalMs?: number;
  readonly logger?: ILogLayer;
}

export interface GkeNodeDiscoveryOptions {
  // Existing options remain.
  readonly logger?: ILogLayer;
}

export interface GceNodeDiscoveryOptions {
  // Existing options remain.
  readonly logger?: ILogLayer;
}

export type GceRegistrarOptions =
  | (ExplicitRegistrarOptions & { readonly logger?: ILogLayer })
  | (MetadataRegistrarOptions & { readonly logger?: ILogLayer });
```

`UnaryGatewayOptions`, `NativeGatewayServicesOptions`, `DeliveryClientOptions`,
`RemoteDeliveryConfig`, and `LeasedNodeRegistryOptions` do not gain a logger:
their failures are returned/rejected to the caller or are logged by an outer
owner. The containment manifest proves the no-log disposition for their
internal cleanup observations. Applications reuse one LogLayer instance across
the options they construct; each component snapshots its own child and never
closes the parent.

Routing declarations exported by `@spine-event-engine/server` are exactly:

```ts
export type CommandRoute<Id, Schema extends MessageSchema = MessageSchema> = (
  message: MessageShape<Schema>,
  context: CommandContext,
) => Id;

export type EventRoute<Id, Schema extends MessageSchema = MessageSchema> = (
  message: MessageShape<Schema>,
  context: EventContext,
) => readonly Id[];

export type StateUpdateRoute<Id, Schema extends MessageSchema = MessageSchema> = (
  state: MessageShape<Schema>,
  context: EventContext,
) => readonly Id[];

export class CommandRouting<Id> {
  static create<Id>(): CommandRouting<Id>;
  route<Schema extends MessageSchema>(schema: Schema, via: CommandRoute<Id, Schema>): this;
  routeSemantic(javaType: string, via: CommandRoute<Id>): this;
  replaceDefault(via: CommandRoute<Id>): this;
}

export class EventRouting<Id> {
  static create<Id>(): EventRouting<Id>;
  route<Schema extends MessageSchema>(schema: Schema, via: EventRoute<Id, Schema>): this;
  routeSemantic(javaType: string, via: EventRoute<Id>): this;
  replaceDefault(via: EventRoute<Id>): this;
}

export class StateUpdateRouting<Id> {
  static create<Id>(): StateUpdateRouting<Id>;
  route<Schema extends MessageSchema>(schema: Schema, via: StateUpdateRoute<Id, Schema>): this;
  routeSemantic(javaType: string, via: StateUpdateRoute<Id>): this;
  replaceDefault(via: StateUpdateRoute<Id>): this;
}
```

Repository injection is exactly:

```ts
export interface RepositoryOptions<EntityType extends /* existing bound */> {
  // Existing options remain.
  readonly commandRouting?: CommandRouting<RepositoryEntityId<EntityType>>;
  readonly eventRouting?: EventRouting<RepositoryEntityId<EntityType>>;
  readonly stateUpdateRouting?: StateUpdateRouting<RepositoryEntityId<EntityType>>;
}
```

Repository construction snapshots every routing object. Later mutation cannot
change the built repository.

The handler-filter API is exactly:

```ts
export interface WhereOptions {
  readonly eventField: string;
  readonly equals: string;
}

export function Where(options: WhereOptions): HandlerMethodDecorator;
```

The existing stringifier API gains exactly:

```ts
Stringifiers.forField(
  field: DescField,
  types?: TypeRegistryLookup | Registry,
): Stringifier<unknown>;

StringifierRegistry.forField(field: DescField): Stringifier<unknown>;
```

Example composition:

```ts
const eventRouting = EventRouting.create<MessageId>()
  .route(MessagePostedSchema, (event) => (event.board?.value === "archive" ? [] : [event.id]))
  .replaceDefault((_event, context) => [unpackProducer(context)]);

const repositoryOptions = {
  eventRouting,
};

ServerEnvironment.when(EnvironmentType.Production).use({
  logger: applicationLogger,
});
```

The exact repository-builder call remains the existing API call site; only the
new `RepositoryOptions` members above are added.

## Behavior Evidence Required

Every runtime task starts with a focused RED test and records the failing
behavior before production edits.

### Logging evidence

- application logger injection and child context;
- structured default output with stable correlation attributes;
- direct Google Cloud transport construction and record mapping;
- logger lifecycle remains with the caller;
- a throwing transport/plugin cannot change request, delivery, cleanup, or
  shutdown behavior;
- redaction tests for every prohibited authentication-secret category;
- one-and-only-one WARN or ERROR record at each approved containment boundary;
- no warning for expected business rejections or ordinary client errors.

### Routing evidence

- exact Command, Event, and state-update custom routes;
- replacement defaults for all supported signal classes;
- Event/state route results of zero, one, and several IDs;
- producer-compatible, producer-incompatible fallback, and malformed-compatible
  Event cases;
- Process Manager and Projection behavior under the same general contracts;
- exact > `(is)` > `(every_is)` > default precedence;
- incomplete, wrong, duplicate, and ambiguous semantic registrations fail at
  construction;
- generated registry and packed-consumer coverage for public metadata.

### Handler-filter evidence

- direct and nested paths;
- primitive and message-valued fields through Stringifiers;
- filtered precedence, unfiltered fallback, no-match ignore;
- every supported Event-consuming decorator;
- construction failures for invalid path, literal, type, decorator, and
  conflicting fields;
- generated metadata survives an independently packed consumer.

### Model-convention and rejection evidence

- omitted `(required)` on supported first Command and Entity fields is enforced;
- redundant explicit `true` remains valid;
- explicit option behavior remains authoritative;
- declaration order, not numeric tag order, selects the implicit field;
- unsupported first-field categories fail model validation;
- both accepted rejection filename forms generate the existing throwable and
  outcome behavior;
- Message Board demonstrates implicit IDs and one typed business rejection.

## Implementation Train

### T-0154: LogLayer foundation

Depends on T-0153. Owns the root and every affected server-side package
manifest plus the lockfile, `server-environment`, private fault-contained
logging helpers, server exports, the explicit environment-to-attachment/runtime
propagation path, the exact top-level component options above, and the shared
AST checker/fixture harness. Later logging tasks add only manifest entries and
operational call sites. RED evidence covers logger injection and child
ownership, exact default `StructuredTransport` configuration/output,
synchronous and asynchronous logger failure, field allowlist/size bounds and
secret exclusions, one-to-one checker binding, no global/per-module fallback,
and removal of `warn`. Operational call sites and Google Cloud example
composition are excluded.

### T-0155: Bus, repository, and service containment logging

Depends on T-0154. Owns bus, repository execution, services, context
registration/discovery containment boundaries, and the first containment
manifest partition. RED evidence covers exactly one WARN/ERROR at the selected
outer boundary and no record for rethrows, validation, rejections, empty routes,
or an inner boundary whose outcome is handled elsewhere.

### T-0156: Delivery and lifecycle containment logging

Depends on T-0155. Owns delivery, Stand, subscription registry/runtime,
environment attachment/close, worker lifecycle, the server containment
manifest partitions, and checker integration. RED evidence covers retry and
exhaustion, terminal background work, logging failure, bounded fields, and the
complete server suppression inventory.

### T-0156A: Auth, remote delivery, and deployment containment logging

Depends on T-0154 and is disjoint from T-0155/T-0156. Owns `packages/auth`,
`packages/delivery-client`, `packages/delivery-server`, `packages/deployment`,
`packages/deployment-gke`, and `packages/deployment-gce` private emission
helpers, operational boundaries, containment manifest partitions, and checker
integration. RED evidence covers active discovery/renewal WARN records, no log
on cancellation/close, auth-secret negative fields, remote delivery no-log
outcomes, server listener failure, application-owned logger lifecycle, and
throwing transports. The exact direct `ILogLayer` options are established by
T-0154; no logging facade or callback API is introduced.

### T-0157: Descriptor semantic metadata

Depends on T-0154 and may proceed beside T-0155, T-0156, and T-0156A. Owns core
`TypeRegistry` provenance fields and lookups, option extraction, shared Entity
semantic extraction, exports, and metadata tests. RED evidence covers `(is)`,
`(every_is)`, deduplication, malformed tags, source precedence, and proof that
caller compatibility tags cannot impersonate descriptor declarations.

### T-0158: `CommandRouting`

Depends on T-0157. Owns the new routing module, Command members of
`RepositoryOptions`, construction, dispatch and replay, exports, and tests. RED
evidence covers public types, configuration snapshots, exact/semantic/default
precedence, ambiguity, default replacement, invalid return values, and
declaration-order defaults.

### T-0159: `EventRouting`

Depends on T-0158. Owns Event routing plus the Event portions of repository,
Process Manager/Projection handoff, and replay. RED evidence covers the complete
producer matrix, incompatible fallback, removal of the equality requirement,
multicast and stable deduplication, empty routes, semantic precedence, and
malformed custom IDs.

### T-0160: State-subscription metadata

Depends on T-0159. Owns decorator classification, handler metadata/builder,
build analysis, generated registry/schema rendering and ingestion, and state
subscription fixtures. RED evidence distinguishes state and Event
`@Subscribe`, validates version-2 records and signatures, rejects version 1
after cutover, and preserves generated version-2 Event behavior.

### T-0161: `StateUpdateRouting` and delivery

Depends on T-0160. Owns state routing, repository/context state-update
dispatch, `EntityStateChanged` unpacking, existing Projection handoff, and
`UPDATE_SUBSCRIBER` reuse. RED evidence covers first type-compatible field,
missing compatible field, exact/semantic/replacement routes, multicast and
empty routes, durable replay, tenant selection, and ID validation.

### T-0162: Field Stringifiers

Depends on T-0157 and may proceed beside T-0158 through T-0161 until handler
generation ownership converges at T-0163. Owns the public `Stringifiers` and
`StringifierRegistry` field extensions and focused type tests. RED evidence
covers every supported scalar, bytes, enum, and message form; custom message
mappings; canonical round trips; and invalid, non-finite, repeated, or map
values.

### T-0163: `@Where`

Depends on T-0160 and T-0162. Owns the decorator, analyzer, generated
metadata/rendering/ingestion, handler selection, and repository execution. RED
evidence covers all three supported handler forms, every excluded form, nested
paths, missing values, precedence/fallback, same-path constraints, canonical
duplicates, and invalid static declarations.

### T-0164: Implicit required IDs

Depends on T-0163. Owns one server implicit-ID validation policy, CommandBus and
Inbox pre-dispatch use, Entity transition/commit use, and validation fixtures.
RED evidence covers declaration order, supported and excluded types, durable
Command replay, every Entity kind, explicit true/false, one violation only, and
the exclusion of Events and rejections.

### T-0165: Rejection conformance

Depends on T-0164. It owns conformance/naming tests and a source checker. It
touches generator/runtime production code only when an observed RED proves a
defect. Evidence covers rollback, one typed Event with original context, client
outcome, both filename forms, no state/history commit, and no duplicate
dispatch mechanism.

### T-0166: Message Board Wave 9 proof

Depends on T-0154, T-0156A, T-0159, T-0161, T-0163, T-0164, and T-0165. Owns
only Message Board manifests, deployment configuration, authored domain Proto/
handlers, generator configuration, and example tests. Generated outputs remain
untracked; clean-regeneration evidence proves them. The task proves
application-owned composition with the official Google Cloud LogLayer transport
using a fake Google `Log`, the local structured default, natural custom and
empty Event routes, a natural `@Where`, implicit Command/Entity IDs, and the
existing rejection flow. Framework-only variants stay in framework fixtures
rather than being forced into the example.

### T-0167: Wave 9 convergence and integration

Depends on every preceding task. It owns orchestration and durable records, not
new production implementation. Substantive corrections return to the existing
owner of the affected task/files. It runs deterministic API/export,
secret-field, containment-manifest, generated-clean, Proto, package/import,
copyright-deferral, and product-Markdown-deferral checks; one cross-wave
specialist review; the final security review; one converged release
verification; dependency-ordered integration; and `origin`-only branch, tag,
and `main` pushes.

After T-0154, T-0155/T-0156, T-0156A, and T-0157 may proceed on disjoint
ownership; T-0162 may proceed after T-0157 beside routing work. Overlapping
production ownership remains serialized: T-0155/T-0156 for server runtime,
T-0157 through T-0161 for metadata/routing/repository, T-0162/T-0163 for core
and handler filtering, T-0164 for validation/repository, then T-0166 for the
example. No two writers own repository, handler generation, core exports,
package manifests, or the lockfile at once.

## Review And Verification

- Each task runs focused RED/GREEN tests, relevant package typechecks, ESLint,
  TSDoc, Prettier, `git diff --check`, prohibited-secret scans, and
  changed-source/package-scoped coverage of at least 90% in every metric.
- Specialist review follows deterministic checks. Only concerns affected by a
  correction are re-reviewed.
- Logging tasks use deterministic secret-boundary tests and scans. T-0167 runs
  the one final security review because the Wave changes the authentication-
  secret boundary.
- Every bounded task uses `verify:task` once after convergence. T-0167 uses one
  `verify:release`, then post-merge verification on `main`.
- Every feature and correction commit is pushed immediately to `origin`.
  Published task branches are never rewritten.

Concern dispositions are fixed per task:

| Tasks            | Style | TypeScript/API | Documentation/TSDoc | Reliability |
| ---------------- | ----- | -------------- | ------------------- | ----------- |
| T-0154           | Yes   | Yes            | Yes                 | Yes         |
| T-0155–T-0156    | Yes   | N/A: no export | N/A: no public docs | Yes         |
| T-0157           | Yes   | Yes            | Yes                 | Yes         |
| T-0158–T-0164    | Yes   | Yes            | Yes                 | Yes         |
| T-0165 test-only | N/A   | N/A            | N/A                 | N/A         |
| T-0165 with code | Yes   | As affected    | As affected         | Yes         |
| T-0166           | Yes   | Yes            | TSDoc only          | Yes         |
| T-0167           | Yes   | Yes            | Yes                 | Yes         |

Security is a final T-0167 release-readiness concern because logging changes
the authentication-secret boundary. Earlier tasks use deterministic secret
negative tests rather than repeatedly invoking the final security reviewer.

Every runtime slice uses one `verify:task` after its corrections converge.
T-0167 alone runs the final converged release profile rather than using it as a
diagnostic loop.

## External And JVM Evidence

- LogLayer application context and child logging:
  <https://loglayer.dev/logging-api/context.html>
- LogLayer structured transport:
  <https://loglayer.dev/transports/structured-logger.html>
- LogLayer Google Cloud transport:
  <https://loglayer.dev/transports/google-cloud-logging.html>
- Google Cloud structured logging contract:
  <https://cloud.google.com/logging/docs/structured-logging>
- Google Cloud Logging Node.js client reference:
  <https://cloud.google.com/nodejs/docs/reference/logging/latest>
- Current local Spine JVM source was inspected for `CommandRouting`,
  `EventRouting`, `StateUpdateRouting`, default routes, `EventRoute.noTargets`,
  `@Where`, `@AcceptsFilters`, `RequiredIdPolicy`, and
  `RequiredFieldSupport`. Spine JVM was neither changed nor built.

## Wave 10 Documentation Handoff

T-0168 will be the Wave 10 planning task and durable owner of this handoff. It
must return the preliminary structure to the human for renewed approval before
editing product documentation. Wave 10 rewrites `docs/USER_GUIDE.md` as the
beginner guide and links dense provider, deployment, and reference material
instead of repeating it. The preliminary structure is:

1. **Begin with the domain** — EventStorming, domain language, and choosing the
   first Bounded Context.
2. **Create a project** — packages, tooling, and the smallest runnable server.
3. **Describe the model in Proto** — IDs, Commands, Events, Entity states,
   columns, rejections, and generated TypeScript.
4. **Implement behavior** — Aggregates, Process Managers, Projections,
   handlers, routing, `@Where`, and business rejections.
5. **Send Commands and read state** — Node and browser clients, Queries,
   subscriptions, reconnect, and idempotency.
6. **Persist application data** — memory for tests, MySQL, Datastore, tenancy,
   layouts, mappings, and migrations, with provider detail linked out.
7. **Test the application** — model, Entity, routing, rejection, query,
   subscription, and integration tests.
8. **Run and observe it** — LogLayer setup, structured fields, secret safety,
   and collector transports.
9. **Package and deploy it** — combined and distributed shapes, containers,
   GKE/GCE, scaling, shutdown, and linked operator references.
10. **Continue from working examples** — Message Board, Distributed Message
    Board, To-Do, Orders, and focused feature maps.

Repository-wide Markdown rewriting, copyright-header correction, and
multiple-Gateway behavior are Wave 10 work. Cloud Run remains outside the
initial offering.

T-0168 acceptance requires a checked link inventory from every guide section to
the canonical dense sources it relies on: root and package `README.md`/
`REFERENCE.md` files; `docs/api/README.md`; `docs/architecture/README.md`;
`docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md`; storage provider references;
server, auth, client, delivery, and deployment package references; and the
Message Board, Distributed Message Board, To-Do, Orders, and Projects example
guides. Every link must resolve locally and each dense topic has one canonical
target rather than repeated guide prose.

The exact deferred surfaces are root/package READMEs,
`docs/USER_GUIDE.md`, other product and example Markdown, repository-wide
copyright headers, and multiple-Gateway behavior. Wave 9 may edit only its
canonical build-protocol plan, task, work, review, decision, and completion
records plus public API TSDoc required by the corresponding runtime slice.
