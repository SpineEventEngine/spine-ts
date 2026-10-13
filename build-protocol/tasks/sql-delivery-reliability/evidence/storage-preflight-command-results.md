# Frozen storage preflight command results

These entries transcribe command invocations and results observed during the single preflight. Full stdout/stderr transcripts were not saved at execution time; this file is a compact result record, not a reconstructed raw log. No checks were rerun to create it. Assignment profile: orchestrator-dispatched mechanical function, configured gpt-6-luna / medium; runtime introspection unavailable.

## Static commands

| Command                                                                                                                                                                                                                                                                          | Exit | Observed output/result                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsc --noEmit -p tsconfig.eslint.json`                                                                                                                                                                                                                                 |    0 | No diagnostics.                                                                                                                                                                                                                                                               |
| `pnpm exec tsc -b --pretty false`                                                                                                                                                                                                                                                |    0 | No diagnostics. Build completed before the parent's reserved SQL capture; no further build is planned.                                                                                                                                                                        |
| `pnpm lint:cleanup`                                                                                                                                                                                                                                                              |    0 | `$ node scripts/check-cleanup-rules.mjs` — `Cleanup enforcement checks passed.`                                                                                                                                                                                               |
| `pnpm lint:tsdoc`                                                                                                                                                                                                                                                                |    0 | `$ node scripts/check-tsdoc.mjs` — `TSDoc enforcement checks passed.`                                                                                                                                                                                                         |
| `pnpm lint:copyright`                                                                                                                                                                                                                                                            |    0 | `$ node scripts/check-copyright.mjs`; no diagnostics.                                                                                                                                                                                                                         |
| `git diff --check`                                                                                                                                                                                                                                                               |    0 | No diagnostics.                                                                                                                                                                                                                                                               |
| `pnpm exec eslint` on task evidence `primitive-operations.mjs`, `capture.mjs`, and `probe.mjs`                                                                                                                                                                                   |    0 | No diagnostics.                                                                                                                                                                                                                                                               |
| `pnpm exec eslint` on changed package `src`/`test` TS/MJS paths (`git diff --name-only --diff-filter=ACMRT HEAD`, filtered to those paths, piped through `xargs`)                                                                                                                |    1 | Three errors: `storage-datastore/src/datastore/storage-factory.ts:91,120` and `storage-mysql/src/mysql/entity-history.ts:51`, rule `@typescript-eslint/prefer-function-type`. Three unused-disable warnings: Datastore factory lines 79/110 and MySQL entity-history line 40. |
| Prettier check over changed supported files and task `md/json/mjs` files (`git diff --name-only --diff-filter=ACMRT HEAD` plus `rg --files build-protocol/tasks/sql-delivery-reliability`, filtered extensions, sorted unique, piped through `xargs pnpm exec prettier --check`) |    1 | Remaining warnings: `evidence/sql-trace/PRIMITIVE_RESULTS.md`, `evidence/status-checkpoint.md`, `packages/server/test/delivery/delivery-worker.test.ts`, and `packages/server/test/delivery/inbox.test.ts`. My new coverage map was formatted and passes its targeted check.  |

The Python script `evidence/sql-trace/classify-primitives.py` had no available formatter: `command -v black`, `command -v ruff`, and `command -v prettier` returned no executable; Prettier does not support Python. It was not modified.

## Single focused V8 command

The shell invocation first generated `include_args` from the changed production source paths, then ran the command shown below with that variable expanded. Included source paths were `packages/delivery-client/src/remote/adapters.ts`, `packages/server/src/delivery/{delivery-ports,delivery,inbox-storage,inbox}.ts`, `packages/storage-datastore/src/datastore/{entity-history,record-storage,storage-factory}.ts`, `packages/storage-mysql/src/mysql/{entity-history,record-storage,storage-factory}.ts`, `packages/storage-postgres/src/postgres/{entity-commit,entity-history,record-storage,storage-factory}.ts`, and `packages/storage/src/{event/event-store,index,internal/entity-commit,internal/event-store,memory/in-memory-entity-commit,memory/in-memory-storage-factory,provider}.ts`. The source list came from the `git diff --name-only --diff-filter=ACMRT HEAD` filter; the command used one `--coverage.include=<path>` argument for each.

```sh
pnpm exec vitest run \
  packages/storage/test/entity/in-memory-entity-commit.test.ts \
  packages/storage/test/event/event-store.test.ts \
  packages/storage-postgres/test/postgres-entity-commit.test.ts \
  packages/storage-postgres/test/postgres-entity-history.test.ts \
  packages/storage-postgres/test/postgres-record-storage.test.ts \
  packages/storage-mysql/test/mysql-entity-commit-contract.test.ts \
  packages/storage-mysql/test/mysql-factory-commit-mocked.test.ts \
  packages/storage-mysql/test/mysql-record-storage.test.ts \
  packages/storage-datastore/test/datastore/entity-history.test.ts \
  packages/storage-datastore/test/datastore-record-storage.test.ts \
  packages/server/test/delivery/inbox.test.ts \
  packages/server/test/delivery/direct-inbox-records.test.ts \
  packages/server/test/delivery/direct-shard-session-records.test.ts \
  packages/server/test/delivery/delivery-worker.test.ts \
  packages/server/test/delivery/delivery-supervisor.test.ts \
  packages/delivery-client/test/remote-inbox-direct.test.ts \
  --coverage \
  --coverage.thresholds.lines=0 \
  --coverage.thresholds.branches=0 \
  --coverage.thresholds.functions=0 \
  --coverage.thresholds.statements=0 \
  $include_args
```

The executed shell preamble was:

```sh
srcfiles=$(git diff --name-only --diff-filter=ACMRT HEAD | rg '^packages/[^/]+/src/.*\.ts$' || true)
include_args=''
while IFS= read -r source; do
  [ -n "$source" ] && include_args="$include_args --coverage.include=$source"
done <<EOF
$srcfiles
EOF
```

The run exited 0: **Test Files 16 passed (16); Tests 397 passed (397)**. V8 printed an aggregate 16.53% line coverage over broad workspace sources despite the changed-source include arguments; this is diagnostic only, and the configured release threshold was not changed. The source-line branch intersection is recorded separately in [`storage-slice-coverage-diff.md`](storage-slice-coverage-diff.md). The full Vitest console report was not retained as a raw log.
