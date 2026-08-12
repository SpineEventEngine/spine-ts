# Projects example reference

This reference is for coding agents and maintainers. Beginners should start
with the [Projects README](README.md).

## Topology

The fixed registry contains three Aggregates (`Project`, `Task`, and `Person`),
twenty Projections, and ten Process Managers: thirty-three repositories. Proto
and handler registries are generated artifacts and must not be edited.

The local topology does not select a durable provider. In a durable composition,
providers can push down record IDs and declared `(column)` filters or sort
fields, but `RecordQuery<I>` statically types IDs only. The descriptor and
column mapping validate filter/sort names and `unknown` filter values at runtime;
unmarked fields remain in authoritative bytes. MySQL routes a complete tenant to
its configured database; Datastore routes it to a native namespace. Neither
provider uses the Bounded Context name as a physical partition.

## Load-runner behavior

Each simulated user uses one HTTP/2 session and a subscription filtered to its
project ID. The user activates the subscription, posts `CreateProject`, requires
an OK acknowledgement, polls until that exact `ProjectSummary` appears, and
then consumes its correlated update.

Command and query latency start at command submission. Subscription latency
starts when the final update wait begins. The report includes p50, p95, and p99
for each measurement, completed paths, failures, and throughput. Every user
aborts its controller and session, then gives `iterator.return()` a bounded
500 ms cleanup window. Visibility waits are bounded by five seconds. The
runner does not send a cancellation RPC.

## Verification

```bash
pnpm vitest run \
  examples/projects/test/proto-module.test.ts \
  examples/projects/test/topology.test.ts \
  examples/projects/test/load-runner.test.ts
```

The runner excludes mixed updates, assignment, refusal, production persistence,
authentication, deployment, warm-up, steady-state phases, randomized think
time, and failure injection. Native loopback permission is required.
