# T-0012.3: Delete Or Shrink Abandoned Runtime Abstractions

Status: Implemented; verification passed; review pending
Start: `2026-07-01 19:11 WEST`
Baseline commit: `cb5ace3`
Branch: `task/T-0012-3-shrink-runtime-abstractions`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-3-shrink-runtime-abstractions`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`

## Objective

Remove or shrink runtime concepts that were introduced ahead of the corrected
Spine JVM-aligned roadmap.

The task should make the current framework smaller and easier to review before
storage, event store, buses, bounded-context assembly, repositories, delivery,
stand, and gRPC are rebuilt in order.

## Scope

Allowed:

- delete abandoned command-execution-first/runtime lifecycle shells;
- remove over-specific detail/error hierarchies such as bounded-context
  repository registration details unless a remaining caller truly needs them;
- simplify repository identity errors to ordinary errors with only minimal code
  fields if tests require stable branches;
- delete transport delivery/retry/lifecycle helpers that model delivery before
  the delivery task;
- update tests, docs, exports, cleanup-rule exceptions, and TypeDoc expected
  export counts to match the smaller API;
- keep real transport bus abstractions and ZeroMQ IPC adapter seams that are
  required by the non-negotiable architecture.

Not allowed:

- implement the replacement storage factory, event store, buses, bounded
  context assembly, repositories, delivery, stand, or gRPC services;
- introduce new public helper functions or substitute abstractions;
- preserve a speculative abstraction merely by renaming it;
- weaken generated-code, test-layout, naming, callback, or line-length checks;
- hide ZeroMQ details less than the current transport abstraction does.

## Initial Cleanup Targets

The implementer must inspect current code and may adjust scope if tests reveal a
smaller safe slice. The expected first targets are:

- `packages/server/src/context/bounded-context.ts`:
  `BoundedContextRuntime`, `BuiltBoundedContextSnapshot`,
  `BoundedContextRuntimeOptions`, repository registration detail types, and
  snapshot-centered error details.
- `packages/server/src/repository/repository.ts`:
  `RepositoryIdentityErrorDetails` and structured detail helpers when a simple
  error code/message is enough.
- `packages/transport/src/index.ts` and tests: delivery/retry/lifecycle
  descriptors that belong to the later delivery/inbox task rather than the
  transport abstraction.
- Public exports in `packages/server/src/index.ts` and transport exports/tests
  that expose the removed concepts.

## Acceptance Criteria

- The public API surface is smaller where the deleted abstractions were exposed.
- `BoundedContext` remains a simple metadata shell/builder only.
- Transport keeps topic/subscription/publish/request/respond abstraction and
  ZeroMQ details remain hidden.
- No delivery/retry/lifecycle framework behavior is modeled before its roadmap
  task.
- Tests are updated to assert the smaller API and do not keep obsolete behavior
  alive.
- Docs and durable logs record what was deleted and why.
- `pnpm lint`, typecheck, tests, docs/API checks, proto checks, and full verify
  pass.

## Required Skills

- `codebase-design`: required to remove shallow abstractions and keep deep
  modules.
- `receiving-code-review`: required for review follow-up.
- `verification-before-completion`: required before completion claims.

## Review Lanes

Required independent reviewers:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

No blocking human question is known.
