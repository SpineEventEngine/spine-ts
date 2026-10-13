# Eight-process shard conditional operations

The current built worktree passed these bounded registry checks on PostgreSQL 16.15/18.6, MySQL 8.4.10, and MariaDB 11.4.13. The driver starts eight distinct Node OS processes, imports this worktree’s built framework, and uses real domain ShardIndex, WorkerId, and ShardSessionRecord messages. Each run uses a unique session table and deterministic lease clock.

| Database   | Distinct processes | Winners: absent / expired / released | Conditional delete winners | Distinct shard winners | Evidence                                                                                                           |
| ---------- | -----------------: | ------------------------------------ | -------------------------: | ---------------------: | ------------------------------------------------------------------------------------------------------------------ |
| postgres16 |                  8 | 1 / 1 / 1                            |                          1 |                      8 | [output](eight-process-postgres16.log), [capture](runs/postgres16-eight-process-claims-2026-10-13T185836972Z.json) |
| postgres18 |                  8 | 1 / 1 / 1                            |                          1 |                      8 | [output](eight-process-postgres18.log), [capture](runs/postgres18-eight-process-claims-2026-10-13T185847635Z.json) |
| mysql84    |                  8 | 1 / 1 / 1                            |                          1 |                      8 | [output](eight-process-mysql84.log), [capture](runs/mysql84-eight-process-claims-2026-10-13T185901618Z.json)       |
| mariadb114 |                  8 | 1 / 1 / 1                            |                          1 |                      8 | [output](eight-process-mariadb114.log), [capture](runs/mariadb114-eight-process-claims-2026-10-13T185925004Z.json) |

Each run additionally proves that the prior expired session cannot renew or release the winning session, the current session can renew and release, and all eight processes observe absence after conditional deletion. Every child exits with code zero. The capture wrapper verifies the dedicated container identity and database version and restores logging; all four restoration records passed.

Command for each named database: `TRACE_OPERATION=eight-process-claims node build-protocol/tasks/sql-delivery-reliability/evidence/sql-trace/capture.mjs <database> -- node build-protocol/tasks/sql-delivery-reliability/evidence/sql-trace/eight-process-claims.mjs`.

This is direct registry/CAS verification, not the two/eight-process application workload matrix. No business Command reconciliation, publication recovery, transport readiness, or server-crash durability claim follows from these checks. Those acceptance requirements remain pending.
