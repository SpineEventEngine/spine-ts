# Spine routing, dispatch, and delivery specification for TypeScript

Navigation: [README](README.md) | Previous: [Entities, repositories, and state](spine-entities-repositories-and-state.md) | Next: [Client APIs, queries, subscriptions, and tests](spine-client-api-queries-subscriptions-and-tests.md) | Related: [Server runtime and bounded context](spine-server-runtime-and-bounded-context.md)

Source baseline: `/private/tmp/spine-research/core-jvm` 2.0.0-SNAPSHOT.381, with runtime/support repos consulted where relevant. This document describes behavior to preserve in a TypeScript/Node.js implementation. It is not a Java API guide.

## Scope

Routing and dispatch cover these signal paths:

- Client commands enter `CommandService`, then `CommandBus`, then exactly one command dispatcher.
- Produced or imported events enter `EventBus` or `ImportBus`, then one or more event dispatchers.
- Repository-level routing turns a signal into target entity IDs and writes `InboxMessage` records.
- Delivery workers pick inbox shards, deduplicate, order, and invoke endpoints.
- Queries and subscriptions are read-side services over `Stand`; they are in scope as client delivery APIs, but not part of the command/event bus and inbox sharding model.
- Integration broker publishes and receives external events across bounded contexts. External commands are not a supported receptor path.

Primary sources:

- `server/src/main/java/io/spine/server/CommandService.java`
- `server/src/main/java/io/spine/server/commandbus/CommandBus.java`
- `server/src/main/java/io/spine/server/event/EventBus.java`
- `server/src/main/java/io/spine/server/aggregate/ImportBus.java`
- `server/src/main/kotlin/io/spine/server/route/*.kt`
- `server/src/main/java/io/spine/server/delivery/*`
- `server/src/main/proto/spine/server/delivery/inbox.proto`
- `server/src/main/proto/spine/server/delivery/delivery.proto`
- `server/src/main/proto/spine/server/dispatch/dispatching.proto`
- `server/src/main/java/io/spine/server/integration/*`
- `core/src/main/proto/spine/core/command.proto`
- `core/src/main/proto/spine/core/event.proto`
- `core/src/main/proto/spine/core/enrichment.proto`

## Signal Model

`Command` and `Event` are outer messages containing a typed domain message in `Any` plus context.

- `Command` has `CommandId`, `message`, `CommandContext`, and internal `SystemProperties`. A command is imperative and should have one and only one handler for its message type. See `core/src/main/proto/spine/core/command.proto`.
- `Event` has `EventId`, `message`, and `EventContext`. Multiple subscribers may receive the same event. `EventContext` carries timestamp, origin, producer ID, version, optional enrichment, `external`, and rejection context. See `core/src/main/proto/spine/core/event.proto`.
- Rejections are events with `EventContext.rejection`.
- Multi-tenancy is carried in actor/context data and exposed as `tenant()`/`tenantId()` by envelopes. Command validation enforces tenant presence for multitenant contexts and absence for single-tenant contexts. See `CommandValidator`.

TypeScript implication: represent bus payloads as immutable envelopes with:

- stable outer ID;
- resolved message type URL/class;
- decoded domain message;
- context;
- tenant ID accessor;
- origin/external metadata.

Avoid routing or dispatching directly on raw Protobuf `Any`.

## Bus Semantics

The abstract bus pipeline is:

1. Convert outer signal to an envelope.
2. Run filters.
3. Store or record the accepted signal.
4. Acknowledge accepted signals before dispatch.
5. Dispatch to registered dispatcher(s).
6. Report errors as `Ack` status where applicable; the bus observer's `onError` is not used for posting results.

Source: `server/src/main/java/io/spine/server/bus/Bus.java`.

Default filters are:

- validating filter;
- dead-message filter for unsupported/unhandled messages;
- any bus-specific filters.

### CommandBus

`CommandBus` is a unicast bus. It dispatches each command to exactly one `CommandDispatcher` selected by message class. Duplicate dispatcher registration for a command type is rejected by `CommandDispatcherRegistry`.

Additional command behavior:

- `CommandReceivedTap` records receipt in the system context.
- `CommandScheduler` is last in the filter chain. Scheduled commands are intercepted, scheduled, acknowledged as handled by the filter, and later re-posted with `postPreviouslyScheduled`.
- `CommandAckMonitor` writes system events for acknowledged, errored, and rejected commands.
- `FlightRecorder` records dispatched and scheduled command lifecycle events.

Sources:

- `server/src/main/java/io/spine/server/commandbus/CommandBus.java`
- `server/src/main/java/io/spine/server/commandbus/CommandDispatcherRegistry.java`
- `server/src/main/java/io/spine/server/commandbus/CommandScheduler.java`
- `server/src/main/java/io/spine/server/commandbus/CommandAckMonitor.java`
- `server/src/main/java/io/spine/server/commandbus/FlightRecorder.java`

TypeScript implication: command handler registration must enforce one effective dispatcher per command message type. A scheduler should be a bus filter, not special logic in handlers.

### EventBus

`EventBus` is a multicast bus. It appends events to the `EventStore` before dispatching them. It then optionally enriches events and calls all matching dispatchers. If no dispatcher is called after filters pass, dispatch fails.

Event dispatchers are filtered by origin:

- domestic events are dispatched only to domestic event receptors;
- external events are dispatched only to receptors whose first parameter is marked external.

Sources:

- `server/src/main/java/io/spine/server/event/EventBus.java`
- `server/src/main/java/io/spine/server/event/EventDispatcherRegistry.java`
- `server/src/main/java/io/spine/server/event/EventDispatcher.java`

TypeScript implication: event dispatcher lookup must include both message type and external/domestic origin, not only message type.

### ImportBus

`ImportBus` is a unicast bus for aggregate event import. It dispatches domestic events to aggregate repositories that declare the event importable via `@Apply(allowImport = true)`. External events cannot be imported by this path.

Sources:

- `server/src/main/java/io/spine/server/aggregate/ImportBus.java`
- `server/src/main/java/io/spine/server/aggregate/EventImportDispatcher.java`
- `server/src/main/java/io/spine/server/aggregate/Apply.java`

TypeScript implication: event import is not normal event subscription. It should be a distinct API with stricter validation and routing.

## Handler Annotations as Contracts

Java annotations define model metadata. TypeScript should replace these with decorators, static metadata, or registration DSLs that preserve the same contracts. See the [Generated/Runtime Contract](README.md#generatedruntime-contract) for required handler and semantic-tag metadata.

### `@Assign`

A command assignee handles a command and emits event(s). It:

- accepts a command message as first parameter;
- optionally accepts `CommandContext`;
- returns an event, iterable of events, tuple/either/optional event forms;
- may reject by throwing a generated rejection throwable;
- participates in the one-handler-per-command rule.

Source: `server/src/main/java/io/spine/server/command/Assign.java`.

### `@Command`

A command receptor either transforms a command into command(s), or reacts to an event/rejection by emitting command(s).

Allowed first parameters:

- command message for command transformation;
- event message or rejection message for command reaction.

External events and rejections may be accepted by marking the event/rejection parameter with `@External`. External commands are not allowed; `CommanderClass` validates this.

Sources:

- `server/src/main/java/io/spine/server/command/Command.java`
- `server/src/main/java/io/spine/server/command/model/CommanderClass.java`
- `server/src/main/java/io/spine/server/model/ExternalCommandReceiverMethodError.java`

### `@Subscribe`

A subscriber observes command outputs without producing new signals. It returns void and may subscribe to:

- event message plus optional `EventContext`;
- rejection message plus optional original command and command context;
- entity state message marked as entity state.

Field filters with `@Where` are supported for event parameters.

Sources:

- `core/src/main/java/io/spine/core/Subscribe.java`
- `core/src/main/kotlin/io/spine/core/Where.kt`

### `@React`

A reactor handles an event and emits event(s). It may accept:

- event message;
- event message plus `EventContext`;
- rejection message with original command and optional command context.

It may return event, optional event, iterable, tuple, either, or `NoReaction`. `@External` and `@Where` are supported on event parameters.

Source: `server/src/main/java/io/spine/server/event/React.java`.

### `@Apply`

An event applier mutates aggregate state from an event. It is private, void, and accepts one event message. `allowImport = true` marks the event type as importable through `ImportBus`.

Source: `server/src/main/java/io/spine/server/aggregate/Apply.java`.

## Routing

Routing maps signal envelopes to entity IDs. It happens inside dispatchers/repositories, before writing to inbox.

### Route Function Shapes

- `Unicast<I, M, C>` returns one ID.
- `Multicast<I, M, C>` returns `Set<I>`.
- `CommandRoute<I, M>` is unicast over command message and `CommandContext`.
- `EventRoute<I, M>` is multicast over event message and `EventContext`.

Sources:

- `server/src/main/kotlin/io/spine/server/route/Unicast.kt`
- `server/src/main/kotlin/io/spine/server/route/Multicast.kt`
- `server/src/main/kotlin/io/spine/server/route/CommandRoute.kt`
- `server/src/main/kotlin/io/spine/server/route/EventRoute.kt`

### Command Routing

Commands are always routed to a single entity. `CommandRouting.newInstance(idClass)` uses the default route, which reads the first field of the command message and requires it to be assignable to the entity ID type.

Custom routes may be registered per concrete command class or interface. More specific routes must be registered before interface/super-interface routes.

Sources:

- `server/src/main/kotlin/io/spine/server/route/CommandRouting.kt`
- `server/src/main/kotlin/io/spine/server/route/DefaultCommandRoute.kt`
- `server/src/main/kotlin/io/spine/server/route/ByFirstField.kt`

TypeScript implication: default command routing requires descriptor access and runtime type checks. If using generated TS types without descriptors, generate routing metadata from `.proto`; see the [Generated/Runtime Contract](README.md#generatedruntime-contract).

### Event Routing

Events are generally multicast. `EventRouting` can also adapt unicast functions into singleton sets.

Current aggregate repositories initialize event routing and import routing with `withDefaultByProducerIdOrFirstField(idClass)`: try producer ID from `EventContext`, then fall back to first event message field. The class docs also describe producer-ID default as the common repository default.

Sources:

- `server/src/main/kotlin/io/spine/server/route/EventRouting.kt`
- `server/src/main/kotlin/io/spine/server/route/EventRoute.kt`
- `server/src/main/kotlin/io/spine/server/route/ByProducerId.kt`
- `server/src/main/kotlin/io/spine/server/route/ByFirstEventField.kt`
- `server/src/main/kotlin/io/spine/server/route/ByProducerIdOrFirstField.kt`
- `server/src/main/java/io/spine/server/aggregate/AggregateRepository.java`

### MessageRouting Registry

`MessageRouting` keeps a default route plus custom routes. Lookup order:

1. Direct class route.
2. First assignable interface route.
3. Default route.

Interface matches are cached as direct routes for later lookup. The route map is synchronized because it may be read and modified at runtime.

Source: `server/src/main/kotlin/io/spine/server/route/MessageRouting.kt`.

TypeScript implication: route registration order is observable. Use ordered maps and validate route shadowing at registration time.

## Repository Dispatch to Inbox

Repositories do not normally call entity handlers immediately. They route and write inbox messages, returning `DispatchOutcome.sent_to_inbox`.

### Aggregates

`AggregateRepository` registers with `CommandBus`, `EventBus`, and optionally `ImportBus`. Its inbox has:

- `HANDLE_COMMAND` endpoint for `@Assign`/`@Command` command handling;
- `REACT_UPON_EVENT` endpoint for `@React`/event-commanding reactions;
- `IMPORT_EVENT` endpoint for `@Apply(allowImport = true)`.

Dispatch behavior:

- command -> route command -> `inbox.send(command).toHandler(id)`;
- event reaction -> route event -> `inbox.send(event).toReactor(id)` for each target;
- import -> route import event -> `inbox.send(event).toImporter(id)`.

Sources:

- `server/src/main/java/io/spine/server/aggregate/AggregateRepository.java`
- `server/src/main/java/io/spine/server/aggregate/AggregateCommandEndpoint.java`
- `server/src/main/java/io/spine/server/aggregate/AggregateEventReactionEndpoint.java`
- `server/src/main/java/io/spine/server/aggregate/EventImportEndpoint.java`

### Process Managers

`ProcessManagerRepository` inbox has:

- `HANDLE_COMMAND` endpoint;
- `REACT_UPON_EVENT` endpoint.

Commands are routed to zero or one process manager. Events route to a set of process manager IDs and are sent to reactors.

Source: `server/src/main/java/io/spine/server/procman/ProcessManagerRepository.java`.

### Projections

`ProjectionRepository` inbox has:

- `UPDATE_SUBSCRIBER` endpoint for `@Subscribe`;
- `CATCH_UP` endpoint for historical replay.

Projection dispatch sends events to subscribers for routed projection IDs.

Source: `server/src/main/java/io/spine/server/projection/ProjectionRepository.java`.

### Stateful Reactors

`AbstractStatefulReactor` has an inbox with `REACT_UPON_EVENT`. It routes event envelopes to reactor IDs and serializes endpoint access with a lock in local multithreaded mode.

Source: `server/src/main/java/io/spine/server/event/AbstractStatefulReactor.java`.

## Inbox Message Schema

`InboxMessage` is the durable delivery record.

Fields:

- `id`: UUID plus `ShardIndex`;
- `signal_id`: original signal ID transformed with target ID;
- `inbox_id`: target entity ID plus target state type URL;
- payload: event or command;
- `label`: dispatch destination;
- `status`: delivery state;
- `when_received`;
- `version`: internal ordering tie-breaker;
- `keep_until`: deduplication retention deadline.

Labels:

- `HANDLE_COMMAND`: command handler;
- `UPDATE_SUBSCRIBER`: event subscriber;
- `REACT_UPON_EVENT`: event reactor or event-commanding method;
- `IMPORT_EVENT`: aggregate import applier;
- `CATCH_UP`: projection catch-up.

Statuses:

- `TO_DELIVER`;
- `SCHEDULED`;
- `DELIVERED`;
- `TO_CATCH_UP`.

Sources:

- `server/src/main/proto/spine/server/delivery/inbox.proto`
- `server/src/main/java/io/spine/server/delivery/Inbox.java`
- `server/src/main/java/io/spine/server/delivery/InboxPart.java`
- `server/src/main/java/io/spine/server/delivery/InboxOfCommands.java`
- `server/src/main/java/io/spine/server/delivery/InboxOfEvents.java`

TypeScript implication: the inbox table/collection needs indexes on shard, status, received time, version, inbox ID, signal ID, label, and command/event kind. The record ID alone is not the deduplication key.

## Delivery

`Delivery` contains inbox storage, catch-up storage, a sharded work registry, shard observers, a delivery strategy, and deduplication settings.

Source: `server/src/main/java/io/spine/server/delivery/Delivery.java`.

### Sharding

`DeliveryStrategy.determineIndex(entityId, entityStateType)` returns a `ShardIndex`. The default local strategy is a single shard; strategies can spread entities across shards or co-locate related entity types.

`ShardIndex` contains zero-based `index` and `of_total`.

Sources:

- `server/src/main/java/io/spine/server/delivery/DeliveryStrategy.java`
- `server/src/main/proto/spine/server/delivery/delivery.proto`
- `server/src/main/java/io/spine/server/delivery/UniformAcrossAllShards.java`

Invariant: all messages for a given target entity should map to a single shard unless a custom strategy deliberately changes consistency trade-offs.

### Shard Locking

`ShardedWorkRegistry` is a per-shard lock/session registry. `pickUp(index, node)` either returns a session or an already-picked-up outcome. A worker must release the session after processing. Expired sessions can be released by inactivity duration.

Sources:

- `server/src/main/java/io/spine/server/delivery/ShardedWorkRegistry.java`
- `server/src/main/java/io/spine/server/delivery/AbstractWorkRegistry.java`
- `server/src/main/proto/spine/server/delivery/delivery.proto`

TypeScript implication: implement shard pickup with atomic compare-and-set semantics in the backing store. A distributed Node deployment cannot rely on in-process locks.

### Delivery Run

`deliverMessagesFrom(shard)`:

1. Picks up the shard.
2. Reads `InboxStorage` page by page, ordered by `received_at` then `version`.
3. Runs a new `Conveyor` for each page.
4. Runs stations:
   - `MaintenanceStation`;
   - `CatchUpStation`;
   - `LiveDeliveryStation`;
   - `CleanupStation`.
5. Flushes conveyor changes to storage in bulk.
6. Releases the shard lock.
7. Checks for a late `TO_DELIVER` message and notifies observers again.

Sources:

- `server/src/main/java/io/spine/server/delivery/Delivery.java`
- `server/src/main/java/io/spine/server/delivery/InboxStorage.java`
- `server/src/main/java/io/spine/server/delivery/Conveyor.java`

### Ordering

Live messages are deduplicated and then sorted chronologically by:

1. `when_received`;
2. `version`;
3. inbox message UUID.

Storage reads order by `received_at` and `version`; the comparator adds UUID as a final tie-breaker.

Sources:

- `server/src/main/java/io/spine/server/delivery/InboxStorage.java`
- `server/src/main/java/io/spine/server/delivery/InboxMessageComparator.java`
- `server/src/main/java/io/spine/server/delivery/LiveDeliveryStation.java`

TypeScript implication: use a monotonic per-process or per-storage `version` when writing inbox messages at the same timestamp. If distributed writers can share a timestamp, UUID is only a deterministic tie-breaker, not causal ordering.

### Deduplication

Delivery deduplication uses `DispatchingId = (InboxSignalId, InboxId)`, meaning the same original signal to the same target inbox.

Dedup sources:

- duplicates within the same conveyor page;
- messages marked delivered in current conveyor;
- a local `DeliveredMessagesCache` capped at 1,000 entries;
- delivered inbox records kept until `keep_until` when a deduplication window is configured.

When duplicates are detected, the message is removed and the endpoint is notified via `onDuplicate`.

Sources:

- `server/src/main/java/io/spine/server/delivery/DispatchingId.java`
- `server/src/main/java/io/spine/server/delivery/DeliveredMessagesCache.java`
- `server/src/main/java/io/spine/server/delivery/LiveDeliveryStation.java`
- `server/src/main/java/io/spine/server/delivery/Conveyor.java`
- `server/src/main/java/io/spine/server/delivery/TargetDelivery.java`

Aggregate-level idempotency additionally checks aggregate history since the last snapshot for events caused by the same command/event.

Source: `server/src/main/java/io/spine/server/aggregate/IdempotencyGuard.java`.

TypeScript implication: implement both delivery dedup and aggregate idempotency. Delivery dedup prevents repeated endpoint calls; aggregate idempotency protects event-sourced state when delivery/storage races still occur.

### Failures and Retries

Delivery has explicit monitor hooks:

- shard pickup failure;
- shard already picked up;
- reception failure for an endpoint dispatch outcome with error;
- continuation after each `DeliveryStage`.

`TargetDelivery.MonitoringDispatcher` calls `DeliveryMonitor.onReceptionFailure` with a repeat callback. `Delivery.deliverMessagesFrom` similarly delegates shard pickup failures to monitor-provided actions.

Sources:

- `server/src/main/java/io/spine/server/delivery/Delivery.java`
- `server/src/main/java/io/spine/server/delivery/TargetDelivery.java`
- `server/src/main/java/io/spine/server/delivery/DeliveryMonitor.java`
- `server/src/main/java/io/spine/server/delivery/RepeatDispatching.java`

Implementation rule: retries are policy-driven by monitor/failure actions, not implicit infinite loops in handlers.

### Direct and Local Delivery Modes

`Delivery.local()` is synchronous, single-shard, in-memory-lock friendly, and uses a 30-second deduplication window. `localAsync()` dispatches asynchronously. `direct()` skips inbox storage and sharding and is explicitly unsafe for concurrent signal dispatch.

Source: `server/src/main/java/io/spine/server/delivery/Delivery.java`.

TypeScript implication: provide direct mode only for tests/tools with loud warnings. The production path should always go through inbox storage and shard locking.

## Event Enrichment

Event enrichment happens after event storage and before event dispatch.

`EventEnricher` is configured with functions keyed by source event class/interface and enrichment message class. Enrichment is stored in `EventContext.enrichment` as either:

- `do_not_enrich`;
- a container map from enrichment type name to packed `Any`.

If no enrichment function matches, the event is dispatched unchanged.

Sources:

- `core/src/main/proto/spine/core/enrichment.proto`
- `server/src/main/java/io/spine/server/event/EventBus.java`
- `server/src/main/java/io/spine/server/event/EventEnricher.java`
- `server/src/main/java/io/spine/server/enrich/Enricher.java`
- `server/src/main/java/io/spine/server/enrich/EnricherBuilder.java`
- `server/src/main/java/io/spine/server/enrich/Schema.java`

TypeScript implication: enrichment functions should be pure or explicitly side-effect-managed because they run between event store append and dispatch. Do not mutate the stored event record; create an enriched envelope/context for dispatch.

## External Events and Integration Broker

External message exchange is event-oriented.

`IntegrationBroker`:

- registers with a bounded context;
- publishes domestic events requested by other contexts;
- subscribes to external event channels requested by local dispatchers;
- exchanges `BoundedContextOnline` and `ExternalEventsWanted` control messages;
- posts incoming external events into the local `EventBus` with the event context marked external.

Sources:

- `server/src/main/proto/spine/server/integration/broker.proto`
- `server/src/main/java/io/spine/server/integration/IntegrationBroker.java`
- `server/src/main/java/io/spine/server/integration/EventsExchange.java`
- `server/src/main/java/io/spine/server/integration/BusAdapter.java`
- `server/src/main/java/io/spine/server/integration/DomesticEventPublisher.java`
- `server/src/main/java/io/spine/server/integration/IncomingEventObserver.java`

Important constraints:

- `@External` marks receptor parameters for messages originating in another bounded context.
- Events, rejections, and entity states may be external.
- External commands do not travel through this mechanism.
- An event type may be consumed by many contexts but produced by only one context at a time.

Sources:

- `core/src/main/java/io/spine/core/External.java`
- `server/src/main/java/io/spine/server/integration/IntegrationBroker.java`
- `server/src/main/java/io/spine/server/command/Command.java`
- `server/src/main/java/io/spine/server/model/ExternalCommandReceiverMethodError.java`

`ThirdPartyContext` models a non-Spine external system as a bounded context and publishes imported events through the broker. It requires explicit tenant data when multitenant.

Source: `server/src/main/java/io/spine/server/integration/ThirdPartyContext.java`.

TypeScript implication: transport channels should be keyed by event type URL. The incoming path must set `external = true` before bus dispatch so normal domestic handlers do not receive the event accidentally.

## Query and Subscription Delivery

Queries and subscriptions are read-side services, not bus dispatch.

- `QueryService.read(Query)` finds the bounded context by target type and calls `context.stand().execute(query, observer)`.
- `SubscriptionService.subscribe(Topic)` creates a subscription in the relevant `Stand`.
- `activate(Subscription)` streams `SubscriptionUpdate` via a callback.
- `cancel(Subscription)` removes it.
- If no context is found for a subscription target, the JVM implementation creates/cancels the subscription in all known contexts behind one client-visible `Subscription`.

Sources:

- `server/src/main/java/io/spine/server/QueryService.java`
- `server/src/main/java/io/spine/server/SubscriptionService.java`
- `client/src/main/proto/spine/client/query_service.proto`
- `client/src/main/proto/spine/client/subscription_service.proto`
- `client/src/main/proto/spine/client/query.proto`
- `client/src/main/proto/spine/client/subscription.proto`

TypeScript implication: keep read-side query/subscription APIs separate from write-side bus and inbox. Subscription update ordering should follow the stand/read-side update mechanism, not delivery shard ordering unless those updates are themselves produced by delivered events. Preserve opaque subscription IDs for unknown-target fallback and route activation/cancellation through the subscription service.

## Dispatch Outcomes

`DispatchOutcome` records whether a signal:

- succeeded and produced events, commands, or a rejection;
- errored;
- was interrupted;
- was ignored by filters;
- was sent to inbox;
- was published to remote;
- had no route targets.

Batch outcomes preserve signal ordering.

Source: `server/src/main/proto/spine/server/dispatch/dispatching.proto`.

TypeScript implication: endpoints should return structured outcomes rather than throwing for all business outcomes. Throwing should represent unexpected runtime failure; rejection is a domain event.

## Implementation Implications for TypeScript/Node

Minimum components:

- Envelope layer for commands/events with type URL resolution and tenant/origin helpers.
- Command bus as unicast registry with validating/dead/scheduler filters and ack monitor hooks.
- Event bus as multicast registry with event store append-before-dispatch and optional enrichment.
- Import bus for aggregate import events.
- Metadata model for `Assign`, `Command`, `Subscribe`, `React`, `Apply`, `External`, and `Where`.
- Routing registry with default first-field/producer-ID routes, custom class/interface routes, and ordered lookup.
- Durable inbox storage with shard indexes, status, label, target inbox, signal ID, ordering columns, and retention.
- Sharded work registry with atomic pickup/release and expiry.
- Delivery runner with conveyor/station pipeline, deduplication, monitor-controlled retries, and cleanup.
- Integration broker over a pluggable transport keyed by type URL.
- Read-side `Stand` services for query/subscription, separate from write-side bus delivery.

Design cautions:

- Do not bypass inbox delivery for normal server operation; direct mode is only for controlled single-threaded execution.
- Do not dispatch external events to domestic handlers or vice versa.
- Do not treat command ack as handler completion. The bus acknowledges accepted posting before dispatch; immediate ERROR and immediate REJECTION are post-time results, while deeper business rejections are later rejection events represented in system events and dispatch outcomes.
- Do not collapse `signal_id` and inbox message ID. The former is dedup identity; the latter is a delivery record identity.
- Do not use Java reflection assumptions in TypeScript. Generate or register explicit metadata for first fields, entity ID types, message interface tags, handler signatures, query columns, and route ownership.

## Open Questions and Uncertainties

- I found no separate durable outbox abstraction in the inspected 2.0.0 sources. Outbound integration uses `DomesticEventPublisher` plus transport publishers, while local delivery uses `Inbox`. A TypeScript implementation may still choose an outbox for transport reliability, but it would be an implementation addition rather than a directly mirrored Spine concept.
- `ByProducerIdOrFirstField` checks whether the producer-ID route returns an empty set, but `ByProducerId` appears to cast `context.producer()` and return a singleton. The exact behavior when `producer_id` is absent/default should be verified against generated mixins/tests before cloning this fallback literally.
- Delivery retry policy is intentionally monitor-driven. The default monitor behavior should be documented from `DeliveryMonitor` tests before fixing production defaults in TypeScript.
- Interface-based routing and enrichment depend on JVM class/interface reflection. TypeScript needs the generated semantic tags described in the [Generated/Runtime Contract](README.md#generatedruntime-contract), or a constrained decorator DSL that registers equivalent tags.
