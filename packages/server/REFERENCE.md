# @spine-event-engine/server reference

This reference describes the public server contracts for coding agents.

## Integration broker and event origin

Each `BoundedContext` creates and closes exactly one private integration broker.
The broker has distinct status, configuration, and event exchanges. Event
export is requested-only: a context installs a domestic publisher only for
event types requested by another context, and withdrawal removes only that
requester's interest. The broker does not enforce ownership; the supported
shape is many consumers and one domain producer per event type at a time.

The status exchange announces `BoundedContextOnline`; observing a foreign
announcement resends the local complete wanted-event document. The
configuration exchange treats each `ExternalEventsWanted` as a complete
replacement, installs producer publication on the first requester, avoids
duplicate unchanged broadcasts, and removes publication after the last
withdrawal. The event exchange uses one logical channel per event message type
and retains the original Event ID and complete Event. Self-origin and paired
domain/System Context messages are ignored.

`External<T>` is exported as a transparent type alias (`type External<T> = T`)
and has no runtime value or brand. The build-time handler analyzer recognizes
the canonical server declaration only when it is the direct first receptor
parameter. Missing markers mean `domestic`; a valid marker means `external`.
External commands are rejected, while external event/rejection handlers and
the supported state-subscription path are filtered by `EventContext.external`.
Repository selection applies the filter per handler, including mixed-origin
repositories. This is also the loop rule: domestic publication and origin
filtering prevent self-origin and paired-context traffic; no hop count, origin
ledger, Inbox, retry, replay, deduplication, cursor, fencing, or election is
added.

Incoming broker frames must contain a valid `ExternalMessage` wrapper and a
complete `Event`. The server unpacks and validates the event, obtains the
tenant from its explicit event origin, validates that tenant at the existing
boundary, copies only `EventContext.external = true`, and posts the ordinary
domain `EventBus`, whose admitted schemas are the destination's authority for
incoming payload decoding. Unknown or malformed received payloads are logged safely,
dropped, and do not stop the broker loop. Zero-byte control messages are valid
where the Proto contract permits an empty payload.

Malformed, unknown-schema, or undecodable received events emit the fixed ERROR
message `Dropped corrupt external event.` with safe `contextName`, `eventType`,
`operation: external-event-intake`, and
`reasonCode: corrupt_external_event`; the callback resolves, the event is
dropped, and later valid events continue. Application intake failures after a
valid decode remain observable.

Context readiness includes broker open. Close gates new EventBus intake before
awaiting transport work, broadcasts an empty wanted document, detaches domestic
publishers and external subscribers, drains accepted work, and closes acquired
channels. Failed cleanup remains retryable and concurrent close callers share
one attempt.

`ThirdPartyContext` is the sole public third-party import API. Its
`singleTenant()` form forbids an actor tenant; `multitenant()` requires one.
`emittedEvent(event, actor)` accepts a registered generated Protobuf message used as an event
payload and `ActorContext` (or a
`UserId` in the single-tenant form), preserves actor identity and timestamp,
and publishes through its hidden context. An unknown local schema throws; a
valid event with no interested external receptor is simply not delivered.

## Server environment facilities

`ServerEnvironment.instance()` is a process-wide singleton. Production
resolution requires storage and the complete application schema registry:

```ts
import { EnvironmentType, ServerEnvironment } from "@spine-event-engine/server";
import type { TypeRegistryLookup } from "@spine-event-engine/core";
import type { StorageFactory } from "@spine-event-engine/storage";

declare const storageFactory: StorageFactory;
declare const typeRegistry: TypeRegistryLookup;

ServerEnvironment.when(EnvironmentType.Production).use({
  storageFactory,
  typeRegistry,
});
```

`storageFactory` supplies records and events. `typeRegistry` is the complete
application schema universe used by `ThirdPartyContext` to encode outgoing
imported events. An optional `integrationChannelFactory` overrides the
process-wide private
integration message channel factory. When it is absent, all local bounded
contexts share one in-memory factory, including in production. Local and test
environments default storage in memory and use the core registry only as a
fallback; those defaults are not production configuration.

To override the default channel factory, add
`integrationChannelFactory: customFactory` to the same settings object.

## Routing lifecycle

Event, command, and state-update routing accepts exact schemas and nominal
message-interface tokens. It selects exact, first registered matching token,
then replacement/default. The route runs once at accepted admission; its
validated typed targets are stored and reused for retries. The legacy-named
local `catchUpReadSide()` helper is unrelated to retry: it resets and replays
the whole local read side, and is not Projection catch-up.

## Handler routing and operations

Generated handler metadata routes a command, event, or state update by its
exact generated message type. A declared default route is considered only when
there is no exact route. This is TypeScript routing; it does not consume
`(is).java_type` or `(every_is).java_type`, and it has no decorator-based
route registration API.

One `@Where({ eventField, equals })` equality filter may narrow an event- or
rejection-consuming `@Subscribe`, `@React`, or `@Command` handler after type
routing. `eventField` and `equals` are typed string literals; invalid or
repeated declarations fail closed. It is not an alternative routing mechanism.

Configure logging through `ServerEnvironment` when assembling the server. The
server installs that logger into its runtime components, where warnings and
failures carry operation context. Durable facts belong in events or storage.
Entity Inbox replay sends persisted accepted work through the normal handler
path, so handler effects must be replay-safe.

## Context assembly and entities

Create a context with `BoundedContext.singleTenant(name)` or
`BoundedContext.multitenant(name)`. Names are immutable. Use
`withStorageFactory(factory)` to supply record/event storage.
`withGeneratedRegistryRoot(root)` enables framework discovery of the generated
handler registry for classes registered with `add(EntityClass)`;
`buildAsync()` performs that discovery and assembly. `build()` remains for
explicit `Repository` registration. A built context contains `CommandBus`,
`EventBus`, `Stand`, repositories, and its storage lifecycle.

### Stand subscription registry

Each built context also has one `StandSubscriptionRegistry`. By default the
builder creates a storage-backed registry from the resolved context
`StorageFactory` (including the `ServerEnvironment` factory used for a builder
added to a server). It stores one `spine.client.SubscriptionRecord` under each
explicit `SubscriptionId`. A complete custom implementation can instead be
supplied with `withSubscriptionRegistry(registry)`; responsibility transfers to
the builder on the first build attempt.

`SubscriptionService` streams are live best-effort notifications, not replay,
ordering, or completeness contracts. A standalone Server defaults to the
persistent registry. In a managed complete-replica cohort, the framework owns
each child Server and accepts only every context's actual
`InMemorySubscriptionRegistry`; a persistent or custom registry is rejected
and the assembled child is closed before READY. Durable logical bindings remain
Gateway-only. The Coordinator fans each logical definition to ready children,
merges updates, propagates cancellation, and carries no subscription payload on
parent/child IPC. A late or replacement child synchronizes retained definitions
before it is eligible for normal requests. Active definitions attach their
child streams before admission; subscribed but inactive definitions do not
block readiness. Each child observes application-configured remote/shared
Delivery directly. During DRAINING, new unary and shard admission stops while
active Delivery and its subscription updates finish before child close. The
application owns Delivery facility and shard-strategy selection; managed mode
does not infer or certify configuration provenance.

Create records begin `pending` and expire after 30 seconds unless activated.
Active records have no framework TTL. Cancellation physically deletes the
definition; no tombstone remains. A stored definition is at most 1 MiB
(1,048,576 bytes). Its physical provider columns are `status` and
`when_activation_expires`. `cleanup()` asks the provider for 26 pending rows
ordered by `when_activation_expires` then ID, validates that finite result,
deletes at most 25 expired definitions, and reports `more` only when its
observed 26th row is expired. Cleanup can run idempotently on every node.

Context close drains and closes Stand before its registry, then closes tenant,
repository, and storage resources; it attempts every close and reports
aggregate failures. An in-memory registry reports `persistent === false`.
Attaching such a context to a production `ServerEnvironment` emits one
context-name-only warning without failing startup; Local environments do not
warn.

Creation writes the pending record only when that ID is absent. Activation
replaces that pending record only when it remains unchanged. Cancellation and
expiry cleanup delete the observed record only when it remains unchanged. Each
node reconciles its local snapshot immediately after context assembly and then
every ten seconds. Physical deletion detaches the local observer after its next
completed cycle. This is best-effort per-node convergence, not a
cluster-completeness, replay, ordering, gap-repair, or exactly-once guarantee.

The registry accepts only a generated `SubscriptionId` for activate, get, and
delete. `create(subscription)` returns `{ kind: "created", entry }` or
`{ kind: "existing", entry }`; the latter requires byte-equivalent canonical
content and a different definition with the same ID throws `StandConflictError`.
`activate(id)` returns `activated`, `active`, `missing`, or `expired`.
`delete(id)` returns `deleted` or `missing`. Blank IDs or topics and malformed
durable records fail closed.

Entries and nested subscriptions returned by create, activate, get, and
snapshot are clone-safe views. Protobuf byte arrays remain mutable runtime
views but are cloned so they never alias caller storage. Snapshots are ordered
by identifier. A durable provider must implement atomic compare-and-set for
`SubscriptionRecord`; construction rejects a provider that cannot. MySQL table
configuration and Datastore custom record storage registered for
`SubscriptionRecord` are used by the registry. The registry uses one
record-storage handle, while the context closes the registry.

`Entity` is the state base class. `Aggregate`, `Projection`, and
`ProcessManager` identify the three entity families. Handler decorators are
`@Assign`, `@Command`, `@React`, `@Subscribe`, and `@Apply`. In a transactional
handler, `update(mutator)` changes the active draft and returns the draft;
`tryUpdate(mutator)` validates a scratch draft and returns violations without
applying an invalid change. Entity lifecycle and version changes are committed
only after the transaction accepts.

## Signals, validation, and rejection behavior

`CommandBus` validates every accepted command from Proto validation options
before dispatcher or repository handler code runs. It raises the framework's
command-validation failure, which `SpineServices` maps to
`COMMAND_VALIDATION_ERROR` with a packed `spine.validation.ValidationError`.
Entity transition validation failures map to
`COMMAND_STATE_TRANSITION_VALIDATION_FAILED` with the same detail type.

An application handler throws a generated core `RejectionThrowable` for a
domain rejection. The repository rolls back state, version, lifecycle, and
output; it schedules the typed rejection event independently. Command service
acknowledgement remains an accepted `Ack`. Rejection-event posting can be
unobserved by inactive, full, or closed subscriptions and a posting failure is
an internal diagnostic, not a retry guarantee.

Every domain context has an internal paired System Context. Domain events use
the domain `EventBus` and domain `EventStore`. System events use only the
System Context `EventBus`, so they never enter the domain EventStore. System
event persistence is optional: `persistSystemEvents()` enables the paired
System Context's separate storage; otherwise the bus validates, dispatches,
and notifies without appending. Schemas may come from an external dispatcher or
a registered internal repository producer. A producer-only schema is not
thereby an external dispatch route.

## Services, reads, and lifecycle

`SpineServices({ contexts }).register(router)` registers the JVM-compatible
CommandService, QueryService, and SubscriptionService contracts. `Server`
opens the local Node HTTP/2 listener; default host is `127.0.0.1`. Set
`readMaxBytes` and `writeMaxBytes` only to integers 1–4294967295; defaults are 4194304. `RunningServer.close()` stops intake, closes sessions, waits for active
work to stop using dependencies, then closes contexts. Caller-managed `start()`
does not close global process facilities; close `ServerEnvironment.instance()`
separately when used. The final run-managed `run()` close closes its environment.

`Stand` registers entity state for point/list reads, updates current state, and
offers in-process subscriptions. The legacy-named local reset/replay helper
`catchUpReadSide(options?)` clears every registered Projection state and replays
the whole stored event history through matching Projection subscribers; it does
not append events. Single-tenant contexts reject a tenant option; multitenant
contexts require one. It cannot target a Projection repository, entity IDs, or
a starting time, and has no durable operation identity, progress, Inbox
catch-up delivery, restart, resumption, or historical/live coordination. It is
not JVM-equivalent Projection catch-up.

Active subscription streams and queues are process-local. `Stand` serves
authoritative queries from current state and Entity subscriptions observe
committed `EntityStateChanged` messages on the paired System Context EventBus,
so a direct Stand write alone does not produce a subscription update. Consumer
callback failures are isolated from post-commit observation and other
consumers. The package does not guarantee cluster-complete observations,
subscription replay, event-gap repair, or exactly-once effects.

### Standalone and browser hosting

`Server.start()` installs no process signal handlers, never closes its
environment, and shares only a caller-managed active generation. `Server.run()`
coalesces concurrent calls on one builder, shares a run-managed generation with
other `run()` servers, and rejects mixed admission before listener open. The
coordinator uses one `SIGINT`/`SIGTERM` listener pair, closes servers in reverse
successful-start order, retains failed final environment closure for later
signal or explicit-close retry, and sets `process.exitCode` to `1` after a
signal-driven failure.

`ManagedServerApplication.run()` is the Node-only deployment entrypoint for a
complete-replica process cohort when the framework owns process shutdown.
`ManagedServerApplication.start()` starts the same cohort for an embedding host
and installs no process signal handlers; that host closes the returned handle.
Both require a positive safe-integer
`processCount` and an ESM `moduleUrl`; it never derives a process count from
the machine. Its optional `host` and required nonzero `port` bind the public
Coordinator listener. Every child executes that same module and calls its own
`createServer({ host: "127.0.0.1", port: 0 })`. The child reports its actual
loopback endpoint only after its local readiness gates settle. The parent
initially waits until every configured child is ready. Afterwards it is ready
while at least one child is ready; it remains alive and keeps replacing while
degraded, and reports unready if no child is ready. It replaces an unexpected
child exit after a bounded exponential delay (250 ms initially, capped at 30 s;
reset after 60 s READY). It does not restart a child being closed. Restart
values are optional `restart` settings and must be positive safe integers;
concurrent starts default to `min(4, processCount)`. `run()` parent `SIGINT`
and `SIGTERM` use the same shared child-close path; `start()` leaves those
signals to its caller. This private lifecycle channel
does not transport application signals. The Coordinator forwards generated
Command and Query unary calls once to a READY child; process count does not
inspect CPU availability and does not constrain the application's independently
chosen `DeliveryStrategy` or shard count. Direct `Server.run()` and browser
hosting remain independent of managed Node deployment.

If no child is READY, Command and Query return gRPC `UNAVAILABLE`. The
Coordinator does not enter application intake and does not retry the selected
call on a sibling child. Subscription fan-out follows current READY members;
later and replacement members attach the retained subscription before managed
admission.

`ServerOptions.browser` changes the public listener, not the bounded-context
services. The native HTTP/2 backend binds to an ephemeral loopback port and is
never returned. After it is ready, the server creates `UnaryGateway`,
`SubscriptionGateway`, and native gateway services, then binds one HTTP/1.1
Connect/gRPC-Web listener. A public bind failure closes subscription resources
and the native backend; multiple rollback failures are aggregated.

Browser unary gateway admission has a fixed 1 MiB (1,048,576-byte) request
limit. A larger unary gateway request is rejected with `ResourceExhausted`.
This is an additional boundary: `readMaxBytes` still limits the Connect or
gRPC-Web transport message accepted by the public listener, so the effective
inbound limit is the stricter applicable limit. `writeMaxBytes` limits public
transport responses independently.

Browser origins must be unique canonical HTTP(S) origins with no path, query,
fragment, or trailing slash. Requests without an allowed exact `Origin` receive
403 before RPC handling. Allowed responses include credentialed exact-origin
CORS, `Vary: Origin`, protocol request headers, and exposed gRPC status headers.

Supplying `browser.backend.baseUrl` selects standalone mode. It is one canonical
HTTP(S) origin for a Spine TS or JVM backend; the gateway never closes
that backend. Every standalone mode, including local development and tests,
requires explicit subscription bindings; production additionally requires an
application type registry and named durable bindings. `ResolveContext` stays in the gateway;
Post, Read, Subscribe, Activate, and Cancel use the same authenticated policy,
context-replacement, and native descriptors before reaching the backend.

`browser.backend.baseUrls` is exclusive with `baseUrl` and configures a
non-empty ordered unique static node set. Unary calls use bounded round-robin
without retry; native streams fan out best-effort. Durable bindings retain only
logical definitions, not topology. Clients
re-query authoritative state after duplicate updates or generic loss notices.

`browser.authRoutes` is deliberately a bounded callback seam, not a router.
Each registration has one exact `GET` or `POST` canonical path, one method per
path, exact canonical origins, finite request bytes, and a finite timeout. A
missing Origin is rejected unless that route explicitly permits it for an OAuth
callback. Unknown paths, method/origin failures, body overflow, timeout, and
handler failure return fixed 404, 405, 403, 413, 504, and 500 responses without
calling application code on rejected input. The 404 unknown-path result applies
only after framework Origin admission. Auth admission is bounded to 64 active
requests by default or a configured positive `maxActiveAuthRequests`; excess
requests receive 503 before handler invocation and capacity returns when work
settles. The route deadline covers body intake, handler work, and response
transfer. Response bodies use `writeMaxBytes`; overflow returns 413 before any
application status or headers are committed. Listener close ultimately aborts
an active request through its disconnect signal.

With `cookies`, `OpaqueSessionCookies` performs strict bearer-first or
CSRF-protected cookie extraction. A strict rejection becomes an unusable
credential and never falls back to permissive header parsing. Without cookies,
the host accepts exactly one non-whitespace bearer token. Credentials and raw
transport metadata do not reach the private backend. The application-supplied
context resolver replaces caller actor and tenant facts before forwarding.

Browser close stops new listener intake, closes subscription admission and
bindings so active streams settle, awaits listener closure, then closes the
native backend. Concurrent calls share an attempt; a failed unfinished phase
can be retried without repeating completed native cleanup.

Browser subscription bindings are separate from service subscription
records. `BrowserServerOptions.bindings` accepts the `SubscriptionBindings`
contract from `@spine-event-engine/auth`. Production browser assembly requires
the Server package's `DurableSubscriptionBindings`; it rejects a missing or
in-memory binding store before listener open. The durable registry receives an explicit
application namespace, storage factory, identifier source, and cleanup callback. It closes only
its independently opened record-storage handle, not the application storage
factory or a Spine JVM/TS backend. It stores canonical public Subscription
definitions, never backend envelopes or membership topology, and never returns
private native data through public subscription responses.

The durable registry preserves one approved `GatewayAuthenticatedSubscription`
per public subscription through a process restart. It validates the record ID,
full Subscription, and expiry before use. The trusted Actor and Tenant remain
inside the stored Topic and are checked for Activate and Cancel. Create assigns
the public ID directly; no quota, reservation, fingerprint, or lease is
persisted. Cleanup remains bounded and restart-safe at the record level. It
cleans the backend definition before deleting its record. It is not a cleaner
lease or fence: this direct store supports one Gateway process. Active streams do not resume,
updates are not replayed, and the registry provides neither exactly-once
delivery, global update ordering, nor cluster-complete notification delivery.

## Delivery and environment

`Inbox`, `InboxStorage`, `ShardIndex`, and `ShardedWorkRegistry` provide the
local durable-row abstraction. Read limits are 1–1000; work leases are
1000–2147483647 ms. Framework replay supports command handling, projection
updates, and process-manager reactions. Callbacks are at-least-once/replay-safe:
lost renewal can prevent stale finalization but cannot undo a callback already
run. The package exposes no general raw worker callback API.

Shard ownership is the only delivery exclusion mechanism and excludes
concurrent delivery within that shard. Pending and delivered `InboxMessage`
rows are direct records; a delivered row is the deduplication fact. A handler
effect and the exact pending-to-delivered compare-and-set are not one
transaction, so a lost acknowledgement can redeliver after restart. Downstream
signal handling must be idempotent. A customized `DeliveryWorkRegistry`
implements `validateOwnership()` so delivery can validate before dispatch, at
repository commit time, and before acknowledgement. Validation is a fence
against an observed takeover, not a distributed transaction with handler
storage.

`keepUntil` is the optional deduplication-protection deadline, not a second
retention setting. A delivered row is cleanup-eligible when that deadline is
absent or elapsed. Under current shard ownership, environment delivery performs
one bounded cleanup page, plus at most one continuation after a full protected
page makes no removal. Each removal atomically verifies ownership and the exact
delivered snapshot. Pending, retryable, non-delivered, and still-protected rows
remain. There is no additional retention configuration, timer, or scheduler.

`BoundedContextBuilder.withDeliveryStrategy(strategy)` snapshots a validated
immutable strategy for its Entity Inbox; the default is one shard. For example,
use the public builder chain:

```ts
import { BoundedContext, UniformAcrossAllShards } from "@spine-event-engine/server";

const context = BoundedContext.singleTenant("Tasks")
  .withDeliveryStrategy(UniformAcrossAllShards.forNumber(3))
  .build();
```

Aggregate commands and Process Manager commands/events derive their target shard
internally and persist their envelope in the target Entity Inbox before any
handler runs. Delivery is never a post-request callback: local and remote
handler runs. Local intake can directly drain the persisted Inbox in the
current request path. Attached `ServerEnvironment` ports acknowledge admission
and delivery workers replay it through the same path. Projection rows remain
separate.

`DeliveryBuilder` constructs a controlled `Delivery`; `DeliverySupervisor`
receives `{ source, delivery, onMessage }`, manages bounded shard notifications
from that structural source, and must start after endpoints are ready and close
before source client/storage. `DeliverySource` is not configured on
`DeliveryBuilder`. The supervisor does not promise
durable supervisor state, topology failover, exactly-once effects, or automatic
retry of unknown remote mutations.

Each drain operation is bounded to one page. That bound limits a single
operation, not the total pending work: an active lease owner can take another
page while its policy retains the shard. The 30-second Inbox deduplication
window controls duplicate admission only; it is not a replay-retention period.
Persisted accepted rows follow their delivery lifecycle and may be replayed
according to that lifecycle after the deduplication window has elapsed.

`DeliveryMonitor` is an instantiable, customizable policy seam exposing
asynchronous continuation, start/completion, failed-reception, pickup-failure,
and already-picked hooks.
`FailedReception` supplies only `markDelivered()` and one immediate
`repeatDispatching()` action; the framework adds no attempt history, timer,
backoff, quarantine, dead-letter, receipt, marker, or scheduler policy. A failed
durable acknowledgement keeps that row pending, blocks later rows for its
target during the run, and does not prevent independent targets from running.

`Environment` resolves the Node `local` or `production` profile once from
`NODE_ENV`. `ServerEnvironment` resolves configured facilities once for that
profile and exposes its `storageFactory`, optional `delivery`, optional
`tracerFactory`, `nodeId`, and `close()` lifecycle. Applications do
not manage internal server attachments through this public API. Neither API
authenticates requests or supplies a production scheduler, remote topology,
storage adapter, or deployment policy.

`ServerEnvironmentDelivery` extends the existing closeable facility shape with
`open()` plus generic `inbox` and `workRegistry` ports. After readiness, the
environment supplies those ports to both existing delivery paths: direct finite
`Delivery` construction and the supervisor's `DeliveryBuilder`. The environment
invokes `open()` once before attachment admission and coalesces concurrent
callers; rejection admits no attachment and a later attempt retries open. A
close-only local delivery remains source-compatible. After attachments retire,
environment close runs delivery, tracer, then storage and preserves retry
checkpoints for failed phases.

`ServerEnvironmentDelivery.source` is optional. When present, its Admin source
is used by the environment supervisor for remote snapshots and
shard-update hints; when absent, the existing local source remains the fallback.
Applications configure and close only the delivery facility through the
environment: attachment supervisors and their source reads belong to that facility.

# Dynamic unary discovery

`BrowserServerOptions.discovery` may supply changing complete application-node snapshots alongside fixed `backend` configuration. Both unary routing and native subscription streams use the same current membership. Empty membership retains durable definitions and later nodes reactivate them; a new backend-dependent subscription is unavailable until a node exists.
