# Live provider verification

Orchestrator-dispatched verification function: Luna/medium, Standard speed.
Use the current checkout and its existing built outputs. The four Entity commit
implementations have been built and their ordinary tests passed. Runtime work
now concerns in-memory query comparisons and Entity ID conversion, not the SQL
or Datastore commit implementation. Do not rebuild while that work is active.

No source, test, documentation, dependency, Git, npm publication or cloud changes.
No child agents. Local Docker is authorized. You are not alone in this checkout;
preserve every edit. One disposable container and one test worker at a time.
Use only containers you create, with names starting `spine-entity-commit-`,
loopback-bound ports and explicit test databases/project IDs. Inspect exact
names before creating/deleting anything. Limit each container to 1 CPU and
1 GiB RAM. Remove your exact containers after checking results, including on
failure; never touch other containers, volumes or images.

Cached images: mysql:8.4.10, mariadb:11.4, postgres:16.15, postgres:18.6,
gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators (also inspect exact
available emulator image names). Do not pull large images if a listed compatible
cached image works. Record image/server versions, commands, environment variable
names (test credentials only), complete results and cleanup.

## SQL checks

Use `vitest.infrastructure.config.ts`, `--maxWorkers=1`, no coverage. Inspect
the referenced tests and package scripts for exact environment requirements.
Use explicit databases for the main scope and tenant A/B where required.

- PostgreSQL 16 and 18: run the package's full PostgreSQL integration file and
  shared Inbox provider cleanup file. Set the expected major version and three
  PostgreSQL URLs. Commands are in packages/storage-postgres/package.json.
- MySQL 8.4 and MariaDB 11.4: run the Entity commit cases in
  packages/storage-mysql/test/mysql-integration.test.ts and shared Inbox cleanup
  tests with SPINE_TS_INBOX_PROVIDER=mysql. Filter tests to names containing
  Entity, nontransactional, compares records, exact delivered, or stale.
  Supply the admin URL for failure-injection triggers and test tenant URLs.
  Run transactional defaults plus a separate MySQL MyISAM / MariaDB Aria case
  for the exact immutable-prefix failure test, using SPINE_TS_MYSQL_ENGINE.
  A dedicated latin1/latin1_bin database is acceptable for these ASCII-only
  nontransactional key tests, whose VARCHAR(512) ID cannot use a utf8mb4 MyISAM
  index. Do not change production schema or silently skip the engine case.

Do not replace genuine SQL engines with mocks. Report any old unrelated setup
failure distinctly. A failed test is not a reason to stop checking independent
providers, but do not patch tests or inflate timeouts.

## Datastore

Use the cached local Firestore emulator in Datastore mode, never cloud.
Set DATASTORE_EMULATOR_HOST and an explicit disposable DATASTORE_PROJECT_ID.
Run only the `keeps Entity current, histories, and Event Store` test from
packages/storage-datastore/test/datastore-emulator.test.ts plus the Datastore
cases in packages/server/test/delivery/inbox-provider-cleanup.test.ts. This
avoids unrelated exhaustive-query/maintenance work already known to be slow.
Keep default test timeouts; preserve any failure evidence.

Capture logs under /tmp/entity-live-provider-*.log and return a concise final
report to the supplied temporary output path. Distinguish passed, failed,
skipped and not-run cases. Do not claim completion if any requested engine
remains untested. Shell wrappers must not use reserved variables such as status.
