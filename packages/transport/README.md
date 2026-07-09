# @spine-ts/transport

Adapter-agnostic transport contracts for local signal routing.

Current scope:

- immutable transport topics framed in signal kinds, payload type URLs, semantic
  tags, and deterministic routing keys;
- immutable subscription descriptors with logical subscriber IDs and delivery
  mode only, never process IDs, filesystem paths, hostnames, socket names, or
  endpoints;
- publish/request operation contracts plus handler callback types;
- async close behavior for future transport implementations; and
- an adapter-scoped ZeroMQ local IPC implementation available from the
  `@spine-ts/transport/zeromq` subpath.

`@spine-ts/server` can bind command/event runtime routes to any implementation
of this `SignalTransport` contract, but this package still does not import
server runtime code or expose a concrete production adapter from its root API.

This package pins the maintained official `zeromq@6.5.0` package for local IPC.
The adapter-scoped `@spine-ts/transport/zeromq` subpath exports
`createZeroMqAdapterConfig()` and `createZeroMqSignalTransport()`. The package
root remains adapter-agnostic. ZeroMQ socket classes, endpoint strings,
multipart frames, native binding types, broker processes, participant lifecycle
values, worker registrations, delivery attempts/results, retry policy, durable
delivery, and handler materialization are not exported from the public transport
API. Delivery and inbox concepts are implemented in `@spine-ts/server`;
participant lifecycle, broker supervision, retained retry history,
remote/multi-host transport, and production health policy remain outside this
package.

ZeroMQ is reserved for local IPC on one host. The native binding install script
is explicitly approved in the workspace pnpm configuration, and development or
CI environments must allow that build step when restoring dependencies. The
adapter derives compact deterministic IPC socket paths from the
`ZeroMqAdapterConfig` identity, the operation channel, and transport routing
descriptors, then keeps those paths private. Publish/subscribe and
request/reply tests open sockets only under temporary IPC directories and clean
them up within the test process. The implementation does not define remote
transport, transport-owned retry loops, durable delivery policy, process
supervision, broker topology, worker registration handshakes, or broad health
checks. Managed sandboxes may reject ZeroMQ `ipc://` binds with `EPERM`, so live
local IPC runs can require native IPC filesystem/socket permissions outside the
sandbox. Scaling beyond one host must use another adapter behind the same
public transport contracts.

The adapter serializes envelopes with Node's V8 serializer. Treat every
`ipc://` frame as trusted runtime data, not as an untrusted network protocol:
only same-host Spine TS runtime peers that already trust each other should share
the transport, and `ipcDirectory` must be private to those peers.
