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

- P3 documentation: the task header still said reviewer sub-agents were pending
  after Round 1 reviewer IDs and closures had been recorded.

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
