# SQL transport lifecycle matrix preparation

This prepared wrapper covers the four frozen lifecycle scenarios—`cancel-retry`, `pending-cancel`, `concurrent-teardown`, and `stream-reconnect`—across PostgreSQL 16, PostgreSQL 18, MySQL 8.4, and MariaDB 11.4; native, gRPC-Web, and Connect; and `db-only` and `shared-memory` Delivery modes. The full inventory is 96 cases, run sequentially and fail-fast.

The package command for each case is `pnpm --filter @spine-event-engine/server-blackbox-tests test:subscription-transports`. The runner supplies `SPINE_TS_TRANSPORT_PROVIDER`, `SPINE_TS_TRANSPORT_PROTOCOL`, `SPINE_TS_TRANSPORT_SCENARIO`, and `SPINE_TS_TRANSPORT_DELIVERY_MODE`. The driver obtains dedicated endpoints from `evidence/databases.json` and creates a UUID database per run.

The wrapper saves a fresh session manifest, per-case invocation records, and complete command logs under `evidence/transport-lifecycle-matrix/sessions/<session-uuid>/`. It correlates each new run directory by the exact provider, protocol, scenario, and Delivery mode, so other concurrently written transport artifacts cannot be mistaken for the selected case. It checks the fixture resource/result/cleanup identities, verifies the matching unique database was dropped and no backend sessions or cleanup errors remain, and compares source and compiled artifact hashes with the launch snapshot after each case. A command, artifact, cleanup, or provenance failure stops the matrix and preserves the raw case evidence plus the unrun inventory.

The wrapper captures the transport driver and helper source, integration-test source, relevant auth/deployment/server/client/Delivery/storage/protobuf compiled outputs, and the exact run resource artifacts. Scenario-specific counter and lifecycle assertions remain in the existing integration test; the wrapper independently checks each persisted result's status and case identity.

The execution surface's configured function profile is `gpt-6-luna` / `low`; runtime introspection is unavailable. This directory is preparation only. Do not launch the matrix until the implementation owner freezes the fixture and the parent explicitly releases execution.

Plan-only validation command:

```sh
node build-protocol/tasks/sql-delivery-reliability/evidence/transport-lifecycle-matrix/run-transport-lifecycle-matrix.mjs --plan
```

After an explicit release, the execution command will be:

```sh
TMPDIR=/Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts/build-protocol/tasks/sql-delivery-reliability/evidence/runtime-tmp node build-protocol/tasks/sql-delivery-reliability/evidence/transport-lifecycle-matrix/run-transport-lifecycle-matrix.mjs
```
