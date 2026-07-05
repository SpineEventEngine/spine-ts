# Review Log: T-0012.12c Task Operations

Task log: `build-protocol/tasks/T-0012-12c-task-operations/TASK.md`
Branch: `task/T-0012-12c-task-operations`
Baseline commit: `fc71408`
Reviewed commit/diff basis: implementation commit `8ab4b5c`; review-fix
commit `3ee5c1a`; metadata-fix commit `b6495bb`; status-fix commit `6fea638`
; restart-guidance-fix commit `7ed30a3`; post-restart-status commit `2cb0cf8`
; round-seven-status commit `05bceb5`; round-eight-status commit `85909a7`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12c-task-operations`
Status: round-eight-status committed; re-review pending

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

### Round 3 - `b6495bb`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32f4-80f1-7562-a7d0-5750b391db56` | Comments |
| documentation              | `019f32f4-816d-7732-810d-17de1aa7ea02` | Comments |
| TypeScript/API docs        | `019f32f4-81e1-7bb2-afc2-1436113f1049` | Clean    |
| security                   | `019f32f4-82b6-7b20-876b-1f81aaf253a7` | Clean    |
| performance/reliability    | `019f32f4-8348-73f2-9c83-10ff06be09e6` | Comments |

Findings:

- Task, review, and work-log status fields still described the
  title/metadata fix as pending after `b6495bb`.

Planned fix:

- Record `b6495bb` as the metadata-fix commit and update current state to the
  post-metadata-fix re-review state.

### Round 4 - `6fea638`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32f7-082c-7df1-b6cc-d4d57805d6bb` | Comments |
| documentation              | `019f32f7-089e-7a42-bcd4-e1c178fc89e2` | Comments |
| TypeScript/API docs        | `019f32f7-093d-7493-890a-21396a7aa44c` | Clean    |
| security                   | `019f32f7-09e1-75c0-b9e0-4e28a4bff277` | Clean    |
| performance/reliability    | `019f32f7-0a59-75c0-93c1-e6f28fc288c1` | Comments |

Findings:

- Task, review, and work-log status fields still described the pre-`6fea638`
  state.

Planned fix:

- Record `6fea638` as the status-fix commit and update current state to the
  post-status-fix re-review state.

### Round 5 - `3624163`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32f9-628a-7242-86d2-db3babfa4add` | Comments |
| documentation              | `019f32f9-632d-7482-8729-9c3aff5b8f21` | Comments |
| TypeScript/API docs        | `019f32f9-63d4-7b72-832e-5be5bfb050fc` | Clean    |
| security                   | `019f32f9-6476-7c61-b18e-34b04f0419d7` | Clean    |
| performance/reliability    | `019f32f9-64fd-7ba2-9964-9abdd71d6c3e` | Comments |

Findings:

- Work-log current state still said to commit the post-status-fix log update
  after `3624163` had already committed it.

Planned fix:

- Update work-log restart guidance to point at round-five re-review/task
  closure.

### Round 6 - `7ed30a3`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32fc-4ae3-7322-b228-0ce18a7030ab` | Clean    |
| documentation              | `019f32fc-4b7d-7ea1-b800-590c75888a41` | Comments |
| TypeScript/API docs        | `019f32fc-4bf6-7300-a446-c0c8678261a9` | Clean    |
| security                   | `019f32fc-4c7a-7fd3-bade-dbf9153ee12b` | Clean    |
| performance/reliability    | `019f32fc-4d4d-7161-b2af-286108182f96` | Comments |

Findings:

- Review/work-log status still described the restart-guidance fix as pending
  after `7ed30a3`.

Planned fix:

- Record `7ed30a3` as the restart-guidance fix and point current state to
  re-review/task closure.

### Round 7 - `2cb0cf8`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f32ff-213b-7602-88ce-dd720710edcf` | Comments |
| documentation              | `019f32ff-21d5-7023-ac19-3e0dfb030d8d` | Comments |
| TypeScript/API docs        | `019f32ff-2249-75d1-9579-59489cf772b3` | Clean    |
| security                   | `019f32ff-22ea-7a70-9fe0-8884b14f1433` | Clean    |
| performance/reliability    | `019f32ff-2363-7062-be80-c73261c5bc33` | Comments |

Findings:

- Task, review, and work-log status fields still described the pre-`2cb0cf8`
  state.

Planned fix:

- Record `2cb0cf8` and point current state to round-seven re-review/task
  closure.

### Round 8 - `05bceb5`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f3301-b4f2-7093-803b-f61ef0e49b68` | Clean    |
| documentation              | `019f3301-b58b-7e91-ba49-c63c849aad70` | Comments |
| TypeScript/API docs        | `019f3301-b60b-7ca0-aa91-674692b9e924` | Clean    |
| security                   | `019f3301-b6a0-70e2-8998-fe58a760fbd1` | Clean    |
| performance/reliability    | `019f3301-b748-7c72-bf6f-b3f3b7481ea7` | Comments |

Findings:

- Task, review, and work-log status fields still described the pre-`05bceb5`
  state.

Planned fix:

- Record `05bceb5` and point current state to re-review/task closure.

### Round 9 - `85909a7`

| Lane                       | Agent                                  | Result   |
| -------------------------- | -------------------------------------- | -------- |
| code style/maintainability | `019f3305-2f53-74b1-8477-cf4204dec8a4` | Comments |
| documentation              | `019f3305-2fcd-73d1-b62a-9e0f0721e32c` | Comments |
| TypeScript/API docs        | `019f3305-3037-7192-afef-7dd9065731de` | Clean    |
| security                   | `019f3305-30bd-7f80-a758-61cff32524f0` | Clean    |
| performance/reliability    | `019f3305-3196-7b50-a0b6-b4fc2b970e62` | Comments |

Findings:

- Task, review, and work-log status fields still described the pre-`85909a7`
  state.

Planned fix:

- Record `85909a7` and point current state to re-review/task closure.
