# Cold-repair Planning entry timeline

Session: 7fadc156-7186-43ec-b178-25f7273b058c. The run-level cold-repair checks pass. This note records the observed entry ordering only and does not assign a cause.

Exactly two runs have Planning counts of 1 in entries, 2 in beforePostCleanupRepair.entries, and 3 in replayEntries: PostgreSQL 18/p2 (c84070361e6e477f840c7486d68821fc) and PostgreSQL 18/p8 (e693d1cec1da4d4eb1114df85fc44949). In both, the additional baseline Planning entry is timestamped inside the cleanupTrace sampling interval and before the cleaned snapshot. After cleanup, the explicit original-Event replay adds one further Planning entry on a fresh process set; the cold-repair assertion checks exactly baseline +1.

For both runs, the first six cleanupTrace snapshots each contain nine rows matching the exact original Event and typed Planning recipient (one DELIVERED and eight TO_DELIVER); the final two snapshots contain none. The cleaned snapshot and beforePostCleanupRepair both report zero rows matching that Event and recipient. The per-snapshot row identities, typed IDs, statuses, versions, timestamps, entry PIDs, and original Event hashes/bytes are in the JSON artifact. No cause is inferred from these timings.

Detailed measured JSON: build-protocol/tasks/sql-delivery-reliability/evidence/process-fault-matrix/cold-repair-intervening-entries.json
