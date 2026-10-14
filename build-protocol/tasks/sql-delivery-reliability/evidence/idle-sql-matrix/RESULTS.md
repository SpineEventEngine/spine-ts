# Idle SQL measurement matrix

Session `b90067d2-241b-4eea-9de6-ce561d52ec5f` completed **16/16** fresh cases with status **PASS**. It measured SQL statement/query families emitted during the idle window after the driver’s 12-second warmup. The window duration was approximately 25 seconds per case. Counting is bounded by the captured begin and end marker records; all statement records inside that interval are included, including DDL. Only statements outside the markers are excluded.

The command was:

```sh
TMPDIR=/Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts/build-protocol/tasks/sql-delivery-reliability/evidence/runtime-tmp node build-protocol/tasks/sql-delivery-reliability/evidence/idle-sql-matrix/run-idle-sql-matrix.mjs
```

The wrapper ran the frozen public fixture sequentially with the exact per-row form `node packages/server-blackbox-tests/test-fixtures/project-idle-sql.mjs outer <provider> <2|8> <db-only|shared-memory>`. No source or compiled-runtime hashes changed from launch through completion. The source/runtime hashes, command lines, distinct run/database IDs, capture metadata, raw-log hashes, and per-row outcomes are in [manifest.json](sessions/b90067d2-241b-4eea-9de6-ce561d52ec5f/manifest.json). Raw SQL logs remain unmodified under `evidence/sql-trace/runs/`.

| Provider   | Engine version                                                                                                             | Workers | Mode          | Window (ms) | SQL statements | SQL families inside markers                               | Cleanup and logging       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ------: | ------------- | ----------: | -------------: | --------------------------------------------------------- | ------------------------- |
| postgres16 | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit |       2 | db-only       |       25009 |            224 | SELECT 140, BEGIN 24, CREATE 24, COMMIT 24, UPDATE 12     | dropped; logging restored |
| postgres16 | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit |       2 | shared-memory |       25009 |              8 | SELECT 8                                                  | dropped; logging restored |
| postgres16 | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit |       8 | db-only       |       25005 |           1544 | SELECT 968, BEGIN 180, CREATE 180, COMMIT 180, UPDATE 36  | dropped; logging restored |
| postgres16 | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit |       8 | shared-memory |       25011 |             32 | SELECT 32                                                 | dropped; logging restored |
| postgres18 | PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit   |       2 | db-only       |       25009 |            224 | SELECT 140, BEGIN 24, CREATE 24, COMMIT 24, UPDATE 12     | dropped; logging restored |
| postgres18 | PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit   |       2 | shared-memory |       25005 |              8 | SELECT 8                                                  | dropped; logging restored |
| postgres18 | PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit   |       8 | db-only       |       25010 |           1984 | SELECT 1232, BEGIN 224, CREATE 224, COMMIT 224, UPDATE 80 | dropped; logging restored |
| postgres18 | PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit   |       8 | shared-memory |       25008 |             32 | SELECT 32                                                 | dropped; logging restored |
| mysql84    | 8.4.10                                                                                                                     |       2 | db-only       |       25010 |            193 | SELECT 152, CREATE 24, UPDATE 17                          | dropped; logging restored |
| mysql84    | 8.4.10                                                                                                                     |       2 | shared-memory |       25007 |              8 | SELECT 8                                                  | dropped; logging restored |
| mysql84    | 8.4.10                                                                                                                     |       8 | db-only       |       25006 |           1492 | SELECT 1201, CREATE 180, UPDATE 111                       | dropped; logging restored |
| mysql84    | 8.4.10                                                                                                                     |       8 | shared-memory |       25007 |             32 | SELECT 32                                                 | dropped; logging restored |
| mariadb114 | 11.4.13-MariaDB-ubu2404                                                                                                    |       2 | db-only       |       25009 |            190 | SELECT 151, CREATE 24, UPDATE 15                          | dropped; logging restored |
| mariadb114 | 11.4.13-MariaDB-ubu2404                                                                                                    |       2 | shared-memory |       25006 |              8 | SELECT 8                                                  | dropped; logging restored |
| mariadb114 | 11.4.13-MariaDB-ubu2404                                                                                                    |       8 | db-only       |       25012 |           1398 | SELECT 1139, CREATE 180, UPDATE 79                        | dropped; logging restored |
| mariadb114 | 11.4.13-MariaDB-ubu2404                                                                                                    |       8 | shared-memory |       25006 |             32 | SELECT 32                                                 | dropped; logging restored |

Across the fresh grid, the capture found **7409** statement records: 7249 in DB-only mode and 160 in shared-memory mode. These are observed statements for this fixture and window, not throughput guarantees.

Engine versions:

- postgres16: PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
- postgres18: PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
- mysql84: 8.4.10
- mariadb114: 11.4.13-MariaDB-ubu2404

All 16 fresh run IDs and database names were unique. Every worker process exited successfully; all disposable databases were dropped; logging was restored with no restoration errors. The shared-memory mode used one additional delivery worker per case. The existing preliminary PostgreSQL 16/two-worker/DB-only run `89c34528decf453284bcbea8b1f2f1b4` is preserved separately and excluded from these totals because it lacks historical source/runtime hashes.

The configured mechanical profile was **gpt-6-luna / low**; runtime profile introspection is unavailable on this surface.
