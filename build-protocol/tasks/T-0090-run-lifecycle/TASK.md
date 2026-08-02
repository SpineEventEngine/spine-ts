# T-0090: Run-managed server lifecycle

Status: Active
Start: `2026-08-02`
Baseline: `29dd6a3c`
Branch: `task/T-0090-run-lifecycle`
Worktree: `.worktrees/T-0090-run-lifecycle`
Parent: `T-0089`

Classification: High-risk. This task changes process signal ownership,
concurrent server admission, permanent environment closure, and retryable
resource lifecycle.

## Objective

Makes `Server.run()` the process-owned entry point that admits an exclusive
run-managed environment generation, supports sibling run-managed servers, and
closes `ServerEnvironment` exactly once after the final run-managed server
retires. `Server.start()` remains caller-managed and never closes its
environment.

## Acceptance Criteria

1. A `run()` call rejects before its listener opens when a start-managed server
   is attached.
2. A `start()` call rejects before its listener opens while run ownership is
   active.
3. Multiple run-managed servers share one environment. Closing a non-last
   server leaves siblings usable; closing the last closes the environment after
   network intake, contexts, and server resources.
4. `SIGINT`, `SIGTERM`, explicit close, repeated/concurrent close, and startup
   failure converge without leaked listeners or duplicate closure.
5. A failed final environment close remains retryable without repeating
   already-completed server/facility phases.
6. Existing caller-managed startup, failed-start rollback, and reusable
   environment behavior remain compatible.
7. No runner abstraction, lifecycle-phase API, health endpoint, auth, registry,
   delivery-client, or deployment behavior is added.

## Human-Imposed Requirements Ledger

- Apply every lifecycle decision and exclusion from the approved Wave 5 plan
  and its A1 execution split verbatim.
- Prefer the smallest change to `Server`, `ProcessServerCoordinator`,
  `ServerEnvironment`, and existing attachment ownership.
- Follow RED-GREEN-REFACTOR. Record the expected failure before production
  changes and run focused race/lifecycle regressions after each behavior.
- Keep one production-code writer. Preserve unrelated changes and never touch
  either protected `human-review` file.
- Commit and push every feature-branch checkpoint immediately. Do not build
  Spine JVM or add any new package/dependency.

## Implementation Dispatch

- Existing role: `implementer`.
- Ownership: `packages/server/src/server/server.ts`,
  `process-server-coordinator.ts`, the minimum related environment attachment/
  lifecycle files, mirrored server tests, public TSDoc/reference claims, and
  this task's work log. No auth, registry, delivery-client, or deployment files.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit. Runtime metadata is recorded when exposed;
  otherwise the immutable configured role/profile and limitation are evidence.
- The implementer must not spawn children or merge. It may commit only after
  focused preflight passes and must push every commit immediately, then report
  RED and GREEN evidence.

## Verification

- Focused: server/environment ownership, process signal, close race,
  failed-start, and retry tests with changed-source coverage.
- Cheap preflight: generated build and tooling typechecks, affected ESLint,
  cleanup/TSDoc, format, docs/API, generated cleanliness, and `git diff --check`.
- Final profile: `verify:release`, once after relevant review convergence.

## Review Assignments

- Style/maintainability: existing reviewer, `gpt-5.6-terra` / high.
- TypeScript/API docs: existing reviewer, `gpt-5.6-terra` / high.
- Performance/reliability: existing reviewer, `gpt-5.6-terra` / high.
- Documentation: existing reviewer, `gpt-5.6-luna` / medium, only if public
  reference prose changes.
- Security: N/A because this task changes no credentials, authorization,
  request trust boundary, or public network exposure.

All required model/reasoning fields are recorded before dispatch. Reviewers
receive the complete converged checkpoint and return one aggregated finding
batch before corrections.
