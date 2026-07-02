# Review Log: T-0012.7b Aggregate Storage And Signal Routing

Status: review round 4 pending
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

Reviewer sub-agents:

- code style/maintainability:
  `019f20c5-44f5-7421-a5cb-b510bf19416c`;
- documentation: `019f20c5-456c-7192-8106-d431040334cb`;
- TypeScript/API docs: `019f20c5-45ff-7352-90fa-c30ea695fdb6`;
- security: `019f20c5-4671-74c1-947f-262cd763fe80`;
- performance/reliability:
  `019f20c5-470a-7190-943f-f7d6662f3aca`.

Result: changes requested.

Findings addressed in the round-2 fix pass:

- storage/user/architecture docs no longer say aggregate snapshots/history are
  deferred;
- review log re-review range now points at the package actually reviewed;
- aggregate event reads sort by aggregate version before duplicate-version
  validation, so event-store ID ordering cannot reject valid history;
- `RepositoryOptions.handlers` now preserves entity/state generics; and
- handler metadata authenticity is exposed through an internal access object
  rather than a standalone helper export.

All five round-2 reviewers were closed after their reports were collected.

### Round 3

Reviewer sub-agents:

- code style/maintainability:
  `019f20cc-161e-7af3-9864-d06791974164`;
- documentation: `019f20cc-16c8-76c0-8a17-e5e14b777318`;
- TypeScript/API docs: `019f20cc-1747-7f91-ae7a-d20481b4e75f`;
- security: `019f20cc-17c6-7b52-852e-4bb13d7f9550`;
- performance/reliability:
  `019f20cc-1860-7e41-a857-4861b5a45f5a`.

Result: clean. No Critical, Important, or Minor findings remained. All five
round-3 reviewers were closed after their reports were collected.

### Round 4

Pending final review of the post-round-3 verification fix:

- package-root export smoke test now includes `AggregateStorage`;
- aggregate-storage tests cover first-field primitive routing, unroutable
  events, corrupted internal snapshot records, and duplicate versions already
  present in stored history; and
- final full verification passed after the coverage-focused test additions.
