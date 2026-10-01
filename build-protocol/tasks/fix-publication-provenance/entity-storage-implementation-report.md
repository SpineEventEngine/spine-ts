# Entity storage implementation report

Status: baseline and Entity storage runtime slice implemented for handoff.
At the original handoff, the TSDoc gate below was unresolved. Subsequent
documentation corrections cleared those findings; see progress.md. Delivery
and performance work continued in the same implementation context.

## Scope and source

Bounded baseline and Entity storage slice. Delivery paging and cleanup remain for the next slice.
The pinned official JVM checkout is `ea3067b137938ac0beb6920c39d11e300976fcc9`.
Inspected `InMemoryRecordStorage.writeRecord`/`writeAllRecords`, `TenantRecords.put`,
and `Transaction.doCommit`/rollback in the source paths cited by `findings.md`.

## Baseline

Opt-in real delivery fixture: `packages/server/test/repository/entity-delivery-benchmark.test.ts`.
It routes one generated `ProjectCreated` Event to distinct `RoutedQueue` Process Managers,
checks every final state outside timing, and uses fresh `InMemoryStorageFactory` contexts.
Node v24.18.0, Apple M3 Max, 48 GiB RAM, no coverage, one Vitest worker.
State and Process Manager Event history disabled; repository Inbox duplicate
retention is the default `30_000` ms.
Timing includes `eventBus().post()` through routing, Inbox, dispatch, Entity commits and acknowledgements.

Raw measurements in milliseconds: warm-up `4291.44925`; 100 `157.43725`;
500 `1339.609417`; five fresh 1,000-recipient runs `4105.063625`,
`4081.391708`, `4041.394667`, `4288.803584`, `4170.644541`.
Every measured 1,000-recipient baseline run exceeded the one-second target.
Command passed (1 test):
`SPINE_ENTITY_DELIVERY_BENCH=1 pnpm exec vitest run packages/server/test/repository/entity-delivery-benchmark.test.ts --maxWorkers=1`.

After the storage slice, the same command passed with raw milliseconds:
warm-up `2305.12425`; 100 `131.036041`; 500 `831.154584`;
five fresh 1,000-recipient runs `2309.342625`, `2291.60575`, `2270.56275`,
`2190.704792`, `2236.451875`. This is an intermediate result before delivery
paging and cleanup changes; every 1,000-recipient run still exceeds the target.

## Red/green and checks

Red: `pnpm exec vitest run packages/storage/test/entity/in-memory-entity-commit.test.ts --maxWorkers=1 -t 'replaces a different current record'` failed as intended: expected `undefined`, received `"conflict"`.
Green: same command passed after the provider port and memory implementation changed.
Focused memory suite passed 22/22. A four-file focused selection passed 78 tests with 311 unrelated tests skipped.
Final focused provider command:
`pnpm exec vitest run packages/storage/test/entity/in-memory-entity-commit.test.ts packages/storage-postgres/test/postgres-entity-commit.test.ts packages/storage-datastore/test/datastore/entity-history.test.ts --maxWorkers=1`
passed 67/67. Repository atomic-commit selection passed 3/3 with 319 unrelated tests skipped.
`packages/storage/test/entity/in-memory-entity-history.test.ts` passed 24/24.
Affected production `pnpm exec tsc -b packages/storage packages/storage-mysql packages/storage-postgres packages/storage-datastore packages/server --pretty false`, tooling `tsc --noEmit -p tsconfig.eslint.json`, `pnpm format:check`, `pnpm lint:cleanup`, and `git diff --check` passed after corrections.

`pnpm lint:tsdoc` remains failing: 138 declarations in `tenant-records.ts`,
104 in Datastore `entity-history.ts`, and 62 in MySQL `storage-factory.ts`.
These are existing declarations in touched legacy files outside the changed Entity
commit methods. The changed Entity commit port and memory commit file have no
TSDoc findings. Clearing 304 unrelated declarations would broaden this slice.

## Changed paths and concerns

Runtime paths: internal Entity commit port, memory commit and tenant records, MySQL/PostgreSQL/Datastore commits, and repository call sites.
Tests: memory commit, PostgreSQL commit and integration, Datastore commit and emulator, MySQL integration, repository routing, and the opt-in benchmark.
No delivery paging or cleanup runtime changes in this slice.
MySQL, MariaDB, PostgreSQL and Datastore emulator integration checks were not
run in this slice, as the brief reserves live-provider checks for main after
both runtime slices. No Docker, full-suite build, coverage, publication, commit,
push, or version edit was performed.
