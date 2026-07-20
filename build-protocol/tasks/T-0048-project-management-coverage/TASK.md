# T-0048: Project-management example coverage closure

Status: In progress; prerequisite to T-0046 datastore-storage remediation

## Objective

Make the existing project-management load-runner conform to the end-user API
cleanup rule and make its source participate in meaningful coverage, without
broad coverage exclusions. This task must complete before T-0046 resumes.

## Decisions and dependency

- The project-management source edit and the reusable coverage-policy work are
  intentionally separate from T-0046.
- T-0048 is a prerequisite: T-0046 must not resume its datastore remediation
  until T-0048 has been reviewed, merged, post-merge verified, and pushed.
- T-0048 establishes the coverage mechanism using project-management as the
  first adopter. T-0046 will apply that mechanism to datastore-orders after
  this task lands; it must not retain a blanket source exclusion.
- The T-0046 decisions already approved by the human are recorded in that
  task's remediation plan: finite query materialization, signed 64-bit indexed
  bigint validation, and a final example-quality load-runner cancellation slice.

## Human-imposed requirements ledger

- Follow `build-protocol/BUILD_PROTOCOL.md` strictly.
- Do not modify `human-review-1-jul.md`.
- Do not begin or modify T-0046 datastore implementation while this prerequisite
  is unfinished.
- Keep the project-management and broad coverage edits in this task.

## Acceptance criteria

- `examples/project-management/src/load-runner.ts` does not use the prohibited
  end-user `packCommand` helper and continues to send correct generated
  `Command` envelopes over real gRPC paths.
- Project-management source is covered by behavior-focused tests; no broad
  `examples/project-management/src/**/*.ts` coverage exclusion remains.
- The coverage configuration is reusable by the forthcoming datastore-orders
  test app without changing public framework APIs or lowering thresholds.
- Focused example, type, lint, formatting, and coverage checks pass before
  review; final verification follows the protocol.

## Non-goals

- No datastore adapter implementation, datastore-orders code, public storage
  API, TypeDoc, benchmark redesign, or global coverage-threshold change.

## High-risk assumptions

- Generated `CommandSchema` plus the public `packAny` helper is the smallest
  permitted replacement for `packCommand` in end-user source.
- Source-map/instrumentation configuration can cover the runner without
  weakening repository-wide coverage guarantees.

## Skill applicability

- Read and applied: `using-git-worktrees`, `planning-with-files`.
- Expected-skill manifest checked: `subagent-driven-development`,
  `using-git-worktrees`, `requesting-code-review`,
  `verification-before-completion`, `planning-with-files`,
  `architecture-decision-records`, `typescript-advanced-types`, and
  `nodejs-backend-patterns` are locally listed.
- Applicable later: `test-driven-development` for the behavior/coverage tests,
  `subagent-driven-development` for the assigned implementer,
  `requesting-code-review` and `verification-before-completion` at their
  respective protocol gates.
- N/A now: architecture-decision-records, TypeScript advanced types, and Node
  backend patterns; this task adds no architectural decision, public type
  contract, or backend service.

## Orchestrator outline

1. Establish the existing runner and coverage behavior, then record findings.
2. Assign one bounded implementation owner after a minimal coverage approach is
   selected.
3. Run focused verification and all relevant review lanes.
4. Merge, post-merge verify, push branch and main, then unblock T-0046.
