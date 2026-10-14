# Remaining acceptance gaps

Current status after implementation, live verification, review and versioning. This replaces
the earlier preparation inventory; historical gaps are preserved in Git history.
The complete task remains active. Use ACCEPTANCE.md for the full requirement map
and the measured artifacts for bounded claims.

## Closed live verification areas

- Diagnostics include original driver causes, safe correlated real gRPC errors,
  pre-handler admission rejection, valid Any serialization failures, same-ID
  retry, and acknowledgement failure/exhaustion on all four SQL servers.
- Status/tenant/order/paging probes passed 1,355 assertions across memory and all
  four SQL servers. Forty-eight actual SQL trace cases and eight-process atomic
  registry/Inbox conditions passed; direct MyISAM/Aria cleanup also passed.
- The application baseline passed 80 runs over all four engines, two/eight
  processes and database-only/shared Delivery: 3,920 accepted Commands reconciled
  with exact business states, Events and handler entries. Its session is
  `baseline-matrix-707f9e28-90e3-49e7-b56f-a16eeaa020e6`.
- The 32-case crash matrix passed all four engines and two/eight processes for
  processing interruption, saved state before acknowledgement, partial saved
  Event publication/known-ID repair, and volatile shared Delivery server loss.
  Session `7fadc156-7186-43ec-b178-25f7273b058c` preserves exact IDs, Event bytes,
  phase-specific handler counts and cleanup. Repeat recipients after retention
  are counted; successful Commands are not rerun by explicit Event repair.
- Final compiled basic subscriptions passed 24 rows. Nested real-socket
  Coordinator child-fault/fanout tests passed 48 rows; five subsequent PG16
  controls strengthen all-child ACK and exact relayed-copy assertions. Two
  endpoints share one Project service/process: this is not managed OS restart.
- Real Cancel retry, pending-activation Cancel, concurrent teardown and stream
  reconnect passed all 96 database/protocol/Delivery-mode combinations in session
  `ac69f976-5ee9-4075-a53a-ec4b762292de`. All databases were dropped with zero
  remaining sessions/errors and unchanged measured source/runtime hashes.

- Retained shared Delivery server takeover passed all eight four-engine/two-and-eight-process rows with complete interruption-time Inbox observations and source/runtime provenance. Pending work remained at 35–36 seconds and finished at 60.48–61.34 seconds. The successful Command entered once; the selected interrupted Event handler entered once before death and once on a replacement. Other handlers entered once in these final rows. A PostgreSQL 16 two-process server-timeout override also completed near 60 seconds. All test databases and children were cleaned up. Fixture reliability/style review is accepted after a stronger saved-trace audit and fresh live control; this is not a hard takeover deadline or exactly-once guarantee.

- Idle SQL passed all 16 four-engine/two-and-eight-process/Delivery-mode rows
  after 12-second warmup and 25-second marked windows. Counts include recurring
  schema initialization: database-only 190–224 statements at two processes and
  1,398–1,984 at eight; shared Delivery eight and 32 respectively. All measured
  resources were cleaned up, SQL logging restored and recorded hashes stable.
  These are bounded observations, not throughput or long-duration load claims.
- The final real-wire fault grid passed 72/72: publication versus Cancel,
  duplicate-ACK terminal protocol failure without retry, and transient Cancel
  failure during partial activation followed by cleanup retry. Every database
  was dropped with zero remaining sessions/errors. All four provider batches
  share the same recorded source/runtime hashes. Same-process backend fanout
  remains distinguished from OS-managed application restart.

The final post-Cancel publication barrier passes all 24 affected configurations;
its targeted reliability review is clean. A separate observer receives the exact
Event while the canceled subscription has no matching server yield. All three
registrations are removed, databases dropped, zero sessions/errors, stable
recorded hashes. Together with the accepted 24 partial-cleanup and 24 duplicate-ACK
rows, this closes the three additional transport fault scenarios.

## Remaining work

All five example families, local/shared React modes and the eight-process/eight-shard
burst are verified. All accepted reviewer findings, including final security, are
resolved. Application resources and all four exact task SQL containers are removed;
see `evidence/live-examples/README.md` and `evidence/databases-final-cleanup.json`.

Version-only commit `7f66e7749` and separate workspace pins/lock commit
`ec40b81e7` are pushed. All 31 workspace versions use snapshot.23; 55 workspace
references are aligned. Both final dependency audits are clean.

- Resolve the complete full-suite regression batch: 37 failed tests and one
  unhandled error from release attempt four. The 5,320 passing tests do not
  establish final acceptance. Confirm environmental reruns, repair stale
  fixtures/inventories and any genuine behavior defects, then repeat preflight
  and the full release profile. Global coverage is not yet available.
  See `evidence/final-release/verify-release-4-result.md`.
- Commit and push final evidence, confirm exact remote SHA and clean worktree.
  No PR is authorized; PR-only CI remains an explicit verification limitation.

No automatic discovery of interrupted Event publication, durable simple shared
Inbox, exactly-once delivery, or ten-second delivery/takeover deadline is claimed.
