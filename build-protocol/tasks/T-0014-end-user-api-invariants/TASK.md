# T-0014: End-User API Invariants

Status: complete
Start: `2026-07-07 14:05 WEST`
End: `2026-07-07 18:57 WEST`
Baseline commit: `cfc950c`
Task log path: `build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
Branch: `task/T-0014-end-user-api-invariants`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0014-end-user-api-invariants`
Authoring sub-agent: Guardrail implementation and review-fix sub-agents completed checker/test lane
Reviewer sub-agents: Round 28 clean; all participating reviewers closed
Implementation commit: `0066de5`
Final branch HEAD: `7c7b27f`
Integrated to main: fast-forwarded `main` to `7c7b27f`

## Objective

Correct the framework and to-do example so public end-user code follows the
handler model required by the human and by Spine JVM's de-event-sourcing ADR.
The example must stop using framework-internal `Command`/`Event` envelopes,
schema-bearing decorators, aggregate appliers, handler-owned transaction
control, handler-owned default-route ID extraction, and handler-owned internal
event ID generation.

## Human-Imposed Requirements Ledger

- End-user emitting handlers return generated domain messages, not framework
  `Command` or `Event` envelopes.
- End-user app code must use bare decorators such as `@Assign`, `@Command`,
  `@React`, and `@Subscribe`; schema-bearing decorators are forbidden in normal
  app code.
- `@Assign`, `@Command`, and `@React` handlers require explicit return types.
- `@Subscribe` handlers require explicit `void` return types.
- Aggregates must not use `@Apply`; de-event-sourcing makes aggregate appliers
  invalid.
- End-user code must not call `startTransaction()` or otherwise control entity
  transactions. The framework opens, commits, validates, and rolls back entity
  transactions.
- End-user handlers must not create framework-internal `Event` envelopes or
  internal event IDs. The framework wraps returned domain events and generates
  internal `EventId` values.
- End-user application code must not discover, materialize, or adapt decorated
  handler metadata. Handler discovery/materialization belongs to the framework
  and generated registry tooling.
- Default command routing validates the first command field in Protobuf
  declaration order before handler invocation. Custom command routing replaces
  this default route and defines its own route-validity behavior.
- The next implementation must inspect Spine JVM source and ADR 0001 before
  designing or coding, even if a TypeScript solution seems obvious.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/CODE_QUALITY.md`
- Spine JVM ADR 0001: aggregates without event sourcing.
- Relevant `spine-jvm-docs/` routing, aggregate, entity, transaction, and
  event-emission notes.

## Skill Applicability

Canonical checklist: record evidence for
`build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Skill sources checked:

- Session skill inventory: task-relevant workflow, worktree, review,
  verification, ADR, and documentation skills were available.
- Task-provided skill names/paths: not applicable; the prompt required protocol
  and sub-agent work but did not name a specific skill.
- `build-protocol/skills/EXPECTED_SKILLS.md`: expected workflow skills were
  present in the manifest.
- `~/.agents/skills/*/SKILL.md`: full directory listing checked with
  `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- `~/.agents/.skill-lock.json`: lock manifest was readable; source details were
  inspected only as needed.

Selected skills read before task actions:

- `subagent-driven-development`: applied autonomous implementation, focused
  sub-agents, continuous execution, review loops, and agent closure rules.
- `using-git-worktrees`: applied isolated branch/worktree setup.
- `requesting-code-review`: applied task-scoped reviewer prompts and ledger use.
- `verification-before-completion`: applied fresh verification before claims.
- `architecture-decision-records`: applied decision-log context, decision, and
  consequence structure.

Skills passed to sub-agents/reviewers:

- Requirements splitter: protocol, ledger, JVM ADR/source inspection
  requirement; completed and closed.
- Implementer: protocol, ledger, JVM ADR/source inspection requirement, and
  verification expectations.
- Reviewers: full ledger and lane-specific checks.

Skipped relevant-looking skills:

- `planning-with-files`: project already has build-protocol task, work, and
  review logs.
- `typescript-advanced-types`: available for later type-inference work.
- `nodejs-backend-patterns`: available for later service/runtime tests.

## Scope

In scope:

- Spec/protocol updates for the new invariants.
- Spine JVM ADR/source analysis for de-event-sourcing, transaction ownership,
  command default routing, and internal event ID generation.
- Framework changes needed to enforce the end-user handler model.
- To-do example migration to the public handler API.
- Automated checks/tests that prevent recurrence.
- Documentation updates for changed public workflow.

Out of scope:

- Multi-host transport.
- Durable production storage beyond current in-memory/local storage seams.
- Full delivery-layer dedup redesign unless needed by the invariant tests.
- Implementing a broad new server facade.

## Work Log

- `2026-07-07 14:05 WEST`: Created task worktree and task documents before
  implementation. Carried human-invariant spec patch from the root checkout
  into this task branch.
- `2026-07-07 14:16 WEST`: Requirements splitter reported no blocking
  questions and recommended starting with guardrail/red-test work, followed by
  decorator/registry, transactions, event materialization, command routing,
  to-do migration, and docs/quality gates. Closed splitter agent
  `019f3cb1-01aa-7340-8dec-cd14f94b87f6`.
- `2026-07-07 14:15 WEST`: Guardrail implementation sub-agent extended
  `scripts/check-cleanup-rules.mjs` to scan `examples/**/src` for the forbidden
  end-user API patterns in the task brief and added focused Vitest coverage in
  `scripts/check-cleanup-rules.test.mjs`.
- `2026-07-07 14:15 WEST`: Verification evidence recorded for the guardrail
  lane. `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` passed.
  `node scripts/check-cleanup-rules.mjs` failed intentionally on
  `examples/todo/src/index.ts`, proving the new guard catches the known
  remaining violations without blocking this subtask.
- `2026-07-07 14:24 WEST`: Closed guardrail implementation sub-agent
  `019f3cb5-848b-7f21-b724-5510afb6812c`. Main orchestrator re-ran focused
  guard verification: 10 tests passed; the repo-level cleanup guard still fails
  intentionally on the current to-do example violations.
- `2026-07-07 14:24 WEST`: Inspected current Spine JVM source for `Assign`,
  `Apply`, `React`, `CommandRouting`, `DefaultCommandRoute`, `ByFirstField`,
  `EventEmitter`, `EventFactory`, `AggregateCommandEndpoint`, and
  `AggregateEndpoint`, plus ADR 0001 decisions D2-D8.
- `2026-07-07 14:28 WEST`: Guardrail review-fix sub-agent
  `019f3cbf-1d9b-7410-9d98-08897cb5ba7e` completed and was closed. Main
  orchestrator re-ran focused verification: 15 tests passed; repo-level cleanup
  remains intentionally red against the current to-do example violations.
- `2026-07-07 14:36 WEST`: Main orchestrator addressed guardrail round-2
  findings locally: import-provenance false positives, legitimate command
  business field reads, structured symlink diagnostics, broken-symlink handling,
  and stale review status text. Focused verification passed with 19 tests;
  repo-level cleanup remains intentionally red against the current to-do example
  violations.
- `2026-07-07 14:42 WEST`: Main orchestrator addressed guardrail round-3
  findings locally: narrowed target-field detection to the first command
  parameter's `id`/`target` fields, allowed ordinary business IDs, sanitized
  command-target diagnostics, and kept destructuring/return target extraction
  covered. Focused verification passed with 19 tests; repo-level cleanup remains
  intentionally red against the current to-do example violations.
- `2026-07-07 15:00 WEST`: Main orchestrator addressed guardrail round-4
  documentation and security findings: task status drift was reconciled, and
  forbidden handler return-type diagnostics no longer echo raw source comments or
  generic argument text.
- `2026-07-07 15:08 WEST`: Main orchestrator addressed guardrail round-4
  TypeScript/API, reliability, and JVM-alignment findings: recursive framework
  envelope return containers, aliased framework-owned helper imports, nested
  `examples/**/src` discovery, destructured command target parameters, and
  shadowed command-parameter callbacks are now covered. Focused verification
  passed with 25 tests; repo-level cleanup remains intentionally red against the
  current to-do example violations.
- `2026-07-07 15:25 WEST`: Main orchestrator addressed guardrail round-5
  findings: bounded recursive type scanning, type-only import provenance,
  `.cts` import-equals namespaces, narrowed `Proto.Event`/`Proto.Command`
  checks, computed target-field extraction, `@Assign`-only target extraction,
  and ADR-aligned aggregate transaction wording. Focused verification passed
  with 32 tests; repo-level cleanup remains intentionally red against the current
  to-do example violations.
- `2026-07-07 15:40 WEST`: Main orchestrator addressed guardrail round-6
  findings: split bulky example guardrail collection into file-resolution,
  per-file API collection, and violation grouping helpers; changed command-target
  checking from broad field reads to validation-helper calls; recognized
  type-only proto import-equals aliases; unwrapped common TypeScript expression
  wrappers for validation arguments; and added import-equals member alias
  coverage. Focused verification passed with 36 tests. The tracked to-do example
  remains intentionally red and is routed to the framework/example migration
  slice rather than weakening the guard.
- `2026-07-07 15:56 WEST`: Main orchestrator addressed round-7 TypeScript/API
  finding for type-only import-equals member aliases such as
  `import type LegacyEvent = Proto.Event`. Focused verification passed with 37
  tests; repo-level cleanup remains intentionally red against the current to-do
  example violations.
- `2026-07-07 16:02 WEST`: Main orchestrator addressed round-7 reliability
  findings for order-insensitive import-equals member aliases and target
  validation through local aliases derived from command `id`/`target` fields.
  Focused verification passed with 39 tests; repo-level cleanup remains
  intentionally red against the current to-do example violations.
- `2026-07-07 16:15 WEST`: Main orchestrator addressed round-8 findings:
  split import provenance helpers, skipped mixed type-only core imports, resolved
  import-equals namespace aliases, enforced explicit handler return type rules,
  and made target-validation alias tracking respect simple block shadowing.
  Focused verification passed with 43 tests; repo-level cleanup remains
  intentionally red against the current to-do example violations.
- `2026-07-07 16:36 WEST`: Main orchestrator addressed round-9 findings and the
  latest human clarification: framework-owned handler materialization is now
  explicitly enforced even when an example locally declares
  `materializeDecoratedEntityHandlers`; import-type envelope returns, chained
  import-equals envelope aliases, inner-scope decorator shadowing, chained command
  target aliases, and nested callback target-alias shadowing are covered. Focused
  verification passed with 49 tests; repo-level cleanup remains intentionally red
  against the current to-do example violations, including the local materializer.
- `2026-07-07 16:50 WEST`: Main orchestrator addressed round-10 findings:
  shortened helper names under the four-component rule, rejected local value
  aliases of Spine decorators, rejected primitive/void/undefined/never,
  empty-capable, recursive, and non-domain return types for emitting handlers,
  recognized block-local type aliases, respected function-parameter and
  binding-pattern shadowing, and changed API docs to use non-empty tuple/rest
  return notation. Focused verification passed with 54 tests; repo-level cleanup
  remains intentionally red against the current to-do example migration input.
- `2026-07-07 17:00 WEST`: Main orchestrator addressed round-11 findings:
  generated-domain return validation now requires provenance from generated
  Protobuf imports or aliases to those imports, rest-only tuples are rejected,
  local namespace/object aliases of framework APIs are tracked, namespace
  destructuring of `packEvent`, `EventIdSchema`, and materializers is covered, and
  nested block shadowing of the command parameter no longer false-positives.
  Focused verification passed with 60 tests; repo-level cleanup remains
  intentionally red against the current to-do example migration input.
- `2026-07-07 17:12 WEST`: Main orchestrator addressed round-12 findings:
  non-empty tuple wording is aligned across governing docs, generated namespace
  and value imports are accepted as return provenance, local type aliases shadow
  imported generated/proto names, object destructuring of decorator aliases is
  tracked, object-wrapped command target aliases are rejected in validation
  helpers, command-transforming `@Command` handlers receive target-validation
  guardrails, labeled rest tuple returns are accepted, and target alias shadowing
  now follows block scope. Focused verification passed with 68 tests.
- `2026-07-07 16:24 WEST`: Main orchestrator addressed round-13 findings:
  handler return provenance now rejects generated commands from event-emitting
  handlers and generated events from `@Command` handlers, `@Command` input
  command detection uses generated command names and local aliases instead of
  only the `Command` suffix, framework helper aliases are tracked through
  property/object aliases, command target validation aliases propagate through
  command object aliases and object destructuring, authored-code symlinks are
  confined before reads, and the example/materializer guard explicitly covers
  `materializeDecoratedEntityHandlers` as framework-only discovery. Focused
  verification passed with 76 tests; repo-level cleanup remains intentionally
  red on the current to-do example migration input.
- `2026-07-07 16:40 WEST`: Main orchestrator addressed round-14 findings:
  stale event-sourced replay wording was removed, no-`@Apply`/no end-user
  transaction/no internal event-ID rules were promoted into shared docs,
  generated signal fallback classification no longer treats `TaskCommand` as an
  event, package `src` symlink traversal was removed from package-test checking,
  object-held namespace aliases and command object paths are tracked, destructured
  command parameters and computed target destructuring are rejected, and
  conflicting import-equals aliases terminate deterministically. Focused
  verification passed with 82 tests. Repository cleanup still fails on the
  checked-in to-do example and is now the next implementation target.
- `2026-07-07 17:06 WEST`: Main orchestrator completed the framework/example
  migration slice. `@Assign`, `@Command`, `@React`, and `@Subscribe` accept bare
  standard decorators; legacy schema materialization now rejects bare decorators
  until generated registry metadata is available. Repository command execution
  supports non-event-sourced aggregates whose handlers update draft state inside
  framework-owned transactions and return generated domain event messages. The
  framework wraps those returned messages into internal `Event` envelopes with
  internal IDs and writes snapshots/events. Projection subscriber execution now
  owns the transaction when subscribers only mutate draft state. The to-do example
  no longer contains `@Apply`, schema-bearing decorators, transaction calls,
  framework `Event` returns, `EventIdSchema`, `packEvent`, default-route ID
  validation helpers, or local handler materialization.
- `2026-07-07 17:06 WEST`: Verification evidence after the migration:
  `node scripts/check-cleanup-rules.mjs` passed;
  `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs
examples/todo/src/index.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed 148/148 before the coverage additions; `corepack pnpm test` passed
  725/725; `corepack pnpm test:coverage` initially showed branch coverage at
  89.62%, so focused tests were added for bare decorator materialization and
  framework-owned aggregate/projection transactions. The final escalated
  `corepack pnpm test:coverage` passed 729/729 with 95.11% statements and
  90.31% branches. `corepack pnpm format:check`, `corepack pnpm lint`,
  `corepack pnpm typecheck:build`, and `corepack pnpm docs:check` passed.
  `docs:check` reported only the known invalid-origin source-link warning.
  Sandbox-only targeted verification failed on `listen EPERM 127.0.0.1`; the
  same targeted command passed escalated with 160/160 tests.
- `2026-07-07 17:25 WEST`: Round-15 reviewer fixes completed. The managed
  aggregate path now always packs generated domain events internally, rejects
  empty output, and no longer treats subscriber/reactor schemas as applier
  evidence. Managed aggregate snapshot writes now happen before event append and
  dispatch. Projection subscriber execution no longer uses source-text heuristics
  for transaction ownership. The to-do aggregate command handlers now use the
  routed `this.id`. Public docs no longer present schema-bearing decorators,
  aggregate `@Apply`, or app-owned materialization as normal application usage.
  The cleanup guard now uses NUL-separated Git file listing, escaped diagnostics,
  broader target-helper detection, and smaller target-validation helpers.
  Verification passed with full coverage 733/733, 95.12% statements, and 90.46%
  branches.
- `2026-07-07 17:33 WEST`: Round-16 follow-up fixes completed before
  re-verification. Managed aggregate storage now validates the event batch under
  the aggregate lock via `writeSnapshotWithEvents` before writing the managed
  snapshot; the cleanup guard escapes Unicode format and bidi controls in
  diagnostics; public user-facing docs no longer present appliers,
  schema-bearing decorators, or handler materializers as ordinary application
  patterns.
- `2026-07-07 17:39 WEST`: Round-16 follow-up verification passed. Static gates
  passed (`format:check`, `lint`, `docs:check`, cleanup guard, `git diff
--check`). Focused tests passed 215/215 outside the sandbox after sandbox
  localhost binding failed with `listen EPERM 127.0.0.1`. Full coverage passed
  734/734 with 95.14% statements and 90.47% branches.
- `2026-07-07 17:44 WEST`: Round-17 JVM-alignment findings fixed. Default
  Command/Event first-field routing rejects blank primitive IDs before handler
  invocation, while generated message IDs follow schema validation. The
  cleanup guard rejects end-user `rollbackTransaction()` calls in addition to
  `startTransaction()` and `commitTransaction()`.
- `2026-07-07 17:45 WEST`: Round-17 JVM-alignment verification passed. Static
  gates passed (`format:check`, `lint`, `docs:check`, cleanup guard, `git diff
--check`). Focused guard/routing tests passed 141/141. Full coverage passed
  735/735 with 95.18% statements and 90.55% branches.
- `2026-07-07 17:47 WEST`: Round-18 documentation findings fixed. Public server
  and API docs no longer say state-transition failures occur while applying
  produced events; they now name the framework-owned aggregate command
  transaction.
- `2026-07-07 17:48 WEST`: Round-18 documentation verification passed:
  `docs:check`, `format:check`, and `git diff --check`.
- `2026-07-07 17:53 WEST`: Round-19 reliability finding fixed. Managed
  aggregate persistence now appends events before writing the managed snapshot
  and deletes the just-appended event IDs if snapshot writing fails. The event
  append storage-failure path is covered and leaves no managed snapshot.
  Event rollback tokens are directly covered for cloned event IDs, empty input,
  and closed storage.
- `2026-07-07 17:56 WEST`: Coverage-only verification timeout fixed. The
  handler-decorator semantic TypeScript compiler fixture now has a focused
  15-second test timeout.
- `2026-07-07 17:58 WEST`: Round-19 verification passed after reliability and
  timeout fixes. Static gates passed (`format:check`, `lint`, `docs:check`,
  `git diff --check`). Focused repository/storage tests passed 70/70; focused
  decorator tests passed 10/10. Full coverage passed 738/738 with 95.32%
  statements and 90.57% branches.
- `2026-07-07 18:02 WEST`: Round-20 rollback deletion finding fixed.
  Event rollback deletes sequentially under its lock, and managed aggregate
  rollback preserves snapshot and rollback failures in an
  `AggregateError`. A multi-event managed aggregate test covers delayed failure
  deleting the second appended event and leaves the remaining same-dispatch
  event visible for recovery diagnostics.
- `2026-07-07 18:05 WEST`: Round-20 rollback deletion verification passed.
  Static gates passed (`format:check`, `lint`, `docs:check`, cleanup guard,
  `git diff --check`). Focused repository/storage tests passed 71/71. Full
  coverage passed 739/739 with 95.32% statements and 90.57% branches.
- `2026-07-07 18:10 WEST`: Round-21 ADR 0001 versioning findings fixed.
  Managed no-applier aggregates advance by one dispatch version per command,
  same-dispatch events share that version with unique internal event IDs, and
  legacy applier-backed aggregate execution keeps sequential per-event versions.
  Aggregate history reads validate only the unsnapshotted event tail, starting
  at version 1 when no snapshot exists. Public docs no longer say the new
  aggregate path applies produced events. Legacy `appendEvents()` still rejects
  already-stored version gaps before appending.
- `2026-07-07 18:15 WEST`: Round-21 ADR 0001 versioning verification passed.
  Focused aggregate-storage/repository tests passed 98/98. Static gates passed
  (`format:check`, `lint`, `docs:check`, cleanup guard, `git diff --check`).
  Full coverage passed 740/740 with 95.28% statements and 90.51% branches.
- `2026-07-07 18:18 WEST`: Round-22 architecture documentation findings fixed.
  Architecture docs now scope schema-bearing decorators, `@Apply`, and
  materialization as compatibility and describe the managed aggregate command
  transaction path without applier wording.
- `2026-07-07 18:19 WEST`: Round-22 architecture documentation verification
  passed: `format:check`, `docs:check`, stale-pattern scan, and `git diff
--check`.
- `2026-07-07 18:26 WEST`: Round-23 security findings fixed. Event rollback is
  now scoped to an append-created token from `appendAllWithRollback()` instead
  of a public arbitrary delete API. Cleanup diagnostics use code points and
  escape astral tag/variation format controls.
- `2026-07-07 18:28 WEST`: Round-23 security verification passed. No public
  `deleteAll()` references remain. Focused storage/guard/repository tests
  passed 155/155. Static gates and full coverage passed; coverage was 740/740
  with 95.31% statements and 90.56% branches.
- `2026-07-07 18:33 WEST`: Round-25 rollback token reuse finding fixed.
  Rollback tokens returned from `appendAllWithRollback()` are one-shot, and
  tests prove a stale token cannot delete a later event with the same ID.
- `2026-07-07 18:34 WEST`: Round-25 rollback token reuse verification passed.
  Event-store focused tests passed 11/11; repository focused tests passed
  61/61. Static gates and full coverage passed; coverage was 740/740 with
  95.31% statements and 90.57% branches.
- `2026-07-07 18:42 WEST`: Round-27 managed orphan-tail finding fixed.
  No-applier managed repositories reject unsnapshotted event tails as an
  explicit repair state, and the rollback-failure test proves a later command
  cannot advance from the orphaned event.
- `2026-07-07 18:43 WEST`: Round-27 managed orphan-tail verification passed.
  Typecheck/build passed. Focused repository tests passed 61/61. Static gates
  passed (`format:check`, `lint`, `docs:check`, cleanup guard, and `git diff
--check`). Full coverage passed 740/740 with 95.31% statements, 90.59%
  branches, 97.92% functions, and 95.33% lines.
- `2026-07-07 18:44 WEST`: Round-28 cleanup guard scalability finding fixed.
  Git helper calls in `scripts/check-cleanup-rules.mjs` now use an explicit
  64 MiB output buffer, and the guard tests include a synthetic tracked-file
  list larger than Node's default synchronous child-process buffer.
- `2026-07-07 18:45 WEST`: First round-28 guard-buffer verification attempt
  failed before the checker path because the fixture commit printed 25,000
  create lines and overflowed the test helper's own child-process buffer. The
  fixture commit is now quiet so the test exercises `git ls-files -z`.
- `2026-07-07 18:50 WEST`: Round-28 cleanup guard scalability verification
  passed. Focused cleanup guard tests passed 84/84, cleanup guard passed,
  `format:check` passed, `git diff --check` passed, `lint` passed, `docs:check`
  passed, and full coverage passed 741/741 with 95.31% statements, 90.59%
  branches, 97.92% functions, and 95.33% lines.
- `2026-07-07 18:51 WEST`: Round-28 TypeScript/API findings fixed.
  `@spine-ts/storage` now root-exports the public `EventRollback` token type.
  Public API docs and decorator JSDoc now mark `@Apply` and
  `materializeDecoratedEntityHandlers()` as legacy/framework compatibility, not
  ordinary application APIs.
- `2026-07-07 18:52 WEST`: First TypeScript/API docs verification attempt
  failed because `docs:check` detected the new `EventRollback` root export was
  missing from the expected API export manifest. The manifest now includes
  `EventRollback`.
- `2026-07-07 18:53 WEST`: First lint attempt after the TypeScript/API docs
  fix failed because formal `@deprecated` JSDoc on `@Apply` tripped
  `no-deprecated` in framework compatibility exports/tests. The public warning
  text remains, but the formal deprecation tag was removed.
- `2026-07-07 18:55 WEST`: Round-28 TypeScript/API public-surface
  verification passed. `format:check`, `git diff --check`, `lint`,
  `docs:check`, and full coverage passed. Full coverage passed 741/741 with
  95.31% statements, 90.59% branches, 97.92% functions, and 95.33% lines.
- `2026-07-07 18:56 WEST`: Round-28 reviewer re-checks completed clean.
  Style/maintainability, documentation, TypeScript/API, security,
  performance/reliability, and JVM/ADR alignment reviewers reported `CLEAN`
  after the final fixes.
- `2026-07-07 18:57 WEST`: Participating round-28 reviewer sub-agents were
  closed with previous status `CLEAN`: style/maintainability
  `019f3d56-50ca-72e1-b111-acd828a9a0b1`, documentation
  `019f3d56-5146-7d90-af40-8f3ced3e33e0`, TypeScript/API
  `019f3d56-51b2-7d20-b477-a65ec48f69aa`, security
  `019f3d56-5237-7af2-90ff-b244c5f8911a`, performance/reliability
  `019f3d56-52b4-7121-ad34-4687a1939017`, and JVM/ADR alignment
  `019f3d56-5344-7e41-bc72-7aba3ce27d30`.
- `2026-07-07 18:57 WEST`: T-0014 marked complete. The implementation goal is
  achieved, tests and coverage are passing, docs/API docs are updated, reviewer
  rounds are clean, and participating sub-agents are closed.
- `2026-07-07 18:58 WEST`: Committed the reviewed T-0014 implementation as
  `0066de5` (`Implement end-user API invariants`). This log-maintenance update
  records that now-known commit and cannot name its own future hash.
- `2026-07-07 19:02 WEST`: Integrated T-0014 into `main` with a fast-forward
  merge from `cfc950c` to `7c7b27f`. The pre-existing dirty root spec files
  were stale autonomous edits already superseded by T-0014; they were restored
  before merge. The untracked `human-review-1-jul.md` file was left untouched.

## Staged Roadmap

1. Guardrail baseline and red tests.
2. Decorator and generated registry contract.
3. Framework-owned entity transactions.
4. Domain message emission and event/command materialization.
5. Command routing semantics.
6. To-do example migration.
7. Documentation and quality gates.

## Decisions

- `D-0057` records end-user domain-message handlers and default-route
  validation. This task will extend it with no appliers, no end-user
  transaction control, and framework-owned internal event IDs.

## Verification Plan

- Focused tests for generated registry/decorator metadata.
- Focused tests for aggregate command handling without `@Apply`.
- Focused tests for default first-field command route rejection before handler
  invocation.
- Focused tests proving user handlers return domain events and the framework
  wraps them into internal `Event` envelopes with generated IDs.
- To-do example tests.
- `pnpm lint`, `pnpm docs:check`, `pnpm test`, `pnpm format:check`, and
  `git diff --check`.
