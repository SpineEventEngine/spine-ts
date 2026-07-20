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

## 2026-07-20 review-fix skill applicability

- Session inventory source: the Codex Desktop skill inventory supplied to the
  implementer. The task-relevant installed skills were confirmed with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`;
  the expected-skill source and paths were checked in
  `build-protocol/skills/EXPECTED_SKILLS.md`, and installation metadata in
  `/Users/armiol/.agents/.skill-lock.json`.
- Selected and read in full: `verification-before-completion`; its fresh-evidence
  gate governs the focused post-fix test, formatting, and diff checks.
- `test-driven-development` was read in full and is N/A for this batch: it
  deletes a duplicate test and changes no runtime or production behavior. The
  retained direct-source `load-runner.test.ts` test remains the behavior owner.
- `subagent-driven-development`, `using-git-worktrees`, and
  `requesting-code-review` are N/A to this implementer pass: the orchestrator
  supplied the existing worktree, completed the review wave, and expressly
  prohibited subagent dispatch. `planning-with-files`,
  `architecture-decision-records`, `typescript-advanced-types`, and
  `nodejs-backend-patterns` are N/A because this batch has no planning,
  architecture, public-type, or backend-runtime change.

## 2026-07-20 review-fix acceptance criteria

- Remove only the duplicate ten-user real-gRPC load-runner happy path from
  `topology.test.ts`; `load-runner.test.ts` remains its direct-source behavior
  and coverage owner.
- Preserve the reusable Vitest policy: test discovery includes exactly
  `examples/*/test/**/*.test.ts`; coverage includes exactly
  `examples/*/src/**/*.ts`; the coverage exclusion list contains no
  project-management source exclusion.

## 2026-07-20 review-fix evidence

- Native focused verification was required because the sandbox rejects loopback
  binding with `listen EPERM`. `pnpm --config.verify-deps-before-run=false exec
vitest run examples/project-management/test/topology.test.ts
examples/project-management/test/load-runner.test.ts` completed `2` files /
  `7` tests with no failures.
- Focused Prettier and `git diff --check` were run after the change. Their final
  results are recorded in the work and review logs; no production or T-0046
  file is part of this fix batch.
