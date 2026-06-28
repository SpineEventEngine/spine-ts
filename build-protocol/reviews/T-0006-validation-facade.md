# Review Log: T-0006 Validation Facade

Task log: `build-protocol/tasks/T-0006-validation-facade/TASK.md`
Work log: `build-protocol/work-logs/T-0006.md`
Branch: `task/T-0006a-validation-facade-contract`
Setup baseline commit: `62ffc33`
Implementation baseline commit: `e953662`
Reviewed commit/diff basis: Round 5 completed against
`876a5586ce20dba7e5ea2b6af50ca2b3c1ce7bb3...2e371b61c08ab5f67ecffb90a48a5ddf4ed0b616`.
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0006a-validation-facade-contract`
Reviewer sub-agents: Round 6 dispatched
Status: Round 6 in progress

## Reviewer IDs

- Code style/maintainability: `019f0f30-4ef2-7ee2-8b19-54ad5366c628`
- Documentation: `019f0f30-9cfa-7ca2-b41b-c9019b1ae269`
- TypeScript/API docs: `019f0f30-dd38-77b0-b091-6380a29bfb4d`
- Security: `019f0f31-0a64-7280-b14c-e3800de65dbb`
- Performance/reliability: `019f0f31-36e2-7463-a065-d6122c248bb7`

## Round 1

Reviewed basis: `e953662...4726985e1786929f5222707dc7abf77c448e8fa3`.

Findings:

- Code style/maintainability
  `019f0f30-4ef2-7ee2-8b19-54ad5366c628`: requested a discriminated
  validation result type so failure results guarantee an error, suggested
  localizing the validation adapter, and requested a fixture comment for the
  base64 validation descriptor.
- Documentation `019f0f30-9cfa-7ca2-b41b-c9019b1ae269`: requested stale
  task/work/review placeholders be replaced with exact SHAs/status, the task
  `Files Changed` section list changed files, the framework guide status be
  updated from bootstrap placeholder, and architecture notes use the
  `spine.validation.*` namespace.
- TypeScript/API docs `019f0f30-dd38-77b0-b091-6380a29bfb4d`: no comments.
- Security `019f0f31-0a64-7280-b14c-e3800de65dbb`: requested safe-by-default
  redaction of invalid field values copied from upstream validation placeholders
  and field values, plus tests/docs.
- Performance/reliability `019f0f31-36e2-7463-a065-d6122c248bb7`: requested a
  core-owned structured failure path for upstream validator or transition-rule
  exceptions, tests for throwing validation/rules and multiple-rule
  ordering/isolation, and exact SHA traceability in logs.

Disposition: Feed all actionable comments back to the authoring sub-agent for a
review-fix pass.

## Round 2

Review-fix pass started from review-finding log head
`7d519d1f4555ffab058d1642065947355c0acf9e`. The authoring sub-agent will
request round 2 after tests, docs, logs, verification, and commit are complete.

Review-fix commit: `0cecc9304eaf4ba2d16b3c4b5101d1b1c4ffbc89`.

Current disposition: review-fix implementation and final verification are
complete; round-2 reviewer reports collected.

Round 2 reviewer IDs:

- Code style/maintainability: `019f0f49-b902-7dc0-89ee-e488ba2be193`
- Documentation: `019f0f49-f2cf-7da3-8b04-64d7c0039d38`
- TypeScript/API docs: `019f0f4a-25f3-7a63-9634-58737bb105c0`
- Security: `019f0f4a-5a13-75e3-9221-16a7d342d42a`
- Performance/reliability: `019f0f4a-9613-7cc3-99b2-beb74fc488e9`

Reviewed basis: `e953662...34927dd`; log-only head during review advanced to
`ce710950aee9e0885aa9e2e15dced54de290b2f1`.

Findings:

- Code style/maintainability
  `019f0f49-b902-7dc0-89ee-e488ba2be193`: no comments.
- Documentation `019f0f49-f2cf-7da3-8b04-64d7c0039d38`: requested stale
  durable-log headers be updated so status, current head, and reviewed basis are
  internally consistent after round-2 dispatch.
- TypeScript/API docs `019f0f4a-25f3-7a63-9634-58737bb105c0`: no comments.
- Security `019f0f4a-5a13-75e3-9221-16a7d342d42a`: requested strict
  safe-by-default placeholder redaction because upstream placeholder keys are
  unrestricted and can carry sensitive payload values under arbitrary names.
- Performance/reliability `019f0f4a-9613-7cc3-99b2-beb74fc488e9`: requested
  stale branch-head and reviewed-basis metadata be corrected for restart-safe
  traceability.

Disposition: Feed the strict placeholder-redaction and durable-log consistency
comments back to the authoring sub-agent for a focused review-fix pass.

## Round-2 Focused Fix

Started from round-2 findings log head
`15b7933216b038888e10ab3cbbefc93c7a79d78d`.

Code-fix commit:
`74d56ab798eb3fad09759d69e480985320af363a`.

Round-2 log handoff commit:
`76f6b017c55e51f5af639a837b2b529a469d47ac`.

Focused fix basis:
`15b7933216b038888e10ab3cbbefc93c7a79d78d...74d56ab798eb3fad09759d69e480985320af363a`.

Verification before code-fix commit: `CI=true corepack pnpm verify` passed with
9 test files and 32 tests; coverage statements 99.19%, branches 92.85%,
functions 100%, lines 99.18%; docs check confirmed 13 proto exports and 21
core exports with the known invalid `origin` TypeDoc warning.

## Round 3

Reviewed basis:
`e953662...9560d2e330cf76c9af910ab5c59d26aac278a9a5`.

Reviewer IDs:

- Code style/maintainability:
  `019f0f5e-99da-7453-a3d6-b026fe155a9d`.
- Documentation: `019f0f5e-9a45-7661-99c1-b2d1b4dddfa7`.
- TypeScript/API docs: `019f0f5e-9ac6-75d1-b202-25c78da7a65d`.
- Security: `019f0f5e-9b45-7c12-b26b-6263831be036`.
- Performance/reliability:
  `019f0f5e-e6ee-7143-988f-e52dd54649a6`.

Findings:

- Code style/maintainability
  `019f0f5e-99da-7453-a3d6-b026fe155a9d`: no comments.
- Documentation `019f0f5e-9a45-7661-99c1-b2d1b4dddfa7`: requested stale
  round-3 durable-log metadata be corrected in the task header and related logs.
- TypeScript/API docs `019f0f5e-9ac6-75d1-b202-25c78da7a65d`: no comments.
- Security `019f0f5e-9b45-7c12-b26b-6263831be036`: requested sanitizing
  transition-rule returned `ConstraintViolation` values before aggregation so
  rule-provided `fieldValue` and arbitrary `message.placeholderValue` entries
  cannot expose sensitive previous/proposed state.
- Performance/reliability
  `019f0f5e-e6ee-7143-988f-e52dd54649a6`: no runtime comments; requested stale
  task-header metadata be corrected for restart-safe traceability.

Disposition: feed the transition-violation sanitization finding to a focused
fix sub-agent. The stale metadata findings are addressed by this round-3
findings/log update.

## Round-3 Focused Security Fix

Started from round-3 findings log head
`86aa522e31a692b49abb2de4aae7d41c8224f0ed`.

Fix commit: `76cbe19beeef0703dded45b3aee66e6b95b0da93`.

Log handoff commit: `876a5586ce20dba7e5ea2b6af50ca2b3c1ce7bb3`.

Disposition: the accepted security finding is addressed in the working tree by
sanitizing transition-rule returned violations through the same facade-owned
conversion path used for upstream single-message validation. The sanitizer
preserves `typeName`, `fieldPath`, and template text, omits raw `fieldValue`,
and redacts every placeholder value before aggregation into
`MessageValidationResult` and `ValidationError`.

RED evidence: `corepack pnpm test packages/core/src/index.test.ts` failed with
19 tests run, 18 passed, and 1 failed because the transition result exposed the
rule-provided `google.protobuf.Any` `fieldValue` instead of omitting it.

Focused verification: `corepack pnpm typecheck` passed, and
`corepack pnpm test packages/core/src/index.test.ts
packages/core/src/validation-facade-boundary.test.ts` passed with 2 test files
and 21 tests.

Full verification before fix commit: `CI=true corepack pnpm verify` passed with
9 test files and 33 tests; coverage statements 99.19%, branches 90.9%,
functions 100%, lines 99.19%; docs check confirmed 13 proto exports and 21 core
exports with the known invalid `origin` TypeDoc warning; proto lint/generate and
generated-output cleanliness passed.

## Closure

Round-3 security finding fixed in
`76cbe19beeef0703dded45b3aee66e6b95b0da93`; security log handoff committed in
`876a5586ce20dba7e5ea2b6af50ca2b3c1ce7bb3`.

## Round 4

Reviewed basis:
`86aa522...876a5586ce20dba7e5ea2b6af50ca2b3c1ce7bb3`.

Reviewer IDs:

- Code style/maintainability:
  `019f0f6d-9998-7053-b653-9a3e0ddf9423`.
- Documentation: `019f0f6d-9a0a-78d0-b2f8-d4f0cd4c8c11`.
- TypeScript/API docs: `019f0f6d-9a74-77a1-af84-2fcb5307252e`.
- Security: `019f0f6d-9aee-7600-97b5-8a87437c05f2`.
- Performance/reliability:
  `019f0f6d-9b7d-76b0-9c7a-c74a00af01e0`.

Findings:

- Code style/maintainability
  `019f0f6d-9998-7053-b653-9a3e0ddf9423`: no comments.
- Documentation `019f0f6d-9a0a-78d0-b2f8-d4f0cd4c8c11`: requested recording
  `876a5586ce20dba7e5ea2b6af50ca2b3c1ce7bb3` as the completed log handoff
  and current head, plus distinguishing it from the code-fix commit.
- TypeScript/API docs `019f0f6d-9a74-77a1-af84-2fcb5307252e`: no comments.
- Security `019f0f6d-9aee-7600-97b5-8a87437c05f2`: no comments.
- Performance/reliability
  `019f0f6d-9b7d-76b0-9c7a-c74a00af01e0`: no runtime comments; requested
  correcting the pending handoff/current-state metadata.

Disposition: correct durable log metadata and re-review.

## Round-4 Log Fix

Log-fix commit: `2e371b61c08ab5f67ecffb90a48a5ddf4ed0b616`.

## Round 5

Reviewed basis:
`876a5586ce20dba7e5ea2b6af50ca2b3c1ce7bb3...2e371b61c08ab5f67ecffb90a48a5ddf4ed0b616`.

Reviewer IDs:

- Code style/maintainability:
  `019f0f71-95fd-7102-afdb-01ca75bd2998`.
- Documentation: `019f0f71-9665-7c03-b068-8c73c2fd97bf`.
- TypeScript/API docs: `019f0f71-96e8-7c83-90b3-8588345f5cab`.
- Security: `019f0f71-975c-7b63-a232-8d8f9919c042`.
- Performance/reliability:
  `019f0f71-97f9-7673-8369-64ced20328d8`.

Findings:

- Code style/maintainability
  `019f0f71-95fd-7102-afdb-01ca75bd2998`: requested the top-level review
  basis be updated from the older round-3 basis so restart readers do not see
  competing current-review signals.
- Documentation `019f0f71-9665-7c03-b068-8c73c2fd97bf`: no comments.
- TypeScript/API docs `019f0f71-96e8-7c83-90b3-8588345f5cab`: no comments.
- Security `019f0f71-975c-7b63-a232-8d8f9919c042`: no comments.
- Performance/reliability
  `019f0f71-97f9-7673-8369-64ced20328d8`: requested the durable task/work
  restart metadata record
  `2e371b61c08ab5f67ecffb90a48a5ddf4ed0b616` as the latest reviewed head
  before the round-5 log fix, instead of pointing only at `876a5586`.

Disposition: correct the review header and restart metadata, then re-review.

## Round-5 Log Fix

Log-fix commit: `2df2abf`.

## Round 6

Reviewed basis:
`2e371b61c08ab5f67ecffb90a48a5ddf4ed0b616...2df2abf`.

Reviewer IDs:

- Code style/maintainability:
  `019f0f75-9e5a-7ab3-b49d-dc31cb431a67`.
- Documentation: `019f0f75-9ec3-7d72-a65c-7e163b25a345`.
- TypeScript/API docs: `019f0f75-9f33-7493-9ac0-e9946c8054c7`.
- Security: `019f0f75-9fab-73e2-92c5-747cad2e932c`.
- Performance/reliability:
  `019f0f75-a037-7813-8bb0-b525dce797d1`.

Disposition: in progress.
