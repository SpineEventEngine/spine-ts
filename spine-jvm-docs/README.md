# Spine TypeScript Documentation Corpus

This corpus captures the functional surface of Spine Event Engine for a future TypeScript/Node.js implementation. It is meant to be read as one connected specification tree: domain messages and signals first, server runtime next, then entity state, routing and delivery, client APIs, and supporting runtime facilities.

The source baseline is the researched Spine 2.0.0-series material, primarily `core-jvm` `2.0.0-SNAPSHOT.381`, with the `base`, `time`, `validation`, `logging`, `change`, `reflect`, and example repositories consulted where they define runtime behavior. The documents preserve behavior and implementation implications rather than Java/Kotlin API shape.

Source citations that start with `/private/tmp/spine-research` refer to local research clones used while preparing this corpus. Interpret those paths as repository-relative paths under the named repo/version in the source baseline table; the local temporary prefix is not part of the specification.

## Source Baseline

| Repository | Version or role | Commit used |
| --- | --- | --- |
| `SpineEventEngine/core-jvm` | `2.0.0-SNAPSHOT.381`, primary source | `6bf4118c8c76` |
| `SpineEventEngine/base` | `2.0.0-SNAPSHOT.421` | `43b55858c410` |
| `SpineEventEngine/time` | `2.0.0-SNAPSHOT.242` | `0d0251c1495f` |
| `SpineEventEngine/validation` | 2.0.0-series validation runtime and options | `6aec69016818` |
| `SpineEventEngine/logging` | `2.0.0-SNAPSHOT.417` | `badfaa9aa49c` |
| `SpineEventEngine/change` | `2.0.0-SNAPSHOT.206` | `53fe7029a189` |
| `SpineEventEngine/reflect` | `2.0.0-SNAPSHOT.200` | `980720d676e5` |
| `spine-examples/server-quickstart` | application-structure sample, not source of 2.x API truth | `2b2d52433540` |
| `spine-examples/todo-list` | application-structure sample, mostly 1.x-era API | `f9dcc2d510f3` |
| `spine-examples/hello-validation` | validation example sample | `e536e1a95bc0` |

## Reading Order

1. [Domain model and signals](spine-domain-model-and-signals.md) - Protobuf model roles, type URLs, identifiers, commands, events, rejections, metadata, validation-facing options, and TS descriptor implications.
2. [Server runtime and bounded context](spine-server-runtime-and-bounded-context.md) - bounded context assembly, server services, multitenancy, integration, system context, storage wiring, and lifecycle behavior.
3. [Entities, repositories, and state](spine-entities-repositories-and-state.md) - entity state metadata, lifecycle flags, transactions, repositories, aggregates, projections, process managers, read access, and diagnostics.
4. [Routing, dispatch, and delivery](spine-routing-dispatch-and-delivery.md) - command/event buses, handler contracts, routing registries, inbox records, delivery workers, enrichment, integration, and dispatch outcomes.
5. [Client APIs, queries, subscriptions, and tests](spine-client-api-queries-subscriptions-and-tests.md) - command/query/subscription service clients, request factories, filters, streaming updates, test fixtures, and SDK surface.
6. [Validation, storage, observability, and support](spine-validation-storage-observability-and-support.md) - validation runtime, generated/runtime boundary, storage abstractions, environment, time, logging, diagnostics, tracing, and support repo versions.

## Key User-Facing Components

- Domain modeling: Protobuf messages, entity options, type URL prefixes, `Any` packing, identifiers, command/event/rejection conventions, actor and tenant metadata.
- Server assembly: bounded contexts, repositories, dispatchers, filters, listeners, enrichers, storage factories, system context, command/query/subscription services, and integration brokers.
- State and persistence: entity records, lifecycle flags, aggregate histories, projections, process managers, query columns, repository cache, and record storage.
- Delivery runtime: command and event bus semantics, route functions, inbox sharding, deduplication, retries, direct/local delivery modes, event enrichment, and dispatch outcomes.
- Client SDK: actor-scoped request factories, commands, queries, subscriptions, filters, columns, ordering, streaming consumers, error handling, and test support.
- Support runtime: validation APIs, generated validators, storage adapters, environment configuration, clock/time utilities, logging context, diagnostic events, and optional tracing.

## TypeScript Implementation Target

The target is a TypeScript/Node.js runtime and SDK that use generated Protobuf messages and descriptor metadata, preserve Spine type URLs and envelope semantics, and expose idiomatic TS APIs around the same behavioral contracts. Implementation notes assume descriptor-driven registration, `bufbuild/protobuf-es`-style generated types, structured validation failures, pluggable transports and storage, tenant-aware runtime state, and async-safe observability hooks.

## Generated/Runtime Contract

The TypeScript side needs generated or explicitly registered artifacts at the runtime boundary. This contract describes what must be available, not how a compiler or plugin produces it:

- Descriptor sets must preserve Spine custom options and Protobuf declaration order, including first-field order used for IDs and default routing.
- A type URL and `Any` registry must map full type URLs and fully qualified type names to message schemas for packing, unpacking, validation, routing, enrichment, and storage.
- Entity metadata must expose entity kind, visibility, state type URL, ID field/type, lifecycle support, and query column definitions.
- Validation functions must be available through a stable runtime facade, such as `violationsOf`, `check`, validation exceptions, and validator registration.
- `(set_once)` enforcement belongs in generated message builders/factories or the validation/runtime facade that performs state updates; plain mutable protobuf objects must not silently bypass it.
- Handler/decorator or registration metadata must describe command assignees, command receptors, subscribers, reactors, appliers, external handlers, field filters, and allowed return shapes.
- Semantic interface tags from `(is)` and `(every_is)` must be represented as descriptor tags or registered type tags for routing, enrichment, validation, and API typing; they should not depend on JVM class/interface names.
- Query column and field metadata must include field paths, column eligibility, comparable field types, ID field metadata, lifecycle pseudo-columns, and response-format support.
- Routing metadata must include default first-field routes, producer-ID routes, custom command/event routes, route specificity, and service ownership by type URL.

Related sections: [Type URLs and Any](spine-domain-model-and-signals.md#type-urls-and-any), [Entity State Options](spine-domain-model-and-signals.md#entity-state-options), [Validation Options That Affect Modeling](spine-domain-model-and-signals.md#validation-options-that-affect-modeling), [Server assembly and exposed services](spine-server-runtime-and-bounded-context.md#server-assembly-and-exposed-services), [Entity State](spine-entities-repositories-and-state.md#entity-state), [Handler Annotations as Contracts](spine-routing-dispatch-and-delivery.md#handler-annotations-as-contracts), [Routing](spine-routing-dispatch-and-delivery.md#routing), [Targets, Filters, Columns, and Ordering](spine-client-api-queries-subscriptions-and-tests.md#targets-filters-columns-and-ordering), and [Generated and runtime boundary](spine-validation-storage-observability-and-support.md#generated-and-runtime-boundary).
