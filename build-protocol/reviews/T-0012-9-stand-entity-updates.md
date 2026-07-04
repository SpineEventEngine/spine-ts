# Review Log: T-0012.9 Stand And Entity Updates

Status: integrated into main
Task log: `build-protocol/tasks/T-0012-9-stand-entity-updates/TASK.md`
Branch: `task/T-0012-9-stand-entity-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-9-stand-entity-updates`
Baseline commit: `796221d`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must verify:

- `Stand` remains a direct read-side framework API and does not introduce gRPC
  simulation.
- Bounded context exposes its owned stand without leaking bus or storage
  internals.
- Registered repository state types become known stand types.
- Entity updates preserve read/write separation and tenant isolation.
- Subscriber cleanup is deterministic and cannot retain listeners forever when
  handles are closed.
- The public API is short, JVM-familiar, and does not introduce long detail
  hierarchies or broad helper sprawl.
- Public docs/API docs match the implemented surface.
- Coverage remains at or above 90%.

## Current State

Implementation added a direct `Stand` class, built-context `stand()` exposure,
repository state-schema registration into the context stand, focused stand and
context tests, public exports, and public docs.

Pre-review self-check:

- Direct read-side framework API only; no gRPC service adapters or service
  simulations were added.
- `BoundedContext` exposes only the owned `stand()` object and does not expose
  storage factories, repository internals, or transport/service internals.
- Registered repository state schemas become known stand types.
- Stand updates are direct caller actions and do not invoke write-side handlers,
  repositories, projections, event catch-up, or buses.
- Subscriber cleanup is explicit through idempotent `unsubscribe()`.
- Single-tenant and multitenant storage context behavior is covered by focused
  tests.
- Public docs describe direct Stand behavior and defer
  QueryService/SubscriptionService to later work.

Full initial verification passed before external review rounds started.

## Round 1 Follow-Up

Concrete review comments are being addressed in a follow-up commit:

- Reliability: snapshot matching subscribers before callback delivery.
- Reliability: avoid cached `RecordStorage` handles by opening and closing per
  read/update operation.
- API surface: remove the public Stand column/index registration surface.
- Documentation: clarify direct Stand versus deferred gRPC
  QueryService/SubscriptionService execution and update `withStorageFactory()`
  TypeDoc.

Focused red tests reproduced the subscriber-mutation and storage-handle issues.
Follow-up verification passed, including focused tests, typecheck, lint,
changed-file Prettier, docs check, full tests, coverage with branch coverage
90.07%, and `git diff --check`.

## Round 2 Follow-Up

Round 2 comments were documentation/API wording only:

- Public docs now consistently state that `withStorageFactory()` supplies
  storage for the context `EventStore`, repository state storage, and direct
  Stand/read-side state storage.
- The stale pre-review note about external review lanes was reworded as
  historical initial-verification state.

Tests were skipped because this follow-up only changes Markdown documentation
and durable logs. Verification is limited to changed Markdown Prettier,
`pnpm docs:check`, and `git diff --check`. Changed Markdown Prettier passed;
`pnpm docs:check` passed with the existing TypeDoc invalid-origin warning and
163 expected `@spine-ts/server` exports.

## Final Review State

All required review lanes are clean after round 3:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Final reviewed commit: `9202b5e`.
