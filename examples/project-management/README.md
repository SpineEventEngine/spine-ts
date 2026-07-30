# Project-management load example

This runnable local specimen exercises generated Spine TS handlers through the
real gRPC-compatible `CreateProject`, query, and `ProjectSummary` subscription
services. Its fixed registration topology is three aggregates (`Project`,
`Task`, and `Person`), twenty projections, and ten process managers, for
thirty-three repositories.

Build the generated types, handler registry, and runnable package first:

```bash
pnpm typecheck:build
```

Run the focused nine-test suite, including Proto-package, topology, and load
runner coverage:

```bash
pnpm vitest run \
  examples/project-management/test/proto-module.test.ts \
  examples/project-management/test/topology.test.ts \
  examples/project-management/test/load-runner.test.ts
```

The load-runner suite includes a real 10-user loopback smoke scenario. Run the
same local scenario at one of the supported independent-user levels:

```bash
SPINE_PROJECT_LOAD_USERS=10 pnpm --filter @spine-event-engine/example-project-management load
SPINE_PROJECT_LOAD_USERS=25 pnpm --filter @spine-event-engine/example-project-management load
SPINE_PROJECT_LOAD_USERS=50 pnpm --filter @spine-event-engine/example-project-management load
SPINE_PROJECT_LOAD_USERS=100 pnpm --filter @spine-event-engine/example-project-management load
```

Each asynchronous user owns a local HTTP/2 session and a subscription targeted
to its exact project ID. It activates that subscription, submits
`CreateProject`, requires an OK command acknowledgement, polls the matching
`ProjectSummary` query until that exact ID is visible, then consumes the first
correlated subscription update. Command-acknowledgement and query-visibility
latencies start at command submission. Subscription-delivery latency starts at
the final subscription wait after query visibility, rather than at command
submission. The runner records p50/p95/p99 values for those three measurements,
completed path counts, failed users, and scenario throughput.

Every user finally aborts its controller and HTTP/2 session, then gives the
subscription iterator a bounded 500ms best-effort cleanup window. Command,
query, and subscription visibility waits are bounded by five seconds. The
runner does not call the subscription service's cancellation RPC.

This is an in-memory local load specimen, not a production benchmark or an SLO.
It does not exercise mixed updates, assignment, refusal, validation, persistence,
authentication, deployment, monitoring, multi-host transport, warm-up or
steady-state phases, randomized think time, or failure-injection metrics.
Sandboxes that deny loopback listeners require an environment that permits
`127.0.0.1` binding for the real gRPC checks.
