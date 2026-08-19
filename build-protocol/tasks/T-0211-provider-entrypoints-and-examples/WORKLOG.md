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

## 2026-08-19 — managed replica registry correction

- The retained container smoke passed the optional legacy-transport gate and
  then correctly rejected Message Board's default persistent registry. Managed
  children require the existing volatile `InMemorySubscriptionRegistry`; the
  Gateway remains the only durable client-subscription authority.
- The example now injects that registry only into the managed child Context.
  This uses the accepted framework facility and neither reintroduces a signal
  transport nor adds a registry or transport concept.
