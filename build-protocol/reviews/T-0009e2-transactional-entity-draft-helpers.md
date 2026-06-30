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

## Round 6

Round 5 clean-review bookkeeping commit under review: `623f0d7`.

Review result captured on `2026-06-30 01:28 WEST`: documentation cleanup
requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15e8-57a2-7ec1-9434-8a4a88aa6b0d` | P3 finding | Closed  |
| Documentation              | `019f15e8-5835-7001-b12d-ed6d56167a6c` | P3 finding | Closed  |
| TypeScript/API docs        | `019f15e8-58a0-7fe3-9719-8b7905f6a863` | Clean      | Closed  |
| Security                   | `019f15e8-5926-7d33-8b90-cff82eb147f9` | Clean      | Closed  |
| Performance/reliability    | `019f15e8-59da-76c0-a7d4-6a01258e7f5c` | Clean      | Closed  |

Findings:

- P3: implementation report top-level status still referenced Round 4 follow-up
  after Round 5 clean review had been recorded.
- P3: work-log residual risk table still used active follow-up routing language
  even though Round 5 recorded no T-0009e.2 follow-up before parent integration.

Clean-role evidence:

- TypeScript/API confirmed the reviewed range is Markdown-only and does not
  touch API/export-bearing files.
- Security confirmed the reviewed range is Markdown-only and includes no
  secrets or sensitive payloads.
- Performance/reliability confirmed no runtime/performance behavior changed and
  core rejected-result routing is coherent.

All findings are accepted. The fix route is docs-only:

- update the implementation report status for Round 6 docs follow-up;
- convert the work-log active risk routing table into closed residual notes with
  no current follow-up;
- run Markdown formatting, full verification, and the required confirmation
  review.

## Round 6 Fix Evidence

Docs-only cleanup implemented and verified after Round 6 review. The final
verification run completed on `2026-06-30 01:28 WEST`.

- Implementation report status now records the Round 6 docs follow-up state.
- Work-log follow-up routing is now a closed residual-notes table with each item
  marked as reviewed, documented, or completed with no current follow-up.
- `CI=true corepack pnpm verify` passed with 15 test files / 152 tests, coverage
  97.23% statements / 91.41% branches / 99.15% functions / 97.17% lines,
  TypeDoc/API/proto gates passed with 68 expected server exports, and generated
  proto output clean.

## Round 7

Round 6 docs-only cleanup commit under review: `b9456dc`.

Review result captured on `2026-06-30 01:30 WEST`: documentation cleanup
requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15ed-fe8d-7b50-ba27-fd95398ad31c` | P3 finding | Closed  |
| Documentation              | `019f15ed-ff32-72d3-8a3c-d19a687effd7` | P3 finding | Closed  |
| TypeScript/API docs        | `019f15ed-ffab-7572-a78e-cba05469980c` | Clean      | Closed  |
| Security                   | `019f15ee-002a-7640-a3ee-4a1783d35c8a` | Clean      | Closed  |
| Performance/reliability    | `019f15ee-00bf-7481-8a74-ea7783df0707` | Clean      | Closed  |

Findings:

- P3: Round 6 fix evidence timestamp read as if verification preceded the
  Round 6 review findings.
- P3: work-log current state still described Round 6 confirmation review as
  pending after Round 7 reviewers completed.

Clean-role evidence:

- TypeScript/API confirmed no TypeScript/API/export-bearing files changed and
  API evidence remains consistent.
- Security confirmed no secrets or sensitive payloads and no runtime/security
  behavior changes.
- Performance/reliability confirmed no runtime/performance behavior changes and
  no active stale routing in the residual-notes table.

All findings are accepted. The fix route is docs-only:

- reword Round 6 fix evidence so chronology follows the review;
- replace the pending confirmation-review current-state line with captured
  Round 7 outcomes;
- run Markdown formatting, full verification, and the required confirmation
  review.

## Round 7 Fix Evidence

Docs-only cleanup implemented and verified on `2026-06-30 01:31 WEST`.

- Work-log current state now records Round 7 outcomes instead of a pending Round
  6 confirmation review.
- Round 6 fix evidence now describes the verification as occurring after Round 6
  review, with the final verification completed at `2026-06-30 01:28 WEST`.
- `CI=true corepack pnpm verify` passed with 15 test files / 152 tests, coverage
  97.23% statements / 91.41% branches / 99.15% functions / 97.17% lines,
  TypeDoc/API/proto gates passed with 68 expected server exports, and generated
  proto output clean.

## Round 8

Round 7 docs-only cleanup commit under review: `f3a067d`.

Review result captured on `2026-06-30 01:35 WEST`: documentation cleanup
requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15f1-0698-77b1-9069-61931b571057` | P3 finding | Closed  |
| Documentation              | `019f15f1-074c-74b2-a5d1-1e4d1d72e6d6` | P3 finding | Closed  |
| TypeScript/API docs        | `019f15f1-07cd-78f3-b36f-e48b0fb47fa3` | Clean      | Closed  |
| Security                   | `019f15f1-0855-7322-b7f7-7e697cbb9595` | Clean      | Closed  |
| Performance/reliability    | `019f15f1-08da-7992-a00f-422d1e75ad50` | Clean      | Closed  |

Findings:

- P3: Round 6 verification evidence still used the earlier `01:26 WEST`
  timestamp in implementation/work logs, leaving a chronology contradiction with
  the Round 6 review captured at `01:28 WEST`.
- P3: Round 7 records did not yet include a Round 7 Fix Evidence section for
  commit `f3a067d`.

Clean-role evidence:

- TypeScript/API confirmed no TypeScript/API/export-bearing files changed and
  API evidence remains consistent.
- Security confirmed only Markdown files changed, with no secrets or runtime
  security behavior changes.
- Performance/reliability confirmed no runtime/performance behavior changed and
  interruption-resume state is coherent.

All findings are accepted. The fix route is docs-only:

- normalize Round 6 verification evidence to the post-review `01:28 WEST`
  timestamp across durable logs;
- add Round 7 Fix Evidence and record Round 8 review outcomes;
- run Markdown formatting, full verification, and the required confirmation
  review.

## Round 9

Round 8 docs-only cleanup commit under review: `8be4571`.

Review result captured on `2026-06-30 01:39 WEST`: documentation cleanup
requested.

| Role                       | Reviewer ID                            | Result     | Closure |
| -------------------------- | -------------------------------------- | ---------- | ------- |
| Code style/maintainability | `019f15f5-58fa-7b21-bbd7-d28b17f04bde` | Clean      | Closed  |
| Documentation              | `019f15f5-5996-7102-bd4a-fda91127f0fc` | P3 finding | Closed  |
| TypeScript/API docs        | `019f15f5-5a06-7160-a589-61909545a2e3` | Clean      | Closed  |
| Security                   | `019f15f5-5a96-7f00-a572-afb657f01231` | Clean      | Closed  |
| Performance/reliability    | `019f15f5-5b33-70f2-a0cc-aa84c66b63c8` | Clean      | Closed  |

Findings:

- P3: task header reviewer status and current-state bullets stopped at earlier
  review rounds instead of reflecting Round 7/Round 8 activity.
- P3: implementation report top-level status and review chronology stopped at
  Round 6 even though later rounds were recorded in work/review logs.

Clean-role evidence:

- Maintainability confirmed Round 8 findings are resolved and Round 7 fix
  evidence/current-state closure is recorded.
- TypeScript/API confirmed no TypeScript/API/export-bearing files changed and
  API evidence remains consistent.
- Security confirmed the reviewed range is docs-only with no secrets or runtime
  security behavior changes.
- Performance/reliability confirmed no runtime/performance behavior changed and
  interruption-resume state is coherent.

All findings are accepted. The fix route is docs-only:

- update task/report top-level status and reviewer/current-state chronology
  through Round 8;
- run Markdown formatting, full verification, and the required confirmation
  review.
