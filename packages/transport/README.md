# @spine-ts/transport

Adapter-agnostic transport contracts for local signal routing.

Current scope:

- immutable transport topics framed in signal kinds, payload type URLs, semantic
  tags, and deterministic routing keys;
- immutable subscription descriptors with logical subscriber IDs and delivery
  mode only;
- immutable broker/worker participant identities, worker registrations, and
  lifecycle/readiness snapshots expressed only in logical roles and transport
  subscriptions;
- publish/request operation contracts plus handler callback types; and
- async close behavior for future transport implementations.

This package pins the maintained official `zeromq@6.5.0` package for the later
local IPC adapter and keeps focused adapter-private smoke tests for same-host
publish/subscribe and request/reply IPC behavior. The package root remains
adapter-agnostic. ZeroMQ socket classes, endpoint strings, multipart frames,
native binding types, broker processes, retries, durable delivery, handler
invocation, and server wiring are not exported from the public transport API.

The lifecycle seam is contract-and-helper state only. It exposes stable broker
and worker participant identities, logical worker roles, deterministic worker
registrations over `TransportSubscription`, lifecycle states, readiness states,
and async-close semantics for future lifecycle-managed participants. It does
not open sockets, start child processes, supervise processes, choose socket
topology, probe readiness over IPC, invoke handlers, classify retries or
delivery failures, add durable inbox/outbox storage, or wire
`@spine-ts/server`.

ZeroMQ is reserved for local IPC on one host. The native binding install script
is explicitly approved in the workspace pnpm configuration, and development or
CI environments must allow that build step when restoring dependencies. Current
adapter-private helpers only normalize local IPC configuration and module
typing. The smoke tests open sockets only under temporary IPC directories and
clean them up within the test process; they do not define production endpoint
layout, frame formats, retries, delivery semantics, process supervision, or
server runtime wiring. Managed sandboxes may reject ZeroMQ `ipc://` binds with
`EPERM`, so live local IPC smoke runs can require native IPC filesystem/socket
permissions outside the sandbox.
