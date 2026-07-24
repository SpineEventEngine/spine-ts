# Project-management load example

This runnable local specimen exercises generated Spine TS handlers through the
real gRPC-compatible `CreateProject`, query, and `ProjectSummary` subscription
services. Its fixed registration topology is three aggregates (`Project`,
`Task`, and `Person`), twenty projections, and ten process managers. The current
runner is a bounded single-phase create-project scenario; mixed update,
assignment, refusal, and validation workloads are future slices.

Build generated types, the handler registry, and the runnable package first:

```bash
pnpm typecheck:build
```

Run the bounded local scenario at one of the supported independent-user levels:

```bash
SPINE_PROJECT_LOAD_USERS=10 pnpm --filter @spine-event-engine/example-project-management load
SPINE_PROJECT_LOAD_USERS=25 pnpm --filter @spine-event-engine/example-project-management load
SPINE_PROJECT_LOAD_USERS=50 pnpm --filter @spine-event-engine/example-project-management load
SPINE_PROJECT_LOAD_USERS=100 pnpm --filter @spine-event-engine/example-project-management load
```

Each asynchronous user owns a local HTTP/2 session and subscription. It creates
a project, requires an OK command acknowledgement, waits for the generated
`ProjectSummary` query result, consumes its first correlated subscription
update, then aborts and bounds cleanup of its resources. The JSON result records
requested and failed users, completed command/query/subscription counts,
p50/p95/p99 latency for acknowledgement, eventual query visibility, and first
subscription delivery, plus scenario throughput. Latency samples begin at
command submission; visibility and subscription waits are bounded by five
seconds, and iterator cleanup receives a bounded 500ms window.

The focused test runs the real loopback flow plus a 10-user smoke scenario:

```bash
pnpm vitest run examples/project-management/test/topology.test.ts
```

This is an in-memory local load specimen, not a production benchmark or
throughput SLO. It has no persistence, authentication, deployment, monitoring,
or multi-host transport. The CLI is repeatable load mode; the focused test is
smoke mode. Warm-up, steady-state phases, randomized think time, and
failure-injection metrics are not implemented yet. Sandboxes that deny loopback
listeners require running the real gRPC checks in an environment that permits
`127.0.0.1` binding.
