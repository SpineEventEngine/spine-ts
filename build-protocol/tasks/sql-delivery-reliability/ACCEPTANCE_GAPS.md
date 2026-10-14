# Remaining acceptance gaps

Current status after the 96-case SQL transport lifecycle matrix. This replaces
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

## Remaining work

- Measure idle SQL at two/eight application processes. Corrected supervisor/SQL
  component tests now pass 16/16 across four engines, including default/override
  scans and separate-process late writes before/after confirmed shard release.
  The before-release writer proves its SQL pickup was blocked; notifications
  are deliberately absent. These bounded component tests do not replace the
  retained-server application-worker takeover case below.
- Retain a shared Delivery server while an actual application worker dies and a
  replacement recovers pending accepted work. Measure the 60-second stale age,
  10-second scan and independently configured processing timeout separately.
  The completed shared-server-loss case proves a different, volatile boundary.
- Add explicit real-wire publication-versus-Cancel ordering, protocol-invalid
  terminal failure, and failed cleanup during partial child fanout. Keep
  existing finite client retry/exhaustion evidence and cleanup bounds distinct.
- Correct Orders/Projects load examples to distinguish readiness ACKs from
  actual business updates; finish coherent isolated launcher ports/images,
  explicit process/shard counts and eight/eight verification. Execute all five
  examples and both required React UI modes, preserving local exceptions.
- Review the new clock tests and example changes with the relevant existing
  concerns; refresh final documentation and all four concern dispositions using
  accepted bounded reviews rather than repeating converged slices.
- Run final release-readiness security review, cheap preflight, verify:release,
  common unused version-only commit, separate internal pins/lockfile update,
  immediate pushes and exact remote-SHA verification. No PR is authorized;
  unavailable PR-only CI must be reported accurately.

No automatic discovery of interrupted Event publication, durable simple shared
Inbox, exactly-once delivery, or ten-second delivery/takeover deadline is claimed.
