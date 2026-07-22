# T-0054: Transactional `update` And `tryUpdate`

Status: Complete, reviewed, integrated, post-merge verified, and pushed

## Objective

Replace the provisional draft-replacement helper with the approved idiomatic
TypeScript counterpart of Spine JVM builder mutation: `update()` for direct
transaction-draft mutation and `tryUpdate()` for validate-before-apply mutation
on a deeply independent scratch state.

## Classification

High-risk. This packet atomically changes a protected API used by every entity
family and changes validation/rollback behavior inside transaction execution.
It also migrates broad framework, example, test, and documentation call sites.
The architecture is already fixed by the accepted Wave 1 plan, so no new
requirements split is required.

## Ownership

- `packages/server` entity transaction/update implementation and focused tests;
- all repository call sites of the removed `updateDraftState()` helper;
- handler-state sections and inline snippets in end-user/API documentation;
- T-0054 task, work, and review records.

Do not implement T-0055 environment behavior, client/query/delivery work, or
unrelated cleanup.

## Acceptance Criteria

1. Remove `updateDraftState()` completely, with no alias or deprecation cycle.
2. Add protected `update(mutator): State`. The mutator receives the live draft,
   mutates it in place, and the method returns the resulting draft state.
3. Add protected `tryUpdate(mutator): readonly ConstraintViolation[]`. It runs
   the mutator against a deeply independent scratch copy of the current draft.
4. A valid scratch candidate replaces the current draft and returns an
   immutable empty violations array. An invalid candidate returns immutable
   violations and leaves the live draft structurally unchanged.
5. Exceptions unrelated to validation propagate unchanged and leave the live
   draft unchanged. Setter/build validation failures, where represented by the
   current TS validation surface, are returned as constraint violations.
6. Sequential `tryUpdate()` calls begin from the current draft, so successful
   changes compose; failed changes do not contaminate later calls.
7. Existing missing-transaction, archived, deleted, committed, and rolled-back
   guards remain coherent for both update paths.
8. Migrate every source, test, example, and public-guide occurrence atomically.
   Inline handler snippets must compile and explain `update()` versus
   `tryUpdate()`, atomicity, returned violations, and propagated errors.

## TDD And Verification

- Capture RED tests for the absent APIs and for scratch rollback/atomicity,
  validation failure, thrown errors, sequential calls, and lifecycle guards.
- Run focused entity/transaction tests, server typecheck/build/lint/docs gates,
  repository scans for stale API names, and diff hygiene before specialist
  review.
- Style/maintainability, TypeScript/API, documentation, and
  performance/reliability (atomicity) reviews are required.
- Run the scheduled full repository verification after accepted review
  corrections, then commit, push, merge to `main`, post-merge verify, and push.

## Assignment Gate

- Existing role: `implementer`.
- Bounded scope: the ownership and acceptance criteria above; one production
  writer; no child spawning.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch.
- The implementer must not commit, push, merge, or modify unrelated files.
- Actual runtime metadata is recorded when exposed; otherwise the explicit
  dispatch and immutable configured role/profile are accepted without
  inventing metadata.

## Human-Imposed Requirements Ledger

- The human-approved protected names are `update()` and `tryUpdate()`; remove
  `updateDraftState()` atomically with no alias or deprecation cycle.
- `update()` is mutation-based: its synchronous mutator receives the live draft
  and the method returns the resulting state snapshot. Callback return values
  never replace state.
- `tryUpdate()` mutates a deeply independent scratch copy, validates before
  apply, returns immutable cloned violations on refusal, and applies a deeply
  detached valid result.
- Async/thenable mutators are unsupported and must be rejected without allowing
  later asynchronous mutation to reach the active draft or produce an
  unhandled rejection.
- Invalid candidates and unrelated thrown errors leave the live draft
  structurally unchanged; unrelated errors propagate rather than becoming
  validation results. Direct `update()` throws after partial mutation do not
  imply rollback.
- Sequential `tryUpdate()` calls begin with the current accepted draft; failed
  calls do not contaminate later calls.
- Missing transaction, archived, deleted, committed, and rolled-back guards
  apply coherently before either mutator is invoked.
- Migrate every source, test, example, and public-guide call site in the same
  packet. Public snippets must compile and explain selection, atomicity,
  violations, synchronous-only execution, and error behavior.
- Frozen JVM semantics are behavioral evidence only. Keep the TypeScript design
  idiomatic and minimal, using the human-approved names rather than JVM API
  spelling or overload proliferation.
- Use behavior-focused RED/GREEN tests, preserve unrelated work, update durable
  task/work/review records with the implementation, and do not commit, push,
  merge, or spawn children from the bounded implementation assignment.

## Baseline

- Branch/worktree: `task/T-0054-transactional-entity-update` /
  `.worktrees/T-0054-transactional-entity-update`.
- Base: verified and pushed `main` at `09d405d3`.
- Current implementation exposes protected `updateDraftState()` and an
  `EntityTransaction.update()` whose callback replaces the draft with its
  return value. The approved API instead mutates a Protobuf message draft in
  place and introduces scratch/apply-on-valid behavior.
- Repository scan finds the provisional name in server code/tests, all three
  examples, testing fixtures, and public guides; the migration is deliberately
  atomic in this packet.

## Acceptance Evidence

- TypeScript/API review is CLEAN. Documentation, style/maintainability, and
  performance/reliability findings were corrected in one consolidated batch;
  all three focused re-reviews are CLEAN.
- The full repository gate passed 84 test files and 1,922 tests in both
  ordinary and coverage runs; 3 files and 21 tests were intentionally skipped.
- Coverage passed at 94.44% statements, 90.16% branches, 94.69% functions, and
  94.52% lines.
- Composite/tooling typechecks, ESLint, cleanup enforcement, formatting,
  TypeDoc/API checks, frozen Proto provenance and descriptor parity,
  generated-source cleanliness, release readiness, and diff hygiene passed.
- No active source, example, or current guide retains `updateDraftState()`, a
  return-value replacement bridge, obsolete transaction names, or stale
  replacement-based mutator guidance.

## Durable Integration Closure

- Reviewed task endpoint `0a22178b` is pushed on
  `origin/task/T-0054-transactional-entity-update`.
- Merge commit `ad6499c3` is pushed on `origin/main`.
- Full post-merge verification on `main` at `ad6499c3` repeated the accepted
  ordinary/coverage results and every TypeDoc, Proto, generated-clean, cleanup,
  formatting, and release-readiness gate.
- T-0054 is durably closed. T-0055 is the active Wave 1 frontier.
