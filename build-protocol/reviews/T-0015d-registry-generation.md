# Review Log: T-0015d Generated Registry File Generation

Status: final verification passed; awaiting commit and integration

Task log: `build-protocol/tasks/T-0015d-registry-generation/TASK.md`
Branch: `task/T-0015d-registry-generation`
Baseline commit: `6691f62`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015d-registry-generation`

Required review lanes:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability;
- JVM alignment and ADR 0001 compliance.

## Human-Imposed Requirements Under Review

- Generated registry source is framework-owned build-time output.
- End-user apps must not supply `...Schema` decorators or materialize handlers.
- Generated registry records exclude `@Apply`.
- Generated output lives under package `generated` directories and is ignored by
  Git.
- No runtime discovery, to-do migration, or handler invocation in T-0015d.

## Rounds

### Round 1

Started after the implementation sub-agent reported `DONE` and was closed by
the main orchestrator. Review scope includes modified tracked files and
untracked task artifacts in the T-0015d worktree:

- `packages/server/src/handler/generated-registry-writer.ts`
- `packages/server/test/handler/generated-registry-writer.test.ts`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `packages/server/README.md`
- `build-protocol/tasks/T-0015d-registry-generation/TASK.md`
- `build-protocol/work-logs/T-0015d.md`

Reviewer lanes:

- code style/maintainability: findings
- documentation: findings
- TypeScript/API docs: findings
- security: findings
- performance/reliability: findings
- JVM alignment and ADR 0001 compliance: clean

Findings to fix before round 2:

- Reject pre-existing symlink output files before writing generated registry
  source.
- Render generated source with safe string literals and validated identifiers,
  including `registryName`, `registryModuleSpecifier`, and handler method names.
- Avoid local import binding collisions for entity and schema imports.
- Emit an explicit `GeneratedHandlerRegistry` annotation for the exported
  registry constant so generated modules compile with `isolatedDeclarations`.
- Refresh stale generated-registry docs that still say package-level source
  generation is deferred.
- Tighten README wording so schema-bearing decorators and
  `materializeDecoratedEntityHandlers()` are described as compatibility/testing
  paths, not ordinary end-user API.

### Round 1 Fix Pass

Implementation reopened on `2026-07-07 21:48 WEST` in the same task worktree.
This pass is constrained to the writer/tests/docs slice only, with no runtime
discovery expansion and no root-worktree edits.

All round-1 reviewer agents were closed after reporting.

The fix sub-agent reported `DONE` after addressing the round-1 findings and was
closed by the main orchestrator.

### Round 2

Started after the round-1 fix pass. Review scope remains the full T-0015d
worktree diff from baseline `6691f62`, including the writer, focused tests,
analyzer regression test, docs, and durable logs.

Reviewer lanes started:

- code style/maintainability: findings
- documentation: findings
- TypeScript/API docs: findings
- security: clean
- performance/reliability: findings
- JVM alignment and ADR 0001 compliance: clean

Findings to fix before round 3:

- Reject reserved-word registry names and registry names that collide with
  generated import local bindings.
- Add compiler-backed coverage for rendered registry output under
  `isolatedDeclarations`, plus package-schema import coverage.
- Refresh stale task/work-log state summaries after the review/fix lifecycle.
- Reuse the same import binding for repeated identical entity inputs.
- Validate render-time options before filesystem mutation in `write()`.
- Reject symlinked `repoRoot`.
- Use locale-independent ordering for deterministic import/alias assignment.

All round-2 reviewer agents were closed after reporting.

### Round 2 Fix Pass

Implementation reopened on `2026-07-07 22:03 WEST` in the same task worktree.
This pass is constrained to the generated-registry writer/tests and durable-log
state refresh only, with no runtime discovery expansion, no root-worktree
edits, and no human-review artifact changes.

Completed in this pass:

- add focused regression coverage for reserved/colliding `registryName`
  values, repeated identical entities, package-schema module specifiers with an
  `isolatedDeclarations` compiler check, prevalidation before `mkdir`, and
  symlinked `repoRoot` rejection;
- implement the minimal writer changes needed to satisfy those tests;
- rerun the required verification commands and leave the task ready for round 3
  review.

The fix implementation sub-agent completed this pass on `2026-07-07 22:08
WEST`. Required verification was rerun after a writer-only Prettier cleanup:
focused handler suites passed (`39` tests), `corepack pnpm typecheck:build`
passed, `corepack pnpm docs:check` passed with the pre-existing TypeDoc invalid
remote warning only, `corepack pnpm lint` passed, `corepack pnpm format:check`
passed, and `git diff --check` passed.

### Round 3

Started after the round-2 fix pass. Review scope remains the full T-0015d
worktree diff from baseline `6691f62`, with special attention to the round-2
fixes for registry-name validation, compiler-backed generated-source coverage,
repeated entity import reuse, prevalidation before filesystem mutation,
symlinked `repoRoot` rejection, deterministic ordering, and refreshed durable
state summaries.

Reviewer lanes:

- code style/maintainability: clean
- documentation: findings
- TypeScript/API docs: findings
- security: findings
- performance/reliability: findings
- JVM alignment and ADR 0001 compliance: clean

Findings to fix in round 3:

- Reject strict-mode forbidden `registryName` values `eval` and `arguments`.
- Refresh stale task/work-log state summaries now that round 3 has started and
  findings are being fixed.
- Re-check the output-directory path after `mkdirSync()` before writing the
  generated file.
- Reject `repoRoot` values reached through symlinked ancestor segments.

### Round 3 Fix Pass

Implementation reopened on `2026-07-07 22:19 WEST` in the same task worktree.
This pass is constrained to the generated-registry writer/tests and durable-log
state refresh only, with no runtime discovery expansion, no root-worktree
edits, and no `human-review-1-jul.md` changes.

Completed in this pass:

- add focused regression coverage for strict-mode forbidden `registryName`
  values and `repoRoot` paths reached through symlinked ancestors;
- implement the minimal writer changes needed to reject those names, reject
  repo-root ancestor symlinks, and re-check the output directory path after
  `mkdirSync()`;
- refresh `TASK.md` and `build-protocol/work-logs/T-0015d.md` so round-3 state
  matches the active fix pass;
- rerun the required verification commands and leave the task ready for review
  closure.

The fix implementation sub-agent completed this pass on `2026-07-07 22:21
WEST`. Required verification was rerun after a task-log Prettier cleanup:
focused handler suites passed (`41` tests), `corepack pnpm typecheck:build`
passed, `corepack pnpm docs:check` passed with the pre-existing TypeDoc invalid
remote warning only, `corepack pnpm lint` passed, `corepack pnpm format:check`
passed, and `git diff --check` passed.

### Final Narrow Review

Started after the round-3 fix pass. The narrow final review checked only the
surfaces that had produced round-3 findings.

Reviewer lanes:

- TypeScript/API docs: findings
- filesystem security/reliability: findings
- documentation/log state: findings

Findings fixed locally before final verification:

- Reject `registryName: "GeneratedHandlerRegistry"` because it collides with
  the fixed type-only import binding.
- Replace the final path-string write with an `O_NOFOLLOW` open/write/close
  sequence so a post-validation symlink swap cannot redirect the generated file
  write.
- Refresh this review log so the round-3 lane statuses and final narrow review
  findings are current.

The final local fix was applied by the main orchestrator after all narrow
reviewer agents were closed. Focused handler tests passed (`41` tests), and the
required verification commands passed when proto-generating commands were run
sequentially: `corepack pnpm typecheck:build`, `corepack pnpm docs:check`,
`corepack pnpm lint`, `corepack pnpm format:check`, and `git diff --check`.
`docs:check` still reports only the pre-existing TypeDoc invalid-remote warning.

The final narrow API reviewer reported clean after that local fix. The final
narrow documentation reviewer found stale task/work-log state, and the final
narrow filesystem reviewer found that tests did not directly lock in the
post-`mkdir` directory recheck or no-follow final write. All narrow reviewer
agents were closed after reporting. The main orchestrator then updated the
task/work-log state and strengthened the filesystem tests with module-mocked
coverage for the post-`mkdir` directory symlink recheck and the `O_NOFOLLOW`
open path. Focused handler suites passed again (`42` tests).

Final verification passed after formatting the updated writer test:
`corepack pnpm typecheck:build`, `corepack pnpm docs:check`, `corepack pnpm
lint`, `corepack pnpm format:check`, and `git diff --check` all completed
successfully. `docs:check` still reports only the pre-existing TypeDoc
invalid-remote warning.
