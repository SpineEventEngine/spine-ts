# Example verification preparation

Read-only inventory by the existing orchestrator scanning function, explicitly
configured `gpt-6-luna` / `medium`; runtime metadata unavailable. Parent inspected
the distributed Compose file and image builder. No example was executed by this
scan. Implementation and all-five execution remain pending.

- **Orders:** `SPINE_DATASTORE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run load`.
  The script is an in-memory teaching workload despite the historical variable
  name, and binds an ephemeral loopback port. Preserve its labelled local scope.
- **Projects:** `SPINE_PROJECT_LOAD_USERS=10 pnpm --dir examples/projects run load`.
  Another local in-memory teaching workload with ephemeral loopback listener.
  Do not add managed-process infrastructure to either teaching mode.
- **Todo:** retain the single-process application and its SQL modes without a
  shared Delivery server. The separate multi-process demonstration already has
  independent process/shard settings and shared Delivery. Inspect its scripts
  when executing to select unique task service names and ports.
- **Message Board:** preserve the local React UI/single-process exception.
  `scripts/start-local-multi-process.sh` exposes process count but hard-codes two
  shards and host ports 8484, 8081, 8091, 8090 and 5173. Add coherent supported
  launch settings for an isolated eight-process/eight-shard verification. Keep
  app, Gateway, browser origin and UI endpoint settings consistent.
- **Distributed Message Board:** reuses the existing model/app/UI. Its current
  Compose topology explicitly has two managed nodes, each with two replicas and
  two Delivery shards. Gateway port is already configurable through
  `GATEWAY_PORT`; datastore and Delivery ports are container-internal. Use a
  unique Compose project name. Preserve the existing accurate in-memory,
  non-HA Delivery and current-state query recovery limits.

Both Message Board Compose modes also expose a fixed Gateway host port 18080
and share a directory-based default Compose project name. Supported port
overrides and documented project selection should make concurrent launches
unambiguous. The container image builder currently publishes fixed
`spine-ts/*:local` tags. Do not replace a shared image tag while other agents are
using it: select task-specific image tags through a coherent build/Compose
configuration or an equivalent isolated supported launch. Build context and
verification artifacts belong to this worktree; use a task-local temporary
directory when invoking helpers that honor `TMPDIR`.

Recheck all shared-Delivery launch commands actually start/connect the server.
Business-state SQL persistence does not persist the simple Delivery server's
Inbox. Document the measured server-restart loss boundary alongside the shared
Delivery recommendation. Explain recovery scan, stale-session and server
processing timeout separately; no ten-second delivery/takeover promise.
