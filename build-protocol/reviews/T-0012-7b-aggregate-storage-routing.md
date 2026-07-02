# Review Log: T-0012.7b Aggregate Storage And Signal Routing

Status: review round 2 pending
Branch: `task/T-0012-7b-aggregate-storage-routing`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-7b-aggregate-storage-routing`
Baseline commit: `77492b9`

## Required Review Lanes

Every review round must run these separate reviewer sub-agents:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must reject:

- `Inbox`, delivery workers, `Stand`, gRPC services, import bus, scheduler,
  system context runtime, process supervision, or read-side query behavior;
- public repository-registration internals;
- large error/detail hierarchies;
- exported standalone helpers without a recorded reason;
- names over the four-component limit;
- tests under `src`; and
- stale docs/API expectations.

## Review Rounds

### Round 1

Reviewer sub-agents:

- code style/maintainability:
  `019f20b5-0eff-7251-a2bc-f07084f818dc`;
- documentation: `019f20b5-0f97-7620-9bcf-407082375366`;
- TypeScript/API docs: `019f20b5-1005-7421-b3c6-da3fd387c494`;
- security: `019f20b5-109e-7a23-aacf-7ff0aadd2e53`;
- performance/reliability:
  `019f20b5-1117-7191-bcb1-fba591615fa4`.

Result: changes requested.

Findings addressed by fix commit `69c6716`:

- stale architecture, user-guide, API, and repository TypeDoc statements about
  repository routing;
- non-primary declaration order in `aggregate-storage.ts`;
- misleading unused `aggregateId` parameter in `appendEvents()`;
- missing aggregate append/read invariants for route consistency and event
  versions;
- runtime-synthesized `spine.server.AggregateSnapshotRecord` descriptor;
- public aggregate and repository route APIs losing ID generic information; and
- structurally fabricated handler metadata becoming bus-visible through
  repository dispatcher adapters.

All five round-1 reviewers were closed after their reports were collected.

### Round 2

Pending re-review of `dcddec7..69c6716`.
