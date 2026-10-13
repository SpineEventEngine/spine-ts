# Bounded SQL trace preparation

## Assignment evidence

Orchestrator-dispatched mechanical trace preparation, explicitly configured **gpt-6-luna / medium**. Runtime introspection is unavailable; no runtime metadata is exposed. This pass wrote only this plan and `evidence/sql-trace/capture.mjs`. It did not enable logging, connect to databases, or run framework operations. The capture script received a syntax-only `node --check`.

The parent subsequently ran success, failure and forced-timeout functional checks during an agreed SQL-idle window, fixed a termination-wait race and MySQL trace formatting, and verified restoration with independent driver queries. See `evidence/sql-trace/FUNCTIONAL_CHECKS.md`. This is evidence-tool verification only; framework SQL acceptance remains pending.

## Prepared wrapper

`evidence/sql-trace/capture.mjs` wraps a later command for exactly one database selected from `evidence/databases.json`. It verifies the exact recorded container ID/name is still running before capture, verifies server version, and injects only the matching task URLs and expected PostgreSQL major/MySQL engine into the child environment. It refuses MySQL-family capture if general logging is already on. The child process group is bounded to 90 seconds; timeout or parent SIGINT/SIGTERM sends TERM then KILL after two seconds, allowing the wrapper to restore settings. It tracks successful setting changes and restores only those changes. Metadata is written even for setup/capture errors and separates failures from restoration errors. Metadata records selected engine/version/image/container ID, operation label, sanitized full command argv, timestamps, exit status, log path, and restoration outcome; it does not record connection URLs.

Invocation template after the runtime test command is ready:

```sh
TRACE_OPERATION=cas-warm node build-protocol/tasks/sql-delivery-reliability/evidence/sql-trace/capture.mjs postgres16 -- pnpm exec vitest run <target-file> -t '<exact case>'
```

Run one operation label and one engine per invocation. Use `postgres18`, `mysql84`, and `mariadb114` for the other dedicated endpoints. Set `TRACE_MYSQL_ENGINE=innodb`, `myisam`, or `aria` for engine-specific MySQL-family cases; MySQL 8.4 rejects the Aria selection. The database URLs and container IDs come only from the task-local `databases.json`.

PostgreSQL capture applies `log_statement=all` as a role-in-database default for newly opened test connections in every database URL in the selected record, remembers each existing role/database override, and restores only settings changed by this invocation. The script reads the bounded log interval only from the selected PostgreSQL container via `docker logs`. MySQL/MariaDB capture saves the current global values, switches `log_output` to `TABLE`, enables `general_log` only for the command window, disables it in `finally`, restores the prior output setting, and extracts only thread IDs that connected to one of the selected record's task databases during that interval. The extraction connection uses UTC, while filter bounds are explicit UTC strings to avoid client-local Date conversion. Binary-bearing general-log arguments are retained as exact hexadecimal bytes plus a reversible Latin-1 display string; a UTF-8 CAST can return null and is not used. The admin extraction connection is opened before capture and is not in the selected test connection set.

## Trace case procedure

The wrapped command's entire SQL interval includes setup and warmup statements. Therefore do not label the complete raw log as warmed SQL or infer wrapper-free behavior from an empty log. The eventual test must emit a distinct SQL marker after warmup and before the measured action, and the review must classify statements after that marker for warm acceptance; report setup/warmup separately. If reliable marker emission is not available, use a dedicated measured command with no warmup and classify it accordingly. Keep first-use initialization in its own operation and raw output. Report only `CREATE TABLE IF NOT EXISTS` plus associated catalog/layout inspection as allowed initialization SQL; unexpected DDL is a failure. Do not count first-use DDL as part of warmed CRUD acceptance.

Capture the following warmed operations individually for PostgreSQL 16, PostgreSQL 18, MySQL 8.4, and MariaDB 11.4:

| `TRACE_OPERATION` label | Target framework action                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `record-read`           | One existing-record read                                                                     |
| `record-write`          | One existing-record write/replace                                                            |
| `record-delete`         | One existing-record delete                                                                   |
| `record-query`          | One bounded query with a filter and ordering                                                 |
| `record-batch`          | One small multi-record batch write                                                           |
| `immutable-append`      | One immutable Event append and one identical retry                                           |
| `record-cas`            | One successful and one guard-miss compare-and-set                                            |
| `entity-commit`         | Entity current record plus state history, diagnostic history, and delivery Event persistence |
| `history-append-read`   | Standalone state and diagnostic Event append, backward query, and state-at-time lookup       |
| `history-maintenance`   | Bounded state trimming and state/Event truncation                                            |
| `inbox-ack`             | One Inbox pending-to-delivered acknowledgement                                               |
| `delivered-cleanup`     | One direct delete-by-ID for a delivered row                                                  |

Use actual domain-correct generated fixtures for Event and Entity cases; keep the generated Event message role as Event, Entity state as state, and identifiers on their generated ID schemas. Retain SQL output only for synthetic fixture values; sanitize parameter-bearing text before committing evidence.

Classify every captured statement by operation. For the accepted independent-write/CAS paths, fail if warmed statements add explicit `BEGIN`/`COMMIT`, advisory locks, or `SELECT ... FOR UPDATE`/row-lock wrappers that the current contract rejects. Verify that the decision/mutation is a single conditional SQL statement guarded by the ID and exact bytes observed by the preceding semantic read; a guard miss must be followed by the specified bounded reread/retry. Do not apply these negative assertions to first-use DDL or unrelated APIs whose accepted contract expressly uses a transaction.

## Evidence result format

For each operation, retain paired files:

- `<engine>-<operation>-<timestamp>.json`: wrapper metadata and restoration result.
- `<engine>-<operation>-<timestamp>.log`: bounded server SQL log for that captured operation.

Acceptance reporting should include image digest, server version, operation label, actual statement sequence, number of rejected wrapper statements (expected zero only where specified), allowed DDL count for the separate first-use case, command exit status, and `loggingRestored`. A nonzero restore status blocks further captures against that container until its saved setting is manually checked; the script reports this explicitly. Actual primitive and EventStore results are now recorded in evidence/sql-trace/PRIMITIVE_RESULTS.md and EVENTSTORE_RESULTS.md. Entity/history captures are classified in storage-sql-classification.json. Inbox acknowledgement and direct cleanup results are in INBOX_RESULTS.md in that evidence folder. All 48 planned operation cases passed; this establishes their stated SQL shapes, not complete task or multiprocess acceptance.
