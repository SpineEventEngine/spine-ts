# Review Log: T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions

Task log:
`build-protocol/tasks/T-0012-3-shrink-runtime-abstractions/TASK.md`
Branch: `task/T-0012-3-shrink-runtime-abstractions`
Baseline commit: `cb5ace3`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-3-shrink-runtime-abstractions`
Status: Implementation complete; review pending

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must enforce `D-0047`, `CODE_QUALITY.md`, and the reset constraints:

- removed abstractions are actually gone or materially smaller;
- no replacement framework behavior is added before the roadmap reaches it;
- API shrinkage is documented and deliberate;
- public standalone helpers are not introduced;
- transport still hides ZeroMQ and keeps only the needed bus abstraction;
- cleanup enforcement remains intact.

## Current Notes

Implementation sub-agent removed the ahead-of-roadmap runtime abstractions and
updated focused tests, API docs, cleanup checks, and public export count
expectations.

Deleted or shrunk concepts recorded by the implementer:

- bounded context runtime shell and built snapshot alias;
- bounded context repository registration structured detail exports;
- repository identity structured detail payloads;
- transport lifecycle participant/worker snapshot helpers;
- transport delivery attempt/result/failure/retry helper family;
- runtime routing dependence on transport worker registration keys.

Deliberately kept concepts:

- bounded context metadata, repository registration, and snapshot support;
- core transport signal/topic/subscription and publish/request/respond
  abstractions;
- runtime routing descriptors as deferred metadata without delivery/runtime
  execution behavior.

Public API counts changed deliberately:

- `server`: `130` exports to `122`;
- `transport`: `46` exports to `17`.

Verification recorded by the implementer:

- focused server/transport Vitest slice passed: 5 files, 81 tests;
- sandbox `corepack pnpm test` and `env CI=true corepack pnpm verify` failed
  only on ZeroMQ `ipc://` permission errors;
- native/escalated `corepack pnpm test` passed: 28 files, 291 tests;
- native/escalated `env CI=true corepack pnpm verify` passed, including lint,
  typecheck, tests, docs check, proto generation, and generated proto check.

Independent review lanes remain pending.
