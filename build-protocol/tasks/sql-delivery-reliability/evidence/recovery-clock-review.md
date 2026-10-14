# SQL recovery clock review wave

Existing performance/reliability and style/maintainability roles were each
explicitly dispatched as `gpt-6-sol` / `medium`; runtime metadata unavailable.
Both reviewed the frozen component test/writer and inventory without tests,
builds or source edits. Sixteen live cases support the bounded public supervisor
and real SQL recovery observations, not full-app override, retained-server
worker takeover, idle SQL cost or a hard deadline.

Parent accepts the complete batch:

- P1 reliability: the before-release writer only persists an Inbox row. Add a
  distinct worker's actual SQL ShardedWorkRegistry pickup from that writer PID
  while the old session remains gated and assert it cannot acquire. This closes
  the specified late-write/busy-claim race; retain exact Event bytes/Inbox ID and
  the after-release case.
- P2 style: the gate resolves after calling release even if release returned
  false. Record/assert true for the real delegated SQL release in both phases,
  so after-release means successful release rather than an attempted call.
- P2 reliability: the SQL factory close methods initiate asynchronous shutdown
  behind void signatures. Immediate DROP can race open pool connections. Use
  bounded, error-preserving fixture cleanup that waits for successful drop/drain;
  do not change the production close contract solely for this test.

The writer imports built runtime while its parent imports source. Describe that
boundary or record matching source/dist provenance; do not silently imply a
full application-process test. The reviewer also flags the test-inventory exact
list in scripts/stable-ci-suite.test.mjs for deterministic mechanical alignment,
including previously added infrastructure tests. No extra public API review is
required for this test-only slice. Return one batch to the existing implementer;
review only substantive remaining race/resource questions after correction.

Parent takeover source check: default processingTimeoutMs=0 disables automatic
pickup expiry, but does not disable explicit releaseSessions with the supervisor's
60000 ms inactivity period. shard-service.ts releaseSessions releases independently
of processingTimeoutMs. The separate process fixture must observe the default
through the stale-session age plus scan, not stop at 35 seconds and infer permanent
non-takeover. A ten-second processing-timeout contrast must be measured rather
than assumed to force a ten-second application takeover.

## Correction acceptance

Both targeted re-reviews are clean. The distinct writer now calls real SQL
ShardedWorkRegistry.pickUp after persistence and returns BLOCKED before the gate
permits release. The parent asserts actual delegated release true in both
orders. Exact original Event bytes, separate PID, pending Inbox ID and one later
delivery remain checked. Failed DROP attempts are retried within five seconds
and aggregated with primary/other cleanup failures if no attempt succeeds.
Corrected logs recovery-review-{postgres16,postgres18,mysql84,mariadb114}-attempt1
show four passing cases each. Inventory and the two Project fixture tests pass;
tooling typecheck, scoped ESLint, format, cleanup and diff checks pass. No
production API or runtime change was introduced by this correction.
