# Review Log: T-0012.5 CommandBus, EventBus, And Handler Registration

Status: complete; all review lanes clean
Branch: `task/T-0012-5-buses-handler-registration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-5-buses-handler-registration`
Baseline commit: `746e862`

## Required Review Lanes

Every review round must run these separate reviewer sub-agents:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must reject:

- repository, bounded-context runtime, delivery, stand, gRPC, scheduler, import
  bus, system audit, or transport behavior;
- event dispatch before event storage;
- multiple effective command dispatchers for one command message type;
- broad adapter/detail hierarchies;
- exported standalone helpers without strong justification;
- names over the four-component limit;
- tests under `src`;
- stale docs/API expectations.

## Rounds

- Author self-check completed:
  - bus scope stayed within command/event posting plus dispatcher registration;
  - no bounded-context runtime wiring, repository dispatch, delivery/inbox,
    stand/query/subscription, gRPC, scheduler, import bus, or transport
    behavior was added;
  - docs/export expectations were updated alongside the code; and
  - fresh targeted and repository-wide verification passed.

- Round 1 findings received for review-fix:
  - public `CommandBus.dispatch()` and `EventBus.dispatch()` bypass the runtime
    queue and must not be public;
  - dispatcher contracts depended on entity metadata `DescriptorMessageSchema`
    instead of neutral core `MessageSchema`;
  - no-dispatch `EventBus.post()` stored and then rejected;
  - append failure needed coverage proving no event dispatcher runs;
  - event dispatcher failure semantics needed explicit docs;
  - current user/task docs were stale;
  - `EventStore` import in `event-bus.ts` should be type-only; and
  - review/work logs needed durable fix entries.
- Round 1 fixes applied:
  - public bus intake is now only `post()`, preserving async queued FIFO
    processing;
  - dispatcher contracts use `MessageSchema`;
  - no-dispatch events are stored and resolve;
  - append failure has focused regression coverage;
  - docs now state append-before-multicast, registration order, no-dispatch
    storage, append failure, dispatcher rejection, and stored-event retention;
  - stale current user/architecture/API wording was narrowed; and
  - task, review, implementation, and work logs record the fix.
- Round 1 fix verification:
  - `pnpm test packages/server/test/bus packages/server/test/index.test.ts`
    passed with 4 test files and 18 tests.
  - `pnpm typecheck`, `pnpm lint`, and `pnpm docs:check` passed.
  - Sandbox `pnpm verify` failed only on the known ZeroMQ IPC permission issue.
  - Escalated `pnpm verify` passed with 35 test files and 302 tests.
- Round 2 review results:
  - code style/maintainability: no findings;
  - TypeScript/API docs: no findings;
  - security: no findings;
  - performance/reliability: no findings;
  - documentation: stale deferred wording and task evidence issues were fixed.
- Focused documentation re-reviews:
  - first focused re-review found only stale work-log milestone wording;
  - second focused re-review found only a self-invalidating `Final branch HEAD`
    field;
  - final focused re-review found no Critical, Important, or Minor findings.
- Final verification after review closure:
  - sandboxed `env CI=true corepack pnpm verify` stopped only on the known
    ZeroMQ IPC sandbox permission failure after 34 passed files and 300 passed
    tests;
  - escalated `env CI=true corepack pnpm verify` passed with 35 test files and
    302 tests; coverage statements 95.61%, branches 90.08%, functions 98.37%,
    lines 95.60%.
