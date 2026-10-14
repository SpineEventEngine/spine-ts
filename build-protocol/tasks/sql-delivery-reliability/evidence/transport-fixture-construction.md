# Transport fixture construction

This note resolves the concrete assembly seam for the transport rows in `../TRANSPORT_PLAN.md`. It describes a real SQL-backed Project context and actual Connect transports, with only the network router and browser binding collaborators decorated in test code.

## Shared real Project context

Put the fixture in `packages/server-blackbox-tests/test/` (for example, a focused `project-subscription-transports.integration.test.ts`). That package already exports the generated Project workflow fixture and has the SQL provider dependencies; importing it from `packages/server/test` would reverse the dependency direction. Build a fresh provider for each test/database case using the established pattern in `packages/server-blackbox-tests/test-fixtures/project-worker.mjs`: select `PostgresStorageFactory` or `MysqlStorageFactory`, create a `StringifierRegistry` with a `TypeRegistry` containing the Project identifier, command, event, and Entity-state schemas used by the workflow, then call `Factory.newBuilder().setOptions({ url }).setStringifierRegistry(stringifiers).build()`.

Pass that factory to `projectWorkflow(contextName, onEntry, factory)`, then construct `new SpineServices({ contexts: [context] })`. The workflow fixture supplies actual Aggregate, ProcessManager, Projection and Repository handlers and uses `StorageSubscriptionRegistry` with this factory. Use the generated `CreateProject` Command, `ProjectCreated` Event and Project IDs in setup and assertions. Do not represent an Event or Entity state as a Command. The entry callback in `projectWorkflow` can count actual handler entries, while the SQL-backed Entity stores and subscription registry provide persistence evidence.

## One real-service router wrapper shared by all transports

The public `SpineServices.register(router: ConnectRouter): ConnectRouter` method registers the actual `CommandService`, `QueryService` and `SubscriptionService` implementations. Create a small test `ConnectRouter` decorator whose `service(schema, implementation)` method delegates every registration to a real router. For the `SubscriptionService` descriptor only, wrap the supplied implementation and delegate its methods to the real implementation. This is the available seam in `packages/server/src/services/spine-services.ts`; `packages/server/test/services/native-subscription-integration.test.ts` currently captures that registration into a test object, but it does not create a network listener or SQL context.

The wrapper can gate the first value of the real `activate(subscription, context)` async iterable: iterate the delegated implementation, hold its first update on a deferred promise, then yield it after the test releases the gate. The service has already performed the actual Activate and attached its context stream, but the client has not received the acknowledgement. For a transient Cancel failure, count calls by subscription ID and throw one test `ConnectError` before delegating the first `cancel`; delegate the next attempt. That keeps the real registration active after the failed attempt and verifies retry against the same public handle. Leave Subscribe and all other calls delegated unchanged.

Record Subscribe IDs, Activate invocations, first-update held/released state, Cancel attempts/successes, active service iterators, and handler-entry counts. Define the iterator counter precisely (increment on entering the wrapped generator, decrement in `finally`); it measures live service iterators, not a private `SpineServices` map. Count actual HTTP/2 sessions by attaching to the fixture-created `http2.Server` `session` event and removing each session on its `close` event. These are observations around real service methods and network sessions, not a replacement/mock service.

## Native gRPC

Create an `http2.createServer(connectNodeAdapter({ routes }))` fixture. In `routes`, call `services.register(decoratedRouter(router, counters, gates))`. Bind to loopback port `0` and use the actual address for a client transport:

```ts
const manager = new Http2SessionManager(baseUrl);
const transport = createGrpcTransport({ baseUrl, sessionManager: manager });
const subscriptions = createClient(SubscriptionService, transport);
```

Use the corresponding `createClient(CommandService, transport)` to post the typed Project Command. Hold Activate at the delegated service response wrapper, let the public Activate client await the acknowledgement, and release it from the test. For teardown call `manager.abort()`, close the client-side streams, close the fixture listener, and close the Project context and storage factory in `finally`. Await the server session counter reaching zero with a finite deadline.

This calls the actual public `SpineServices` service registration but does not exercise `Server.start()`'s private listener lifecycle. The production `Server` builds `SpineServices` internally and its public options expose service limits, not a `ConnectRouter` hook. If a row specifically requires the production `Server` wrapper, current public APIs cannot install this router decorator there; do not imply that this manual listener covers that wrapper lifecycle.

## Browser Connect and gRPC-Web

Run the same native fixture backend and same `SpineServices` decorator. Start a real standalone `BrowserServer` with `BrowserServer.open(undefined, options)`, where `options.backend` is `{ baseUrl: nativeBaseUrl }`; standalone preflight requires a backend or discovery. The exact required callbacks are `sessions.resolve(credential): Promise<{ principal: { id: string; attributes?: Readonly<Record<string, string>> }; expiresAt: Timestamp } | undefined>`, `authorize(principal, request): Promise<boolean>`, `contexts.resolve(principal, request, clock)` and `contexts.resolveContext(principal, clock)`, both returning `{ actor: UserId; tenant?: TenantId; timestamp: Timestamp; ... }`, and `clock.now(): Timestamp`. Supply a `SubscriptionBindings` adapter that delegates every operation to a real `InMemorySubscriptionBindings` instance. Its `size` reports the delegate's retained binding count. The underlying `dispose(definition, signal)` callback should cancel the corresponding real native subscription through a test `NativeSubscriptionCreator` using its own `Http2SessionManager` and `createGrpcTransport` to the same backend. Close the browser server so its actual `SubscriptionGateway` closes the adapter, then abort the test creator's manager and close remaining resources.

Use `createClient(SubscriptionService, createConnectTransport({ baseUrl: browser.baseUrl, httpVersion: "1.1" }))` for Browser Connect. Use `createClient(SubscriptionService, createGrpcWebTransport({ baseUrl: browser.baseUrl }))` for Browser gRPC-Web. Both are actual BrowserServer HTTP/1 routes; their Activate response travels from the same real backend service wrapper, so the same held first update gates the public acknowledgement. The wrapper's Cancel fault also covers both routes.

Record binding size for logical browser registration, the backend wrapper's live Activate iterators and Cancel counters, and the backend listener's HTTP/2 sessions. BrowserServer's returned `RunningServer` exposes `baseUrl`, `port` and `close`, but not its HTTP/1 server or accepted-socket count. Therefore the current public API supports asserting that gateway bindings, backend streams and backend HTTP/2 sessions drain; it does not support an exact Browser HTTP/1 connection count without a test-only internal seam or a production API addition. Avoid asserting such a count from `RunningServer`.

## Cleanup and bounded behavior

Use one cleanup stack/finally block per case. Release every deferred Activate gate first, cancel client iterators, close the browser gateway (if present), abort all client-side `Http2SessionManager`s, close the native listener, then close the context and storage factory and dispose of the isolated database using the existing SQL test harness. Bound gate waits and session/binding drain assertions with explicit deadlines. Ensure a failing assertion cannot leave a held response or active client stream.

No new production hook is needed to share the actual service gate across the three client transports. The remaining concrete gap is limited to observing BrowserServer's private inbound HTTP/1 accepted sockets (and, separately, covering `Server.start()`'s private router assembly while intercepting its service methods). The current public API exposes neither counter nor router injection point.
