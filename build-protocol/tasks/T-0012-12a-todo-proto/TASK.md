# T-0012.12a: Todo Proto Generation

Status: implementation complete; pending review
Start: `2026-07-05 11:38 WEST`
End: Pending
Baseline commit: `b12ef3b`
Task log path: `build-protocol/tasks/T-0012-12a-todo-proto/TASK.md`
Branch: `task/T-0012-12a-todo-proto`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12a-todo-proto`
Authoring sub-agent: Codex implementation sub-agent
`019f31cd-b967-7341-8d79-4d95d8acfec4`
Reviewer sub-agents: Pending
Implementation commit: Uncommitted implementation diff; do not commit per handoff.
Final branch HEAD: `b12ef3b`

## Objective

Add the example-local to-do Protobuf contract and generation workflow without
committing generated output, so later example slices can import generated
Protobuf-ES schemas directly from `examples/todo/generated/`.

## Required Inputs Read

- `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/CODE_QUALITY.md`
- `examples/todo` placeholder files
- existing proto/generation scripts under `scripts/`

## Skill Applicability

Canonical checklist evidence for `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Skill sources checked:

| Source                                              | Scope Checked                                              | Evidence                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                             | Task-relevant subset visible in the current session        | Selected workflow skills: `subagent-driven-development`, `using-git-worktrees`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`; implementation-relevant advisory skills: `typescript-advanced-types`, `javascript-testing-patterns`, `nodejs-backend-patterns`. |
| Task-provided skill names/paths                     | Checked                                                    | Parent split requires the common verification gate, generated-clean gate, and TypeDoc guard.                                                                                                                                                                                                         |
| `build-protocol/skills/EXPECTED_SKILLS.md`          | Checked through parent split                               | Expected autonomous skills are installed/readable; no new skill install is needed.                                                                                                                                                                                                                   |
| `~/.agents/skills/*/SKILL.md`                       | Checked through parent split and current session inventory | Relevant installed skills are available.                                                                                                                                                                                                                                                             |
| `~/.agents/.skill-lock.json` or equivalent manifest | Checked through parent split                               | Lock manifest was readable and included task-relevant user skills.                                                                                                                                                                                                                                   |

Selected skills read before task actions:

| Skill                            | Source        | Applicability                                   | Instructions Applied                                                                    |
| -------------------------------- | ------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `subagent-driven-development`    | Session skill | Governs implementer and review-loop delegation. | Spawn one implementer for this slice, then five reviewer lanes; close agents when done. |
| `using-git-worktrees`            | Session skill | Required one worktree per slice.                | Created `.worktrees/T-0012-12a-todo-proto` from reviewed parent branch.                 |
| `requesting-code-review`         | Session skill | Required review after implementation.           | Use a bounded diff package for review.                                                  |
| `receiving-code-review`          | Session skill | Required for reviewer feedback.                 | Verify comments before applying fixes.                                                  |
| `verification-before-completion` | Session skill | Required before claims and commits.             | Record fresh verification commands/results before marking complete.                     |

Skills passed to sub-agents/reviewers:

| Recipient                | Skills/Instructions Passed                                                                        | Notes                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Implementation sub-agent | Workflow skills above; TypeScript/Node/testing guidance; parent `T-0012.12a` acceptance criteria. | Implementer must update this task log and report while coding.                        |
| Reviewers                | Pending implementation.                                                                           | Each lane receives the slice diff, acceptance criteria, and common verification gate. |

Skipped relevant-looking skills:

| Skill                   | Source               | Reason Skipped                                                                                                       |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `api-design-principles` | Installed user skill | This slice defines example domain protobuf contracts under existing Spine conventions, not a new API design surface. |
| `event-store-design`    | Installed user skill | No storage/runtime behavior is in scope.                                                                             |
| `projection-patterns`   | Installed user skill | Projection behavior is planned for later slices; this slice only defines schemas.                                    |

## Scope

In scope:

- Add example-owned `.proto` files for to-do identifiers, state/projection,
  commands, and events.
- Use Buf / `@bufbuild/protoc-gen-es` for generation into
  `examples/todo/generated/`.
- Keep generated output ignored by Git and out of formatting/lint/coverage and
  TypeDoc output.
- Extend or add generated-clean verification so `examples/todo/generated/`
  freshness is checked for tracked, missing, symlinked, stale, and orphaned
  files.
- Keep example TypeScript ready to import generated schemas directly.
- Update package/scripts/docs only as needed for proto generation.

Out of scope:

- Aggregate, projection, service, runtime, or server behavior.
- Business validation/refusal tests beyond schema options.
- Any `@spine-ts/server` framework runtime change.
- New third-party dependencies unless a concrete tooling blocker is recorded.

## Acceptance Criteria

- `examples/todo` owns domain `.proto` files for `TaskId`, `Task`, task-list
  projection state, `CreateTask`, `RenameTask`, `CompleteTask`, `ReopenTask`,
  and `TaskCreated`/`TaskRenamed`/`TaskCompleted`/`TaskReopened`.
- Domain files follow Spine conventions: commands in `*_commands.proto`,
  events in `*_events.proto`, entity state declares `(entity).kind`, and
  validation options are present for at least one required user-supplied field.
- Generated Protobuf-ES output goes under `examples/todo/generated/`, is
  ignored by Git, and is regenerated during the example build/test workflow.
- Example TypeScript can import generated schemas directly without generated
  facades.
- Root or example tooling excludes generated example output from lint,
  coverage, TypeDoc, and formatting churn while still proving ignored output is
  fresh.
- The generated-clean check covers `examples/todo/generated/` and fails on
  tracked, missing, symlinked, stale, or orphaned generated files.
- No runtime framework behavior is added in this slice.

## Verification Plan

- Focused example generation command for `examples/todo`.
- `git check-ignore -- examples/todo/generated/.cleanup-enforcement-check`
- `git ls-files -- examples/todo/generated`
- A generated-clean check for `examples/todo/generated/`, either by extending
  `proto:check-generated` or adding an equivalent example-specific script.
- `pnpm docs:check`, proving `examples/todo/generated/**` is excluded or
  otherwise guarded from TypeDoc output while `examples/todo/src/index.ts`
  remains documented.
- Focused example proto/domain compile or smoke test.
- `pnpm typecheck`
- `pnpm lint`
- Formatting check covering changed tracked files.
- `pnpm test:coverage`; if sandbox restrictions block local endpoints or IPC,
  rerun with approved escalation and record both results.
- `git diff --check`

## Work Log

- `2026-07-05 11:38 WEST`: Created subtask worktree from reviewed parent
  branch commit `07d06a2` and opened this task log before implementation.
- `2026-07-05 11:39 WEST`: Implementation sub-agent began from handoff commit
  `b12ef3b`, read required task/spec/tooling inputs, selected the existing
  Buf / Protobuf-ES workflow with no new dependencies, and added a failing
  smoke test for direct generated schema import.
- `2026-07-05 11:39 WEST`: Added todo proto contracts, generation workflow,
  generated-clean coverage for the example output root, generated-output
  exclusions, and direct generated schema smoke coverage.
- `2026-07-05 11:48 WEST`: Main orchestrator reran verification sequentially
  to avoid generation/read races and confirmed the implementation evidence.

## Decisions

- Reuse the existing Buf / Protobuf-ES toolchain. No new third-party dependency
  is selected.
- No Spine JVM server-source inspection is needed for this slice because it
  does not touch `@spine-ts/server` runtime/API code.
- Extend the existing generated-clean script to cover multiple generated roots
  instead of creating a separate example-only checker.
- Add `@bufbuild/protobuf` to `@spine-ts/example-todo` package dependencies at
  the repo-pinned version so generated Protobuf-ES runtime imports resolve from
  the example workspace.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- `examples/todo/proto/spine/example/todo/v1/*.proto`
- `examples/todo/buf.gen.yaml`
- `examples/todo/src/index.test.ts`
- `examples/todo/package.json`
- `buf.yaml`, `buf.gen.yaml`, `.gitignore`, `.prettierignore`,
  `eslint.config.mjs`, `typedoc.json`, `vitest.config.ts`, `pnpm-lock.yaml`
- `scripts/proto-workflow.mjs`, `scripts/check-generated-clean.mjs`
- T-0012.12a task/report/work logs

## Tests Run

- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  failed as the intended TDD red step because
  `../generated/spine/example/todo/v1/tasks_pb.js` does not exist yet.
- `pnpm proto:generate`: passed.
- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`:
  passed with 2 tests.
- `pnpm proto:lint`: passed.
- `git check-ignore -- examples/todo/generated/.cleanup-enforcement-check`:
  passed; path is ignored.
- `git ls-files -- examples/todo/generated`: passed; output was empty.
- `pnpm proto:check-generated`: passed for package and todo generated roots.
- `pnpm exec vitest run scripts/check-generated-clean.test.mjs --passWithNoTests`:
  passed with 3 tests.
- Main orchestrator reran `pnpm proto:generate`, the focused example smoke
  test, `pnpm proto:check-generated`, `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm docs:check`, `git diff --check`, and
  `pnpm exec vitest run scripts/check-generated-clean.test.mjs --passWithNoTests`;
  all passed in sequential order.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm docs:check`: passed with the existing TypeDoc invalid-origin warning.
- `pnpm format:check`: passed.
- `pnpm test:coverage`: sandboxed run failed on known local IPC/HTTP2 binding
  restrictions; escalated rerun passed.
- `git diff --check`: passed.

## Coverage Result

- Sandboxed `pnpm test:coverage` failed with ZeroMQ IPC `Operation not
permitted` and HTTP/2 `listen EPERM 127.0.0.1` timeouts.
- Escalated `pnpm test:coverage` passed: 45 test files, 620 tests, statements
  95.06%, branches 90.22%, functions 97.60%, lines 95.08%.
- Main orchestrator confirmed the same sandbox failure mode and escalated
  coverage result before commit.

## Documentation And Public API Impact

| Area                             | Impact                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Package README impact            | Pending; mention generation only if scripts/user workflow change.                              |
| TypeDoc/API docs impact          | `examples/todo/generated/**` is excluded; `examples/todo/src/index.ts` remains an entry point. |
| Public API additions/removals    | Generated schemas are importable from ignored output; no generated facade added.               |
| Framework `USER_GUIDE.md` impact | N/A unless framework generation workflow changes.                                              |
| Example `USER_GUIDE.md` impact   | Pending; final guide slice owns full rewrite.                                                  |
| API examples                     | Pending later implementation slices.                                                           |
| Compatibility notes              | Record any generation-tooling caveat.                                                          |

## Security Impact

| Area                    | Impact                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Dependencies            | No new dependencies planned.                                                                  |
| Secrets and credentials | No secrets used.                                                                              |
| IPC                     | N/A.                                                                                          |
| Validation              | Add schema validation options for required user-supplied fields.                              |
| Tenant boundaries       | N/A for schema-generation slice.                                                              |
| `Any`/deserialization   | Generated messages will later be packed/unpacked through existing registry/service contracts. |
| Logging                 | N/A.                                                                                          |

## Verification

- Fresh verification completed and recorded in `Tests Run` and
  `Coverage Result`.

## Review Rounds

Pending implementation.

## Integration Result

Pending.
