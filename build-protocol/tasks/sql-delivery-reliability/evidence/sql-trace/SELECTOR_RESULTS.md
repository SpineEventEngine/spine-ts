# Dedicated-database SQL selector results

## Interface

The capture wrapper accepts an optional exact database name through
`TRACE_DATABASE`. Its accepted form is `sqlrel_idle_` followed by 32 lowercase
hexadecimal characters. The caller creates the database before capture and
drops it after capture. The wrapper verifies that it exists on the exact
task-local server, records it as `selectedDatabase`, and routes all child
database URLs to it. Without `TRACE_DATABASE`, the existing fixed-database
behavior remains in effect.

For PostgreSQL, `ALTER ROLE ... IN DATABASE ... SET log_statement = 'all'` is
applied and confirmed before the wrapped child starts. Only the selected
database is changed in selector mode; the existing prior-setting restoration
still runs in `finally`. MySQL-family capture retains its existing bounded
global `general_log`/`log_output` change and restoration. Thread discovery uses
`LOCATE` against the literal `on <database>` token, so underscores are not
treated as SQL `LIKE` wildcards. No general log was truncated, and no service,
production database, or table was changed.

The selector probe emits `sqlrel_trace_warmup_begin` and
`sqlrel_trace_capture_end` SQL statements in the selected database. It also
queries the existing `spine_test` database with
`sqlrel_trace_decoy_control`. Selector metadata records positive begin/end
marker capture and decoy exclusion. A missing marker or captured decoy makes
the wrapper fail.

## Commands and results

Each database was created by the test harness before invoking the wrapper and
dropped in its `finally` cleanup after the runs. The SQL was `CREATE DATABASE
"<selected name>"` / `DROP DATABASE "<selected name>"` on PostgreSQL, and
`CREATE DATABASE \`<selected name>\``/`DROP DATABASE \`<selected name>\`` on
MySQL-family servers. For each listed run, the wrapped command was:

```sh
TRACE_DATABASE=<selected name> TRACE_OPERATION=idle-selector-<mode> \
  node build-protocol/tasks/sql-delivery-reliability/evidence/sql-trace/capture.mjs <engine> \
  -- node build-protocol/tasks/sql-delivery-reliability/evidence/sql-trace/probe.mjs <mode>
```

`success` exited 0 on all four engines. `failure` intentionally exited 7 on
PostgreSQL 16 and MySQL 8.4. Every run wrote a nonempty raw log, recorded the
expected selected database, reported `loggingRestored: true`, had no capture
or restoration failures, and reported all three marker checks true.

| Server           | Selected database                              | Successful run metadata                                            | Child-failure run metadata                                         |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| PostgreSQL 16.15 | `sqlrel_idle_abb48fad696f6f699b43bddf8639af7b` | `runs/postgres16-idle-selector-success-2026-10-14T031259999Z.json` | `runs/postgres16-idle-selector-failure-2026-10-14T031302263Z.json` |
| PostgreSQL 18.6  | `sqlrel_idle_eb046db7659311c2bd6ddf29081394e8` | `runs/postgres18-idle-selector-success-2026-10-14T031304572Z.json` | —                                                                  |
| MySQL 8.4.10     | `sqlrel_idle_dc6426c5a32b6e3176af1062b3319f2f` | `runs/mysql84-idle-selector-success-2026-10-14T031306899Z.json`    | `runs/mysql84-idle-selector-failure-2026-10-14T031309135Z.json`    |
| MariaDB 11.4.13  | `sqlrel_idle_4d79f20cd2f985999127d44f820a9585` | `runs/mariadb114-idle-selector-success-2026-10-14T031311429Z.json` | —                                                                  |

Each metadata file has a paired `.log` file beside it. The run records include
the exact selected database, task container identity, image, server version,
command exit status, marker checks, and restoration fields. Container identity
was checked against the recorded task-local container ID before each capture.

## Mechanical checks

`node --check` passed for `capture.mjs` and `probe.mjs`. Prettier check passed
after formatting those two files. The databases were removed after evidence
capture.
