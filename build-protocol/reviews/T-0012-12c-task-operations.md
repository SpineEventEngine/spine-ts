# Review Log: T-0012.12c Task Operations

Task log: `build-protocol/tasks/T-0012-12c-task-operations/TASK.md`
Branch: `task/T-0012-12c-task-operations`
Baseline commit: `fc71408`
Reviewed commit/diff basis: implementation commit `8ab4b5c`; review-fix
commit `3ee5c1a`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12c-task-operations`
Status: round-two comments; title and metadata fix pending

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Rounds

### Round 1 - `8ab4b5c`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32e1-ca29-7780-ab62-566c237afb57` | Comments |
| documentation              | `019f32e1-caae-78f1-8a09-1cedf6386f09` | Comments |
| TypeScript/API docs        | `019f32e1-cb24-7a90-9180-5b9715b8285b` | Comments |
| security                   | `019f32e1-cbaf-7642-87ae-d7ed5e1148c3` | Clean    |
| performance/reliability    | `019f32e1-ccdb-7252-a6ac-b8ea6a8fae35` | Comments |

Findings:

- Projection completion/reopen count logic derives `openTaskCount` from
  `state.tasks[0]` while updating tasks by matching ID. It must derive the
  before/after count from the matched row contents and cover duplicate same-ID
  creates.
- The reopen test can pass against the post-create projection row before
  `CompleteTask` is observed. It must wait for the completed intermediate state
  before posting `ReopenTask`.
- Task/work-log metadata still says implementation commit pending instead of
  `8ab4b5c`.
- Task/report wording overclaims aggregate rehydration coverage. Either add
  direct aggregate snapshot/history evidence or narrow the claim to the actual
  command/projection evidence.

Planned fixes:

- Compute task-list open counts from actual row state after matched-task
  updates.
- Add duplicate-ID projection regression coverage.
- Strengthen the reopen test to observe completed state first.
- Add or narrow aggregate rehydration evidence.
- Update task/report/work-log metadata.

### Round 2 - `3ee5c1a`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32f1-3fd5-7d02-873a-6a60fe0f4786` | Comments |
| documentation              | `019f32f1-406a-7ee3-9b3a-17c9097c1057` | Comments |
| TypeScript/API docs        | `019f32f1-40da-7073-979a-3c1f8c8fff18` | Comments |
| security                   | `019f32f1-4176-7512-aada-be510c3c9061` | Clean    |
| performance/reliability    | `019f32f1-41e5-7701-86be-8957fc3f729b` | Clean    |

Findings:

- The multi-command test title still claimed persisted aggregate rehydration
  even though the body now covers command/projection-visible state.
- Task/work-log metadata still described final/fix commit state as pending
  after `3ee5c1a`.

Planned fixes:

- Rename the test to match the narrowed evidence.
- Update task/work-log/review metadata for the committed review fix.
