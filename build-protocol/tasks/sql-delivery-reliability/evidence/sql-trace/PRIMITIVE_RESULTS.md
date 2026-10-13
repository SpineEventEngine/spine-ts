# Warmed primitive SQL results

Six public RecordStorage operations passed on PostgreSQL 16.15/18.6, MySQL 8.4.10 and MariaDB 11.4.13 (24 captures). Dedicated image/container identities and logging restoration are recorded in each paired `runs/*.json` metadata file. `primitive-sql-classification.json` selects the exact successful captures and retains measured statements. Command logs retain state assertions and current-worktree built entry paths/hashes.

| Operation                                                  | Statements in each marked interval |
| ---------------------------------------------------------- | ---------------------------------- |
| Existing record read                                       | One SELECT                         |
| Existing record replacement                                | One INSERT/upsert                  |
| Existing record deletion                                   | One DELETE                         |
| Filtered, ordered bounded query                            | One SELECT                         |
| Two-record batch                                           | Two independent INSERT/upserts     |
| Successful conditional update then expected-value mismatch | SELECT, guarded UPDATE, SELECT     |

All intervals are nonempty and contain no explicit transaction boundary, locking read, advisory lock or DDL. The conditional UPDATE guards both the ID and observed serialized bytes and updates bytes plus materialized columns. This trace does not inject a concurrent guard miss; the separate contention tests cover that behavior. `classify-primitives.py` checks these properties against the raw logs and emits the JSON classification.

The driver creates and prepares one handle before the start marker, performs the measured action, emits the end marker, then checks returned/persisted state. Scalar StringValue records represent generic record storage only, not Commands, Events, Entities or domain IDs. PostgreSQL initialization transactions remain outside these warmed intervals. EventStore opens fresh handles and can repeat initialization; its separate trace must not be described as transaction-free overall.

The first MySQL attempt rejected a hyphenated UUID table name before measurements. The fixture now strips hyphens; the failed command/log is preserved and the rerun passed. No framework fix followed from this fixture failure. Every capture, including that failure, reports restored logging. This is bounded primitive evidence, not the remaining Entity/history/Inbox SQL acceptance or the multiprocess delivery matrix.
