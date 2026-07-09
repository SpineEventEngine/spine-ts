# T-0017h Style/Maintainability Review Round 1

Reviewer role: code style/maintainability  
Branch/worktree: `task/T-0017h-delivery-scheduler-retry` /
`.worktrees/T-0017h-delivery-scheduler-retry`  
Date: `2026-07-09`

## Canonical Skill Applicability Check

- Created this review report as the only write target for this reviewer lane.
- Session skill inventory exposed task-relevant skills including
  `code-review-excellence`, `requesting-code-review`,
  `javascript-testing-patterns`, `typescript-advanced-types`,
  `nodejs-backend-patterns`, `architecture-patterns`,
  `verification-before-completion`, and `using-git-worktrees`.
- Task prompt explicitly requested the canonical skill applicability check and
  called out `code-review-excellence` / `requesting-code-review` if selected.
- Checked repo expected-skill manifest:
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- Enumerated readable installed skill entrypoints with:
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- Inspected `/Users/armiol/.agents/.skill-lock.json`; relevant lock entries
  include `code-review-excellence` from `wshobson/agents` and
  `requesting-code-review` from `obra/superpowers`, plus the expected TypeScript
  and backend skills.
- Selected and fully read before diff review:
  `/Users/armiol/.agents/skills/code-review-excellence/SKILL.md` and
  `/Users/armiol/.agents/skills/requesting-code-review/SKILL.md`.
- Skipped relevant-looking implementation skills (`javascript-testing-patterns`,
  `typescript-advanced-types`, `nodejs-backend-patterns`,
  `architecture-patterns`) because this lane is a review-only style and
  maintainability pass, not an implementation/design turn. Skipped
  `review` because the assignment is this single BUILD_PROTOCOL reviewer lane,
  not the broader two-axis review workflow.
- Skills are advisory only; `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, the
  T-0017h task ledger, sandbox rules, and the requested review scope govern.

## Governing Checks

- Read and checked `build-protocol/BUILD_PROTOCOL.md`,
  `build-protocol/CODE_QUALITY.md`, and
  `build-protocol/tasks/T-0017h-delivery-scheduler-retry/TASK.md`, including
  the Human-Imposed Requirements Ledger.
- Reviewed the delivery-loop implementation, focused tests, server root export,
  API-doc/export guard updates, public docs, work logs, and the mechanical
  Prettier-only change in
  `packages/server/test/context/process-manager-handoff.test.ts`.
- CODE_QUALITY checks applied: primary declaration first, method size target,
  exported-helper discipline, semantic name length, callback naming, and
  120-character line limit.
- Simplicity check: the production change is a small loop around
  `Delivery.drain()`; it does not port JVM conveyor/station/monitor machinery
  or add fake durable catch-up storage.

## Findings

### Medium: stopped concurrent `run()` hides the active run

- File/line: `packages/server/src/delivery/delivery-loop.ts:29`
- Rationale: `run()` checks `this.#state.stopped` before checking
  `this.#running`. If a loop is currently draining, a caller can invoke
  `stop()` and then call `run()` again while the first run is still in flight;
  the second call returns an independent zero-count `STOPPED` result instead
  of rejecting the concurrent run or joining the active lifecycle. That weakens
  the otherwise clear one-run-at-a-time API and makes state transitions harder
  to reason about.
- Concrete fix: check `this.#running !== undefined` before the stopped-state
  fast path, or explicitly make `run()` idempotently return the active promise.
  Add a focused test for `run(); stop(); run()` while the first drain is
  blocked.

### Low: API docs still say scheduler loops are absent

- File/line: `docs/api/README.md:298`
- Rationale: The same paragraph introduces `DeliveryLoop` as the supported
  local one-shard loop, then says "This slice does not run scheduler loops."
  That wording now conflicts with the public surface and makes the boundary
  between the supported local loop and deferred production worker supervision
  unclear.
- Concrete fix: reword the exclusion to the narrower deferred behavior, for
  example "This slice does not run transport-backed scheduler loops, retry
  monitors, ..." or "This slice does not run production scheduler/supervision
  loops, ...".
