# Inbox acknowledgement and cleanup SQL results

Acknowledgement and direct delivered-row cleanup passed on PostgreSQL 16.15/18.6, MySQL 8.4.10 and MariaDB 11.4.13. The driver uses generated TaskCreated Events addressed to a TaskList by its TaskListId, with a unique physical Inbox table per run. Captured metadata/logs and the assertions are retained; `classify-storage.py` reproduces statement classification in `storage-sql-classification.json`.

Acknowledgement emits two ordinary SELECT statements and one UPDATE guarded by ID and previously observed bytes. The returned and stored status is DELIVERED. Cleanup emits exactly one DELETE whose predicate contains only the ID; the removed record is absent afterward. There is no exact-snapshot predicate, lease/session check, rollback or post-delete lease validation in the measured data operations.

Each operation opens a fresh record handle. PostgreSQL consequently runs one separate CREATE TABLE/catalog-validation transaction, including its schema advisory lock, before the data statements. MySQL and MariaDB perform five schema setup statements. The traces distinguish this initialization from data work and do not claim public operations are wholly transaction-free. All eight captures restored logging.

Together with the other reports, this completes 12 planned operation shapes on four databases (48 successful cases). It does not substitute for processing-failure, acknowledgement-failure, publication-recovery, subscription or multiprocess workload acceptance.
