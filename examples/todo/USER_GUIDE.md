# To-Do Example User Guide

Current status: bootstrap placeholder; the example is not runnable yet.

This guide will eventually explain how to generate Protobuf-ES code, start the
to-do server, post commands, query state, subscribe to updates, run tests, and
understand which framework features the example demonstrates.

T-0011 does not implement the to-do domain or a runnable server. It does make
future example implementation less speculative by adding these framework seams:

- `@spine-ts/server` can derive command/event readiness from handler metadata
  and feed `createServerRuntimeRoutingPlan()`.
- `createServerRuntimeRoutingPlan()` emits immutable command/event transport
  topics, subscriptions, worker registrations, and explicit deferred
  query/subscription/system seams.
- `@spine-ts/transport` owns adapter-agnostic topics, logical subscriptions,
  broker/worker lifecycle snapshots, and delivery/retry boundary data.
- The ZeroMQ foundation is still adapter-private local IPC only; it proves
  same-host `ipc://` smoke behavior but does not define production endpoints.

The example still needs later tasks for generated to-do Protobuf contracts,
domain entities, repositories, handler invocation, runtime dispatch,
transport-backed service hosting, durable delivery, query/subscription
execution, server startup, and black-box tests.
