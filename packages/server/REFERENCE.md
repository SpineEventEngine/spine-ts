# @spine-event-engine/server reference

This reference describes the public server contracts for coding agents.

## Context assembly and entities

Create a context with `BoundedContext.singleTenant(name)` or
`BoundedContext.multitenant(name)`. Names are immutable. Use
`withStorageFactory(factory)` to supply record/event storage.
`withGeneratedRegistryRoot(root)` enables framework discovery of the generated
handler registry for classes registered with `add(EntityClass)`;
`buildAsync()` performs that discovery and assembly. `build()` remains for
explicit `Repository` registration. A built context owns `CommandBus`,
`EventBus`, `Stand`, repositories, and its storage lifecycle.

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

`EventBus` validates stored and live events before user dispatcher code and
before append. Schemas may come from an external dispatcher or a registered
internal repository producer. A producer-only schema is not thereby an external
dispatch route.

## Services, reads, and lifecycle

`SpineServices({ contexts }).register(router)` registers the JVM-compatible
CommandService, QueryService, and SubscriptionService contracts. `Server`
opens the local Node HTTP/2 listener; default host is `127.0.0.1`. Set
`readMaxBytes` and `writeMaxBytes` only to integers 1–4294967295; defaults are 4194304. `RunningServer.close()` stops intake, closes sessions, waits for active
work to stop using dependencies, then closes contexts. Caller-managed `start()`
does not close global process facilities; close `ServerEnvironment.instance()`
separately when used. The final run-managed `run()` close closes its environment.

`Stand` registers entity state for point/list reads, updates current state, and
offers in-process subscriptions. `catchUpReadSide(options?)` clears registered
projection state and replays stored events through matching projection
subscribers; it does not append events or run delivery jobs. Single-tenant
contexts reject a tenant option; multitenant contexts require one.

Active subscription streams and queues are process-local, while inactive service
records use the context storage factory. The package does not guarantee
cluster-complete observations, subscription replay, event-gap repair, or
exactly-once effects.

### Standalone and browser hosting

`Server.start()` installs no process signal handlers, never closes its
environment, and shares only a caller-managed active generation. `Server.run()`
coalesces concurrent calls on one builder, shares a run-managed generation with
other `run()` servers, and rejects mixed admission before listener open. The
coordinator uses one `SIGINT`/`SIGTERM` listener pair, closes servers in reverse
successful-start order, retains failed final environment closure for later
signal or explicit-close retry, and sets `process.exitCode` to `1` after a
signal-driven failure.

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
HTTP(S) origin for a Spine TS or JVM backend; the gateway never owns or closes
that backend. Every standalone mode, including local development and tests,
requires explicit subscription bindings; production additionally requires an
application type registry and named durable bindings. `ResolveContext` stays in the gateway;
Post, Read, Subscribe, Activate, and Cancel use the same authenticated policy,
context-replacement, and native descriptors before reaching the backend.

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

Browser subscription bindings are separate from service-owned subscription
records. `BrowserServerOptions.bindings` accepts the `SubscriptionBindings`
contract from `@spine-event-engine/auth`. Production browser assembly requires
bindings that declare the durable capability; `DurableSubscriptionBindings` is
the provided implementation. It rejects a missing or volatile in-memory
binding store before listener open. The durable registry receives an explicit
application namespace, storage factory, identifier source, disposal callback,
and finite lease, cleanup, record, and byte limits. It owns and closes only
its independently opened record-storage handle, not the application storage
factory or a Spine JVM/TS backend. It copies backend envelopes on read, write,
and callbacks and never returns them through public subscription responses.

The durable registry preserves opaque records through a process restart.
It validates record family, version, type, storage key identity, owner
fingerprint, tenant, expiry, lifecycle, fence, lease, canonical byte
accounting, and finite record size before use. Invalid data fails closed with a
generic registry error. A namespace-global quota reserves the final public ID
before creation; the reservation release is asynchronous and exactly once.
Two gateways coordinate ownership with finite leases and fences. Before each
backend effect and public update, the gateway checks its durable owner/fence
guard. A false guard suppresses that effect or update; renewal also aborts the
local controller when it observes lease loss. A former owner cannot finalize.
Cleanup remains bounded and restart-safe at the record level. It renews the
fenced cleaner lease immediately before each disposal callback, preventing a
second cleaner from taking over during that callback. Active streams do not resume,
updates are not replayed, and the registry provides neither exactly-once
delivery, global update ordering, nor cluster-complete notification delivery.

## Delivery and environment

`Inbox`, `InboxStorage`, `ShardIndex`, and `ShardedWorkRegistry` provide the
local durable-row abstraction. Read limits are 1–1000; work leases are
1000–2147483647 ms. Framework replay supports command handling, projection
updates, and process-manager reactions. Callbacks are at-least-once/replay-safe:
lost renewal can prevent stale finalization but cannot undo a callback already
run. The package exposes no general raw worker callback API.

`BoundedContext.withDeliveryStrategy(strategy)` snapshots a validated immutable
strategy for its Entity Inbox. Aggregate and Process Manager rows derive their
target shard internally and persist their envelope before replay. Direct local
delivery drains in the post request; attached environment ports acknowledge
persisted work and replay it in a worker. Projection rows remain separate.

`DeliveryBuilder` constructs a controlled `Delivery`; `DeliverySupervisor`
receives `{ source, delivery, onMessage }`, owns bounded shard notifications
from that structural source, and must start after endpoints are ready and close
before source client/storage. `DeliverySource` is not configured on
`DeliveryBuilder`. The supervisor does not promise
durable supervisor state, topology failover, exactly-once effects, or automatic
retry of unknown remote mutations.

`Environment` resolves the Node `local` or `production` profile once from
`NODE_ENV`. `ServerEnvironment` resolves configured facilities once for that
profile and exposes its `storageFactory`, `transport`, optional `delivery`,
optional `tracerFactory`, `nodeId`, and `close()` lifecycle. Applications do
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
environment close runs delivery, transport, tracer, then storage and preserves
retry checkpoints for failed phases.
