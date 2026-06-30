# @spine-ts/transport

Adapter-agnostic transport contracts for the first local signal-routing slice.

Current scope:

- immutable transport topics framed in signal kinds, payload type URLs, semantic
  tags, and deterministic routing keys;
- immutable subscription descriptors with logical subscriber IDs and delivery
  mode only;
- publish/request operation contracts plus handler callback types; and
- async close behavior for future transport implementations.

This package does not install ZeroMQ or expose broker endpoints, socket names,
multipart frames, retries, durable delivery, worker lifecycle, or handler
invocation. Those are deferred to later transport tasks.
