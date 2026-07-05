# Review Log: T-0012.11d Validation And Immediate Refusal Outcomes

Task log:
`build-protocol/tasks/T-0012-11d-validation-refusal/TASK.md`
Branch: `task/T-0012-11d-validation-refusal`
Baseline commit: `c13b19c`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11d-validation-refusal`
Status: round-3 fixes verified; ready for round-4 independent review

## Required Lanes

- code style/maintainability: local lint and formatting passed
- documentation: docs check passed
- TypeScript/API docs: typecheck and docs check passed
- security: round-2 finding fixed and verified
- performance/reliability: round-2 review clean; focused behavior tests and
  coverage passed; sandbox coverage blocked by local endpoint permissions only

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
