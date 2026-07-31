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
work to stop using dependencies, then closes contexts. It does not close global
process facilities; close `ServerEnvironment.instance()` separately when used.

`Stand` registers entity state for point/list reads, updates current state, and
offers in-process subscriptions. `catchUpReadSide(options?)` clears registered
projection state and replays stored events through matching projection
subscribers; it does not append events or run delivery jobs. Single-tenant
contexts reject a tenant option; multitenant contexts require one.

Active subscription streams and queues are process-local, while inactive service
records use the context storage factory. The package does not guarantee
cluster-complete observations, subscription replay, event-gap repair, or
exactly-once effects.

## Delivery and environment

`Inbox`, `InboxStorage`, `ShardIndex`, and `ShardedWorkRegistry` provide the
local durable-row abstraction. Read limits are 1–1000; work leases are
1000–2147483647 ms. Framework replay supports command handling, projection
updates, and process-manager reactions. Callbacks are at-least-once/replay-safe:
lost renewal can prevent stale finalization but cannot undo a callback already
run. The package exposes no general raw worker callback API.

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
