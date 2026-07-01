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
- immutable delivery attempt/result values and failure classifications that
  derive retry eligibility as data for later policy consumers;
- publish/request operation contracts plus handler callback types; and
- async close behavior for future transport implementations.

This package pins the maintained official `zeromq@6.5.0` package for the later
local IPC adapter and keeps focused adapter-private smoke tests for same-host
publish/subscribe and request/reply IPC behavior. The package root remains
adapter-agnostic. ZeroMQ socket classes, endpoint strings, multipart frames,
native binding types, broker processes, retry executors, durable delivery,
handler invocation, and server wiring are not exported from the public
transport API.

The lifecycle seam is contract-and-helper state only. It exposes stable broker
and worker participant identities, logical worker roles, deterministic worker
registrations over `TransportSubscription`, lifecycle states, readiness states,
and async-close semantics for future lifecycle-managed participants. It does
not open sockets, start child processes, supervise processes, choose socket
topology, probe readiness over IPC, invoke handlers, add durable inbox/outbox
storage, execute retry timers/loops, or wire `@spine-ts/server`.
Builder inputs stay canonical: worker registrations and lifecycle snapshots take
`TransportParticipantIdentityInput` values and rehydrate frozen identities from
those semantic fields instead of accepting prebuilt participant objects.

The delivery/retry boundary is data-only. `createTransportDeliveryAttempt()`
derives attempt keys from a logical subscription, worker identity, delivery ID,
target ID, and 1-based attempt number, rejecting forged prebuilt attempt keys
or subscription/worker keys. `classifyTransportDeliveryFailure()` maps stable
failure kinds to retry eligibility and keeps only allowlisted scalar diagnostic
details. `createTransportDeliveryResult()` derives `delivered` or `failed`
status from the attempt outcome and preserves retry eligibility as separate
data for later policy consumers. It rejects caller-supplied statuses or result
keys that do not match. These helpers do not write durable inbox/outbox
records, deduplicate delivery records, run retry loops or timers, schedule
workers, invoke handlers, dispatch repositories, supervise processes, or define
server runtime behavior.

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
