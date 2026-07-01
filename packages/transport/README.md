# @spine-ts/transport

Adapter-agnostic transport contracts for local signal routing.

Current scope:

- immutable transport topics framed in signal kinds, payload type URLs, semantic
  tags, and deterministic routing keys;
- immutable subscription descriptors with logical subscriber IDs and delivery
  mode only, never process IDs, filesystem paths, hostnames, socket names, or
  endpoints;
- publish/request operation contracts plus handler callback types; and
- async close behavior for future transport implementations.

This package pins the maintained official `zeromq@6.5.0` package for the local
IPC adapter foundation and keeps focused adapter-private smoke tests for
same-host publish/subscribe and request/reply IPC behavior. The package root
remains adapter-agnostic. ZeroMQ socket classes, endpoint strings, multipart
frames, native binding types, broker processes, participant lifecycle values,
worker registrations, delivery attempts/results, retry policy, durable
delivery, handler invocation, and server wiring are not exported from the
public transport API. Delivery, inbox, participant lifecycle, and retry
concepts belong to later roadmap tasks.

ZeroMQ is reserved for local IPC on one host. The native binding install script
is explicitly approved in the workspace pnpm configuration, and development or
CI environments must allow that build step when restoring dependencies. Current
adapter-private helpers only normalize local IPC configuration and module
typing. The smoke tests open sockets only under temporary IPC directories and
clean them up within the test process; they do not define production endpoint
layout, frame formats, retries, delivery semantics, process supervision, broker
topology, worker registration handshakes, or server runtime wiring. Managed
sandboxes may reject ZeroMQ `ipc://` binds with `EPERM`, so live local IPC smoke
runs can require native IPC filesystem/socket permissions outside the sandbox.
Scaling beyond one host must use another adapter behind the same public
transport contracts.
