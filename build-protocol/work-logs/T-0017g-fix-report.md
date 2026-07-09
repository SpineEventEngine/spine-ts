# T-0017g First-Round Fix Report

Status: `DONE`

## Root Cause Notes

- The first implementation spread process-manager inbox state across
  `BoundedContext` and `RepositoryRuntime`, then used a generic
  `repositoryAccess.deliverCommand()` replay path that was broader than the
  task needed.
- Multitenant process-manager handoff reused the ordinary command storage
  context helper, which allowed an inbox write without proving tenant presence
  first.
- Inbox replay unpacked and executed stored commands directly, so replay could
  bypass the command-bus payload validation boundary and did not bind the
  durable inbox target ID/type back to repository routing before handler code.
- Command post success was inferred from one `Delivery.drain()` run even when
  the shard was pre-claimed or the received row sat beyond the first inbox page.

## Files Changed

- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/delivery/inbox.ts`
- `packages/server/src/delivery/inbox-storage.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `docs/api/README.md`
- `packages/server/README.md`
- `docs/architecture/README.md`
- `build-protocol/work-logs/T-0017g-implementation-report.md`
- `build-protocol/work-logs/T-0017g.md`

## Fix Summary

- Replaced the delivery-specific `BoundedContext` sprawl with a narrower
  repository-backed process-manager inbox path: the replay-target registry is
  exposed through `repositoryAccess`/repository internals, while the
  exact-row wait and confirmation stay with the process-manager inbox
  handoff/delivery flow.
- Removed the generic repository direct command-delivery surface and replaced
  it with a narrow process-manager inbox replay target hook.
- Required non-blank tenant metadata before any multitenant process-manager
  inbox write, then carried the active delivery tenant into replay and rejected
  missing/mismatched stored tenant metadata before handler code.
- Replayed stored commands now pass the same payload validation boundary as the
  command bus and must match the durable inbox target ID/type routed from the
  repository before the process-manager handler runs.
- Local handoff now rejects shard `SKIPPED` runs and keeps draining through the
  bounded page limit until the specific received row reaches `DELIVERED`, or it
  fails with a bounded deferred-delivery error.
- Updated public docs to describe the supported process-manager inbox handoff
  without exposing the internal inbox label in end-user-facing wording.
- Corrected the stale `format:check` note in the implementation report.

## TDD Record

Red:

- Added focused regressions for tenantless multitenant handoff, shard
  preclaim, page-boundary backlog delivery, replay tenant mismatch, replay
  target mismatch, and replay payload validation.
- Verified the red state with:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts -t "rejects multitenant process-manager handoff without a tenant before inbox write|rejects process-manager handoff success when another worker already owns the shard|keeps draining process-manager handoff backlog until the received row is delivered|rejects process-manager inbox replay when the stored command tenant mismatches delivery tenant|rejects process-manager inbox replay when stored target metadata does not match the routed command|rejects invalid stored process-manager command payloads before handler code"`

Green:

- Implemented the narrowed inbox capability, replay guards, exact-row delivery
  confirmation, and supporting inbox exact-read API.
- Reran the same focused regression command and it passed.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts -t "rejects multitenant process-manager handoff without a tenant before inbox write|rejects process-manager handoff success when another worker already owns the shard|keeps draining process-manager handoff backlog until the received row is delivered|rejects process-manager inbox replay when the stored command tenant mismatches delivery tenant|rejects process-manager inbox replay when stored target metadata does not match the routed command|rejects invalid stored process-manager command payloads before handler code"` - passed
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts` - passed (`107` tests)
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/context/bounded-context.test.ts` - passed (`39` tests)
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts` - passed (`16` tests)

## Concerns

- The handoff remains intentionally narrow: only process-manager command inbox
  replay is moved behind the durable local handoff in this task. Repository
  event replay, scheduler/retry orchestration, and broader worker topology are
  still deferred.
