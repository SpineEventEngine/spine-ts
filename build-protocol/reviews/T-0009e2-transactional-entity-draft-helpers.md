# Review Log: T-0009e.2 TransactionalEntity Scoped Draft Helpers

Task log:
`build-protocol/tasks/T-0009e2-transactional-entity-draft-helpers/TASK.md`
Work log: `build-protocol/work-logs/T-0009e2.md`
Branch: `task/T-0009e2-transactional-entity-draft-helpers`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e2-transactional-entity-draft-helpers`
Baseline commit: `bd8d02e`

## Review Requirements

Every review round must include separate sub-agents for:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Reviewers must inspect the committed range for this task or subtask, report
findings with file/line references when possible, and explicitly state whether
their role is clean. The orchestrator must close every reviewer after result
capture.

## Round 1

Authoring sub-agent:
`019f15ba-f2f2-7f21-a244-bd61564e0eb6` (Aquinas the 3rd).

Implementation is complete and final verification passed. Reviewer dispatch
covered committed range `4e250b2..a7acaca`.

Review result captured on `2026-06-30 00:50 WEST`: changes requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15c6-791a-7dd1-8fc6-0fa1464959ba` | P3 finding | Closed  |
| Documentation              | `019f15c6-9b13-79d0-947f-8edca7001b90` | P2 finding | Closed  |
| TypeScript/API docs        | `019f15c6-bf75-7110-a909-e180d8bbc375` | Clean      | Closed  |
| Security                   | `019f15c6-e562-7a70-b5df-c4fad702f69a` | P2 finding | Closed  |
| Performance/reliability    | `019f15c7-05db-70e3-860d-e790badcc7f9` | P2 finding | Closed  |

Findings:

- P2 security/reliability: `commitTransaction()` returned raw
  `EntityTransaction.commit()` results. Rejected commits intentionally keep the
  transaction active, and the raw rejected result exposed `version.draft` by
  reference to the still-active transaction, allowing callers to mutate draft
  version metadata outside `updateDraftVersionMetadata()`.
- P2/P3 documentation/maintainability: live durable status text still described
  implementation commit or reviewer dispatch as pending, and one current-state
  line pointed at implementation commit `13f8a05` instead of reviewed range
  `4e250b2..a7acaca`.

Clean-role evidence:

- TypeScript/API confirmed the updated API surface and API docs gate pass for
  68 expected server exports.
- Code style/maintainability otherwise found the new `TransactionalEntity` seam
  small, protected, JVM-familiar, and backed by `EntityTransaction` without
  repository/runtime/family behavior.
- Documentation otherwise confirmed protected-only transaction scope, accepted
  and rejected commit behavior, rollback behavior, out-of-scope runtime
  behavior, and inspected JVM sources.

All findings are accepted. The fix route is:

- add a RED regression that mutates `rejected.version.draft` and proves a later
  accepted retry does not inherit that mutation;
- return cloned version evidence from `commitTransaction()` for both accepted and
  rejected outcomes;
- update stale live durable status wording to the reviewed range;
- rerun focused tests, typecheck, lint/format/docs, full verification, and the
  required review loop.

## Round 1 Fix Evidence

Focused fix implemented and verified on `2026-06-30 00:53 WEST`.

- RED: focused entity/root tests failed because mutating
  `rejected.version.draft` changed the still-active transaction and later
  accepted entity version metadata.
- GREEN: `commitTransaction()` now returns cloned accepted and rejected version
  evidence before exposing commit results. Focused entity/root tests passed 2
  files / 32 tests.
- `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check`,
  and `corepack pnpm docs:check` passed.
- `CI=true corepack pnpm verify` passed with 15 test files / 152 tests, coverage
  97.23% statements / 91.41% branches / 99.15% functions / 97.17% lines,
  TypeDoc/API/proto gates passed with 68 expected server exports, and generated
  proto output clean.

## Round 2

Round 1 fix commit under review: `4246385`.

Review result captured on `2026-06-30 00:57 WEST`: documentation cleanup
requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15ce-aea5-76f2-83f0-7fb0cc98f3f9` | Clean      | Closed  |
| Documentation              | `019f15ce-ce50-7f20-b7aa-dac245e0047e` | P3 finding | Closed  |
| TypeScript/API docs        | `019f15ce-f334-70f0-978a-944bbed4c799` | Clean      | Closed  |
| Security                   | `019f15cf-11a7-7212-94ed-f682d6875b5e` | Clean      | Closed  |
| Performance/reliability    | `019f15cf-3672-72d0-b921-35c749ecced4` | Clean      | Closed  |

Findings:

- P3 documentation: the task header still used stale pre-review wording after
  Round 1 reviewer IDs and closures had been recorded.

Clean-role evidence:

- Maintainability confirmed `cloneCommitResult()` is small, local, clearly
  named, and does not expand repository/runtime/family behavior.
- TypeScript/API confirmed the commit result discriminants and public/protected
  API consistency remain intact, and the API gate passes with 68 expected server
  exports.
- Security confirmed no remaining live mutation paths from returned commit
  results into active transaction state/version/lifecycle.
- Performance/reliability confirmed retry/rollback behavior remains
  deterministic and the added clone cost is limited to plain version metadata
  evidence.

The documentation finding is accepted. The fix route is docs-only:

- update the task header reviewer status to record Round 1 and Round 2 reviewer
  closure;
- record Round 2 review outcomes in task/report/work/review logs;
- rerun format/full verification and the required review loop.

## Round 2 Fix Evidence

Docs-only cleanup implemented and verified on `2026-06-30 00:59 WEST`.

- Task header reviewer status now records Round 1 closure and Round 2 closure
  with docs-only follow-up.
- Round 2 outcomes are recorded in task/report/work/review logs.
- `CI=true corepack pnpm verify` passed with 15 test files / 152 tests, coverage
  97.23% statements / 91.41% branches / 99.15% functions / 97.17% lines,
  TypeDoc/API/proto gates passed with 68 expected server exports, and generated
  proto output clean.

## Round 3

Round 2 docs-only cleanup commit under review: `bd4052a`.

Review result captured on `2026-06-30 01:03 WEST`: documentation cleanup
requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15d4-5cbe-7f23-aa42-899d72d241f4` | P3 finding | Closed  |
| Documentation              | `019f15d4-8063-7202-8370-92c17ec6ab52` | P3 finding | Closed  |
| TypeScript/API docs        | `019f15d4-a09c-7a72-b5b8-0161f3f8de62` | Clean      | Closed  |
| Security                   | `019f15d4-c57b-7cc2-a11f-73ef291bcf8d` | Clean      | Closed  |
| Performance/reliability    | `019f15d4-e5e6-79a1-822f-be9633ce96af` | P3 finding | Closed  |

Findings:

- P3: task current state still said the Round 1 fix was ready for Round 2
  review even though Round 2 was recorded as complete.
- P3: work-log risk routing still pointed the fixed rejected-result metadata
  issue at Round 2 security/reliability review after those lanes had returned
  clean.

Clean-role evidence:

- TypeScript/API confirmed the committed range is docs-only and does not change
  API or runtime surface.
- Security confirmed the committed range is docs-only, includes no sensitive
  payloads, and keeps the commit-result snapshot isolation evidence accurate.

All findings are accepted. The fix route is docs-only:

- reword the task current-state Round 1 fix sentence as reviewed history;
- mark the fixed rejected-result risk as completed in Round 2;
- record Round 3 outcomes and rerun format/full verification plus review.

## Round 3 Fix Evidence

Docs-only cleanup implemented and verified on `2026-06-30 01:07 WEST`.

- Task current state now treats the Round 1 fix and Round 2 cleanup as reviewed
  history.
- Work-log risk routing now records the rejected-result metadata risk as fixed
  and reviewed clean in Round 2.
- `CI=true corepack pnpm verify` passed with 15 test files / 152 tests, coverage
  97.23% statements / 91.41% branches / 99.15% functions / 97.17% lines,
  TypeDoc/API/proto gates passed with 68 expected server exports, and generated
  proto output clean.

## Round 4

Round 3 docs-only cleanup commit under review: `23b757f`.

Review result captured on `2026-06-30 01:12 WEST`: documentation cleanup
requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15dc-24cf-78a1-ac58-d4e5881b6c14` | P3 finding | Closed  |
| Documentation              | `019f15dc-2559-7c01-b77c-2927c0f0b10b` | P3 finding | Closed  |
| TypeScript/API docs        | `019f15dc-25c8-7532-98e8-9d5183d81e03` | Clean      | Closed  |
| Security                   | `019f15dc-2662-7933-93ca-0d5915a64995` | Clean      | Closed  |
| Performance/reliability    | `019f15dc-26d2-7f70-980d-b80982201e4b` | P3 finding | Closed  |

Findings:

- P3: task header still omitted Round 3 closure and did not reflect Round 4
  docs-only follow-up.
- P3: work-log rejected-result metadata risk still pointed at Round 3
  reliability confirmation after Round 3 had completed.
- P3: durable review history placed Round 3 before Round 2 instead of preserving
  chronological order.

Clean-role evidence:

- TypeScript/API confirmed the reviewed range is docs-only and does not alter
  API or runtime surface.
- Security confirmed the reviewed range is docs-only and includes no sensitive
  payloads.

All findings are accepted. The fix route is docs-only:

- update live reviewer status to include Round 3 closure and Round 4 docs-only
  follow-up;
- mark the rejected-result metadata risk as completed with no current
  follow-up;
- reorder this durable review log chronologically and record Round 4 outcomes;
- run Markdown formatting and verification.

## Round 4 Fix Evidence

Docs-only cleanup implemented and verified on `2026-06-30 01:16 WEST`.

- Task header now records Round 1, Round 2, Round 3, and Round 4 closure, with
  the Round 4 docs-only follow-up verified.
- Work-log risk routing now marks the rejected-result metadata risk as
  completed with no current follow-up.
- Review history now reads chronologically: Round 1, Round 1 Fix Evidence,
  Round 2, Round 2 Fix Evidence, Round 3, Round 3 Fix Evidence, Round 4, and
  Round 4 Fix Evidence.
- `CI=true corepack pnpm verify` passed with 15 test files / 152 tests, coverage
  97.23% statements / 91.41% branches / 99.15% functions / 97.17% lines,
  TypeDoc/API/proto gates passed with 68 expected server exports, and generated
  proto output clean.

## Round 5

Round 4 docs-only cleanup commit under review: `f97701a`.

Review result captured on `2026-06-30 01:21 WEST`: clean.

| Role                       | Reviewer ID                            | Result | Closure |
| -------------------------- | -------------------------------------- | ------ | ------- |
| Code style/maintainability | `019f15e4-f8db-7e01-a069-2d8028078ced` | Clean  | Closed  |
| Documentation              | `019f15e4-f965-7082-8535-19819ae3f16a` | Clean  | Closed  |
| TypeScript/API docs        | `019f15e4-f9de-72a3-bdbd-c9e9f62f9ade` | Clean  | Closed  |
| Security                   | `019f15e4-fa6b-7ab1-b2a9-a51e6302fa2b` | Clean  | Closed  |
| Performance/reliability    | `019f15e4-fadf-7a22-bd45-b3545ce28689` | Clean  | Closed  |

Clean-review evidence:

- Maintainability confirmed the task header records Round 3 closure and Round 4
  follow-up verification, rejected-result risk routing is complete, and the
  review log is chronological.
- Documentation confirmed only the four expected `build-protocol` Markdown files
  changed, Round 4 outcomes/fix evidence are clear, and stale live status
  wording is absent.
- TypeScript/API confirmed no TypeScript, package config, script, API docs, or
  export-bearing files changed; public API, TypeDoc expectations, and package
  exports are untouched.
- Security confirmed no secrets, tokens, auth headers, or sensitive payloads were
  added and no runtime/security behavior changed.
- Performance/reliability confirmed no runtime/performance behavior changed and
  the rejected-result metadata risk is routed as completed with no current
  follow-up.
