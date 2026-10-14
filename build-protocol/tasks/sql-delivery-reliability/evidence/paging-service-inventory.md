# Inbox page service registration inventory

Mechanical read-only inventory for the required `spine.delivery.InboxReadService.ReadPage` contract. Search scope: `packages` and `examples`, excluding generated and `dist` output. Raw `rg` matches are in `paging-service-inventory.log`.

## Findings

- `packages/delivery-server/src/server/delivery-server.ts:210-211` registers both `InboxService` and `InboxReadService`; production listener is covered.
- `packages/delivery-client/test/managed-remote-delivery-readiness.integration.test.ts:415-416` and `packages/delivery-client/test/managed-external-events.integration.test.ts:279-280` register both services. These managed routers already satisfy the required read RPC.
- `packages/delivery-client/test/in-memory-core-response-loss.test.ts:37-38,79-80,117-118,169-170,225-226,274-275,327-328,371-372` have matching `InboxReadService` registrations alongside the normal `InboxService` routers. The exceptional routers at lines 336, 354, and 377 wrap only mutation responses. The line-336 router is passed to `RemoteInbox`, but its use exercises `markDelivered` (point lookup through `findOne`, then write), not page reading; it is not a likely missing `ReadPage` registration. Line 354 tests write response loss and later `DeliveryClient.findOne`; line 377 tests removal response loss and later `findOne`. These are point-read/mutation cases rather than `readPage` consumers.
- `packages/delivery-client/test/delivery-client-grpc.integration.test.ts:47-52` manually registers only `InboxService`; the `DeliveryClient` use at line 66 calls `findOne`, not `readPage`. This is a point-read serialization fixture, not a likely missing page service.
- `packages/delivery-server/test/server/delivery-server-listener.test.ts:57` calls raw `InboxService.findOne` only with an invalid identifier to check validation. It does not use `DeliveryClient` or `RemoteInbox` for a read.
- `packages/delivery-server/test/admin/delivery-server-admin.test.ts:64` creates a raw `InboxService` client and uses `writeOne`; it is mutation/observation coverage and does not use `DeliveryClient` or `RemoteInbox` reads.
- `packages/delivery-server/README.md:82-85` shows a manually assembled router with `InboxService` and `ShardService`, but omits `InboxReadService`. The snippet does not instantiate `DeliveryClient`/`RemoteInbox`; however, it documents a server router that would be incomplete for a client `readPage` caller. Likely documentation follow-up if that snippet is meant to show a complete delivery endpoint.
- `packages/delivery-server/src/health/health-service.ts:21-28` lists `spine.delivery.InboxReadService` as known. `packages/delivery-server/test/health/health-service.test.ts:30-36` checks `InboxService`, Shard, and Admin but does not enumerate `InboxReadService`; likely test enumeration gap, not a missing service registration.
- `packages/delivery-client/test/e2e/multi-machine-delivery.test.ts:100` checks health for the old `InboxService` name only; it does not manually register services. Consider whether service-health coverage should include `InboxReadService`.

## Classification

No unpaired manual production or managed-test router registration was found among the searched paths. The managed routers and the production listener register `InboxReadService`. Likely follow-ups are the README snippet and the health tests' service-name lists. The other fixtures are point `findOne`, mutations, shard observation, or invalid-request checks; they do not call `DeliveryClient.readPage` or page-reading `RemoteInbox` behavior. This is a source inventory only and makes no claim that tests or builds pass.

Runtime model metadata was not exposed to this task; dispatch configured `gpt-6-luna` / `low` for the orchestrator-dispatched mechanical scanning function.
