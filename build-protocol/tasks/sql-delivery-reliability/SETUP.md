# SQL delivery reliability verification setup

Mechanical setup assignment: orchestrator-dispatched mechanical setup/read-only
inventory function (not a project role), explicitly dispatched as
`gpt-6-luna` / `medium`. Runtime self-introspection is unavailable on this
surface; the dispatch fields are the available profile evidence.

All containers below were created for this task with random suffix `8327eaa2`.
Their Docker IDs were captured immediately after creation and are recorded
here. They bind only to `127.0.0.1` with dynamically allocated host ports.
They have no mounted volumes and must remain running for this task's
verification. Disposable credentials: user `spine` for PostgreSQL and `root`
for MySQL-family servers; password `spine_sqlrel_tmp`.

| Engine        | Container name / ID                                                                                | Locked image reference                                                                                | Server version | Host endpoint     |
| ------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------- | ----------------- |
| PostgreSQL 16 | `spine-sqlrel-8327eaa2-pg16` / `c95a7bcdb86b279a700cad9379d3cee4b7dc960da5b1d0306f6614107a645ed7`  | `postgres@sha256:a3b7f434b2dc57ce85a67e171163eb8ab1a1ebcb39d27484661f26b1dfbe30d6` (`postgres:16.15`) | 16.15          | `127.0.0.1:63580` |
| PostgreSQL 18 | `spine-sqlrel-8327eaa2-pg18` / `50841829b2409499e6800f39dd8b11ba6de516ec7eec85145d10ace270f95ea0`  | `postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae` (`postgres:18.6`)  | 18.6           | `127.0.0.1:63609` |
| MySQL         | `spine-sqlrel-8327eaa2-mysql` / `730a636f7dca4d81251b563f225964a1db01cd94f4b914a8937776c786d88522` | `mysql@sha256:c592c15aaf4a1961e15d82eb31ea5987dda862d1c4b1e93424438c0e91dc1f8d` (`mysql:8.4.10`)      | 8.4.10         | `127.0.0.1:63610` |
| MariaDB       | `spine-sqlrel-8327eaa2-maria` / `7d865e3415ae5c4c609bf39f89d9f7fe78fcde853829af8517f49e58f64e6c21` | `mariadb@sha256:70cc072b29b4a89ae07abb2d4da2c64678a7f2dfe092751bb51c87d67dc1338b` (`mariadb:11.4`)    | 11.4.13        | `127.0.0.1:63612` |

Each container has three fresh databases: `spine_test`, `spine_tenant_a`, and
`spine_tenant_b`. MySQL and MariaDB have a disposable `root`@`%` account with
full privileges for host-side test connections and trigger injection.

## Environment

Use the PostgreSQL variables for either version by selecting the matching
endpoint and expected major. Set these for PostgreSQL 16:

```sh
SPINE_TS_POSTGRESQL_URL='postgresql://spine:spine_sqlrel_tmp@127.0.0.1:63580/spine_test'
SPINE_TS_POSTGRESQL_TENANT_A_URL='postgresql://spine:spine_sqlrel_tmp@127.0.0.1:63580/spine_tenant_a'
SPINE_TS_POSTGRESQL_TENANT_B_URL='postgresql://spine:spine_sqlrel_tmp@127.0.0.1:63580/spine_tenant_b'
SPINE_TS_POSTGRESQL_EXPECTED_MAJOR=16
```

For PostgreSQL 18, use the same URLs with port `63609` and set
`SPINE_TS_POSTGRESQL_EXPECTED_MAJOR=18`.

For MySQL, use port `63610`; for MariaDB, use port `63612`. Set the corresponding
four variables separately for each engine:

```sh
SPINE_TS_MYSQL_URL='mysql://root:spine_sqlrel_tmp@127.0.0.1:63610/spine_test'
SPINE_TS_MYSQL_ADMIN_URL='mysql://root:spine_sqlrel_tmp@127.0.0.1:63610/spine_test'
SPINE_TS_MYSQL_TENANT_A_URL='mysql://root:spine_sqlrel_tmp@127.0.0.1:63610/spine_tenant_a'
SPINE_TS_MYSQL_TENANT_B_URL='mysql://root:spine_sqlrel_tmp@127.0.0.1:63610/spine_tenant_b'
SPINE_TS_MYSQL_ENGINE=innodb
```

Change those URLs to port `63612` for MariaDB. `SPINE_TS_MYSQL_ADMIN_URL`
uses the same disposable admin account and database; the current live suite
uses it to add a trigger for SQL failure injection. Tenant integration cases
are enabled only when both tenant URLs are set.

## Readiness evidence

Readiness was checked by `pg_isready -U spine` in each PostgreSQL container and
`mysqladmin`/`mariadb-admin ping` in each MySQL-family container. Server version
and database names were queried inside each container. Captured final startup
log lines report PostgreSQL accepting connections, MySQL 8.4.10 ready for
connections, and MariaDB 11.4.13 ready for connections. MariaDB logged that
`io_uring_queue_init` was unavailable and it fell back to Linux native AIO; the
server reached ready state. Docker inspection confirmed all four containers
remain `Up` and every host binding is `127.0.0.1`.

The PostgreSQL logs also contain a benign setup-time duplicate-database error:
`spine_test` is created automatically by the official image, then the setup
attempted to create it again before creating both tenant databases. All three
required databases are present. This did not affect server readiness.

## Existing live SQL tests

- `packages/storage-postgres/test/postgresql-integration.test.ts` requires the
  three PostgreSQL URLs above and optionally checks the expected major. It
  covers CRUD/query/compare-and-set, timestamp ordering/pagination, Entity
  commits and tenant isolation. The package script also includes
  `packages/server/test/delivery/inbox-provider-cleanup.test.ts`.
- `packages/storage-mysql/test/mysql-integration.test.ts` is opt-in through
  `SPINE_TS_MYSQL_URL`; its tenant cases require both tenant URLs. It covers
  SQL storage and Entity paths, trigger-based failure injection through the
  admin URL, and tenant isolation. The package script also includes the same
  server Inbox cleanup suite. Run separately against MySQL and MariaDB.
- Focused SQL provider tests include
  `packages/storage-postgres/test/postgres-delivery-cleanup.test.ts`,
  `packages/storage-mysql/test/mysql-delivery-cleanup.test.ts`, provider
  integration/contract tests, and the two live integration suites. The
  cleanup provider files are primarily deterministic driver doubles; the
  provider cleanup acceptance test is the cross-provider live path.

## Process, transport, and fault-test inventory

Useful current tests include:

- Delivery state and concurrency: `packages/server/test/delivery/delivery-loop.test.ts`,
  `delivery-worker.test.ts`, `delivery-worker-runtime.test.ts`,
  `delivery-run-coordinator.test.ts`, `delivery-supervisor.test.ts`,
  `delivery-fencing.test.ts`, `shard-index.test.ts`,
  `packages/delivery-server/test/core/inbox-service.test.ts`,
  `mutation-admission.test.ts`, and `shard-service.test.ts`.
- Subscription readiness and teardown: server
  `handler/command-registration-readiness.test.ts`,
  `handler/event-registration-readiness.test.ts`,
  `server/durable-subscription-provider-conformance.test.ts`,
  `server/durable-subscription-public-contract.test.ts`,
  `server/managed-child-subscription.test.ts`,
  `server/server-lifecycle-integration.test.ts`, and delivery-client
  `managed-remote-delivery-readiness.integration.test.ts`,
  `client-rpc-lifecycle.test.ts`, and `remote-supervisor-grpc.integration.test.ts`.
- Process and real transport paths: `packages/delivery-server/test/bin/delivery-server-process.test.ts`,
  delivery-client `e2e/multi-machine-delivery.test.ts`,
  `delivery-client-grpc.integration.test.ts`,
  `managed-external-events.integration.test.ts`, and
  `remote-work-registry.test.ts`; server
  `services/native-subscription-integration.test.ts` exercises native client
  subscriptions.
- Fault behavior: delivery loop/worker/supervisor suites cover endpoint,
  monitor, run cancellation, shard release, retry/backoff, and shutdown
  failures. The MySQL live suite has trigger injection, and PostgreSQL/MySQL
  live storage suites exercise real SQL behavior. The existing in-memory
  response-loss suite is `packages/delivery-client/test/in-memory-core-response-loss.test.ts`.

## Matrix gaps to close

The inventory is mostly unit/contract tests plus one-process integration
coverage. It does not yet establish the requested repeated workloads across
PostgreSQL 16/18, MySQL 8.4, and MariaDB 11.4 with two and eight independent
processes; database-only versus shared Delivery; or end-to-end supported
transport acceptance for each topology. Add real process competition and
count handler executions, reconcile every accepted ID with durable SQL state
and projections or an explicit terminal outcome, and inspect executed SQL for
independent writes, conditional claims, cleanup, and recovery. Extend live
fault acceptance for each independent write, processing/monitor/acknowledgement
failure, partial recipient publication, retry exhaustion, and Event-only
recovery across restart. Exercise shared in-memory Delivery restart/crash with
accepted pending IDs and record the expected loss boundary. Cover missed
notifications, configurable idle recovery scans, cancellation races, and
bounded shutdown with real processes. Existing provider tests cannot substitute
for those matrix runs.

## Read-only reference investigation scripts

The read-only reference at
`/Users/armiol/development/Spine/spine-ts-and-appfactory/experiments/delivery-matrix`
contains useful starting points: `storage-matrix.mjs` for SQL acceptance,
`extended-matrix.mjs` for delivery/acknowledgement/lease/fault cases,
`gateway-matrix.mjs` for client subscription readiness and teardown over real
transports, and `run-matrix.py` for orchestration and evidence summarization.
`prepare-fixture.py`, `start-databases.py`, and `stop-databases.py` show fixture
and disposable-service mechanics; `test-startup-cleanup.py` documents their
cleanup checks. These scripts were inspected only, not run: their orchestration
writes results and fixture data under the reference tree and may operate on
fixed services. Portability and generated Protobuf fixture provenance should
be checked before adapting any case into this worktree.

## Domain fixture suitability for separate processes

`packages/server-blackbox-tests/proto/spine/server/testing/project_workflow.proto`
and the adjacent `project_commands.proto` / `project_events.proto` are suitable
for a two-recipient acceptance scenario without borrowing the reference
experiment's disposable source transforms. The checked-in domain model has
separate generated `PlanningId` and `StaffingId` message types, corresponding
Process Manager states, and a Portfolio Projection state. In
`test/project-event-routing.test.ts`, `ProjectPlanning` and `ProjectStaffing`
react to the same `ProjectCreated` Event with distinct routing targets, and
`Portfolio` also subscribes through its own target. This provides two Process
Manager recipients plus a Projection using domain-correct generated messages.

The existing black-box test executes inside one Vitest process with the
`BoundedContext` test setup; it does not launch independent worker processes,
persist execution counts, or configure SQL storage. Its handlers do not expose
per-recipient execution counters. A new acceptance driver should consume this
worktree's built/generated package artifacts and the checked-in fixture source,
add explicit per-process counters and separate worker startup, and verify both
recipient states/counters against SQL. There is no need to copy or run the
reference experiment's source transforms.

## Machine-readable container evidence and host driver check

`evidence/databases.json` records current Docker inspection data for each
container: full ID/name/state, configured image, image ID and actual
`RepoDigests`, loopback port mapping, server version, database URLs, and driver
readiness. The PostgreSQL 18 `RepoDigest` in this file was read from Docker's
image metadata and matches the locked reference digest
`postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`.

Host-side connectivity was verified without building or generating packages:
Node imported `pg` from `packages/storage-postgres/node_modules` and
`mysql2/promise` from `packages/storage-mysql/node_modules`; each connected to
`spine_test` through its published loopback port and returned its server version
and selected database. All four driver connections passed. No full test suite
was run.
