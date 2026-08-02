# Wave 5 Execution Split

Status: Active

Parent plan:
`build-protocol/planning/WAVE_5_PACKAGING_DEPLOYMENT_PLAN.md`.

Task: `T-0089`

This is the durable child-task order for Wave 5. It refines the approved plan
without reopening product decisions. The program remains high-risk because it
changes lifecycle ownership, persisted coordination, authentication hosting,
public assembly, and production deployment contracts.

## Binding scope and exclusions

- `Server.run()` exclusively owns process signals and final
  `ServerEnvironment` closure. `Server.start()` remains caller-managed and
  never closes its environment. Run admission and external start management
  cannot overlap in one environment.
- Combined gateway/application mode supports one application replica.
  Multiple application replicas require standalone gateways.
- Production combined and standalone gateways require an explicitly supplied
  durable subscription registry and logical namespace, even with one gateway.
  In-memory bindings remain local/test-only and production fails closed.
- Registry durability preserves logical subscription records and coordination,
  not an active stream. Gaps and duplicates remain possible; reconnect and
  authoritative re-query remain required. Wave 5 adds no completeness,
  exactly-once, or global-order guarantee.
- Exactly one in-memory `delivery-server/simple-server` is deployed. It remains
  non-durable and non-HA. Redis, Hazelcast, other durable delivery modes, and
  Spine JVM builds are excluded.
- A standalone gateway targets Spine TS or an unmodified Spine JVM endpoint
  through existing shared descriptors. JVM evidence reuses the locked/static
  fixture and does not build, patch, or vendor Spine JVM.
- The gateway exposes reserved Spine RPC paths and only explicitly registered
  application auth routes. It never exposes an unrestricted catch-all or
  general application router.
- Kubernetes uses TCP startup/readiness probes, no default liveness probe, and
  process exit as the principal failure signal. TCP readiness means listener
  acceptance only. Shutdown closes intake before resource teardown.
- Application code selects its storage provider. Infrastructure passes
  endpoints, namespaces, configuration, and secrets but never selects MySQL,
  Datastore, or another application provider. MessageBoard acceptance may
  explicitly select a Datastore emulator in MessageBoard code.
- Packages and images are built and tested locally only. Wave 5 publishes
  neither. No deployment CLI, new application runner, storage-selection
  framework, operator, Helm chart, default application health API, or parallel
  lifecycle/persistence/subscription abstraction is permitted.
- Neither protected `human-review` file may be read or changed.

## Existing seams and contract freeze

- Lifecycle deepens `Server.run()`, `Server.start()`, `RunningServer.close()`,
  `ProcessServerCoordinator`, `ServerEnvironment`, environment attachments, and
  `RetryableCloseGroup`; it adds no second runner.
- Registry work keeps `SubscriptionGateway`, `SubscriptionBindings`,
  `InMemorySubscriptionBindings`, `BackendSubscriptionEnvelope`, the existing
  service-owned subscription-record codec, `StorageFactory`, and
  `RecordStorage.compareAndSet()` as its foundations. Gateway records receive a
  distinct namespace and one versioned codec rather than another persistence
  mechanism.
- Durable records store public ID, private backend envelope, principal
  fingerprint, optional tenant, session expiry, lifecycle, finite claim/lease,
  cancellation fence, byte accounting, and version. The logical namespace and
  global/per-record limits are explicit.
- The current synchronous `SubscriptionBindings.reserveCapacity()` cannot
  enforce global admission through asynchronous durable storage. B1 owns the
  single minimum evolution to awaitable reservation/admission and updates the
  in-memory implementation and all callers atomically. This is an authorized
  consequence of the approved durability contract, not a blocker.
- Activation must let the binding owner abort backend work and fence every
  forwarded update and final transition. A stale owner can neither forward nor
  resurrect after lease loss or cancellation.
- Hosting deepens the existing browser host, `UnaryGateway`, native gateway
  services, Fetch `Request`/`Response`, shared service descriptors, and Envoy
  renderer. Each auth registration fixes exact method/path, finite byte/time
  limits, and origin policy; its handler receives `Request` plus `AbortSignal`
  and returns `Response`.
- Production assembly checks an explicit registry durability capability before
  listener open; it does not infer durability from class names or `instanceof`.
- Remote delivery reuses `DeliveryClient`, `RemoteInbox`,
  `RemoteWorkRegistry`, `DeliveryBuilder`, and `ServerEnvironmentSettings`.
  Because delivery-client already depends on server, server must not acquire a
  reverse dependency.
- Build/deployment work reuses `spine-proto generate`, `compose`, `handlers`,
  packed-tarball acceptance, package metadata checks, MessageBoard, the Envoy
  renderer, and the existing simple delivery server.

## Ordered task map

| ID  | Boundary                                                                                     | Integration dependency  | Verification profile                          |
| --- | -------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------- |
| A1  | Exclusive run-managed lifecycle and final environment closure                                | None                    | `verify:release`                              |
| B1  | Durable registry contract, codec, storage assembly, and production fail-closed admission     | A1                      | `verify:release`                              |
| B2  | Two-gateway fencing, ambiguous-outcome reconciliation, global limits, and bounded cleanup    | B1                      | `verify:release`                              |
| C1  | Standalone Spine host plus bounded application auth routes and exact Envoy exposure          | B2                      | `verify:release`                              |
| D1  | Environment-owned remote delivery integration                                                | A1; integrates after C1 | `verify:release`                              |
| E1  | Build-once package and local container-image contract                                        | C1, D1                  | `verify:release`                              |
| F1  | Combined and two-by-two standalone Compose acceptance plus minimal Kubernetes references     | E1                      | focused `verify:task` plus topology/manifests |
| G1  | Human/agent docs, final review/security, release acceptance, integration, and remote closure | F1                      | final `verify:release`                        |

B1-B2 are the critical path. Read-only container, manifest, and documentation
inventories may proceed while they run, but write-heavy children integrate in
the table order. D1 may be prepared after A1 because its files are disjoint;
it integrates after C1 so E1 consumes stable hosting and lifecycle contracts.

## A1 — Run-managed lifecycle

Ownership: `packages/server/src/server/server.ts`,
`packages/server/src/server/process-server-coordinator.ts`, the minimum related
environment lifecycle access under `packages/server/src/server/**`, mirrored
tests, public TSDoc, and focused server reference claims. No auth, registry,
delivery-client, or deployment files.

RED tests and acceptance:

- `run()` rejects before listener startup when a start-managed server is
  attached; `start()` rejects before listener startup while run ownership is
  active.
- Multiple run-managed servers share one environment. Closing a non-last server
  leaves siblings usable; the last closes the environment exactly once after
  all server intake, contexts, and resources.
- `SIGINT`/`SIGTERM`, explicit close, repeated/concurrent close, and startup
  failure converge without leaked signal listeners or duplicate closure.
- Retriable failures preserve phase order. Caller-managed `start()` remains
  compatible and never closes the environment.
- No runner abstraction, public lifecycle phases, or default health API appear.

Review: style/maintainability, TypeScript/API docs, and
performance/reliability; documentation completeness only for changed public
claims. Gate: focused lifecycle/race tests with changed-source coverage, cheap
preflight, one converged reviewer wave, then `verify:release` once.

## B1 — Durable registry foundation

Ownership: existing binding contracts/in-memory implementation in
`packages/auth/src/subscriptions/**`; one StorageFactory-backed implementation
and versioned gateway codec in `packages/server/src/**`; mirrored tests,
exports/TSDoc, and focused package references. It does not alter service-owned
Subscription RPC record semantics, hosting, auth routes, or deployment files.

RED tests and acceptance:

- Awaitable reservation/admission preserves in-memory behavior and releases a
  failed Subscribe reservation once.
- Durable create/read/close/reopen round-trips all frozen fields, copies bytes,
  and isolates explicit application namespaces.
- Principal/tenant/session ownership checks remain mandatory. Malformed,
  oversized, wrong-version, wrong-key, or inconsistent records fail closed
  without exposing backend bytes.
- Construction rejects missing namespace, invalid finite lease/cleanup bounds,
  invalid global record/per-record byte limits, and provider-incompatible CAS.
- Production combined and standalone assembly reject absent/volatile bindings
  before listener open; local/tests may explicitly use in-memory bindings.
- The gateway owns registry storage and closure independently of backend JVM/TS
  selection and independently of application-data storage.

Review: all four canonical lanes because public, persistence, and documentation
claims change. Gate: focused auth/server/storage tests and changed-source
coverage, provider conformance where relevant, cheap preflight, then
`verify:release` once.

## B2 — Two-gateway coordination and retention

Ownership: B1 durable coordination/capacity/cleanup internals and tests, plus
focused visible limit documentation. Public changes are limited to behavior
proved necessary by RED tests. No scheduler, host, deployment controller, or
storage-selection policy.

RED tests use two independently opened registries over one backing store with
controlled clocks/barriers/faults:

- Exactly one gateway wins activation by CAS with unique fence/version and
  finite renewable lease; an unexpired claim cannot be stolen and an expired
  claim is recovered within bounded attempts.
- Gateway A loses its lease with an open stream, gateway B takes over or
  cancels, and A cannot forward, finalize, or resurrect after resuming.
- Cancellation is retry-safe, wins through a durable fence, and may reach
  either gateway. Subscribe/activate/cancel/renew/abort/close races converge to
  one valid durable state with bounded local controllers.
- A CAS that applies and then reports an ambiguous error is reconciled by
  reading the current version/fence before another mutation or backend effect.
- Two gateways racing on admission cannot exceed the namespace-global record
  limit; failed creation returns capacity exactly once; encoded per-record byte
  limits are enforced before persistence.
- Expired cleanup uses finite batches, durable continuation, bounded retries,
  and durable failure backoff. Restart resumes it; concurrent cleaners do not
  double-account or delete a current replacement.
- Crashes between mutation and accounting/continuation updates remain
  repairable from durable facts. Retained timers, continuations, errors, and
  private payloads stay bounded and sanitized.

Acceptance: all cross-gateway ownership is in durable atomic facts; forwarding
and finalization are fenced; limits are global per namespace; cleanup is finite
and resumable; failover preserves records, not stream continuity.

Review: performance/reliability and TypeScript/API docs are mandatory;
style/maintainability covers coordination structure; documentation covers
visible limits/claims. Gate: deterministic race/fault/retention tests with
changed-source coverage, cheap preflight, then `verify:release` once.

## C1 — Standalone host and bounded auth routes

Ownership: deepen `packages/server/src/server/browser-server.ts` and existing
auth/native seams into one standalone host; exact-route dispatcher and public
route registrations; tests/exports/TSDoc; `interop/envoy/**`; existing
descriptor/JVM fixture assertions. It may factor shared combined/standalone
assembly but may not add another gateway pipeline or general router.

RED tests and acceptance:

- Production startup requires explicit backend target, sessions,
  authorization/context/registry/clock/fingerprint collaborators, durable
  bindings, and namespace. It opens required registry/configuration before the
  listener.
- Command, Query, ResolveContext, Subscribe, Activate, and Cancel share the
  current reserved descriptors and policy in both modes; forwarding works with
  Spine TS and the locked unmodified-JVM descriptor fixture without a JVM build.
- Each auth route has one normalized exact path/method, finite body/time limits,
  and explicit origin policy. Duplicate, conflicting, wildcard, catch-all, or
  reserved Spine registrations fail before listener open.
- Reserved Spine paths always win. Unregistered paths/methods and uncaught
  errors return bounded non-leaking responses without backend/application work.
- Handlers receive Fetch `Request` and `AbortSignal`; timeout, disconnect,
  shutdown, and drain cancel work. Request bodies are bounded before buffering.
- An explicit OAuth callback policy may accept missing browser `Origin`, but
  app code must verify OAuth state. Other route origins follow their declared
  allowlist policy.
- Envoy exposes only reserved Spine paths and registered auth routes with
  matching methods/origins/limits. Close stops intake first, aborts relays and
  routes, then closes registry/backend resources without leaks.

Review: all four canonical lanes. The existing final security reviewer remains
G1's release gate rather than a new per-slice role. Gate: host, routing,
origin/limit/timeout, redaction, Envoy, descriptor compatibility, and lifecycle
tests with coverage, cheap preflight, then `verify:release` once.

## D1 — Environment-owned remote delivery

Ownership: `packages/delivery-client/src/**`, the minimum compatible
`ServerEnvironmentSettings`/attachment surface in `packages/server/src/server/**`,
mirrored tests, exports/TSDoc, and package references. It reuses the current
client/adapters/builder and must not introduce a package cycle, parallel
runner, durable delivery server, or provider selector.

RED tests and acceptance:

- One application configuration supplies the remote delivery endpoint and
  required durable removal-quarantine collaborator, producing the existing
  environment delivery facility without repeated manual adapter wiring.
- Required configuration opens before listener intake. Failed open leaves no
  client, stream, or attachment and remains retry-safe.
- Environment closure stops intake/attachments before delivery, client,
  quarantine, transport, tracing, and storage in safe dependency order.
- Repeated/concurrent close and partial failure retry only unfinished phases and
  close each resource once.
- The simple delivery server's gRPC Health service remains unchanged; no
  application health API or new worker/supervisor is added.

Review: all four canonical lanes for changed API/usage/lifecycle claims. Gate:
focused delivery-client/server lifecycle tests with coverage, cheap preflight,
then `verify:release` once.

## E1 — Build-once and local images

Ownership: package/root build scripts and metadata only where required;
MessageBoard production entrypoints/provider selection; and
`examples/message-board/deploy/container/**` Dockerfiles, entrypoint checks, and
local image tests. F1 exclusively owns Compose/Kubernetes paths.

RED tests and acceptance:

- A fresh packed-tarball install runs `spine-proto generate`, `compose`, and
  `handlers` at build time, compiles once, and starts installed runtime output
  without generation, `tsc`, workspace traversal, or monorepo rebuild.
- The same application artifacts/image start combined or application-only mode
  via explicit entrypoints/configuration without changing domain code.
- Standalone gateway and existing simple delivery server build as local images
  from pinned workspace artifacts. Production images contain required
  generated/manifests and avoid build caches/dev-only inputs where practical.
- Node receives process signals directly, shutdown is bounded, runtime secrets
  are not baked into images, and no script publishes packages/images.
- MessageBoard code, not image/deployment infrastructure, explicitly selects
  application storage and any Datastore emulator adapter.

Review: all four canonical lanes. Gate: capability precheck, packed-tarball and
local image build/start/stop tests, changed-source coverage where code changes,
cheap preflight, then `verify:release` once because shared build/release behavior
changes.

## F1 — Production topology references and acceptance

Ownership: `examples/message-board/deploy/compose/**`,
`examples/message-board/deploy/kubernetes/**`, topology/manifest acceptance
harnesses, and focused deployment notes. Framework defects return to the
existing owning context; deployment code must not invent coordination or
provider selection.

RED tests and acceptance:

- One deterministic combined command starts one combined gateway/application
  replica, explicit durable registry/namespace, application-selected storage,
  Envoy, and exactly one simple delivery server from local build-once images.
- One deterministic standalone command starts Envoy, two gateways, two
  application replicas using the same application code/shared
  application-selected storage, one shared durable registry namespace, shared
  session signing/validation/revocation configuration, and exactly one simple
  delivery server.
- Either gateway may receive Subscribe/Activate/Cancel. Gateway loss, lease
  takeover, cancellation fence, stale-owner resume, restart preservation, and
  missing-durable-registry fail-closed behavior prove B1-B2 end to end.
- Authenticated Post, Query, subscription/cancel, reconnect/re-query, graceful
  SIGTERM, and build-free startup pass. Updates through either app replica are
  query-authoritative; Wave 6 cross-node notification propagation is not
  asserted.
- The standalone gateway exercises the locked JVM-compatible descriptor fixture
  without building JVM. Tests clean all listeners, streams, claims, containers,
  networks, volumes, and temporary state within bounded time.
- Kubernetes references cover combined and standalone modes, Envoy, one simple
  delivery server, config/Secret references, graceful termination, TCP startup
  and readiness, and no default liveness probe. They are storage-neutral,
  contain no Helm/operator/provider resources, use local/reference image names,
  and pass deterministic schema/render/policy checks.

Review: documentation and performance/reliability are mandatory;
style/maintainability covers orchestration code; TypeScript/API docs applies to
changed snippets/entrypoints. Gate: Docker/Compose/loopback capability precheck,
focused topology tests through `verify:task` with explicit coverage choice,
Compose config and manifest validation. G1 owns final repository-wide release
verification.

## G1 — Documentation and Wave 5 closure

Ownership: affected human READMEs and agent REFERENCES, user and
architecture/deployment guides, current protocol/status records, final
acceptance reconciliation, and one aggregated correction batch returned to the
still-available implementation owner. It adds no new runtime scope.

Acceptance:

- Docs distinguish run/start ownership, combined/standalone eligibility,
  listener-only readiness, bounded auth routes/origins, durable registry and
  shared-session requirements, finite leases/cleanup, and best-effort
  reconnect/re-query limits.
- Docs state that application code selects storage; the gateway owns separate
  registry storage configuration; the single simple delivery server is
  in-memory/non-HA; publication, JVM build, durable delivery HA, and Wave 6
  propagation are excluded.
- All commands run from a clean build-once state. Links, snippets, exports,
  local images, Compose, Kubernetes, and prohibited-claim scans pass.
- One complete relevant specialist wave gives every canonical concern a clean,
  accepted, or concrete N/A disposition. Findings are deduplicated and returned
  as one correction batch. The existing final security reviewer checks the
  converged Wave 5 authentication/deployment trust boundaries once.
- Final native acceptance runs combined and standalone topologies,
  two-gateway failover/fencing, local image build/start, graceful shutdown, and
  leak scans. After cheap preflight and review convergence,
  `verify:release` runs once.
- Each child and final task records focused evidence, merge and change-sensitive
  post-merge verification, immediate feature/main/tag pushes where applicable,
  and matching remote refs before durable closure.

Review: all four canonical specialist lanes and the existing final security
reviewer. Gate: final topology acceptance plus one `verify:release`; rerun only
after diagnosing/correcting a failure and restoring a clean cheap preflight.

## Execution protocol and blocker disposition

Each child receives one implementation owner, behavior-first RED tests, exact
file ownership, and explicit model/reasoning metadata before dispatch. Freeze
its public/serialized contract once. Run focused tests/coverage and cheap
preflight before one relevant review wave and the selected expensive profile.
Aggregate the whole wave before one correction batch. Push every feature commit
immediately; merge, post-merge verify, push `main`/tags, and confirm remote refs
before starting the dependent child. Preserve unrelated user changes and never
touch protected human review files.

No governing contradiction or blocker is established. The synchronous
in-memory reservation mismatch is resolved within B1's approved public-contract
scope. Routine design choices, test/review failures, Docker corrections, or an
unavailable optional local Kubernetes cluster are not blockers. Stop only when
a human decision must change, required external evidence remains unavailable
after authorized attempts, repository/user-owned state prevents safe work, or
final security leaves a residual risk requiring human acceptance.
