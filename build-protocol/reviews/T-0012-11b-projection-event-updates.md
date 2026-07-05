# Review Log: T-0012.11b Projection Event Updates

Status: round-5 review fixes implemented; verification passed
Task log: `build-protocol/tasks/T-0012-11b-projection-event-updates/TASK.md`
Branch: `task/T-0012-11b-projection-event-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11b-projection-event-updates`
Baseline commit: `f38fcac`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must verify:

- repository event dispatch invokes projection subscribers only for projection
  repositories in built bounded contexts;
- projection updates stay on the read side and write through `Stand`;
- `Stand` remains the query/subscription facade;
- event handling remains asynchronous and does not add catch-up, retry, or
  broker scope;
- tenant context and event version metadata are preserved where available; and
- tests prove behavior through event bus, repository, stand, and service seams
  rather than private helpers.

## Current State

- Implementation and full verification are green.
- Review should verify that projection execution is limited to built projection
  repositories, updates read-side state only through framework-owned `Stand`,
  preserves direct `routeEvent()` as route-only, and avoids catch-up, retry,
  broker, or projection-list query scope.
- Round-1 review fixes addressed the command-tenant propagation bug for
  aggregate-produced projection events, the handler-backed projection version
  type boundary, and the aggregate-only shared invocation diagnostic. Focused
  red/green verification, typecheck, lint, format, docs, diff, and escalated
  coverage passed. Sandboxed coverage still fails on local IPC/HTTP2 endpoint
  permissions only.
- Round-2 review fixes addressed the reliability gap where
  fire-and-forget already-stored event redispatch failures were swallowed. The
  owning `BoundedContext` now exposes copy-safe
  `storedEventDispatchFailures()` diagnostics while preserving post-storage
  command completion semantics and avoiding retry/catch-up/delivery scope.
- Round-2 documentation fixes synchronize the parent `T-0012.11`
  task/report/review statuses and current-state text with the parent work log.
- Round-2 final verification passed: focused tests, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `git diff --check`,
  and escalated `pnpm test:coverage` with 45 files and 576 tests. Sandboxed
  coverage still fails only on known local IPC/HTTP2 endpoint permissions.
- Round-3 review fixes addressed tenant/security, diagnostics reliability,
  internal naming, and docs/API findings. Aggregate-produced events now bind
  origin to the executing command, diagnostics retain bounded frozen error
  snapshots, internal callbacks use `recordDispatchFailure`, and public docs no
  longer contain the stale handler/fragments wording.
- Round-3 verification passed: focused repository tests, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `git diff --check`, and
  escalated `pnpm test:coverage` with 45 files and 579 tests. Sandboxed
  coverage still fails only on local IPC/listen permissions.
- Round-4 review fixes attempted to address the residual no-id command security
  finding by binding command context as origin even when the command had no id.
  Round 5 found that was not contract-safe because Spine proto requires
  `Origin.message`.
- Round-5 review fixes reject aggregate command execution when `command.id` is
  missing before events are bound, applied, or stored. The no-id tenant
  regression expects rejection and no projection write in tenant-a or tenant-b.
  Command-with-ID tenant overwrite coverage remains in place. Final
  verification passed: focused/full repository routing tests, `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `git diff --check`, and
  escalated `pnpm test:coverage` with 45 files and 580 tests. Sandboxed
  coverage still fails only on local IPC/listen permissions.
- Round-6 cleanup addresses final documentation/API review comments by
  documenting the public aggregate `command.id` requirement and making the
  past-message test fixture include required `Origin.message`.
- Final round-6 style, documentation, TypeScript/API docs, security, and
  performance/reliability re-reviews reported no findings. Fresh final
  verification passed focused and full repository routing tests, typecheck,
  lint, format, docs, diff whitespace, and escalated coverage.
