# Review Log: T-0012.11d Validation And Immediate Refusal Outcomes

Task log:
`build-protocol/tasks/T-0012-11d-validation-refusal/TASK.md`
Branch: `task/T-0012-11d-validation-refusal`
Baseline commit: `c13b19c`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11d-validation-refusal`
Status: round-18 report consistency fix verified; ready for follow-up review

## Required Lanes

- code style/maintainability: formatting passed through round 17
- documentation: docs check passed through round 17
- TypeScript/API docs: typecheck passed through round 12; docs check passed
  through round 17, including round-13 README Markdown, round-14/16/17 docs
  updates, and round-15/16 status rollup fixes
- security: round-11 incompatible-payload detail fix verified; earlier
  dispatcher-thrown validation detail sanitization remains verified
- performance/reliability: round-12 rejected-commit marker lifetime fix
  verified; earlier rollback and replay/ordering fixes remain verified;
  historical sandbox coverage gaps were limited to local endpoint permissions

## Findings

### Round 1

1. Security/correctness: `CommandService.Post` can still route malformed
   commands to custom `addCommandDispatcher()` handlers because payload
   validation currently happens only inside repository aggregate execution.
   Validation must move into `packages/server/src/bus/command-bus.ts` before
   `dispatcher.dispatch()`, using the registered schema for the command type
   URL and letting `ValidationException` surface naturally.
2. API design: `TransactionalEntity.rejectedCommitSnapshot()` widens the public
   surface on an exported base class. Rejected-commit inspection should stay
   behind the internal `transactionalEntityAccess` seam only.
3. Documentation: public docs describe pre-durable validation but do not say
   that `CommandService.Post` returns `COMMAND_VALIDATION_ERROR`, message
   `Command payload validation failed.`, and packed `ValidationError` details
   for validation failures alongside refusal and transition-validation
   mappings.
4. Review log clarity: the log text said independent review had not run even
   though lane rows already cited local checks. The local evidence should be
   clearly labeled as pre-review verification.
5. Durable logs: child and parent work logs need an explicit entry for this
   review-fix pass.

## Pre-Review Local Verification Evidence

- Focused validation/refusal/transition tests passed with 2 files, 5 tests, and
  71 skipped.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, and
  `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed on local endpoint permissions
  (`listen EPERM 127.0.0.1`; ZeroMQ `Operation not permitted`).
- Escalated `pnpm test:coverage` passed with 45 files and 597 tests; branches
  90.05%.

## Fix Pass

- `2026-07-05 05:13 WEST`: Fix author started the round-1 pass in this child
  worktree, added RED regressions for invalid custom-dispatcher command
  payloads at the `CommandBus` and `CommandService.Post` seams, and is
  implementing the validation move plus the internal-only rejected-commit
  access change before rerunning focused verification.
- `2026-07-05 05:20 WEST`: Fix author completed the implementation pass and
  reran focused verification. Full `CommandBus` and repository-routing suites
  passed, stable-`Ack` service cases passed, and `pnpm typecheck`,
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check` passed.
  `pnpm lint` then exposed overlong names in this task's code, so the
  orchestrator shortened the public entity scope reason name, local entity
  metadata helper names, and the internal transition-validation error before
  rerunning verification.
- `2026-07-05 05:26 WEST`: Orchestrator reran focused regressions and static
  gates after the naming cleanup. Focused bus/repository/service regressions
  passed with 2 files and 3 selected tests, `pnpm typecheck`, `pnpm lint`,
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check` all passed.

### Round 2

- `2026-07-05 05:32 WEST`: Documentation and TypeScript/API lanes found stale
  `packages/server/README.md` wording that still described repository-local
  payload validation and omitted `COMMAND_VALIDATION_ERROR` details for invalid
  payloads.
- `2026-07-05 05:33 WEST`: Code style/maintainability found repository code
  importing transition-validation errors from the service package, crossing the
  write-side/service boundary.
- `2026-07-05 05:35 WEST`: Performance/reliability was clean.
- `2026-07-05 05:35 WEST`: Security found that mapping every
  `ValidationException` to detailed `COMMAND_VALIDATION_ERROR` could expose
  dispatcher-internal validation details. Only command-bus payload validation
  and transition validation should produce structured `ValidationError`
  details in `Ack`.

## Round-2 Fix Pass

- `2026-07-05 05:38 WEST`: Orchestrator moved command-bus payload validation
  and repository transition validation errors into their owning layers, kept
  `CommandRefusalError` as the service/public handler-facing error, changed
  `CommandService.Post` to expose validation details only for those internal
  boundary errors, added a regression for dispatcher-thrown
  `ValidationException` sanitization, and updated `packages/server/README.md`.
- `2026-07-05 05:42 WEST`: Focused bus/service regressions passed with 2 files
  and 4 selected tests. `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`,
  `pnpm format:check`, and `git diff --check` all passed after the second fix
  pass.

### Round 3

- `2026-07-05 05:45 WEST`: Documentation found that `docs/api/README.md` and
  `docs/architecture/README.md` still underspecified the command-bus validation
  boundary, and `IMPLEMENTATION_REPORT.md` still claimed independent review had
  not run.
- `2026-07-05 05:46 WEST`: Security and TypeScript/API docs lanes were clean.
- `2026-07-05 05:47 WEST`: Code style/maintainability found accepted commands
  with incompatible payload bytes under a registered type URL still mapped to
  generic `COMMAND_POST_ERROR` instead of `COMMAND_VALIDATION_ERROR`.
- `2026-07-05 05:48 WEST`: Performance/reliability found that moving
  `TransitionValidationError` out of services dropped stable direct-caller
  `type` and `clientMessage` fields.

## Round-3 Fix Pass

- `2026-07-05 05:51 WEST`: Orchestrator restored stable metadata on
  repository transition validation errors, mapped structural command payload
  mismatch through `CommandValidationError`, added a command-bus regression for
  incompatible payload bytes, aligned API/architecture docs with the fuller
  bus-boundary wording, and updated the implementation report review summary.
- `2026-07-05 05:54 WEST`: Affected bus/repository/service regressions passed
  with 3 files and 6 selected tests. `pnpm typecheck`, `pnpm lint`,
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check` all passed
  after the third fix pass.

### Round 4

- `2026-07-05 05:58 WEST`: Code style and documentation found docs-only drift:
  `IMPLEMENTATION_REPORT.md` still described round 3 as in progress, public
  contract docs did not all state that dispatcher-thrown `ValidationException`
  values stay sanitized as `COMMAND_POST_ERROR`, and the required-lanes rollup
  still mentioned a round-2 reliability state.
- `2026-07-05 05:59 WEST`: TypeScript/API docs, security, and
  performance/reliability lanes were clean.

## Round-4 Fix Pass

- `2026-07-05 06:01 WEST`: Orchestrator updated public docs with the sanitized
  dispatcher-exception sentence, changed the implementation report round-3
  summary to past tense, and refreshed the review-log lane rollup.
- `2026-07-05 06:04 WEST`: Docs-only verification passed:
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.

### Round 5

- `2026-07-05 06:08 WEST`: Code style and documentation found remaining
  implementation-report wording drift: round 4 was still described as in
  progress, and the summary used the broader phrase "command validation
  failures" instead of "command-bus payload validation failures."
- `2026-07-05 06:09 WEST`: TypeScript/API docs, security, and
  performance/reliability lanes were clean.

## Round-5 Fix Pass

- `2026-07-05 06:10 WEST`: Orchestrator narrowed the implementation report
  command validation wording, recorded dispatcher-thrown `ValidationException`
  sanitization, and changed the round-4 summary to past tense.
- `2026-07-05 06:13 WEST`: Report-only verification passed:
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.

### Round 6

- `2026-07-05 06:17 WEST`: Code style and documentation found the
  implementation report still described round 5 as in progress.
- `2026-07-05 06:18 WEST`: TypeScript/API docs found
  `packages/server/README.md` narrowed `CommandRefusalError` to aggregate
  command handlers even though service mapping accepts any command handler
  throwing it.
- `2026-07-05 06:19 WEST`: Security and performance/reliability lanes were
  clean.

## Round-6 Fix Pass

- `2026-07-05 06:20 WEST`: Orchestrator changed the report round-5 summary to
  past tense and changed `packages/server/README.md` to say any command handler
  may throw `CommandRefusalError`.
- `2026-07-05 06:22 WEST`: Docs/report verification passed:
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.

### Round 7

- `2026-07-05 06:26 WEST`: Documentation and code style found
  `IMPLEMENTATION_REPORT.md` still described round 6 as in progress.
- `2026-07-05 06:27 WEST`: Security and TypeScript/API docs lanes were clean.
- `2026-07-05 06:28 WEST`: Performance/reliability found a P1 correctness
  issue: if an aggregate event applier rolled back after a rejected
  `commitTransaction()`, `rollbackTransaction()` cleared the rejected-commit
  marker before repository execution could raise
  `COMMAND_STATE_TRANSITION_VALIDATION_FAILED`, allowing durable work to
  proceed.

## Round-7 Fix Pass

- `2026-07-05 06:32 WEST`: Orchestrator preserved rejected-commit markers
  across `rollbackTransaction()`, added direct repository and service
  regressions for rejected commit rollback, and kept marker clearing on new
  transaction start or later accepted commit.
- `2026-07-05 06:37 WEST`: Focused rollback regressions passed with 2 files and
  2 selected tests; full affected repository/service suites passed outside the
  sandbox with 2 files and 80 tests. The sandboxed full affected suite failed
  only on known loopback gRPC listener permissions (`listen EPERM 127.0.0.1`).
  `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and
  `git diff --check` passed.

### Round 8

- `2026-07-05 07:04 WEST`: Code style and documentation found stale
  implementation-report wording that still described earlier review rounds as
  current.
- `2026-07-05 07:05 WEST`: TypeScript/API docs noted that removing the older
  `TransactionalEntityScopeErrorReason` name is source-breaking. This is
  intentionally not reverted because the user explicitly approved aggressive
  cleanup for this framework draft and the active hard naming rule forbids
  identifiers with more than four semantic components.
- `2026-07-05 07:06 WEST`: Security was clean.
- `2026-07-05 07:07 WEST`: Performance/reliability found that aggregate
  rehydration replay reused the command-time transition-validation error path,
  that stale rejected-commit marker clearing needed direct coverage, and that
  command-bus validation ordering needed a queued invalid-command regression.

## Round-8 Fix Pass

- `2026-07-05 07:12 WEST`: Orchestrator split aggregate replay failures from
  command-time transition validation with an internal `ReplayError`, added a
  regression for invalid stored history, added a successful fresh-transaction
  recovery regression, and added a command-bus ordering regression proving
  invalid queued commands wait behind active dispatch.
- `2026-07-05 07:34 WEST`: Focused bus/repository regressions passed with 3
  selected tests. Full affected bus/repository/service suites passed outside
  the sandbox with 3 files and 95 tests. The sandboxed affected suite failed
  only on known loopback gRPC listener permissions (`listen EPERM 127.0.0.1`).
  `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and
  `git diff --check` passed.

### Round 9

- `2026-07-05 07:48 WEST`: Documentation found stale parent task/report/work
  log text that still described `T-0012.11d` as the next selected slice, and
  found the child implementation report still labeled earlier coverage evidence
  as final.
- `2026-07-05 07:49 WEST`: Code style found the same stale parent log state and
  noted that `ReplayError` belongs in a repository replay module rather than
  the command-facing error module.
- `2026-07-05 07:50 WEST`: Security found that rejected transaction validation
  details were shallow-cloned, allowing applier code to mutate the
  `ValidationError` later exposed by `CommandService.Post`.
- `2026-07-05 07:51 WEST`: TypeScript/API docs found public docs needed to
  distinguish command-produced event transition validation from internal
  aggregate-history replay failures.
- `2026-07-05 07:52 WEST`: Performance/reliability was clean.

## Round-9 Fix Pass

- `2026-07-05 07:57 WEST`: Orchestrator moved `ReplayError` to a replay-owned
  repository module, cloned nested rejected transition `ValidationError`
  messages with the generated protobuf API, added a mutation regression, and
  qualified public docs plus parent/child task logs.
- `2026-07-05 08:49 WEST`: Focused mutation regression passed. Full affected
  bus/repository/service suites passed outside the sandbox with 3 files and 96
  tests. The sandboxed affected suite failed only on known loopback gRPC
  listener permissions (`listen EPERM 127.0.0.1`). `pnpm typecheck`,
  `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and `git diff --check`
  passed.

### Round 10

- `2026-07-05 08:56 WEST`: Code style and documentation found the child
  implementation report review summary still counted only eight rounds.
- `2026-07-05 08:57 WEST`: Documentation and TypeScript/API docs found stale
  architecture and server README wording that did not distinguish
  current-command transition validation from internal aggregate-history replay
  failures, and stale parent task/report status headers.
- `2026-07-05 08:58 WEST`: Security and performance/reliability were clean.

## Round-10 Fix Pass

- `2026-07-05 09:00 WEST`: Orchestrator updated architecture/server README
  replay wording, parent status headers, and the child implementation report
  review summary.
- `2026-07-05 09:03 WEST`: Docs-only verification passed:
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check`.

### Round 11

- `2026-07-05 09:08 WEST`: Documentation, code style, and TypeScript/API docs
  found current-state summaries that still stopped at round 9 or round 10.
- `2026-07-05 09:09 WEST`: Security found incompatible command payload bytes
  could expose a `COMMAND_VALIDATION_ERROR` detail with an empty
  `ValidationError`.
- `2026-07-05 09:10 WEST`: Performance/reliability was clean.

## Round-11 Fix Pass

- `2026-07-05 09:14 WEST`: Orchestrator changed invalid command payload
  details to include one sanitized constraint violation, added a
  `CommandService.Post` regression for incompatible payload bytes, and updated
  parent/child status summaries.
- `2026-07-05 09:20 WEST`: Focused incompatible-payload service regression
  passed. Full affected bus/repository/service suites passed outside the
  sandbox with 3 files and 97 tests. The sandboxed affected suite failed only
  on known loopback gRPC listener permissions (`listen EPERM 127.0.0.1`).
  `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and
  `git diff --check` passed.

### Round 12

- `2026-07-05 09:24 WEST`: Performance/reliability found that
  `startTransaction()` cleared `rejectedCommits` before any recovery commit
  succeeded. An applier could reject a transition, roll it back, start a new
  transaction, and return without an accepted commit, causing repository
  execution to miss the rejected marker and proceed to durability.
- `2026-07-05 09:25 WEST`: Documentation, code style, TypeScript/API docs, and
  security had no additional code findings for this pass beyond durable-log
  status updates.

## Round-12 Fix Pass

- `2026-07-05 09:28 WEST`: Implementation worker stopped
  `startTransaction()` from clearing rejected-commit markers. Accepted commits
  still clear the marker. Added repository-routing regressions for command-time
  and aggregate-replay paths where a rejected commit is rolled back and followed
  by a new transaction with no accepted commit.
- `2026-07-05 09:38 WEST`: Focused restarted-marker regressions passed with 3
  selected tests. Full affected repository-routing suite passed with 46 tests.
  `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm format:check`, and
  `git diff --check` passed. No service/network test was blocked in this pass.

### Round 13

- `2026-07-05 09:45 WEST`: Documentation review found the lane rollup at the
  top of this log was stale and did not mention the round-11 security fix or
  round-12 rejected-commit marker lifetime fix.
- `2026-07-05 09:46 WEST`: Documentation review found the
  `COMMAND_VALIDATION_ERROR` bullet in `packages/server/README.md` had a
  broken Markdown continuation for `validation failed.`.

## Round-13 Fix Pass

- `2026-07-05 09:50 WEST`: Implementation worker refreshed the lane rollup,
  fixed the README bullet continuation, and updated child durable logs. Docs,
  format, and whitespace verification passed.

### Round 14

- `2026-07-05 09:55 WEST`: Documentation review found
  `IMPLEMENTATION_REPORT.md` still stopped at round 12 in its review summary
  and latest verification, and parent durable headers still said
  `T-0012.11d round-12 verified`.

## Round-14 Fix Pass

- `2026-07-05 10:00 WEST`: Implementation worker updated the implementation
  report round-13 handoff summary and verification evidence, refreshed parent
  durable status headers, and recorded this child review/work-log pass. Docs,
  format, and whitespace verification passed.

## Round-14 Status Follow-Up

- `2026-07-05 10:05 WEST`: Orchestrator spot-check found the child task status
  header still pointed to round 13. Implementation worker aligned
  `TASK.md` with this review log's round-14 status and recorded the correction
  in the child durable logs. Docs, format, and whitespace verification passed.

### Round 15

- `2026-07-05 10:10 WEST`: Documentation review found remaining rollup drift:
  this lane summary still stopped at rounds 12/13, the child implementation
  report stopped at the round-13 handoff, and parent current-state bodies still
  described only the round-12 reliability fix.

## Round-15 Fix Pass

- `2026-07-05 10:15 WEST`: Implementation worker updated the cited rollups
  directly to include round-14 docs/status verification and the follow-up child
  status alignment, then recorded this pass in the child durable logs. Docs,
  format, and whitespace verification passed.

## Round-15 Header Follow-Up

- `2026-07-05 10:20 WEST`: Orchestrator spot-check found child and parent top
  status headers still stopped at round 14. Implementation worker aligned those
  headers with the round-15 durable-log/status fix and recorded the correction
  in child and parent work logs. Docs, format, and whitespace verification
  passed.

### Round 16

- `2026-07-05 10:25 WEST`: Documentation review found current-summary drift:
  the child implementation report and parent current-state bodies still stopped
  at the round-14 docs/status follow-up instead of the round-15
  durable-log/status fixes and header alignment.

## Round-16 Fix Pass

- `2026-07-05 10:30 WEST`: Implementation worker updated the cited current
  summaries directly to include round-15 durable-log/status verification,
  aligned child status headers with this pass, and recorded the fix in child
  durable logs. Docs, format, and whitespace verification passed.

## Round-16 Parent Header Follow-Up

- `2026-07-05 10:35 WEST`: Orchestrator spot-check found parent top status
  headers still stopped at round 15. Implementation worker aligned those
  headers with the round-16 current-summary/status fix and recorded the
  correction in child and parent work logs. Docs, format, and whitespace
  verification passed.

### Round 17

- `2026-07-05 10:40 WEST`: Documentation review found the architecture docs
  still claimed command intake validation, handler invocation/runtime wiring,
  and Ack mapping were absent, and found current rollups still stopped at round
  15 despite round-16 summary/header fixes.

## Round-17 Fix Pass

- `2026-07-05 10:45 WEST`: Implementation worker updated the architecture docs
  to reflect current command validation/refusal/Ack seams while preserving
  deferred server lifecycle, event intake, broker, and subscription-store
  scope; refreshed the cited rollups through round 16; and recorded this pass
  in child durable logs. Docs, format, and whitespace verification passed.

## Round-17 Parent Status Follow-Up

- `2026-07-05 10:50 WEST`: Orchestrator spot-check found parent top status
  headers and current-state bodies still stopped at round 16. Implementation
  worker aligned those parent summaries with the round-17 documentation/status
  fix and recorded the correction in child and parent work logs. Docs, format,
  and whitespace verification passed.

### Round 18

- `2026-07-05 10:55 WEST`: Documentation review found the child
  implementation report still stopped at round 16 in its review summary and
  latest verification even though the round-17 documentation/status fixes were
  verified elsewhere.

## Round-18 Fix Pass

- `2026-07-05 11:00 WEST`: Implementation worker updated the child
  implementation report to include round-17 architecture/status documentation
  fixes and verification, then recorded this report-consistency pass in child
  durable logs. Docs, format, and whitespace verification passed.
