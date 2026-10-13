# Added-line branch coverage from the focused storage run

Coverage source: the single focused V8 run recorded in `STORAGE_PREFLIGHT.md`, with `coverage/lcov.info` intersected against `git diff --unified=0 HEAD` added-line ranges for changed `packages/*/src/**/*.ts` paths only. This is branch evidence for changed lines, not a repository-wide coverage claim. The run reported 16/16 files and 397/397 tests passing. Its report still included broad workspace source files despite the requested per-file `--coverage.include` arguments; zero thresholds were diagnostic only.

Uncovered added branches found:

| Changed source line                                              | Uncovered branch                                                           | Path                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/server/src/delivery/inbox-storage.ts:230`              | Active-operation check immediately before direct delete returns false.     | Cancellation / operation becoming inactive between initial eligibility and deletion. |
| `packages/storage-datastore/src/datastore/entity-history.ts:212` | State-history loop is skipped when no state rows are supplied.             | Empty state-history input.                                                           |
| `packages/storage-datastore/src/datastore/entity-history.ts:214` | Diagnostic-history loop is skipped when no diagnostic events are supplied. | Empty diagnostic-history input.                                                      |
| `packages/storage-datastore/src/datastore/entity-history.ts:216` | Delivery-event loop is skipped when no delivery events are supplied.       | Empty delivery-event input.                                                          |
| `packages/storage-mysql/src/mysql/storage-factory.ts:827`        | Non-retryable MySQL Entity-commit failure is rethrown without retry.       | Permanent/non-deadlock error.                                                        |
| `packages/storage-mysql/src/mysql/storage-factory.ts:847`        | Deadlock classifier exits on a non-object/null wrapped cause.              | Malformed/non-object cause.                                                          |
| `packages/storage-mysql/src/mysql/storage-factory.ts:849`        | Deadlock classification for `ER_LOCK_DEADLOCK` is unhit.                   | Driver code form.                                                                    |
| `packages/storage-mysql/src/mysql/storage-factory.ts:849`        | Deadlock classification for errno `1213` is unhit.                         | Driver numeric-code form.                                                            |
| `packages/storage-mysql/src/mysql/storage-factory.ts:873`        | Empty state-history loop.                                                  | Entity input has no state rows.                                                      |
| `packages/storage-mysql/src/mysql/storage-factory.ts:874`        | Empty diagnostics loop.                                                    | Entity input has no diagnostic events.                                               |
| `packages/storage-postgres/src/postgres/record-storage.ts:437`   | `discard` branch that releases a failed client with an Error marker.       | Client-disposal-required provider failure.                                           |
| `packages/storage/src/memory/in-memory-entity-commit.ts:139`     | Missing delivery Event ID / unavailable Event storage rejection.           | Invalid Entity-commit delivery Event input.                                          |
| `packages/storage/src/memory/in-memory-entity-commit.ts:236`     | Missing Entity ID in next current record.                                  | Invalid current Entity record.                                                       |
| `packages/storage/src/memory/in-memory-entity-commit.ts:237`     | Current record identifies a different Entity.                              | Mismatched Entity identity.                                                          |

All other branch records on added lines in these changed production files were hit in this run. Changed additions without an `lcov.info` branch record are not listed as uncovered branches. This is a mechanical mapping; it does not determine whether each branch is reachable through the focused behavior suite or belongs in this slice's required coverage.
