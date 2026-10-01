# Delivery implementation report

Status: delivery runtime and focused regressions implemented. The real benchmark
still exceeds the required one-second target. The file-wide TSDoc findings
recorded at this handoff were subsequently corrected; see progress.md. The
performance requirement remains open.

## Scope and source

This slice changed delivery scanning, retention filtering, clock plumbing, and
focused tests. The pinned official JVM checkout was confirmed at
`ea3067b137938ac0beb6920c39d11e300976fcc9`. Inspected
`Delivery.runDelivery`/`run`, `InboxPage` continuation, `Conveyor` duplicate
identity handling, `DeliveredMessagesCache`, and `CleanupStation` there before
the runtime changes. No storage source file assigned to the parallel
documentation function was edited here.

Production paths: `packages/server/src/delivery/delivery.ts`,
`delivery-ports.ts`, `inbox.ts`, `inbox-storage.ts`, and
`packages/delivery-client/src/remote/adapters.ts`. Tests:
`packages/server/test/delivery/delivery-worker.test.ts`, the opt-in real
benchmark, and the remaining PostgreSQL/MySQL live Entity-commit assertions.

Delivery now advances the composite cursor through productive pages and starts
one more scan only after a whole scan records successful delivery. Duplicate
deletion alone cannot restart a scan. Future retained rows skip per-record
cleanup validation and deletion; the final storage/provider check remains in
place for eligible rows. Page-local duplicate evidence and early cleanup use
the applicable inbox clock. The bounded 1,000-entry recent cache is unchanged.

The optional internal `DeliveryInbox.retentionTime()` provider-port method is
the only API addition. Direct Inbox delegates to its configured storage clock;
RemoteInbox uses client wall time for local filtering. Remote mutation checks
remain with the remote endpoint; this clock does not assert that client and
server times are equal. No `DeliveryOptions` clock service was introduced.

## Red and green

Red command:
`pnpm exec vitest run packages/server/test/delivery/delivery-worker.test.ts --maxWorkers=1 -t 'continues after productive pages|uses the inbox clock|skips per-record checks'`.
Three intended failures: productive page reset the cursor, the behind-wall
clock still delivered a protected duplicate, and future retained cleanup
performed three checks instead of the one page-level check.

Green focused command:
`pnpm exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/direct-inbox-records.test.ts packages/delivery-client/test/remote-inbox-direct.test.ts packages/delivery-client/test/remote-delivery-direct.test.ts --maxWorkers=1`.
Five files passed, 85 tests. Coverage includes productive pages after retained
prefixes, a second scan finding an equal-time insertion behind a deleted cursor,
duplicate-only no-progress completion, clock offsets and equality boundary,
future cleanup skip, existing cache/eviction, blocked targets, cancellation,
direct storage and remote adapter cases. The benchmark handler now returns
`undefined`.

## Real measurement

Command:
`SPINE_ENTITY_DELIVERY_BENCH=1 pnpm exec vitest run packages/server/test/repository/entity-delivery-benchmark.test.ts --maxWorkers=1`.
Passed one opt-in test. Node v24.18.0, Apple M3 Max, 48 GiB RAM, no coverage,
one Vitest worker, fresh in-memory contexts and all recipient states verified.
Raw milliseconds: warm-up `1448.21475`; 100 recipients `127.478125`;
500 recipients `617.104625`; five fresh 1,000-recipient runs
`1314.987`, `1354.385`, `1325.810125`, `1389.348125`, `1323.825166`.
All five miss the under-one-second requirement. The measured remaining cost is
the whole `eventBus().post()` path at 1.315–1.389 seconds, including routing,
Inbox admission/reads, dispatch, Entity commits and acknowledgements; no
per-stage timing was collected. The previous storage-only five-run range was
2.191–2.309 seconds and the original baseline was 4.041–4.289 seconds.

## Mechanical checks and open findings

Affected `pnpm exec tsc -b packages/server packages/delivery-client --pretty false`,
`pnpm typecheck:tooling`, focused ESLint, changed-file Prettier, `pnpm lint:cleanup`,
and `git diff --check` passed. `pnpm lint:tsdoc` failed. Its last scan reported
109 findings in delivery.ts, 50 in inbox-storage.ts, and 50 in remote/adapters.ts,
mostly missing tags or summaries on previously present private helpers because
the gate covers whole touched files. It also reported findings in five storage
files assigned to the parallel documentation function. No TSDoc baseline was
changed or waived. The delivery-file comment work and benchmark target remain
open for main's integration decision.

Live PostgreSQL/MySQL, Docker, full-suite, commit, push, version and publication
work were not performed in this bounded slice.
