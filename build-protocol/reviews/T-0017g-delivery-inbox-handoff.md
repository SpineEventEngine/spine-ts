# T-0017g Review Log

Status: first fix complete; re-review pending

Scope: delivery inbox handoff integration, dedup boundaries, tenant/type-url
preservation, docs/API updates, and verification evidence.

## Required Lanes

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Code style/maintainability | `019f455a-f025-7503-ab55-f126c8c4928c` | Closed | FINDINGS |
| Documentation completeness | `019f455a-f0e0-7b13-a60c-171186b12272` | Closed | FINDINGS |
| TypeScript/API docs        | `019f455a-f15e-7ce2-9480-f380fa3cdebb` | Closed | FINDINGS |
| Security                   | `019f455a-f1e1-7310-8d1a-12a235055433` | Closed | FINDINGS |
| Performance/reliability    | `019f455a-f279-70f0-826e-01f7d6b4df63` | Closed | FINDINGS |

## Implementation Result

- Implementation sub-agent `019f4546-6b86-79f3-9c7a-d579142cd50a` returned
  `DONE_WITH_CONCERNS` and was closed by the coordinator.
- The implementation moved process-manager command assignees behind durable
  inbox handoff plus immediate local shard drain.
- The implementation intentionally left aggregate command paths, repository
  event paths, scheduler/retry/catch-up loops, and worker execution for later
  roadmap tasks.
- The implementation report is
  `build-protocol/work-logs/T-0017g-implementation-report.md`.
- First review round is pending after coordinator verification and review
  package preparation.

## First-Round Findings

- Style/maintainability: delivery-specific state and behavior grew inside
  `BoundedContext`, including callback-valued runtime members and inline inbox
  decoding/delivery. Move handoff behavior behind one small context-owned
  internal object/capability and pass that capability into repository runtime.
- Style/maintainability: `repositoryDirectDeliveries`,
  `createRepositoryDirectDeliveries()`, and generic `repositoryAccess.deliverCommand()`
  add a parallel WeakMap-backed command execution surface solely to avoid
  recursion. Collapse or narrow this to the process-manager handoff path and
  keep handoff sub-steps small.
- Documentation: `docs/api/README.md`, `packages/server/README.md`, and
  `docs/architecture/README.md` contain stale or contradictory wording about
  inbox/delivery management and process-manager handler execution.
- Documentation: `build-protocol/work-logs/T-0017g-implementation-report.md`
  still records `format:check` as failing even though the coordinator rerun
  passed after formatting carried-forward T-0017f logs.
- TypeScript/API docs: multitenant process-manager handoff can write a durable
  inbox row before tenant presence is enforced. Require a non-blank tenant ID
  before `Inbox.receive()` for multitenant contexts.
- TypeScript/API docs: generic `RepositoryAccess.deliverCommand()` is broader
  than the task requires. Narrow the internal authority to process-manager
  command replay for the opted-in handoff path.
- TypeScript/API docs: end-user-facing docs should not expose the internal
  `HANDLE_COMMAND` label unless naming it is part of the public contract.
- Security: inbox replay loses tenant binding by deriving tenant only from the
  stored command envelope. Carry the active delivery/storage tenant into replay
  and reject a stored command whose tenant metadata does not match.
- Security: inbox replay bypasses the normal command validation path and does
  not check durable inbox target ID/type against repository routing. Validate
  replayed commands with the same schema-validation boundary as `CommandBus`
  and bind replay to stored inbox metadata before handler invocation.
- Performance/reliability: a single `Delivery.drain()` does not prove the
  newly written inbox row was delivered. `SKIPPED` shard pickup or a bounded
  page can leave the row `TO_DELIVER` while command posting resolves.
- Performance/reliability: tests cover the happy path only. Add regressions for
  pre-claimed shard and page-boundary/backlog behavior.

## First-Round Closure Plan

- Dispatch one fix sub-agent with the complete findings list.
- Require root-cause notes, focused red/green tests for tenant validation,
  route binding, shard-skip/page-boundary delivery completion, and docs/log
  updates.
- Re-review all five lanes after the fix report is written.

## First-Fix Closure

- Fix sub-agent `019f4560-a173-7622-85d3-c60cfa21dfde` returned
  `DONE_WITH_CONCERNS` and was closed by the coordinator.
- Fix report: `build-protocol/work-logs/T-0017g-fix-report.md`.
- Coordinator verification after the fix:
  - `pnpm --config.verify-deps-before-run=false format:check` passed.
  - `git diff --check` passed.
  - `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/repository/repository-routing.test.ts` passed with
    107 tests.

## Re-Review Lanes

| Lane                       | Reviewer ID                            | Status  | Result  |
| -------------------------- | -------------------------------------- | ------- | ------- |
| Code style/maintainability | `019f4572-43d2-7753-b931-12591533907f` | Running | Pending |
| Documentation completeness | `019f4572-4472-7033-baea-00e109baddb0` | Running | Pending |
| TypeScript/API docs        | `019f4572-4500-74c0-8e0f-4b5a4ca4b018` | Running | Pending |
| Security                   | `019f4572-457f-7df0-a02d-3e8da3a8f855` | Running | Pending |
| Performance/reliability    | `019f4572-4608-73d0-bf2c-5b166398cbd7` | Running | Pending |

## Re-Review Findings

- Code style/maintainability: `LocalProcessManagerInbox` still keeps delivery
  mechanics in the already-large `bounded-context.ts`; move it and helpers to a
  dedicated internal handoff module.
- Code style/maintainability: new process-manager inbox/replay identifiers
  include five semantic components, such as
  `RepositoryProcessManagerInboxTarget`, `createProcessManagerInboxTarget`,
  `validateProcessManagerReplayTenant`, and
  `validateProcessManagerReplayTarget`. Shorten the local vocabulary.
- Documentation completeness: `docs/api/README.md` still says this slice does
  not manage inboxes/delivery, contradicting the later process-manager command
  handoff text.
- Documentation completeness: `packages/server/README.md` still says durable
  inbox handoff is outside the local runtime slice, contradicting the updated
  process-manager command handoff text.
- TypeScript/API docs, security, and performance/reliability re-reviews were
  clean.

## Second Fix Closure

- Second fix sub-agent `019f4575-cb32-7ea3-b76f-140a3ba739de` returned
  `DONE` and was closed by the coordinator.
- Tiny cleanup sub-agent `019f457b-2d74-7aa2-af99-9d9c3f2569b4` renamed the
  remaining five-component internal variable and was closed by the coordinator.
- Second fix report: `build-protocol/work-logs/T-0017g-fix2-report.md`.

## Final Targeted Re-Review

| Lane                       | Reviewer ID                            | Status | Result   |
| -------------------------- | -------------------------------------- | ------ | -------- |
| Code style/maintainability | `019f457c-78a9-79e3-96ca-572296dbbd52` | Closed | CLEAN    |
| Documentation completeness | `019f457c-791d-74b1-bcda-46b5a60102e6` | Closed | FINDINGS |

## Final Targeted Re-Review Notes

- Style reviewer `019f457c-78a9-79e3-96ca-572296dbbd52` closed CLEAN.
- Documentation reviewer `019f457c-791d-74b1-bcda-46b5a60102e6` closed FINDINGS
  because `packages/server/README.md` still had stale wording that described
  durable inbox handoff as outside this local runtime slice.
- Final docs re-review `019f4585-fb48-7112-9173-692bddc7ff10` found the same
  stale README passage plus the reviewer-ID typo above; this docs-fix pass
  closes both issues.
- This docs-fix pass corrected that README sentence to say process-manager
  command assignees now use framework-owned durable inbox handoff with
  immediate local shard replay/drain, while scheduler/retry workers,
  cross-process durable recovery, and broader event/aggregate handoff remain
  deferred.
- Final docs re-review `019f4589-5729-7470-9e06-401815abd4f0` closed CLEAN
  after inspecting the corrected server README passages, API docs passages,
  and the canonical reviewer ID in this review log.
- Targeted lint/follow-up reviewer `019f4594-663c-7fd0-b65d-96ff22326bb1`
  closed CLEAN after the preclaimed-shard test release moved into `finally`,
  the first-fix report separated repository internals from handoff/delivery
  responsibilities, and the work log stayed readable.
- Targeted TypeScript tooling reviewer `019f459a-5d61-7261-beb0-d59c463c4a80`
  closed CLEAN after confirming `requireProcessManagerInboxTarget()` now throws
  on a missing internal target and returns a definite replayable test object.
- Final tiny reviewer `019f459c-94ad-7ba1-8b83-ccec9096ad97` closed CLEAN
  after the helper was simplified to call `repositoryAccess` directly while
  keeping the absent-target test error.
- Coverage-fix reviewer `019f45a8-c71c-7090-9e9b-e1890c4c482d` closed CLEAN
  for the focused `LocalProcessManagerInbox` branch tests.
- Second coverage-fix reviewer `019f45ae-68cc-7683-a060-5f43dbfdf8c2` closed
  CLEAN for the focused repository replay-guard tests.
- Final coverage/test-cleanup reviewer `019f45b4-aa54-7713-ad57-e60d560d6372`
  closed CLEAN after the coverage tests were adjusted for lint/tooling without
  changing production code or the covered behavior.

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.
