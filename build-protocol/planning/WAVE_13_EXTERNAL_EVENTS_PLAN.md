# Wave 13 External Events Plan

## Status and authority

Wave 13 is a **high-risk architecture milestone**. It adds the missing
JVM-equivalent external-event integration subsystem, changes a public handler
declaration contract, imports serialized contracts, and adds a cross-process
transport responsibility. This is the single H-021 requirements-splitting
pass. No product code may precede the committed T-0195 planning package and the
complete committed RED gate in T-0196.

The requirements split is **complete and not blocked; review acceptance is
pending**. The initially demonstrated ZeroMQ single-binder mismatch is resolved
by the human-authorized, adapter-private
per-channel endpoint-directory substitution recorded below. That substitution
does not change broker semantics, public configuration, or the Protobuf wire.
Any implementation need outside the frozen decisions in this document is an
H-004 stop-for-human-direction condition.

Binding authority, in descending order for this milestone:

1. `build-protocol/tasks/T-0195-wave13-external-events/HUMAN_REQUIREMENTS.md`
   (H-001 through H-028), including the original human JVM manifest recorded in
   this plan;
2. `build-protocol/BUILD_PROTOCOL.md`, `AGENTS.md`, and
   `build-protocol/PROJECT_COMPLETION_PLAN.md`;
3. accepted decisions in `build-protocol/DECISION_LOG.md`;
4. `build-protocol/TECHNICAL_SPEC.md`,
   `build-protocol/RUNTIME_ARCHITECTURE.md`, and
   `build-protocol/DEVELOPER_API.md`;
5. `build-protocol/planning/AGENTIC_REVIEW_REMEDIATION_PLAN.md` only where it
   does not conflict with the live human ledger. Its older broker Inbox,
   retry, replay, deduplication, and restart language is superseded by H-019.

## Immutable baselines and source corpus

- TypeScript baseline: `d6287ae8f2219ea8b71811230289a64226b4a127` from
  live `origin/main`.
- JVM baseline: `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc` at
  `/tmp/spine-core-jvm-wave13.Ry7RKr`.
- Runtime notes read in full:
  `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` and
  `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`.
- Accepted decisions applied: D-0032, D-0035, D-0036, D-0037, D-0048,
  D-0049, D-0052, D-0054, D-0059, D-0060, D-0064, D-0075, D-0085,
  D-0088, D-0089, D-0091, D-0092, D-0093, D-0094, D-0099, D-0109,
  D-0112, and D-0113. D-0099 supersedes D-0070's instance-based
  `ServerEnvironment` choice with the accepted singleton. D-0064 remains valid
  for local runtime signal intake; it does not grant `ContextTransport`
  authority over the integration broker.

### Exact pinned JVM production paths

All of the following were read completely at the pinned commit.

Integration:

- `server/src/main/java/io/spine/server/integration/IntegrationBroker.java`
- `server/src/main/java/io/spine/server/integration/AbstractExchange.java`
- `server/src/main/java/io/spine/server/integration/SingleChannelExchange.java`
- `server/src/main/java/io/spine/server/integration/TransportLink.java`
- `server/src/main/java/io/spine/server/integration/StatusExchange.java`
- `server/src/main/java/io/spine/server/integration/ConfigExchange.java`
- `server/src/main/java/io/spine/server/integration/EventsExchange.java`
- `server/src/main/java/io/spine/server/integration/BusAdapter.java`
- `server/src/main/java/io/spine/server/integration/DomesticEventPublisher.java`
- `server/src/main/java/io/spine/server/integration/IncomingEventObserver.java`
- `server/src/main/java/io/spine/server/integration/ObserveWantedEvents.java`
- `server/src/main/java/io/spine/server/integration/BroadcastWantedEvents.java`
- `server/src/main/java/io/spine/server/integration/AbstractChannelObserver.java`
- `server/src/main/java/io/spine/server/integration/ExternalMessages.java`
- `server/src/main/java/io/spine/server/integration/ExternalEventTypeMixin.java`
- `server/src/main/java/io/spine/server/integration/ThirdPartyContext.java`

Transport:

- `server/src/main/java/io/spine/server/transport/TransportFactory.java`
- `server/src/main/java/io/spine/server/transport/MessageChannel.java`
- `server/src/main/java/io/spine/server/transport/AbstractChannel.java`
- `server/src/main/java/io/spine/server/transport/Publisher.java`
- `server/src/main/java/io/spine/server/transport/Subscriber.java`
- `server/src/main/java/io/spine/server/transport/ChannelHub.java`
- `server/src/main/java/io/spine/server/transport/PublisherHub.java`
- `server/src/main/java/io/spine/server/transport/SubscriberHub.java`
- `server/src/main/java/io/spine/server/transport/memory/InMemoryTransportFactory.java`
- `server/src/main/java/io/spine/server/transport/memory/InMemoryPublisher.java`
- `server/src/main/java/io/spine/server/transport/memory/InMemorySubscriber.java`

Context and model:

- `server/src/main/java/io/spine/server/BoundedContext.java`
- `server/src/main/java/io/spine/server/ServerEnvironment.java`
- `server/src/main/java/io/spine/server/event/EventDispatcher.java`
- `server/src/main/java/io/spine/server/event/EventDispatcherRegistry.java`
- `server/src/main/java/io/spine/server/event/EventDispatcherDelegate.java`
- `server/src/main/java/io/spine/server/event/AbstractEventSubscriber.java`
- `server/src/main/java/io/spine/server/event/AbstractEventReactor.java`
- `server/src/main/java/io/spine/server/command/AbstractCommander.java`
- `server/src/main/java/io/spine/server/model/ExternalAttribute.java`
- `server/src/main/java/io/spine/server/model/Receptor.java`
- `server/src/main/java/io/spine/server/model/SignalOriginMismatchError.java`
- `server/src/main/java/io/spine/server/model/ExternalCommandReceiverMethodError.java`
- `core/src/main/java/io/spine/core/External.java`
- `core/src/main/java/io/spine/core/Events.java` (`Events.toExternal()`).

Exact Protobuf sources:

- `server/src/main/proto/spine/server/integration/broker.proto`, SHA-256
  `76a3b965391d989d32a1a6dbc84a4465d2f8f2386be7ed266fd201483dc9865d`.
- `server/src/main/proto/spine/server/transport/transport.proto`, SHA-256
  `92df339007d7dda01a6df5b87c38d988bfedebabd6ac28eb7fbb874bcd5f73bd`.
- `core/src/main/proto/spine/core/event.proto`, SHA-256
  `0c385d3fd98d68d35ce1d7887bd564b590daba47b959b99d205c2be56a737d29`.
  The current TS copy is byte-identical despite its older manifest commit
  attribution.

Exact required tests:

- `server/src/test/java/io/spine/server/integration/IntegrationBrokerTest.java`
- `server/src/test/java/io/spine/server/integration/DomesticEventPublisherTest.java`
- `server/src/test/java/io/spine/server/integration/ExternalMessagesTest.java`
- `server/src/test/java/io/spine/server/integration/ThirdPartyContextTest.java`
- `server/src/test/java/io/spine/server/model/ExternalAttributeTest.java`

Exact fixtures read:

- `server/src/testFixtures/java/io/spine/server/integration/given/broker/{IntegrationBrokerTestEnv,BillingAggregate,PhotosAggregate,SubscribedBillingAggregate,SubscribedPhotosAggregate,SubscribedStatisticsAggregate,SubscribedWarehouseAggregate}.java`
- `server/src/testFixtures/java/io/spine/server/integration/given/{DocumentRepository,DocumentAggregate,EditHistoryRepository,EditHistoryProjection}.java`
- `server/src/testFixtures/java/io/spine/server/model/given/external/{TestCommander,TestReactor,TestSubscriber}.java`
- `server/src/testFixtures/proto/spine/test/integration/broker/{commands,entities,events}.proto`
- `server/src/testFixtures/proto/spine/test/integration/{commands,doc_commands,doc_events,docs,entities,events,identifiers,integration_rejections,photos_commands,photos_events}.proto`
- `server/src/testFixtures/proto/spine/test/model/external/events.proto`

## Complete human-ledger disposition

The exact requirement text remains immutable in `HUMAN_REQUIREMENTS.md`; this
table makes every row operational and prevents later task briefs from weakening
it.

| ID    | Plan disposition                                                                                                           | Owning proof/gate                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| H-001 | Preserve the pinned JVM integration concepts and observable behavior through the responsibility and substitution matrices. | six-column ledger; RED-01–22                        |
| H-002 | Use deep TS modules and composition; do not port abstract Java ceremony.                                                   | architecture/style review                           |
| H-003 | Every substitution is frozen with mismatch, seam, invariant, visibility and proof; add no unlisted policy/surface.         | six-column ledger; H-004 audit                      |
| H-004 | Stop on any unlisted architectural, public, or serialized need.                                                            | stop conditions; implementation work logs           |
| H-005 | Work remains in the isolated Wave 13 worktree; primary checkout and human state are immutable.                             | startup/final status evidence                       |
| H-006 | TS/JVM SHAs and every mandatory pinned path/checksum are recorded above.                                                   | T-0195 records; source verification                 |
| H-007 | Only genuine broker same/cross-process behavior counts; all shortcut scans are explicit.                                   | RED-01 and RED-22                                   |
| H-008 | Preserve ContextTransport authority; migrate only reusable private adapter pieces; no SignalTransport broker dependency.   | dependency scan; transport disposition              |
| H-009 | One internal broker is built, registered, and closed by every Bounded Context.                                             | T-0200; RED-18                                      |
| H-010 | ServerEnvironment supplies typed message TransportFactory; memory is test/local default and production is explicit.        | T-0197a/T-0198/T-0200; RED-21/22                    |
| H-011 | Status, config and event exchanges remain distinct with all specified transitions.                                         | behavior matrix; RED-05–13                          |
| H-012 | Copy the exact three pinned Proto contracts and use only Protobuf broker frames.                                           | serialized intake; RED-14                           |
| H-013 | Domestic default, first-parameter external origin, valid event/rejection/state kinds, and invalid external commands.       | metadata decision; RED-17/19/20                     |
| H-014 | Extend only the generated-handler pipeline and origin-aware dispatcher metadata/filtering.                                 | T-0197b; RED-03/04/19                               |
| H-015 | Install only requested domestic publishers; preserve order, removal, complete Event and EventId.                           | RED-05/07/08/09/13                                  |
| H-016 | Validate/unpack, use existing explicit tenant seam, set only external, and post the ordinary domain EventBus.              | RED-14/15/16                                        |
| H-017 | Prevent loops solely through origin filtering and domestic publication.                                                    | RED-06; forbidden-concept scan                      |
| H-018 | Document many consumers/one domain producer; add no ownership enforcement/election.                                        | API/docs review; RED-02                             |
| H-019 | Transport owns best-effort delivery; no broker Inbox/retry/dedup/replay/fencing.                                           | architecture/reliability scan and review            |
| H-020 | Include the exact public JVM ThirdPartyContext semantics; no alternate abstraction.                                        | T-0200; RED-20                                      |
| H-021 | This is the one requirements-splitter high-risk pass, explicit role/profile, no children, and no product code.             | requirements-splitter report                        |
| H-022 | Persist every named planning deliverable in the T-0195 package.                                                            | this plan and report                                |
| H-023 | Commit all 22 genuine failing-before cases before product changes.                                                         | T-0196 RED log/checkpoint                           |
| H-024 | Parallelize only disjoint contracts/transport, metadata/filtering and harness work; serialize listed shared seams.         | dependency graph; ownership table; stream log       |
| H-025 | Use focused development, one specialist wave/batch, stable docs, one release verify and at least 90% line/branch.          | T-0202 convergence gate                             |
| H-026 | Enforce every explicit exclusion with dependency/symbol/diff scans.                                                        | stop/exclusion section; final audit                 |
| H-027 | Push checkpoints/main and finish remote/tag reconciliation to only origin/main, no tags.                                   | T-0202 remote closure                               |
| H-028 | Continue autonomously through acceptance/review/release/merge/push/cleanup unless a declared blocker occurs.               | orchestrator work log and terminal closure evidence |

## Frozen architecture decisions

1. Every `BoundedContext` owns exactly one internal `IntegrationBroker`. The
   builder constructs it from `ServerEnvironment.instance().transportFactory`,
   initialization registers event interests and exchanges, and context close
   closes the broker. Applications neither construct nor manage it.
2. Status, configuration, and event exchanges remain distinct responsibilities
   even when related TypeScript helpers share a file. Status and config each use
   the singleton `ChannelId` derived from their exact message type. Events use
   one `ChannelId` per wanted event type.
3. A narrow `TransportFactory`/message-channel SPI is the JVM-equivalent public
   infrastructure extension. Its exact public Node signatures are frozen below.
   Broker modules see `ChannelId`, `Publisher`, and `Subscriber` behavior only.
   They never see `SignalTransport`, routing plans, signal kinds, subscriber IDs,
   request/respond, sockets, manifests, or paths. Publisher/subscriber hubs stay
   private because they are broker channel caches rather than application SPI.
4. Local/test environments default the new facility to an in-memory factory.
   Production resolution fails unless the application supplies it, just as it
   already must supply storage and signal transport. The setting is the JVM
   `TransportFactory` concept, not a new broker policy.
5. The existing `ContextTransport`, `RuntimeTransportBinding`, and
   `SignalTransport` continue to own command/event runtime intake only. No
   broker code imports them. Reusable secure-directory, endpoint, close, and
   native ZeroMQ implementation pieces may be migrated behind the distinct
   message-channel adapter.
6. Exact `ExternalMessage` Protobuf binary is the only broker frame. JSON and
   V8 serialization are forbidden. The adapter-private endpoint manifest is
   resource-discovery metadata, not a message frame or durable broker record.
7. TS declares origin with the smallest faithful public port of JVM's public
   `@External`: transparent type-only alias `type External<T> = T` on the
   **first receptor parameter type**. It has no runtime value or brand and is
   assignable exactly as `T`. The build-time analyzer recognizes a direct import
   or local import alias whose TypeScript symbol resolves to the canonical
   server-package declaration; arbitrary lookalikes and unrelated re-exports are
   rejected. It unwraps `T` for schema inference and emits
   `origin: "external"`; absent marker emits `origin: "domestic"`. A compiling
   fixture proves parameter assignability and generated-schema agreement. No
   runtime registration DSL is added.
8. Generated handler registry version advances atomically. Analyzer, writer,
   ingestor, canonical metadata, tests, declarations, and generated fixtures
   change in one owner-controlled task. Old generated registry versions receive
   their existing deterministic unsupported-version failure; no dual-version
   compatibility policy is invented for this unreleased snapshot.
9. `EventDispatcher` exposes domestic and external event schema sets.
   EventBus/registry coarse selection and repository handler selection both
   honor `EventContext.external`: domestic reaches only domestic handlers;
   imported reaches only external handlers. A repository with mixed-origin
   handlers for the same type must filter per handler, not only per dispatcher.
10. External commands are a model error. `External<Command>` on `@Assign` or a
    command-consuming `@Command` produces the TS equivalent of
    `ExternalCommandReceiverMethodError`. `External<Event>` and external
    rejection inputs are valid for `@Subscribe`, `@React`, and event-consuming
    `@Command`.
11. State-subscription metadata accepts the same external marker because the
    current TS model supports `state-subscription`. Wave 13 does not transport
    Entity state through the event broker: the marker filters state updates at
    their existing `EntityStateChanged` EventContext origin path. Wave 13 proves
    that domestic state updates do not reach an external state receptor, but it
    makes no positive cross-context external-state delivery claim. Creating an
    external-state wire or routing state as a domain Event is forbidden; any
    positive remote-state delivery belongs to the later subscription-parity
    owner.
12. Incoming event intake unpacks `ExternalMessage.original_message` as the
    complete `Event`, validates required wrapper identity/origin and the event,
    obtains the existing explicit tenant from the Event origin, validates it
    through `TenantBoundary`, copies the Event with only
    `EventContext.external = true`, and calls the ordinary domain `EventBus`.
    No global or second `AsyncLocalStorage` tenant context is introduced.
13. Producer registration is reference-counted by requesting Bounded Context.
    Each received complete wanted document atomically replaces that origin's
    previous set. A private serialized transition queue protects map/channel
    state across asynchronous create/remove work; overlapping duplicate,
    replacement, and withdrawal callbacks expose no intermediate set. On setup
    failure the prior requester set remains authoritative and acquired resources
    are cleaned up before the sanitized error is reported. The first request for
    a type installs one domestic publisher; further requests add references;
    withdrawal removes only that requester; the last withdrawal unregisters the
    publisher. It never observes external events.
14. Event wrapper identity is exact: `ExternalMessage.id` is the original
    `Event.id` packed as `Any`, `original_message` packs the complete Event, and
    `bounded_context_name` is the origin context. Non-event exchange messages
    use a generated UUID packed as `StringValue`, matching JVM meaning.
15. Self-origin and paired system/domain context traffic are ignored. Loop
    prevention is only domestic publication plus imported/external receptor
    filtering. There is no hop counter, origin ledger, Inbox, retry, replay,
    deduplication, cursor, fencing, or election.
16. Many consumers and one domain producer per event type at a time is a
    documented limitation, not runtime ownership enforcement. Transport may
    have many publishers for status/config. No producer lease or election is
    added.
17. `ThirdPartyContext` is **included** because JVM exposes it publicly and the
    original manifest requires it. It is the sole third-party import API:
    a hidden single/multitenant Bounded Context with system events forgotten,
    explicit `ActorContext`, tenant required/forbidden validation, and JVM
    `EventFactory.forImport` meaning. The imported Event producer ID packs that
    hidden context's `BoundedContextName`; publication uses its broker;
    consumers deliver only to external receptors; close closes the hidden
    context. No alternate gateway or generic import abstraction is introduced.

### Frozen public TypeScript contracts

The transport package exports `MessageChannel`, `Publisher`, `Subscriber`,
`ExternalMessageConsumer`, `ConsumerHandle`, and `TransportFactory` from its
root. Promise-returning creation, publication, consumer attachment/removal, and
close replace JVM synchronous I/O/`Ack`/`StreamObserver`/`AutoCloseable` without
changing their meaning:

```ts
type ExternalMessageConsumer = (message: ExternalMessage) => void | Promise<void>;
interface ConsumerHandle {
  close(): Promise<void>;
}
interface MessageChannel {
  readonly id: ChannelId;
  readonly targetType: string;
  isStale(): boolean;
  close(): Promise<void>;
}
interface Publisher extends MessageChannel {
  publish(id: Any, message: ExternalMessage): Promise<void>;
}
interface Subscriber extends MessageChannel {
  addConsumer(consumer: ExternalMessageConsumer): Promise<ConsumerHandle>;
}
interface TransportFactory {
  createPublisher(id: ChannelId): Promise<Publisher>;
  createSubscriber(id: ChannelId): Promise<Subscriber>;
  close(): Promise<void>;
}
```

`ConsumerHandle.close()` is idempotent and is the Node substitution for JVM
`removeObserver`; subscriber close completes/removes all consumers. The types,
generated `ChannelId`/`ExternalMessage` dependencies, root imports, emitted
declarations, structural third-party implementation, and async error/close
behavior receive compile/import tests. JVM `ChannelHub`, `PublisherHub`, and
`SubscriberHub` are deliberately private: they implement broker-owned caching
and expose no application-facing capability beyond this SPI.

The server package exports `External<T>` and `ThirdPartyContext` from its root.
The exact third-party surface is:

```ts
class ThirdPartyContext {
  static singleTenant(name: string): Promise<ThirdPartyContext>;
  static multitenant(name: string): Promise<ThirdPartyContext>;
  emittedEvent(event: Message, actor: ActorContext): Promise<void>;
  emittedEvent(event: Message, actor: UserId): Promise<void>;
  isOpen(): boolean;
  close(): Promise<void>;
}
```

Async factories/emit/close replace JVM synchronous construction and channel I/O.
Both overloads retain JVM validation: the `UserId` form is single-tenant only;
the `ActorContext` form requires a tenant exactly for multitenant and forbids it
for single-tenant. Name validation, post-close rejection, imported producer and
actor identity, root imports, declarations, TSDoc, and API inventory are tested.

## Adapter-private cross-process channel substitution

The existing ZeroMQ `SignalTransport` binds one publisher socket for one topic,
which cannot support every process publishing the same status/config channel;
it also encodes only command/event as Protobuf and uses V8 serialization for
other kinds. It is therefore preserved for its existing authority and is not
wrapped as the broker transport.

The authorized `TransportFactory` ZeroMQ implementation uses the existing
public `ZeroMqConfig` (`ipcDirectory`, `adapterIdentity`) without adding public
settings:

- derive a private channel directory from SHA-256 of the complete canonical
  `ChannelId.target_type`; never put a raw type URL in a filesystem name;
- one `Subscriber` binds one unique PULL IPC endpoint and only then atomically
  publishes a bounded mode-0600 manifest under the channel directory;
- adapter startup and every `publish()` perform one size-bounded manifest scan,
  reconcile the publisher cache to the exact live endpoint/generation set, close
  removed/replaced/expired entries, and retain one dedicated PUSH connection per
  live subscriber endpoint. Publishing fans the same Protobuf bytes once to
  every discovered endpoint, so PUSH load balancing never substitutes for
  fan-out; late join and crash/restart cache eviction are native test cases;
- separate publishers may connect to the same PULL endpoints, permitting every
  process to publish status/config; the domain restriction remains one event
  producer at a time;
- preserve FIFO for each publisher-to-subscriber pair. No global ordering
  between different publishers is claimed. The one domain producer rule makes
  per-event-type order equivalent to JVM observable order;
- `publish()` attempts every currently discovered endpoint even when one setup
  or send fails, then resolves only after every healthy PUSH send is accepted
  locally or rejects with one sanitized aggregate failure after all attempts.
  One dead and one live endpoint is a conformance case. It does not claim remote
  acknowledgment, durability, retry, or replay;
- bind-before-manifest prevents discovery of an unready subscriber;
  manifest-removal-before-socket-close prevents new discovery during normal
  shutdown; in-flight close is drained through existing retryable close
  conventions. Publisher cache reconciliation is also the deterministic sweep
  trigger for subscribers created after that publisher;
- startup and each discovery sweep reject and remove bounded malformed,
  symlinked, escaped, dead-owner, expired-owner, or missing-socket manifests.
  Owner heartbeat/expiry and reconnect are fixed, adapter-private resource
  lifecycle—not public policy and not broker persistence;
- use the existing 0700, effective-user-owned, no-final-symlink IPC-directory
  boundary; manifest input is size-bounded, schema-checked, and never included
  in application diagnostics verbatim;
- subscriber observer count determines `isStale`; removing the last observer
  removes the manifest and socket. Hubs close stale channels and aggregate
  close failures without hiding later cleanup;
- late startup is recovered by the protocol itself: config/status subscribers
  exist before online publication; a new online message makes existing peers
  rebroadcast complete wanted documents.

If implementation proves that dedicated PUSH-to-PULL cannot retain first-send
delivery through the required bind/connect lifecycle without adding an
acknowledgment protocol or new public setting, stop under H-004. Do not silently
add an ack frame, proxy, peer-election protocol, or durability claim.

## Behavior and responsibility matrix

| Behavior                      | Owner                                     | Input/state                                   | Required effect                                                                             | Explicit non-owner / exclusion                  | Proof                            |
| ----------------------------- | ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------- |
| Context integration lifecycle | `BoundedContext` + internal broker        | built context, environment factory            | create once, register after buses, close with context                                       | application singleton; `Server` transport group | RED-18 and lifecycle integration |
| Online discovery              | status exchange                           | `BoundedContextOnline`                        | ignore self/paired; trigger unconditional wanted resend                                     | event routing plan                              | RED-10/11                        |
| Wanted configuration          | config exchange                           | complete `ExternalEventsWanted` by origin     | equality suppress ordinary rebroadcast; track requester references; withdraw empty on close | deltas, election, persistence                   | RED-07/08/09/12                  |
| Domestic publication          | event exchange + domestic publisher       | locally posted non-external Event             | only requested types; wrap full Event once; ordered dispatch                                | global forward-all; external Event              | RED-02/05/06/13                  |
| External reception            | incoming observer + domain EventBus       | exact `ExternalMessage` containing Event      | validate, tenant-scope, set external, ordinary post                                         | direct repository invocation; ContextTransport  | RED-14/15/16                     |
| Receptor classification       | generated handler pipeline                | first parameter `External<T>` or unmarked `T` | immutable domestic/external metadata and validation                                         | reflection/runtime DSL                          | RED-03/04/17/19/20               |
| Loop prevention               | metadata + producer selection             | cyclic topology                               | imported events reach external receptors and never republish                                | hop count, origin history, Inbox                | RED-06                           |
| Message channels              | `TransportFactory` adapter                | `ChannelId`, `ExternalMessage`                | typed publishers/subscribers, fan-out, staleness, close                                     | broker retry/dedup                              | RED-01/18/21/22                  |
| Tenant boundary               | existing `TenantBoundary`/repository path | tenant from complete Event origin             | single/multitenant validation and isolation                                                 | new global tenant state                         | RED-15                           |
| Third-party import            | public `ThirdPartyContext`                | generated event + explicit actor context      | JVM-equivalent import identity and broker publication                                       | alternate gateway                               | RED-20                           |
| System/domain separation      | distinct current buses                    | imported domain Event                         | post domain EventBus only; paired system traffic ignored                                    | merge buses                                     | RED-16/20                        |

## Complete six-column JVM-to-TypeScript substitution ledger

| JVM responsibility                              | JVM mechanism                                                              | Node/TS substitution                                                                                                                                                                              | Why needed                                                                                                                        | Preserved invariants                                                                                                                    | Behavioral proof     |
| ----------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `integration/IntegrationBroker.java`            | context-owned coordinator; constructs hubs/exchanges; register/close order | internal `integration/integration-broker.ts`, owned by context                                                                                                                                    | `context/bounded-context.ts` has no broker                                                                                        | one per context; no application singleton/public broker                                                                                 | RED-01/18            |
| `AbstractExchange.java`                         | shared context/hub ownership                                               | deeper private exchange helpers, not a ceremony port                                                                                                                                              | no integration exchange base                                                                                                      | ownership and close remain visible                                                                                                      | exchange unit tests  |
| `SingleChannelExchange.java`                    | one canonical channel per exchange                                         | private status/config helper over `ChannelId`                                                                                                                                                     | no message channels                                                                                                               | exact singleton channel identity                                                                                                        | RED-10/11/14         |
| `TransportLink.java`                            | binds subscriber observers and publisher                                   | direct typed composition inside each exchange; no separate TS link class                                                                                                                          | no equivalent                                                                                                                     | observer attach/remove and close ordering                                                                                               | RED-18/21            |
| `StatusExchange.java`                           | observe/publish online; online triggers wanted resend                      | internal `integration/status-exchange.ts`                                                                                                                                                         | no discovery                                                                                                                      | self/paired ignore; unconditional resend                                                                                                | RED-10/11            |
| `ConfigExchange.java`                           | complete wanted docs; first/last producer registration; withdrawal         | internal `integration/config-exchange.ts`                                                                                                                                                         | readiness metadata is local only                                                                                                  | complete documents, equality suppression, requester refs                                                                                | RED-07/08/09/12      |
| `EventsExchange.java`                           | channel per type; subscribe external interests; publish requested domestic | internal `integration/events-exchange.ts`                                                                                                                                                         | EventBus has no broker                                                                                                            | full Event, type channels, no external republish                                                                                        | RED-01/02/05/06/13   |
| `BusAdapter.java`                               | broker-facing local EventBus adapter; imports via `toExternal`             | private broker bus adapter using existing EventBus methods                                                                                                                                        | `bus/event-bus.ts` posts but has no origin-aware adapter                                                                          | ordinary EventBus, system bus stays separate                                                                                            | RED-16               |
| `DomesticEventPublisher.java`                   | EventDispatcher for domestic requested type                                | internal dispatcher with domestic schema set and unregister handle                                                                                                                                | dispatcher has only `messageSchemas`                                                                                              | requested only, domestic only, ordered                                                                                                  | RED-05/07/09/13      |
| `IncomingEventObserver.java`                    | unpack full Event, tenant runner, BusAdapter dispatch                      | private observer validates Event/tenant then posts domain bus                                                                                                                                     | runtime transport can post Event but is unauthorized                                                                              | exact tenant and identity, external flag only mutation                                                                                  | RED-14/15/16         |
| `ObserveWantedEvents.java`                      | synchronized type-to-context references; first add/last remove             | private map/set owned by config exchange                                                                                                                                                          | no requester registry                                                                                                             | idempotent references; no election                                                                                                      | RED-07/08/09         |
| `BroadcastWantedEvents.java`                    | immutable last complete set; suppress unchanged; force send                | private complete-set broadcaster                                                                                                                                                                  | no broadcast owner                                                                                                                | complete doc; force resend on online                                                                                                    | RED-10/11/12         |
| `AbstractChannelObserver.java`                  | ignore same and paired system/domain origin                                | private validated observer base/helper                                                                                                                                                            | no integration observer                                                                                                           | exact origin filtering, completion state                                                                                                | RED-06/16/18         |
| `ExternalMessages.java`                         | wraps Event/wanted/online with exact IDs and context                       | internal `integration/external-messages.ts` using generated proto                                                                                                                                 | no wrapper                                                                                                                        | full original Event/EventId; UUID for non-event                                                                                         | RED-14               |
| `ExternalEventTypeMixin.java`                   | type URL value helper                                                      | reuse core `TypeUrls`; tiny internal conversion only                                                                                                                                              | `TypeUrls` exists                                                                                                                 | `type.spine.io`, no new token                                                                                                           | RED-14               |
| `ThirdPartyContext.java`                        | public single/multitenant import context with actor validation             | public `ThirdPartyContext` faithful to JVM                                                                                                                                                        | no import API; D-0075 removed aggregate import                                                                                    | explicit actor/tenant, broker only, close                                                                                               | RED-20               |
| `transport/TransportFactory.java`               | creates publishers/subscribers by ChannelId; close                         | public JVM-equivalent message `TransportFactory` setting                                                                                                                                          | `SignalTransport` is routing-plan-shaped                                                                                          | no routing/subscriber/request concepts in broker                                                                                        | RED-21/22            |
| `MessageChannel.java`                           | ID, stale, target type, close                                              | narrow channel interfaces and canonical ChannelId helper                                                                                                                                          | no exact channel                                                                                                                  | type URL identity and lifecycle                                                                                                         | RED-18/21            |
| `AbstractChannel.java`                          | common immutable ChannelId                                                 | composition/value helper, no abstract-class port                                                                                                                                                  | no exact base                                                                                                                     | immutable identity                                                                                                                      | transport unit tests |
| `Publisher.java`                                | publishes `ExternalMessage` with ID/Ack                                    | typed async publisher; Promise settlement defined above                                                                                                                                           | signal publisher accepts Event/Command only                                                                                       | exact Protobuf, local send success only                                                                                                 | RED-13/14/21/22      |
| `Subscriber.java`                               | observer set, stale when empty, fan-out, complete on close                 | typed subscriber with internal consumer handles                                                                                                                                                   | signal subscription binds one handler/id                                                                                          | add/remove, fan-out, stale, completion                                                                                                  | RED-18/21            |
| `ChannelHub.java`                               | channel cache, IDs, stale cleanup, aggregate close                         | private broker-owned generic hub; factory only creates channels                                                                                                                                   | no channel hub                                                                                                                    | one local object per ID; cleanup all                                                                                                    | RED-18/21            |
| `PublisherHub.java`                             | caches typed publishers                                                    | private publisher hub                                                                                                                                                                             | no exact hub                                                                                                                      | stable channel reuse                                                                                                                    | RED-07/09/21         |
| `SubscriberHub.java`                            | caches typed subscribers                                                   | private subscriber hub                                                                                                                                                                            | no exact hub                                                                                                                      | complete wanted set derives from live IDs                                                                                               | RED-07/12/21         |
| `memory/InMemoryTransportFactory.java`          | factory-shared subscriber multimap                                         | distinct in-memory message factory                                                                                                                                                                | local signal transport carries route operations                                                                                   | same-process fan-out, no wire shortcut                                                                                                  | RED-21               |
| `memory/InMemoryPublisher.java`                 | synchronous fan-out, never stale                                           | async facade over factory-owned fan-out                                                                                                                                                           | no exact publisher                                                                                                                | same message to each live subscriber                                                                                                    | RED-21               |
| `memory/InMemorySubscriber.java`                | observer semantics from Subscriber                                         | shared subscriber implementation                                                                                                                                                                  | no exact subscriber                                                                                                               | observer/stale/close parity                                                                                                             | RED-21               |
| `TransportFactory` production adapter           | supplies independent typed channels and owns delivery                      | `packages/transport/src/zeromq/message-transport.ts` uses the authorized private channel directory: unique manifest-backed PULL per subscriber and dedicated cached PUSH per publisher/subscriber | `packages/transport/src/zeromq/signal-transport.ts` binds one publisher/topic and cannot carry exact non-signal `ExternalMessage` | fan-out, many status/config publishers, FIFO per pair, exact Protobuf, private discovery/cleanup; no new public config or broker policy | RED-21/22            |
| `server/BoundedContext.java`                    | owns broker; registers external dispatchers; closes broker                 | construct/register/close internal broker in existing builder lifecycle                                                                                                                            | `bounded-context.ts` owns buses/stands/inboxes only                                                                               | builder remains assembly root; domain/system buses distinct                                                                             | RED-01/18            |
| `server/ServerEnvironment.java`                 | owns configured transport factory; test default; close                     | add message `transportFactory` facility and close ownership                                                                                                                                       | environment owns only `SignalTransport`                                                                                           | production explicit; local memory default; singleton lifecycle                                                                          | RED-18/21/22         |
| `event/EventDispatcher.java`                    | domestic/external sets                                                     | add immutable domestic/external schema sets                                                                                                                                                       | current interface has one `messageSchemas` set                                                                                    | origin-aware discovery and filtering                                                                                                    | RED-03/04/05         |
| `event/EventDispatcherRegistry.java`            | selects dispatcher by type and `context.external`                          | index separate domestic/external type sets for coarse selection, then repository filters each handler                                                                                             | registry keys only type URL                                                                                                       | domestic/external exclusivity                                                                                                           | RED-03/04/06         |
| `event/EventDispatcherDelegate.java`            | delegates separate event sets                                              | deepen existing repository dispatcher                                                                                                                                                             | no delegate type; repository composes dispatch                                                                                    | no new public delegate class                                                                                                            | RED-03/04            |
| `event/AbstractEventSubscriber.java`            | reports domestic/external event classes                                    | generated metadata/readiness exposes origin sets                                                                                                                                                  | generated subscriptions lack origin                                                                                               | fan-out preserved                                                                                                                       | RED-03/04/20         |
| `event/AbstractEventReactor.java`               | reports domestic/external event classes                                    | same generated origin field                                                                                                                                                                       | generated reactions lack origin                                                                                                   | reaction output semantics unchanged                                                                                                     | RED-03/04/20         |
| `command/AbstractCommander.java`                | event-consuming command methods may be external                            | analyzer classifies command-input vs event/rejection-input before origin validation                                                                                                               | generated command reaction lacks input-origin distinction                                                                         | external commands invalid; external event command valid                                                                                 | RED-17/20            |
| `model/ExternalAttribute.java`                  | first Java parameter annotation determines origin                          | canonical public type marker `External<T>` analyzed at build time                                                                                                                                 | standard TS has no parameter decorator seam                                                                                       | first parameter only, compile-time metadata                                                                                             | RED-19/20            |
| `model/Receptor.java`                           | origin predicates and validation                                           | immutable `origin` on canonical handler metadata                                                                                                                                                  | no origin field                                                                                                                   | domestic default                                                                                                                        | RED-03/04/17         |
| `model/SignalOriginMismatchError.java`          | rejects origin/type mismatch                                               | stable analyzer/ingestion diagnostic and runtime invariant error                                                                                                                                  | no equivalent diagnostic                                                                                                          | fail early, no silent fallback                                                                                                          | RED-17/19            |
| `model/ExternalCommandReceiverMethodError.java` | external command receiver invalid                                          | specific build diagnostic/code                                                                                                                                                                    | no external syntax                                                                                                                | no external command execution                                                                                                           | RED-17               |
| `core/External.java`                            | public marker on first receptor param; events/rejections/states allowed    | exported `External<T>` type-only marker                                                                                                                                                           | no marker                                                                                                                         | public only because JVM exposes concept                                                                                                 | RED-19/20            |
| `core/Events.java#toExternal`                   | copies Event and sets context.external                                     | private `toExternalEvent()` helper in `packages/server/src/integration/external-messages.ts`                                                                                                      | no helper; direct cloning exists                                                                                                  | complete Event preserved; one flag changed                                                                                              | RED-14/16            |
| `broker.proto`                                  | exact integration messages and validation options                          | byte-copy to proto package, manifest, generate/export                                                                                                                                             | absent                                                                                                                            | exact fields/reserved/type prefix                                                                                                       | RED-14               |
| `transport.proto`                               | exact `ChannelId.target_type = 1`                                          | byte-copy/generate; infrastructure export only                                                                                                                                                    | absent                                                                                                                            | exact channel identity                                                                                                                  | RED-14/21            |
| `core/event.proto`                              | Event/EventId/EventContext including external field 8                      | retain bytes; update provenance to pinned evidence only if manifest rules allow multi-source evidence                                                                                             | byte-identical current copy                                                                                                       | no schema churn                                                                                                                         | proto checksum test  |

## Current TypeScript trace and disposition

| Current path                                                                                                             | Current responsibility                                                                   | Wave 13 disposition                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/server/src/context/bounded-context.ts`                                                                         | builder, buses, repositories, stands, inboxes, tenant index, close                       | add internal broker ownership at existing build/init/close seams; no public broker accessor                                                |
| `packages/server/src/bus/event-bus.ts`                                                                                   | validate/store/dispatch Event; registry by type URL                                      | preserve ordinary intake and domain bus; add origin-aware dispatcher selection/unregister needed by producer lifecycle                     |
| `packages/server/src/bus/event-dispatcher-registry.ts`                                                                   | maps message schema to dispatchers                                                       | narrow to origin-aware indexing without global forwarding                                                                                  |
| `packages/server/src/bus/event-dispatcher.ts`                                                                            | `messageSchemas`, optional accept, dispatch                                              | expose separate domestic/external sets with domestic compatibility default                                                                 |
| `packages/server/src/handler/build-time-handler-analyzer.ts`                                                             | infers bare decorator schemas/arity/emissions/filter                                     | unwrap and validate canonical `External<T>` first parameter; emit origin                                                                   |
| `packages/server/src/handler/generated-registry-writer.ts`                                                               | renders registry v2                                                                      | advance version and render origin atomically                                                                                               |
| `packages/server/src/handler/generated-handler-registry.ts`                                                              | validates/ingests registry v2                                                            | validate origin and preserve it in canonical metadata                                                                                      |
| `packages/server/src/handler/handler-metadata.ts`                                                                        | canonical handler model and repository registry                                          | add immutable origin, domestic default only at explicit legacy builder boundary                                                            |
| `packages/server/src/handler/event-registration-readiness.ts`                                                            | exposes subscriber/reactor/application type metadata; explicitly defers origin           | remove deferral; publish domestic/external event sets for context/broker registration                                                      |
| `packages/server/src/handler/handler-decorators.ts`                                                                      | metadata-only standard method decorators                                                 | export/use type marker through package root; no runtime parameter decorator/DSL                                                            |
| `packages/server/src/repository/repository.ts`                                                                           | generated handler routing, explicit tenant/storage context, event/rejection dispatch     | filter candidate receptors by EventContext.external per handler; preserve storage/transaction path                                         |
| `packages/storage/src/internal/tenancy.ts` and `packages/server/src/context/tenant-index.ts`                             | canonical explicit `TenantBoundary` validation and known-tenant lifecycle                | reuse unchanged; validate the Event-origin tenant and let normal repository/inbox paths carry it; add no tenant global                     |
| `packages/server/src/server/server-environment.ts`                                                                       | singleton storage, SignalTransport, delivery, tracing, logger                            | add separately owned message TransportFactory; local memory default; production required; retryable close                                  |
| `packages/server/src/runtime/context-transport.ts`                                                                       | opens routing-plan signal intake to command/domain EventBus                              | preserve unchanged authority; broker dependency scan must be empty                                                                         |
| `packages/server/src/runtime/runtime-transport.ts`                                                                       | validates/encodes runtime command/event signal operations                                | preserve; no ExternalMessage intake                                                                                                        |
| `packages/server/src/runtime/runtime-routing.ts`                                                                         | command/event route plans with worker/subscriber IDs                                     | preserve; forbidden as broker discovery                                                                                                    |
| `packages/server/src/server/context-transport-group.ts`                                                                  | server-owned runtime transport binding group                                             | preserve; no broker lifecycle ownership                                                                                                    |
| `packages/transport/src/index.ts`                                                                                        | public SignalTransport and routing descriptors                                           | retain and export the distinct frozen JVM message-channel SPI; never widen signal kinds for broker frames                                  |
| `packages/transport/src/zeromq/signal-transport.ts`                                                                      | single-binder per-topic runtime signal sockets; Command/Event binary and V8 other frames | preserve observable API; migrate/reuse private safety/close utilities into distinct channel adapter, not broker wrapping                   |
| `packages/transport/src/zeromq/{adapter-config,endpoint-files}.ts`                                                       | existing public config and safe endpoint cleanup                                         | reuse config; deepen private endpoint resources for channel directories/manifests                                                          |
| `packages/proto/proto/spine-sources.json`, `packages/proto/spine-proto-manifest.json`, and `packages/proto/src/index.ts` | copied-source provenance, generation map, and public generated schemas                   | add the two exact pinned server Proto sources/exports; retain the byte-identical core Event source                                         |
| `packages/server/test/server/server-context-transport-cross-process.test.ts` and child fixture                           | real framework command/event cross-process acceptance                                    | pattern source only; Wave 13 gets separate normal-app broker fixture and does not forward Events directly                                  |
| `examples/todo/test/local-multi-process.test.ts` and worker                                                              | normal application child-process composition and cleanup                                 | pattern source for bounded waits/cleanup; do not modify Todo to masquerade as broker proof unless selected as the real two-context fixture |

### Exact planned source and test map

Implementation may deepen these modules, but may not move a responsibility
across package boundaries without H-004 direction:

- exact copied sources:
  `packages/proto/proto/spine/server/integration/broker.proto` and
  `packages/proto/proto/spine/server/transport/transport.proto`;
- channel SPI and adapters:
  `packages/transport/src/message-channel.ts`,
  `packages/transport/src/memory/message-transport.ts`,
  `packages/transport/src/zeromq/message-transport.ts`, and
  `packages/transport/src/zeromq/channel-endpoints.ts`, with exports through
  existing transport roots;
- broker modules:
  `packages/server/src/integration/integration-broker.ts`,
  `packages/server/src/integration/status-exchange.ts`,
  `packages/server/src/integration/config-exchange.ts`,
  `packages/server/src/integration/events-exchange.ts`,
  `packages/server/src/integration/external-messages.ts`, and
  `packages/server/src/integration/third-party-context.ts`;
- shared existing seams:
  `packages/server/src/context/bounded-context.ts`,
  `packages/server/src/server/server-environment.ts`,
  `packages/server/src/bus/{event-bus,event-dispatcher,event-dispatcher-registry}.ts`,
  `packages/server/src/handler/{build-time-handler-analyzer,generated-registry-writer,generated-handler-registry,handler-metadata,event-registration-readiness,handler-decorators}.ts`,
  and `packages/server/src/repository/repository.ts`;
- focused suites:
  `packages/proto/test/integration-broker-contract.test.ts`,
  `packages/transport/test/message-transport-conformance.ts`,
  `packages/transport/test/memory/message-transport.test.ts`,
  `packages/transport/test/zeromq/message-transport.test.ts`,
  `packages/server/test/handler/external-origin.test.ts`,
  `packages/server/test/integration/integration-broker.test.ts`,
  `packages/server/test/integration/third-party-context.test.ts`,
  `packages/server/test/server/server-integration-broker-lifecycle.test.ts`, and
  `packages/server/test/server/server-integration-broker-cross-process.test.ts`
  with its adjacent `.mjs` child fixture.

## Exact serialized-contract intake

T-0197a owns the serialized-contract boundary and must perform it as one
atomic generated change:

1. Copy pinned bytes to
   `packages/proto/proto/spine/server/integration/broker.proto` and
   `packages/proto/proto/spine/server/transport/transport.proto`.
2. Retain `packages/proto/proto/spine/core/event.proto` byte-for-byte; verify
   checksum equality with the pinned JVM file.
3. Add exact source-manifest records in
   `packages/proto/proto/spine-sources.json` with repository, pinned commit,
   upstream path, source/raw URL, and the checksums above. Do not hand-edit
   generated JS/DTs.
4. Run the canonical `pnpm proto:generate` workflow. Update generated output,
   `packages/proto/spine-proto-manifest.json`, relevant proto root exports,
   API inventory, and frozen descriptor/checksum evidence as required by the
   repository's generation workflow.
5. Assert exact descriptors:
   - `ExternalMessage`: required `Any id = 1`, required
     `Any original_message = 2`, reserved field 3 and `actor_context`, required
     `BoundedContextName bounded_context_name = 4`;
   - `ExternalEventsWanted`: repeated `ExternalEventType type = 1`;
   - `ExternalEventType`: required non-empty `string type_url = 1`;
   - `BoundedContextOnline`: required `BoundedContextName context = 1`;
   - `ChannelId`: `string target_type = 1`;
   - file/type URLs retain `type.spine.io` and validation options.
6. Binary round-trip full `Event`, wrapper ID, unknown-field policy, malformed
   required values, wrong packed message, and canonical type URL. No JSON/V8
   fallback.

Generated integration schemas are exported from `@spine-event-engine/proto`
for infrastructure and compatibility because JVM exposes the Protobuf types.
The broker implementation, exchanges, wrapper helpers, and channel hubs remain
server/transport internals. `TransportFactory` and `ThirdPartyContext` are
public only because their JVM concepts are public and applications must supply
production transport / third-party import respectively. All added public
symbols require root exports, `.d.ts`, TSDoc, TypeDoc/API inventory, README,
and import-path tests.

## Dependency-ordered task slices

### T-0195 — Architecture and requirements split (this package)

Owner: existing requirements splitter, `gpt-5.6-sol` / high, no children.

Deliverables: human/JVM/current-TS matrices, complete substitution ledger,
transport and Proto decisions, 22 RED designs, task dependencies, ownership,
review/docs/security/release gates, and this report. Acceptance: only planning,
task-record, work-log, and review-record files change; no product code.

### T-0196 — Complete 22-case RED gate

Owner: one bounded implementer owning test/fixture paths only. Depends on
T-0195. No production files may change. Create the exact tests below with
failing-before logs that demonstrate missing behavior rather than syntax,
fixture, import, or environment mistakes. Commit and push the RED checkpoint
before any product implementation. Acceptance: every RED has a stable test
name, expected reason, actual failing assertion, and mapping to H/JVM behavior.

### T-0197a — Exact Proto and message-channel contracts

Owner: contracts/transport implementer. Depends on T-0196. Owns
`packages/proto/**`, the narrow channel contract files under
`packages/transport/src/`, in-memory adapter files/tests, and required package
exports/docs. It must not edit server handler or broker files. Acceptance:
exact source hashes/descriptors, canonical generation green, binary contract
tests, TransportFactory conformance, in-memory parity, no SignalTransport
dependency in broker-facing interfaces.

### T-0197b — Generated external-origin metadata and filtering

Owner: metadata/filtering implementer. Depends on T-0196 and runs in parallel
with T-0197a. Owns only handler analyzer/writer/registry/metadata/readiness,
EventDispatcher/EventBus registry, repository candidate filtering, focused
tests, declarations and public marker exports. It must not edit Proto,
transport, broker, environment, or context lifecycle files. Acceptance:
domestic default; exact first-parameter marker; all valid receptor kinds;
invalid external command; mixed-origin same-type dispatcher proof; generated
version atomicity; no runtime DSL.

### T-0197c — Behavior harness and normal-application fixture

Owner: fixture/test implementer. Depends on T-0196 and may run in parallel
with T-0197a/b. Owns only new Wave 13 fixtures and test helpers. It replaces no
RED assertion and touches no product file. It prepares two genuine normal
application processes, generated models, secure short IPC paths, bounded
readiness/observation/shutdown, child diagnostics, and cleanup evidence.

### T-0198 — ZeroMQ message-channel adapter

Owner: the existing T-0197a contracts/transport implementation context, not a
fresh rediscovery owner. Depends on T-0197a; serialize all edits to shared
ZeroMQ/config/endpoint files and package exports. Implement exactly the private
endpoint-directory design above. Acceptance: conformance against the same
factory suite as memory; multi-publisher singleton channel; fan-out; FIFO;
first send after startup; stale/crash cleanup; malformed/symlink/oversize
manifest rejection; bounded close; no new public config/wire/broker policy.

### T-0199 — Integration broker exchanges

Owner: one broker implementer. Depends on T-0197a, T-0197b, and T-0198. Owns
new `packages/server/src/integration/**`, broker-focused tests, and only the
minimal EventBus unregister/access edits handed off from T-0197b. Implement
status/config/events, wanted references, wrapper/intake, domestic publisher,
origin/self/system filtering. Acceptance: RED-01 through RED-16 relevant cases
green with exact Event identity and no ContextTransport/SignalTransport
dependency.

### T-0200 — Context, environment, tenant, and ThirdParty integration

Owner: one lifecycle implementer, preferably the T-0199 context holder. Depends
on T-0199. Owns `bounded-context.ts`, `server-environment.ts`, close/lifecycle
tests, public `ThirdPartyContext`, and root API/docs handoff. Serialize these
shared lifecycle files. Acceptance: one broker per context, register and close
order, production factory requirement/local memory default, explicit tenant
isolation, ThirdParty parity, retryable cleanup, RED-17 through RED-21 green.

### T-0201 — Cross-process acceptance and behavior convergence

Owner: integration implementer. Depends on T-0197c, T-0198, and T-0200. Owns
the normal application fixture/test only plus narrowly justified corrections
returned to the still-available owners. Acceptance: RED-22 green natively with
two PIDs, distinct Bounded Contexts, generated external receptor metadata,
wanted exchange, domestic producer, exact full Event across ZeroMQ, external
delivery, no forwarder/direct transport publication, bounded cleanup, and
separate same-process/in-memory green evidence.

### T-0202 — Documentation, review, security, release, and remote closure

Owner: orchestrator for convergence; no new implementation identity. Depends
on T-0201. First run deterministic focused checks and coverage. Then dispatch
one complete applicable specialist wave: style/maintainability,
performance/reliability, TypeScript/API docs/compatibility, documentation, and
final security. Return one consolidated correction batch to existing owners;
re-review only substantively affected concerns. Update docs after behavior is
stable. Run one cheap preflight then one `verify:release`, plus separate native
cross-process evidence, changed executable line and branch coverage both at
least 90%, post-merge verification, pushes, and H-027 remote/tag cleanup.

Dependency graph:

```text
T-0195 -> T-0196 -> {T-0197a, T-0197b, T-0197c}
T-0197a -> T-0198
{T-0197a, T-0197b, T-0198} -> T-0199 -> T-0200
{T-0197c, T-0198, T-0200} -> T-0201 -> T-0202
```

## File ownership and handoffs

| Stream              | Exclusive write ownership                                                                          | Must not touch                      | Handoff                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| RED/harness         | new Wave 13 tests/generated test fixtures only                                                     | all production, proto source        | immutable test names/contracts to all streams               |
| Contracts/transport | `packages/proto/**`; new channel SPI/memory files; serialized transport tests                      | server handlers/broker/context      | generated schemas + frozen channel interfaces to broker     |
| Metadata/filtering  | handler analyzer/writer/registry/metadata/readiness; bus registry/dispatcher; repository filtering | Proto/transport/broker/environment  | immutable origin sets + registration/unregister seam        |
| ZeroMQ              | adapter-private channel files and serialized edits to existing ZeroMQ helpers                      | broker/context/handler              | factory conformance + live adapter to lifecycle             |
| Broker              | new `packages/server/src/integration/**`                                                           | generator/proto/ZeroMQ              | broker constructor/register/close contract to context owner |
| Lifecycle/public    | bounded context, environment, ThirdParty, root exports/docs after handoff                          | lower adapter internals             | integrated public/declaration surface to convergence        |
| Convergence         | tests/docs/review records; one accepted correction batch                                           | no independent architecture rewrite | final evidence to merge/release owner                       |

Only one writer may own overlapping files. Proto generation, package root
exports, API inventory, ZeroMQ endpoint utilities, `bounded-context.ts`,
`server-environment.ts`, coverage records, release verification, and integration
are serialized. All workers are told they are not alone and must preserve other
owners' changes.

## The 22 mandatory failing-before designs

All tests must fail against baseline for the stated missing behavior, not for a
missing generated fixture or invalid setup. The committed RED log retains the
command, named case, expected failure, observed failure, and baseline SHA.

1. **RED-01 — one producer, one consumer, same process.** Two real
   `BoundedContext`s share the in-memory factory. An external subscriber in the
   consumer requests a type; a domestic event in the producer arrives once.
2. **RED-02 — one producer, many consumers.** Two consumer contexts request the
   same type and each receives the complete event once; no competing-consumer
   loss.
3. **RED-03 — domestic receptor excludes imported event.** A domestic handler
   for a matching type is not invoked after broker import.
4. **RED-04 — external receptor excludes domestic event.** An external handler
   is not invoked when the same context posts a domestic Event.
5. **RED-05 — unrequested domestic event is not exported.** Producer observes
   two domestic types but only the remotely wanted type crosses.
6. **RED-06 — bidirectional cycle does not loop.** A and B request types from
   each other; each original event crosses once and imported events never
   republish.
7. **RED-07 — first requester installs one domestic publisher.** First wanted
   document activates publication; repeated/additional requester documents do
   not install duplicate dispatch. Interleaved duplicate and same-origin
   complete-set replacements are serialized and leave exactly the final
   requested types, with one publisher per type and no observable intermediate
   reference state.
8. **RED-08 — one requester withdrawal retains publication.** With two
   requesting origins, one empty wanted document removes only its reference.
9. **RED-09 — last requester withdrawal removes publication.** The final empty
   document unregisters the domestic publisher and later local Events do not
   cross. A failed asynchronous replacement retains the prior authoritative set
   and cleans any partially acquired channel resource.
10. **RED-10 — unchanged wanted set is suppressed.** Ordinary recomputation of
    the same complete set emits no second config message.
11. **RED-11 — online forces wanted rebroadcast.** After a new context publishes
    online, the same unchanged wanted set is sent and the late peer discovers
    it.
12. **RED-12 — config close withdraws interests.** Closing a consumer publishes
    an empty complete wanted document before subscriber teardown; producers
    remove its references.
13. **RED-13 — per-producer order and Event identity are preserved.** A sequence
    of Events arrives in order with byte-equivalent full Event and original
    `EventId`; no reconstructed IDs/contexts.
14. **RED-14 — exact Protobuf wrapper/channel contract.** Frozen descriptor and
    binary round trip prove all field numbers/reservations/type prefix,
    event/non-event IDs, wrong-Any rejection, and no JSON/V8 frame.
15. **RED-15 — tenant propagation and isolation.** Single-tenant import rejects
    a tenant; multitenant import requires and preserves the exact tenant and
    affects only its storage/handler scope.
16. **RED-16 — imported origin and normal EventBus path.** The receiver changes
    only `context.external`, then normal EventBus storage/filter/dispatch runs;
    self and paired system/domain messages are ignored.
17. **RED-17 — external command receiver is invalid.** Analyzer rejects
    external command assignment/reaction input with the stable model diagnostic
    while allowing external event-consuming command methods.
18. **RED-18 — lifecycle, stale channels, and close.** Context close withdraws,
    detaches observers, removes stale channels, closes broker before dependent
    factory teardown, aggregates failures, and permits defined retry cleanup.
19. **RED-19 — first-parameter generated origin contract.** Canonical
    `External<T>` on the first parameter produces external metadata; unmarked
    is domestic; nested/wrong-position/aliased-untrusted shapes fail
    deterministically; analyzer/writer/ingestor agree on version.
20. **RED-20 — all supported external receptor and ThirdParty semantics.**
    External Subscribe, React, event-consuming Command, rejection, and supported
    state subscription classify correctly; `ThirdPartyContext` proves
    single/multitenant actor rules, external-only delivery, imported producer
    identity, and close.
21. **RED-21 — in-memory and ZeroMQ factory conformance.** The same suite proves
    channel IDs, fan-out, many status/config publishers, add/remove observers,
    staleness, FIFO per publisher/subscriber, malformed input, and close for
    memory and native adapters. Native cases also prove per-publish late-join
    discovery, crash/restart endpoint-generation eviction without cache growth,
    and attempt-all fan-out where a dead endpoint yields one sanitized aggregate
    failure only after the live endpoint was attempted and delivered.
22. **RED-22 — genuine normal-application child-process flow.** Two separately
    configured normal Node application processes, distinct PIDs and Bounded
    Contexts, explicitly configured production-capable message transports,
    generated handler metadata, status/config discovery, and a domestic Event
    prove exact external delivery over ZeroMQ. Forbidden shortcuts are scanned:
    no test forwarder, shared EventBus, direct `ExternalMessage` publication by
    the fixture, direct consumer `eventBus().post`, ContextTransport authority,
    or same-process relay. Bounded readiness, child exit, listener/socket close,
    and IPC-directory removal are asserted.

## Verification, review, security, documentation, and final convergence

Development uses focused tests/typechecks only. Before specialist review run
deterministic formatting, lint, generated-proto freshness, generated handler
fixture freshness, dependency scan, package/declaration/API inventory,
forbidden-symbol scans, all 22 behavior tests, complete transport and server
regressions, native adapter tests, and changed coverage. Mechanical results are
not reviewer roles.

One complete specialist wave records every canonical concern:

- style/maintainability: deep modules, no Java ceremony, origin naming,
  generated/runtime boundaries, and removal of obsolete deferral claims;
- performance/reliability: concurrent requester transitions, FIFO,
  observer/channel mutation, first-send startup, manifest discovery/pruning,
  socket/cache bounds, close races/failures, and no reliability overclaim;
- TypeScript/API documentation: `External<T>`, `TransportFactory`, environment
  setting, `ThirdPartyContext`, registry version, exact proto exports,
  declarations, package exports, compatibility and public/non-public boundary;
- documentation: JVM parity, topology, lifecycle, tenant/origin, many-consumer /
  one-producer limitation, production configuration, transport delivery
  strength, and cross-process example;
- final security: untrusted wrapper/Any/required-field/size validation, tenant
  trust boundary, self-origin spoofing, type URL/channel derivation, filesystem
  manifest traversal/symlink/ownership/permissions/size/diagnostic disclosure,
  stale PID/heartbeat behavior, malformed frames, resource exhaustion, and
  cleanup.

Documentation ownership after behavior stabilizes:

- `packages/server/README.md` and `REFERENCE.md`: external declaration,
  lifecycle, ThirdParty, limitation and errors;
- `packages/transport/README.md` and `REFERENCE.md`: distinct signal vs message
  transport authority, production configuration, settlement/close semantics;
- `packages/proto/README.md`/`REFERENCE.md`: exact integration/transport
  contracts and provenance;
- `docs/USER_GUIDE.md`: two-context same/cross-process usage without internals;
- `docs/architecture/README.md`: exchanges, origin/tenant/loop boundary and
  adapter-private topology;
- `docs/api/README.md`, generated TypeDoc and API inventory;
- `build-protocol/DEVELOPER_API.md`, `RUNTIME_ARCHITECTURE.md`,
  `PROJECT_COMPLETION_PLAN.md`, parity/remediation records, decision log only if
  an accepted correction truly needs a durable decision.

Final closure requires: all 22 green; complete focused regressions; exact
generated/proto/API checks; at least 90% changed executable line and branch
coverage; one accepted specialist wave and consolidated correction batch; final
security acceptance; cheap preflight; exactly one converged `verify:release`;
separate native child-process proof; clean authorized diff; isolated merge;
post-merge verification; immediate task/main pushes; remote-ref reconciliation;
deletion of contained completed branches and all tags; proof that only
`origin/main` remains with no tags. No completion claim precedes successful
remote closure or a recorded real remote/auth blocker.

## Stop conditions and exclusions

Stop for human direction if implementation needs a new wire field, ack frame,
public endpoint/heartbeat/proxy configuration, transport or producer election,
generic integration routing DSL, alternate external declaration syntax,
external-state wire, broker persistence/retry/replay/dedup/fencing, or a change
to the many-consumer/one-producer domain rule. Also stop on a pinned-JVM
conceptual contradiction or a BUILD_PROTOCOL blocker.

Explicitly excluded: external commands, runtime enrichment, generic routing as
broker discovery, ContextTransport broker authority, SignalTransport broker
frames, JSON/V8 wire alternatives, global forward-all listeners, shared buses,
ownership election/leases, multiple gateways, Cloud Run, Waves 14–18, and any
broker-specific reliability subsystem.
