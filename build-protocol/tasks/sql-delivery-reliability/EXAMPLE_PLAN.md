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

## Exact prose checklist

Read-only documentation verification accepted from existing documentation_reviewer /root/publication_documentation_review, original explicit gpt-6-luna/medium retained and both fields restated; runtime metadata unavailable. No builds, edits or execution by reviewer. These are requirements for the example slice, not runtime evidence.

- Orders README around204 already labels learning scope; add explicit local teaching/deployment distinction and a link to Distributed Message Board for shared multi-process Delivery.
- Projects README around122 gives memory/loopback limits; add teaching label and the same supported deployment link.
- Todo README13 preserves single-process memory/MySQL/PostgreSQL. Lines76–104 already describe shared launch and separate counts. Add explicit multi-process recommendation, pending Inbox loss on simple Delivery restart despite SQL business state, and separate timing values.
- Message Board README46 preserves local React/single-process mode. Lines58–68 need recommendation plus supported process/shard variables and verified8/8 command after launcher implementation. Lines237–242 must distinguish Gateway query recovery from loss of pending in-memory Delivery work.
- Distributed Message Board README39 correctly describes current two-node/two-process/two-shard topology. Lines53–60 already state in-memory/no-HA; add accepted-pending loss on Delivery restart while Datastore business state persists, recommendation, and timer distinction.
- Message Board deploy/README26 describes required Delivery and Gateway recovery but omits Delivery restart loss/timers. Link one clear canonical explanation rather than duplicating divergent prose.
- delivery-server/README76 shows processingTimeoutMs30000 as an example while defaults disable it; label this explicitly as an optional override.

Timer prose must distinguish configurable10-second scan,60-second stale-session age and separately configurable server processing timeout (default disabled); none guarantees a delivery/takeover deadline. Do not claim crash verification before actual evidence exists. Database-only multi-process choice remains explicit and discouraged because notifications are local and missed work may wait for recovery. Retain all local exceptions.

Parent managed-launcher source check: server REFERENCE's native/managed hosting
section still calls the Coordinator port nonzero, although the starting HEAD's
public options and validator already support zero for an OS-selected port.
Correct that sentence alongside launch configuration documentation. This is
stale prose, not a new port contract.
