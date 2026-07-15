# @spine-ts/transport

Adapter-agnostic transport contracts for signal routing, with a same-host
ZeroMQ IPC adapter on an explicit subpath.

Current scope:

- immutable transport topics framed in signal kinds, payload type URLs, semantic
  tags, and deterministic routing keys;
- immutable subscription descriptors with logical subscriber IDs and delivery
  mode only, never process IDs, filesystem paths, hostnames, socket names, or
  endpoints;
- publish/request operation contracts plus handler callback types;
- async close behavior for transport implementations; and
- an adapter-scoped ZeroMQ local IPC implementation available from the
  `@spine-ts/transport/zeromq` subpath.

`@spine-ts/server` can bind command/event runtime routes to any implementation
of this `SignalTransport` contract, but this package still does not import
server runtime code or expose a concrete production adapter from its root API.

This package pins the maintained official `zeromq@6.5.0` package for local IPC.
The adapter-scoped `@spine-ts/transport/zeromq` subpath exports exactly
`createZeroMqAdapterConfig()`, `createZeroMqTransport()`,
`ZeroMqAdapterConfig`, `ZeroMqAdapterConfigInput`, `ZeroMqTransportScope`, and
`ZeroMqTransportOptions`. The package root remains adapter-agnostic. ZeroMQ
socket classes, endpoint strings,
multipart frames, native binding types, broker processes, participant lifecycle
values, worker registrations, delivery attempts/results, retry policy, durable
delivery, and handler materialization are not exported from the public transport
API. Delivery and inbox concepts are implemented in `@spine-ts/server`;
participant lifecycle, broker supervision, retained retry history,
remote/multi-host transport, and production health policy are initial-release
exclusions; this documentation makes no future-policy commitment.

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
checks. It provides no exactly-once, durable-redelivery, retry, restart, or
remote-delivery guarantee. Managed sandboxes may reject ZeroMQ `ipc://` binds
with `EPERM`, so live
local IPC runs can require native IPC filesystem/socket permissions outside the
sandbox. This adapter's supported scope ends at one host.

IPC directory preparation walks the lexical path before canonicalizing it.
The final component cannot be a symlink. On POSIX, an ancestor symlink is
accepted only for immutable root-owned system aliases such as macOS `/tmp` and
`/var`; the canonical final directory must be owned by the effective user with
exact mode `0700`. Missing components are created one at a time. The adapter
pins the prepared directory identity and rechecks canonical path, type,
ownership, mode, device, and inode immediately before each native bind or
connect. Non-POSIX hosts reject a final link/junction and recheck canonical
directory identity where stable, but do not claim POSIX UID/mode enforcement.

ZeroMQ binds pathname endpoints and cannot bind relative to a held directory
descriptor. A directory substitution after the final recheck therefore remains
possible. Deploy the canonical IPC directory beneath a non-attacker-writable
parent, and grant access only to trusted same-host peers.

For `command` and `event` topics, the private adapter writes and reads the
generated Spine `Command` and `Event` envelopes as Buf Protobuf binary with
unknown fields disabled. No Protobuf wire contract is defined for `query`,
`subscription`, or `system`; the current adapter retains their private V8
encoding. `TransportSignalEnvelope` makes the public `command`/`event` envelope
types the generated `Command`/`Event` types while preserving caller-selected
types for the other signal kinds.

Use the fixed-path kind predicates when consuming an operation or topic whose
kind is widened or is a union:

```ts
import {
  isTransportOperationKind,
  isTransportTopicKind,
  type PublishTransportOperation,
  type TransportTopic,
} from "@spine-ts/transport";

function onTransportOperation(operation: PublishTransportOperation<{ readonly id: string }>): void {
  if (isTransportOperationKind(operation, "event")) {
    operation.envelope; // Inferred as the generated Event type.
  }
}

function onTransportTopic(topic: TransportTopic): void {
  if (isTransportTopicKind(topic, "event")) {
    topic.signalKind; // Inferred as "event".
  }
}
```

`isTransportOperationKind()` always compares `operation.topic.signalKind`;
`isTransportTopicKind()` always compares `topic.signalKind`. These fixed paths
are type-narrowing aids, not validation of untrusted input or envelope content,
and neither predicate inspects the envelope. The topic helper narrows only the
top-level `signalKind`; it does not validate or narrow the routing descriptor or
`routing.signalKind`.

Every inbound `Subscriber`, `Request`, and `Reply` frame has an exact
8,388,608-byte rejection ceiling. This is a per-frame maximum, not a fixed
allocation for ordinary traffic. Publish and request messages place the route
in frame 1. Frame 2 is a Buf payload for `command`/`event` and a private V8
payload for reserved `query`/`subscription`/`system`. A successful request
result uses the existing private V8 wrapper in reply frame 1; it is not Spine
`Ack`. Generated-message-shaped results, including any object with a string
`$typeName`, are rejected before V8 serialization. Receivers consume only those
protocol frames and ignore trailers after zeromq.js has already materialized
the full multipart message. SF-013 therefore remains accepted and unbounded in
aggregate. Peers using the old V8 command/event wire are incompatible with
Buf-wire peers and must upgrade together. Treat every `ipc://` frame as trusted
runtime data: only same-host Spine TS runtime peers that already trust each
other should share the transport, and `ipcDirectory` must be private to those
peers.

`createZeroMqTransport()` bounds request/reply send and receive work with
`requestTimeoutMs`, which defaults to 2,000 milliseconds. When supplied, it
must be an integer from 1 through 2,147,483,647; invalid values throw before
filesystem or socket work. `receiveTimeoutMs` remains a separate background
worker setting, and an already-sent request is not actively cancelled.
