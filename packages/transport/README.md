# @spine-ts/transport

Adapter-agnostic transport contracts for local signal routing.

Current scope:

- immutable transport topics framed in signal kinds, payload type URLs, semantic
  tags, and deterministic routing keys;
- immutable subscription descriptors with logical subscriber IDs and delivery
  mode only;
- publish/request operation contracts plus handler callback types; and
- async close behavior for future transport implementations.

This package pins the maintained official `zeromq@6.5.0` package for the later
local IPC adapter, but the package root remains adapter-agnostic. ZeroMQ socket
classes, endpoint strings, multipart frames, native binding types, broker
processes, retries, durable delivery, worker lifecycle, and handler invocation
are not exported from the public transport API.

ZeroMQ is reserved for local IPC on one host. The native binding install script
is explicitly approved in the workspace pnpm configuration, and development or
CI environments must allow that build step when restoring dependencies. Current
adapter-private helpers only normalize local IPC configuration and module
typing; they do not open sockets, bind or connect IPC paths, define frame
formats, or run smoke tests. Live IPC behavior is deferred to later transport
tasks.
