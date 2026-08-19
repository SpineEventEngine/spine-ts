# T-0210 Evidence

## Baseline and authority

- Spine TS baseline: `origin/main@bc45eae2008589daf50c9b668360ed6ea65d1e2a`.
- Governing plan: `build-protocol/planning/T-0203_COMPLETE_REPLICA_DEPLOYMENT_PLAN.md`,
  especially complete-replica construction, external-event-caused change,
  RED 17–19/29, and T-0210.
- Wave 13 broker authority: the completed `T-0200`, `T-0201`, and `T-0204`
  records and their focused behavior suites.

## Intended behavioral chain

`CommandService -> Todo CommandBus -> domestic TaskCreated -> context-owned
IntegrationBroker -> generated external receptor -> LocalProjectionInbox ->
remote Delivery -> projection state -> native subscription child -> Coordinator
logical subscription`.

For the second case the chain begins with
`ThirdPartyContext.emittedEvent()` and otherwise remains identical.

## Retained RED — valid generated custom type URL is rejected

The real managed-process fixture reaches normal context construction, but its
consumer broker cannot create the `TaskCreated` event channel. The Todo Proto
declares the schema's `type.spine.examples.todo` prefix; `TypeUrls.derive()`
returns that exact URL. The default `InMemoryTransportFactory` rejects it with
`Message channel targetType must be a canonical type URL`, because its channel
validation allows only `type.spine.io` and `type.googleapis.com`.

This failure proves an adapter/product defect, not a fixture shortcut or a
newly invented deployment requirement. T-0210 does not modify the adapter.
The fixture and this evidence are retained as the RED checkpoint for the
separately owned transport correction.

## Dispatcher correction evidence

- Focused RED: `pnpm exec vitest run packages/server/test/server/environment-attachment.test.ts --pool=forks`
  failed with `Condition was not observed` after a row for the second runtime
  was notified through the first runtime on a shared remote shard.
- GREEN after the private shared dispatcher: 86 focused tests pass and
  `pnpm typecheck:build:generated` passes.
- The first rebuilt managed acceptance passed domestic RED-17/18/29 but exposed
  a fixture broker-interest timing gap for RED-19. That fixture-only lifecycle
  gap is resolved in the final managed evidence below.

## Final dispatcher and managed acceptance evidence

- RED: unknown endpoints and singleton tenant-mismatched imported Events were
  consumed by the first shared supervisor; a selected stopped owner could still
  receive work through the group.
- GREEN: `pnpm exec vitest run packages/server/test/server/environment-attachment.test.ts packages/server/test/server/managed-external-events.integration.test.ts --pool=forks`
  passes 2 files / 92 tests. The environment slice is 90/90 and the managed
  fixture is 2/2, proving two sequential domestic updates and ThirdParty import.
- `pnpm typecheck:build:generated` passes after the private controlled-run
  admission path is typed. The admitted predicate is intentionally not a public
  `DeliveryRunOptions` capability.
- The fixture's ThirdParty broker now opens before managed readiness, allowing
  the existing IntegrationBroker online/wanted exchange to establish interest;
  it carries no application payload over fixture control or a new transport.

## Final admission-to-retirement race

- RED: the test holds a selected callback while a sibling route remains live.
  It calls `stopOwners()` and `retireOwners()` immediately after the private
  admission reservation is installed. Before correction, the reservation was
  resolved before the callback joined the selected owner's active set, allowing
  retirement to complete early.
- GREEN: `#route()` registers the callback as active before it deletes and
  resolves its reservation. `awaitOwnersSettled()` first awaits reservations,
  then observes the active callback set. The held row remains `TO_DELIVER` and
  the owner remains unretired; release causes one replay and eventual durable
  settlement.
- Final focused command:
  `pnpm exec vitest run packages/server/test/server/environment-attachment.test.ts packages/server/test/server/managed-external-events.integration.test.ts`.
  Result: 2 files / 96 tests passed.
- Changed-source coverage command adds direct Delivery builder, supervisor, and
  run-control behavior suites. LCOV intersected with
  `git diff --unified=0 58963dc8f07e92a38000576ba84cad0746b287d2 -- packages/server/src`
  reports 135/141 lines (95.74%) and 66/72 branches (91.67%).
- Declaration convergence: the admission predicate remains private to
  `DeliveryControlledRun` and `deliverySupervisorAccess`; emitted root exports
  do not widen `DeliveryRunOptions` or `DeliverySupervisorOptions`.
- Final generated build, repository ESLint, cleanup, TSDoc, copyright,
  logging-containment, local-formatter, audience/API docs, Buf, generated
  output, release-readiness, and `git diff --check` gates pass after the
  inherited transport cleanup correction.

## Final lease-loss-before-dispatch correction

- Retained RED:
  `pnpm exec vitest run packages/server/test/server/environment-attachment.test.ts -t 'releases an admitted reservation after lease loss'`.
  It timed out in `retireOwners()` before product changes: admission had
  reserved a route, lease validation then failed, and no callback could remove
  the reservation.
- GREEN installs a private controlled-run settlement callback through the
  existing supervisor access seam. It removes and settles only reservations
  for the settling shard which never reached `#route()`; it neither replays nor
  acknowledges their Inbox rows, and leaves another concurrently running shard
  alone. The deterministic test proves the row stays `TO_DELIVER`, owner
  retirement completes, and a fresh normal worker later replays it exactly
  once.
- `pnpm exec vitest run packages/server/test/delivery/delivery-supervisor.test.ts packages/server/test/server/environment-attachment.test.ts packages/server/test/server/managed-external-events.integration.test.ts packages/server/test/delivery/delivery-run-control.test.ts --coverage --coverage.include=packages/server/src/delivery/delivery-run-control.ts --coverage.include=packages/server/src/delivery/delivery-supervisor.ts --coverage.include=packages/server/src/server/environment-delivery-worker.ts`
  passes 4 files / 145 tests. LCOV intersected with
  `git diff --unified=0 4a6d2c2ae68348a7297efaea0eea7f27c90564e7 -- packages/server/src`
  is 22/22 lines and 4/4 branches (100% each).
- Generated declarations show no public widening: root `DeliveryRunOptions`
  and `DeliverySupervisorOptions` are unchanged; `onRunSettled` exists only
  in internal `DeliveryControlledRun`. Generated build/typecheck, tooling,
  scoped ESLint, cleanup, TSDoc/API, copyright, logging, formatting, audience
  docs, Buf/generated outputs, release readiness, and diff checks pass.
