# Review Log: T-0012.11d Validation And Immediate Refusal Outcomes

Task log:
`build-protocol/tasks/T-0012-11d-validation-refusal/TASK.md`
Branch: `task/T-0012-11d-validation-refusal`
Baseline commit: `c13b19c`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11d-validation-refusal`
Status: pre-review implementation verified; first independent review received;
review-fix pass underway

## Required Lanes

- code style/maintainability: local lint and formatting passed
- documentation: docs check passed
- TypeScript/API docs: typecheck and docs check passed
- security: pending independent review
- performance/reliability: focused behavior tests and coverage passed; sandbox
  coverage blocked by local endpoint permissions only

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
