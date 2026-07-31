# Project-management load-test example

Status: task specification; implementation not started

## Objective

Add a new example application and repeatable load test that exercises the real
gRPC command, query, and subscription paths with independent asynchronous
clients. The example is a performance specimen, not a production benchmark or
an invitation to add public monitoring APIs.

## Fixed topology

- 3 aggregates: `Project`, `Task`, `Person`/assignee membership.
- 20 projections: project summary, task lists, status/priority counters,
  assignee workload, activity feeds, and tenant/user views.
- 10 process managers: assignment, due-date, status, notification, workload,
  project lifecycle, task dependency, audit, subscription fan-out, and cleanup
  workflows.
- 10, 25, 50, and 100 independent end-users per scenario.
- One real local gRPC-compatible server; clients use only generated messages and
  public package APIs.

## Workload

Each virtual user independently and asynchronously mixes:

- post create/update/assign/complete-task commands;
- query project summaries, task lists, workload, and activity read models;
- subscribe to project/task state changes, consume updates, and cancel cleanly.

Use bounded per-user concurrency, randomized think time, a warm-up period,
steady-state measurement period, and drain/cleanup. Record command
acknowledgement latency separately from eventual projection/query visibility and
subscription update latency.

## Required acceptance evidence

- clean generation/build produces ignored registry output;
- all 3 aggregates, 20 projections, and 10 process managers are registered;
- 10/25/50/100-user runs complete without leaked subscriptions, sessions, or
  child processes;
- command success/refusal/validation failure counts are reported;
- query freshness and subscription delivery completeness are checked against a
  correlation ID, not only latency percentiles;
- p50/p95/p99 and throughput are reported for command acknowledgement, query,
  first subscription update, and update delivery;
- storage, delivery, event-loop, and memory observations are collected without
  adding framework-internal instrumentation to the public API;
- the test is deterministic enough for CI smoke mode and has a larger local
  stress mode.

## Suggested files

`examples/projects/` with `src/`, generated proto/registry output,
`test/load-smoke.test.ts`, `test/load-stress.test.ts`, a scenario runner, and a
README documenting setup, limits, metrics, and interpretation. Keep the load
runner separate from domain handlers so the example remains a black-box client.

## Task boundary

This task does not optimize runtime code, promise a target throughput, add
production persistence, add public metrics/health APIs, or make distributed
multi-host claims. Any performance defect becomes a separately scoped task
with a reproduced workload and evidence.
