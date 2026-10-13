# EventStore immutable-retry SQL results

The marked live EventStore case passes on PostgreSQL 16.15/18.6, MySQL 8.4.10 and MariaDB 11.4.13. It appends an initial Event before the marker, retries the original two-Event batch, queries those IDs, concurrently retries an identical Event, rejects conflicting content under the same ID, and verifies the original complete envelopes. TaskCreated uses generated TaskId/TaskListId messages. Each capture restored logging. Exact capture metadata and classified statements are retained in `eventstore-sql-classification.json`.

| Database      | Separate initialization transactions | Other initialization statements | Independent data statements |
| ------------- | -----------------------------------: | ------------------------------: | --------------------------: |
| PostgreSQL 16 |                                    6 |                               0 |                          12 |
| PostgreSQL 18 |                                    6 |                               0 |                          12 |
| MySQL 8.4     |                                    0 |                              30 |                          12 |
| MariaDB 11.4  |                                    0 |                              30 |                          12 |

PostgreSQL statements were grouped by connection PID. Every BEGIN/COMMIT block encloses only CREATE TABLE IF NOT EXISTS, its table advisory lock and catalog verification. All data SELECT/INSERT statements occur outside these blocks. MySQL-family initialization contains CREATE TABLE/catalog verification, with no explicit transaction or lock call. The twelve data statements per engine have no explicit transaction, locking read or advisory lock.

EventStore selects and closes fresh record handles per operation, so schema setup repeats after the marker even when tables exist. This is an explicit limitation: the whole public EventStore sequence is not DDL-free, and the PostgreSQL sequence is not transaction-free overall. The task specification distinguishes first-use schema initialization from ordinary data work. No new initializer cache or altered schema-validation cadence was introduced.

This evidence proves the exercised immutable append/retry/collision paths, not the remaining Entity/history/Inbox SQL scenarios, process contention, or end-to-end publication recovery.
