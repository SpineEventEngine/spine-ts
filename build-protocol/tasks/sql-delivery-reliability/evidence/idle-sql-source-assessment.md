# Idle SQL source assessment

Existing performance/reliability concern, explicitly dispatched `gpt-6-sol` /
`medium`. Runtime introspection unavailable. Reviewer returned a read-only report;
the parent persists its substance here. No builds, tests or runtime changes by
the reviewer. The preliminary control lacks launch source hashes and is not a
row in the new frozen matrix.

The warmed PostgreSQL 16/two-process database-only control
`89c34528decf453284bcbea8b1f2f1b4` has two recovery bursts at 03:39:20 and 03:39:30.
Each contains 112 SQL statements, including 12 BEGIN/COMMIT pairs, 12 table
advisory locks, 12 CREATE TABLE statements and 36 catalog SELECTs. Each burst's
DDL comprises nine shard-session and three Inbox initializations. The repeated
schema work occurs inside the marked window; it must be counted as idle work,
not discarded as startup.

The source path is the ten-second DeliverySupervisor recovery
(`packages/server/src/delivery/delivery-supervisor.ts`, recovery at lines 524–562)
and LocalDeliverySource's finite shard snapshot
(`environment-delivery-worker.ts`, lines 779–804). Each admitted empty drain
performs pickup, session validation, Inbox read and release. ShardedWorkRegistry
and InboxStorage request fresh record handles. PostgresStorageFactory creates a
PostgresRecordStorage with a fresh per-handle initializer
(`packages/storage-postgres/src/postgres/storage-factory.ts`, lines 375–406;
`record-storage.ts`, lines 148–165). Its schema preparation performs the
transaction, table advisory lock, CREATE TABLE and catalog validation
(`table-initializer.ts`, lines 54–83 and 126–133). Closing unregisters each handle.
These are schema-initialization transactions, not cross-record business-write
transactions, but their recurring cost remains part of the measurement.

The recovery timer is scheduled after the previous recovery settles;
`#recovering` shares overlapping requests, active/pending work is deduplicated by
shard, and the pending limit bounds queued work. The two observed bursts have
equal counts and matched BEGIN/COMMIT counts. The reviewer found no accumulating
work or confirmed requirement-breaking defect in this bounded sample. The
four-engine/two-and-eight-process matrix is still needed before generalizing
query counts or comparing shared Delivery. Do not call this a throughput or
production capacity guarantee, or claim idle SQL has no schema wrappers.
