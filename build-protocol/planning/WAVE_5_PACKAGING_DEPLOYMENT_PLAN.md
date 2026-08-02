# Wave 5 Packaging and Deployment Plan

Status: Q&A complete; approved scope awaiting autonomous implementation start

Planning record: `T-0088`

Starting point: `origin/main@d707bd89`

Risk: High-risk implementation program. Wave 5 changes lifecycle ownership,
persistent subscription coordination, authentication hosting, and deployment
topology. This planning-only record is a micro documentation task.

## Outcome

Spine TS applications can be built once and deployed in either of two
production modes without moving storage selection into framework
infrastructure:

- a combined gateway and application process for one application replica; or
- a standalone gateway in front of one or more Spine TS application replicas,
  or an unmodified Spine JVM backend.

Multiple application replicas require the standalone gateway. Both modes use
the same authentication, session, actor-context, Proto registry, and client
contracts. Moving from combined to standalone mode must not change bounded
contexts or domain code.

## Human Decisions Ledger

- `Server.run()` owns process signal handling and closes `ServerEnvironment`
  after its last run-managed server closes. Multiple run-managed servers may
  share that environment. Run ownership is exclusive: admitting `run()` fails
  before listener startup if an externally start-managed server is attached,
  and `start()` fails while run ownership is active. `Server.start()` remains
  suitable for caller-managed lifecycles and never closes its environment.
- Environment closure releases delivery, tracing, transport, and storage
  facilities in a safe dependency order. Startup failure and repeated closure
  must remain bounded and safe.
- Do not add application health endpoints by default. Kubernetes references
  use TCP startup and readiness probes, no default liveness probe, and process
  exit as the principal failure signal. The simple delivery server retains its
  existing gRPC Health service. Required registry and delivery configuration
  must open before the listener; after that, TCP readiness proves only that the
  listener accepts connections, not that every dependency remains healthy.
  Shutdown closes intake first so readiness fails before resource teardown.
- Infrastructure never selects MySQL, Datastore, or another application
  storage engine. Every replica runs the same application code and therefore
  uses the storage configured by that application. Acceptance may configure a
  Datastore emulator in MessageBoard; Kubernetes remains storage-neutral.
- Combined and standalone gateway modes are both valid for small production
  deployments. Multi-instance deployments require standalone mode.
- A standalone gateway owns its listener. Spine RPC routes and application-
  supplied OIDC start, callback, exchange, and logout routes may share that
  listener through explicit path-and-method route registrations. A handler
  receives a Fetch `Request` and cancellation signal and returns a `Response`.
  Framework routing gives reserved Spine paths precedence, bounds request size
  and duration, converts uncaught errors without leaking details, cancels work
  during drain, and applies an explicit per-route origin policy. OAuth callbacks
  may allow a missing browser `Origin`, but application code must still verify
  OAuth state. Envoy exposes only registered authentication paths, never an
  unrestricted application catch-all or general application router.
- A durable subscription registry is required in production in both modes,
  including a single gateway, so redeployment preserves logical subscription
  records. In-memory registry support remains for local development and tests;
  production must not silently fall back to it.
- The durable registry is a gateway-owned lifecycle dependency, separate from
  backend application-data storage. Gateway assembly requires an explicit
  registry and logical namespace. The framework provides a `StorageFactory`-
  backed implementation that may use the same storage installation as the
  application or a separate one. This also works when the backend is JVM: the
  Node gateway owns its registry storage configuration and closure. Production
  startup rejects the in-memory registry instead of silently accepting it.
- The registry persists public subscription identity, the private backend
  envelope, principal fingerprint, tenant, session expiry, lifecycle,
  claim/lease/cancellation state, and version.
- Registry coordination uses atomic compare-and-set ownership, finite leases,
  bounded stale-claim recovery and cleanup, and retry-safe cancellation
  fences. It must work with two standalone gateway replicas, either of which
  may receive subscribe, activate, or cancel requests.
- A persistent namespace enforces application-configured global record and
  per-record byte limits. Expired-record cleanup uses finite batches, a durable
  continuation, bounded retries, and a failure backoff. Admission and cleanup
  remain correct when two gateways race or a store operation has an ambiguous
  result.
- A gateway restart or failover preserves registry records, not an active
  stream. Clients reconnect and entity clients re-query authoritative state;
  gaps and duplicates remain possible. Wave 5 makes no completeness,
  exactly-once, or global-order promise.
- Two gateway replicas share session signing, validation, and revocation
  configuration. The deployment guide must state this requirement.
- Deploy exactly one in-memory `delivery-server/simple-server` replica. It is
  deliberately non-durable and non-HA. Redis, Hazelcast, and other delivery
  server modes remain excluded.
- Build and test npm packages and container images locally. Publish neither
  packages nor images yet; revisit publication after all accepted waves.
- Ship a production container contract, deterministic Docker Compose topology,
  and minimal Kubernetes reference manifests covering graceful shutdown,
  readiness, configuration, secrets, multiple application nodes, the gateway,
  Envoy, and the one simple delivery server.
- Do not add a deployment CLI, application runner abstraction, operator, Helm
  chart, default health API, storage-selection framework, or JVM build.

## Reused Foundations

- Use `spine-proto generate`, `compose`, and `handlers`, explicit
  `TypeRegistry` composition, and the existing fresh packed-tarball harness.
- Deepen `Server.run()`, `ServerEnvironment`, the existing browser host,
  `@spine-event-engine/auth`, `RecordStorage`, and `SubscriptionGateway` rather
  than adding parallel lifecycle or hosting abstractions.
- Reuse the existing Envoy renderer, delivery client/simple-server fixture,
  and MessageBoard example.
- Use the backend subscription record and `RecordStorage.compareAndSet`
  behavior as the starting point for durable gateway coordination; do not
  duplicate an unrelated persistence mechanism.

## Dependency-Ordered Execution

1. Define and test `Server.run()` environment ownership and final closure.
2. Define and implement the durable subscription registry.
3. Prove two-gateway coordination, failover, leases, cancellation fences, and
   global retention limits. Include stale-owner interleavings: gateway A loses
   a lease with an open backend stream, gateway B takes over or cancels, and A
   must neither forward nor resurrect updates after resuming. Also cover an
   ambiguous store result after successful compare-and-set.
4. Add the standalone gateway host and isolated authentication routes.
5. Add the smallest remote-delivery integration to `ServerEnvironment` so an
   application configures it once and the framework owns shutdown.
6. Define the build and container contract using the existing Proto tooling.
7. Prove the combined production topology.
8. Prove the standalone topology with two gateways and two application
   replicas using shared application-configured storage. Run gateways in
   separate processes against the same registry namespace and prove that a
   missing durable registry configuration fails closed.
9. Add minimal Kubernetes reference manifests.
10. Finish human and agent documentation, release verification, integration,
    and remote synchronization.

The durable registry and two-gateway failover path is the critical path. Later
slices must not invent their own subscription ownership model.

## Fast Autonomous Execution

- Freeze each slice's behavior and public contract once before implementation.
- Keep slices dependency-sized and give one writer ownership of each shared
  high-risk contract. Parallel work is read-only or touches disjoint files.
- Reuse the foundations above before considering a new abstraction or package.
- Run focused tests and changed-source coverage during implementation. Check
  Docker, Compose, and loopback capabilities before depending on them.
- Run deterministic checks before one complete relevant review wave. Return
  one aggregated correction batch to the same implementation context and
  re-review only substantively affected concerns.
- Use `verify:task` for bounded slices and reserve `verify:release` for shared
  runtime/build boundaries and final convergence. Do not use the release gate
  as a diagnostic loop.
- Write broad deployment guidance after interfaces stabilize, while updating
  contract-level TSDoc and focused docs in the owning slice.
- Push every checkpoint, verification, and review-correction commit to
  `origin` immediately.

## Acceptance Boundary

Acceptance includes local image builds, documented single-command topology
startup, graceful shutdown, two-gateway/two-application-replica tests, durable
registry restart/failover tests, storage neutrality, configurable secrets, and
reference manifest validation. It excludes publication, durable delivery-server
HA, Wave 6 cross-node notification propagation, and JVM builds.

## Planning Record

Verification profile: `pnpm verify:task -- --no-tests`, because this task changes
only internal planning and decision records.

Review assignments recorded before dispatch:

- documentation completeness: documentation reviewer, expected
  `gpt-5.6-luna` / `medium`;
- TypeScript/API contract: TypeScript/API docs reviewer, expected
  `gpt-5.6-terra` / `high`;
- performance/reliability: performance/reliability reviewer, expected
  `gpt-5.6-terra` / `high`;
- style/maintainability: N/A because no production or example code changes.

All reviewer dispatches must name the configured model and reasoning
explicitly. Record actual runtime metadata when exposed; otherwise record the
configured role profile and that runtime self-introspection was unavailable.

First review wave:

- documentation: clean; configured Luna/medium profile, runtime
  self-introspection unavailable;
- TypeScript/API and performance/reliability: accepted two shared P1 findings
  and the P2 routing, stale-owner, retention, and readiness findings. The plan
  now defines exclusive run ownership, gateway-owned durable registry assembly,
  bounded auth routes, decisive race tests, global retention bounds, and
  listener-only TCP readiness. Re-review is limited to these corrections.
- TypeScript/API and performance/reliability re-reviews: clean; configured
  Terra/high profiles, runtime self-introspection unavailable. No concern was
  reopened outside the corrected findings.
- Verification: `pnpm --config.verify-deps-before-run=false verify:task --
--no-tests` passed on 2026-08-02. It covered generated Proto checks,
  build/typechecks, ESLint, cleanup and TSDoc enforcement, formatting,
  TypeDoc/API documentation, Proto lint and generated cleanliness, 67 package
  imports, 44 package assets, and 273 Markdown links.
