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
the generated Admin and health descriptors over a separate HTTP/2 session.

The suite checks exclusive pickup, release, and the final state shown by Admin.
Admin may combine rapid changes to the same shard into one update. The test
therefore allows intermediate updates to vary. It also checks service health,
delivery on a replacement application node, and cleanup after a deliberate
failure by starting another server on the same port.

The test pauses one application inside its handler and checks that the other
application leaves the shard alone. It kills the paused process, waits for
the assignment to become at least one second old, then calls
`ShardService.ReleaseSessions` with a one-second inactivity period. The
Delivery server reports the free shard on its work stream. The surviving
application picks it up and delivers the pending message.

## ⚠️ Limits

The test uses IPC to drive its two TypeScript application processes and inspect their results. Both applications connect to the same TypeScript Delivery server on loopback.
