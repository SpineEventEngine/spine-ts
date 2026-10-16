# Server blackbox integration tests

The opt-in process and transport tests use built Project fixtures and a live SQL
server. Set `SPINE_TS_POSTGRESQL_URL` for a `postgres16` or `postgres18` selection,
or `SPINE_TS_MYSQL_URL` for `mysql84` or `mariadb114`. The selected URL must point
to a test database on a server where that account can create and drop a separate
UUID-named database. Run one provider selection at a time.

Run a selected suite with `pnpm --dir packages/server-blackbox-tests <command>`
and set its required selectors:

| Command                        | Required environment variables                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `test:matrix`                  | `SPINE_TS_MATRIX_PROVIDER`, `SPINE_TS_MATRIX_PROCESSES`, `SPINE_TS_MATRIX_MODE`, `SPINE_TS_MATRIX_TOTAL`, `SPINE_TS_MATRIX_BURST` |
| `test:process-faults`          | `SPINE_TS_FAULT_PROVIDER`, `SPINE_TS_FAULT_SCENARIO`, `SPINE_TS_FAULT_PROCESSES`                                                  |
| `test:subscription-transports` | `SPINE_TS_TRANSPORT_PROVIDER`, `SPINE_TS_TRANSPORT_PROTOCOL`, `SPINE_TS_TRANSPORT_SCENARIO`, `SPINE_TS_TRANSPORT_DELIVERY_MODE`   |

Each run reports a resource path under the configured OS temporary directory.
The tests remove successful run files after all assertions, including cleanup
readback; failed runs retain diagnostics there. No database registry or run
output belongs in the repository.
