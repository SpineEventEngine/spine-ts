# T-0211 work log

## 2026-08-19 — intake and ownership split

- Baseline fixed at `origin/main@f3a2d92b30537c8290dee2c963d079d4d2f978dc`.
- Classified high-risk because it changes deployable entrypoints and provider
  endpoint meaning, while preserving existing public and wire contracts.
- Read-only provider inventory used `gpt-5.6-luna` / `medium`; runtime telemetry
  unavailable and subagents prohibited. It confirmed GKE/GCE discovery already
  handles authoritative empty snapshots, scale changes, and stable identities,
  but currently describes ordinary application listeners rather than managed
  Coordinators.
- Read-only example inventory used `gpt-5.6-luna` / `medium`; runtime telemetry
  unavailable and subagents prohibited. It confirmed Message Board production
  examples still configure ZeroMQ and standalone application listeners, while
  Todo retains an obsolete ZeroMQ child-process fixture. Existing managed
  server acceptance supplies the replacement machinery.
- Work is split between non-overlapping provider and example lanes. The parent
  integration worktree remains coordination-only until both lanes are green.

## 2026-08-19 — provider Coordinator entrypoints

- Retained RED-32 in provider policy tests before product changes: neither
  provider template supplied explicit managed process/shard settings, GKE
  targeted a child-style `grpc` port, and entrypoints used standalone `Server`.
- GKE now exposes each ready Pod's node-local Coordinator through the headless
  Service. Its managed children remain loopback-only complete replicas.
- GCE starts its Coordinator and initial replicas before its registrar publishes
  the VM endpoint. The composed handle withdraws that lease, stops children,
  and closes the registry in that order; abrupt VM loss remains lease expiry.
- The managed child re-executes the same entry module. It therefore recognizes
  the existing framework-owned child marker and assembles its replica without
  constructing or publishing a second GCE lease for the VM.

## 2026-08-19 — provider review corrections

- GKE readiness now probes the same named `coordinator` port exposed by its
  ready-only headless Service. The policy test binds probe, container, and
  Service names together.
- GCE uses caller-owned `ManagedServerApplication.start()` and installs one
  provider-owned `SIGINT`/`SIGTERM` close path before registrar startup, so
  registration itself has no signal-ordering gap. It removes only those exact
  outer listeners after the idempotent close settles, preserving unrelated
  process listeners. That close path withdraws the lease before managed-child
  and registry closure.
- Registrar startup failure now invokes `registrar.close()` before the existing
  managed/registry rollback, preserving each failure as a flat ordered aggregate.
- `application_process_count` and `delivery_shard_count` are required Terraform
  inputs and explicit example values. They are independent configuration: the
  app assembly receives the shard count and selects its own Delivery strategy.
- Provider docs and references now explain Coordinator discovery and the two
  explicit settings. No ZeroMQ, direct transport, child endpoint, or new wire
  concept was introduced.

## 2026-08-19 — example-lane managed Message Board checkpoint

- RED-31 retained first: the Message Board deployment-entrypoint test required
  `managed-entry.ts`, explicit `PROCESS_COUNT` and `DELIVERY_SHARD_COUNT`, a
  Coordinator-managed entry module, and no ZeroMQ/IPC setting in the
  replacement configuration. It failed because that entrypoint did not exist.
- The managed entry now runs the same module in parent and child processes,
  builds the full Message Board context only in each child, opens that child's
  `RemoteDelivery`, and explicitly selects its application-owned shard
  strategy. The Gateway keeps only browser/subscription responsibilities and
  does not configure Delivery or a runtime environment.
- Message Board's old production ZeroMQ configuration was removed from this
  replacement path. Repository-wide transport deletion remains T-0212.

## 2026-08-19 — example topology and Todo checkpoint

- The Compose and Kubernetes RED fixtures were changed first to require node
  Coordinators, explicit process/shard values, and no IPC configuration. They
  failed against the previous application-listener topology; after conversion,
  the one-node reference has one managed node with two complete replicas and
  the distributed reference has two such nodes.
- Todo retains its local in-memory `start` path. Its separate managed entry
  uses the already accepted Datastore storage adapter and `RemoteDelivery`, so
  every child has shared application state and direct Delivery observation.
  This is bounded example configuration, not a new framework setting.
- The managed Todo source contract was written RED first. It requires the
  explicit process/shard settings and rejects the retired signal transport
  terms. It now passes.

## 2026-08-19 — configuration coverage correction

- Moved Todo’s managed environment parsing into a private example module so
  invalid and independent process/shard choices are behaviorally tested without
  exposing a framework API. Message Board’s existing deployment configuration
  already provides the equivalent private application seam.

## 2026-08-19 — runtime prerequisite: optional legacy signal transport

- Runtime lane assignment: existing `implementer` role, configured
  `gpt-5.6-terra` / `medium`; runtime telemetry unavailable and subagents
  prohibited.
- Retained RED: a Production `ServerEnvironment` configured with storage and a
  complete schema registry, but no generic `SignalTransport`, failed with
  `Production ServerEnvironment requires transport.` The managed external-event
  child could not use Production under that requirement.
- Minimal bridge: Production now requires only storage and the complete type
  registry. `transport` remains an optional legacy facility. `Server` creates
  and opens `ContextTransportGroup` only when that facility was explicitly
  supplied. Local/default and explicitly configured legacy transport behavior
  remain unchanged until T-0212 removes the subsystem.
- A real managed child now selects Production, supplies storage plus its
  complete event schema registry, and supplies no legacy signal transport. Its
  domestic and ThirdParty external-event paths still complete through the
  process-local broker and Delivery.

## 2026-08-19 — managed caller-owned lifecycle

- Provider review required the same lifecycle distinction already exposed by
  `Server`: `run()` owns process signals; `start()` leaves them to the caller.
  This is a public lifecycle correction, not another managed-process role.
- Retained RED: a coordinator selected for caller-owned startup still installed
  one extra `SIGINT` listener. The test also retains an unrelated listener
  registered during startup, so lifecycle teardown cannot remove listeners it
  does not own.
- `ManagedServerApplication.start(options)` now shares the existing validation,
  child behavior, replica startup, and Coordinator path with `run(options)`.
  It passes only an internal Coordinator signal-ownership flag. `run()` passes
  `true`; `start()` passes `false`; children are unchanged.
- Explicit caller close remains the existing idempotent/retryable coordinator
  close path. The process-owned `run()` proof verifies that it removes only its
  exact handlers and preserves an unrelated startup-time listener.

## 2026-08-19 — API review P1 documentation correction

- Review concern: `typescript_api_docs_reviewer`, configured
  `gpt-5.6-terra` / `high`; runtime telemetry unavailable. Disposition:
  accepted documentation-only P1.
- `packages/server/REFERENCE.md` and `RUNTIME_ARCHITECTURE.md` now state that
  Production requires `storageFactory` plus the complete `typeRegistry` only.
  The legacy `transport` setting is optional and opens its bindings only when
  explicitly supplied; the Production example omits it.
- The same references now distinguish `ManagedServerApplication.run()`
  (framework-owned `SIGINT`/`SIGTERM`) from `start()` (caller-owned signals and
  explicit handle close). No product code or public shape changed in this
  correction.

## 2026-08-19 — reliability review P2 public-facade proof

- Review concern: `performance_reliability_reviewer`, configured
  `gpt-5.6-terra` / `high`; runtime telemetry unavailable. Disposition:
  accepted test-only P2.
- A separate real parent process now calls the public
  `ManagedServerApplication.start()` facade. It proves neither `SIGINT` nor
  `SIGTERM` gains a managed listener, and it calls the returned handle's
  `close()` twice before reporting completion. Existing direct coordinator and
  public `run()` listener-ownership proofs remain intact.

## 2026-08-19 — provider caller-owned lifecycle adoption

- Merged `origin/codex/t0211-runtime-prereq@ddd78fe81` without rewriting the
  provider branch. GCE now selects `ManagedServerApplication.start()` and owns
  only its exact outer signal callbacks; global listener discovery/removal was
  removed.
- The provider test preserves an unrelated `SIGTERM` listener across managed
  startup, simulated graceful shutdown, and explicit outer close while proving
  `withdraw → managed → registry` order.

## 2026-08-19 — managed replica registry correction

- The retained container smoke passed the optional legacy-transport gate and
  then correctly rejected Message Board's default persistent registry. Managed
  children require the existing volatile `InMemorySubscriptionRegistry`; the
  Gateway remains the only durable client-subscription authority.
- The example now injects that registry only into the managed child Context.
  This uses the accepted framework facility and neither reintroduces a signal
  transport nor adds a registry or transport concept.

## 2026-08-19 — converged example acceptance

- Local emulator mode now retains the normal structured console logger and
  avoids constructing the Cloud Logging transport; real cloud mode retains the
  Cloud Logging transport. This is private Message Board composition applied
  consistently to application, combined, Gateway, and managed entries.
- The final retained image smoke passed 5/5 with command/query/subscription/
  Delivery exercise. Earlier HTTP 503 diagnosis proved that unavailable
  Coordinator replicas, not discovery timing, caused the transient failure;
  the packaged emulator branch restored child readiness without a retry.

## 2026-08-19 — integrated convergence

- Merged the runtime, provider, and example lanes in the isolated T-0211
  worktree. Deterministic integration corrections were limited to strict lint,
  TSDoc, cleanup-ledger, snippet, and test-narrowing requirements; no new
  runtime concept or deployment behavior was introduced.
- The complete deterministic profile passed. The canonical bounded verifier
  then passed 25 files and 415 tests, followed by 12/12 Node deployment
  contracts.
- All task-relevant specialist findings are resolved and affected lanes passed
  re-review. The consolidated documentation and final security wave remains
  assigned to T-0213 after the T-0212 deletion boundary.
- T-0211 is review-complete and ready for isolated main integration. The next
  milestone is T-0212: delete ZeroMQ and generic signal routing now that the
  replacement deployment path has retained real acceptance.
