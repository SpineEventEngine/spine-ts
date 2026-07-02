# Implementation Report: T-0012.8 Delivery And Inbox

Status: implemented
Branch: `task/T-0012-8-delivery-inbox`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-8-delivery-inbox`
Baseline commit: `de3ccc7`

## Summary

Implemented the first durable delivery slice with small JVM-familiar delivery
types and storage-backed behavior:

- `Delivery`, `Inbox`, `InboxStorage`, `ShardIndex`, `ShardSession`,
  `ShardedWorkRegistry`, and `LocalDeliveryStrategy`;
- durable inbox writes with target inbox identity, original signal identity,
  label, status, shard, received time, ordering version, and optional
  deduplication retention;
- live deduplication by `(signalId, inboxId)` over durable storage rather than
  record ID;
- storage-backed shard pickup/release with lease expiry replacement semantics;
- public export, README, and API-doc expectation updates for the new delivery
  surface.

## Verification

- `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `git diff --check`

`pnpm docs:check` passed with the existing TypeDoc warning about an invalid
`origin` remote for source links.
