# Multi-process Delivery test

This maintainer test starts a local Delivery server and two independent Node
applications. It verifies ownership transfer and cleanup across real processes;
application developers do not need it for ordinary feature tests.

## 🚀 Run it

From a clean checkout, first run the composite generated-build prerequisite:

```bash
pnpm --config.verify-deps-before-run=false typecheck:build
```

Then run:

```bash
pnpm --config.verify-deps-before-run=false exec vitest run \
  packages/delivery-client/test/e2e/multi-machine-delivery.test.ts
```

## ✨ What it proves

The suite starts one standalone in-memory `simple-server` on trusted loopback,
then starts two independent Node applications. Each application imports only
package-root delivery APIs and generated descriptors; parent observation uses
the generated Admin and health descriptors over its own HTTP/2 session.

The success scenario asserts exclusive pickup and release, exact ordinary and
stale-takeover Admin sequences, exactly 20 post-ACK updates, final shard state,
health, and replacement-supervisor delivery. A deliberate failure scenario
proves process/stream cleanup and same-port reuse while preserving the primary
failure.

Stale takeover uses a one-second processing timeout. The test observes the
stall admission time, proves no survivor dispatch during a deliberate 500 ms
sub-threshold window, requires takeover no earlier than the one-second expiry
with a 100 ms scheduling tolerance, and bounds completion to less than five
seconds.

## ⚠️ Limits

The test uses bounded IPC control/result frames. It is test support, not a
production supervisor or persistence adapter. The topology is TypeScript-to-TypeScript only; it does
not establish live JVM interoperability. Redis, Hazelcast, durable recovery,
public-network hardening, and a human admin UI are outside this test suite.
