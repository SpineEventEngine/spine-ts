# T-0017h TypeScript/API Docs Review Round 1

Reviewer: T-0017h TypeScript/API docs reviewer
Started: 2026-07-09T07:42:15Z
Worktree: `.worktrees/T-0017h-delivery-scheduler-retry`
Branch: `task/T-0017h-delivery-scheduler-retry`
Scope: Public exports and TypeDoc/API docs for `DeliveryLoop`, API checker
updates, index export tests, `packages/server/src/delivery/delivery-loop.ts`,
and `docs/api/README.md`.

## Canonical Skill Applicability Check

- Session inventory evidence: the live session exposed relevant skills including
  `code-review-excellence`, `typescript-advanced-types`,
  `api-design-principles`, `javascript-testing-patterns`,
  `requesting-code-review`, and `verification-before-completion`.
- Task-provided skill names or paths: none explicitly named by path; the
  assignment requested a TypeScript/API docs reviewer and instructed that
  TypeScript/review skills be read if relevant.
- Repo manifest checked: `build-protocol/skills/EXPECTED_SKILLS.md`.
  Expected relevant installed skills include `typescript-advanced-types`,
  `javascript-testing-patterns`, `requesting-code-review`, and
  `nodejs-backend-patterns`.
- User-installed skill entrypoints checked with
  `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`; this was a
  full bounded directory scan and found readable entries including
  `/Users/armiol/.agents/skills/code-review-excellence/SKILL.md`,
  `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`,
  `/Users/armiol/.agents/skills/api-design-principles/SKILL.md`, and
  `/Users/armiol/.agents/skills/review/SKILL.md`.
- Installed-skill lock checked with `sed -n '1,220p' ~/.agents/.skill-lock.json`;
  the lock was reachable and showed expected skill source metadata, including
  `api-design-principles`, `architecture-patterns`,
  `javascript-testing-patterns`, and other installed skills from
  `wshobson/agents` and `mattpocock/skills`.
- Selected and fully read skills:
  - `code-review-excellence` from
    `/Users/armiol/.agents/skills/code-review-excellence/SKILL.md`, selected for
    review process and actionable findings.
  - `typescript-advanced-types` from
    `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`, selected
    for TypeScript type-safety review.
  - `api-design-principles` from
    `/Users/armiol/.agents/skills/api-design-principles/SKILL.md`, selected for
    public API and developer documentation review.
- Relevant-looking skills skipped:
  - `review` at `/Users/armiol/.agents/skills/review/SKILL.md`; skipped because
    it orchestrates dual sub-agent review since a fixed point, while this
    assignment is a single reviewer lane with an explicitly bounded report path.
  - `javascript-testing-patterns`; skipped because this lane reviews export/API
    tests for coverage and consistency, not implementation of new JS/TS tests.
  - `nodejs-backend-patterns`; skipped because runtime/backend behavior is
    reviewed only where it affects the public DeliveryLoop API contract.
- Governing precedence: all selected skills are advisory. `BUILD_PROTOCOL.md`,
  `CODE_QUALITY.md`, the task ledger, sandbox rules, and repo API conventions
  govern conflicts.

## Review Result

FINDINGS

## Findings

### P2 - Validate `DeliveryLoopOptions.limit` at the public loop boundary

- File/line: `packages/server/src/delivery/delivery-loop.ts:22`,
  `packages/server/src/delivery/delivery-loop.ts:75`, and
  `docs/api/README.md:292`.
- Rationale: The public docs describe `DeliveryDrainOptions.limit` /
  `InboxReadOptions.limit` as positive page-size controls, and this review lane
  was explicitly asked to check option validation and optional limit handling.
  `DeliveryLoop` validates `maxFailures` in the constructor but stores `limit`
  unchanged and forwards it into `Delivery.drain()`. Invalid values such as `0`,
  `NaN`, `Infinity`, or fractional limits therefore fail later through storage
  query validation after the loop has started and the shard has been claimed,
  instead of failing at the public `DeliveryLoop` option boundary. That makes the
  new public API contract less predictable than the adjacent `maxFailures`
  validation and leaves the loop without direct regression coverage for invalid
  limits.
- Concrete fix: Normalize `options.limit` with the same positive finite integer
  rule used for `maxFailures` when it is present, store the validated value, and
  add `DeliveryLoop` tests for invalid limits. If the intended contract is that
  only `InboxStorage` validates limits, update the TypeDoc/API README wording to
  say the loop forwards the value and may reject during `run()`.

### P3 - API README still says scheduler loops are not run

- File/line: `docs/api/README.md:289` and `docs/api/README.md:298`.
- Rationale: The delivery API docs now introduce `DeliveryLoop` as repeating
  `Delivery.drain()` until idle, skipped, stopped, or `maxFailures`, but the
  same paragraph still says, "This slice does not run scheduler loops". That is
  now ambiguous/contradictory for a public API reader because this task adds the
  small supported delivery loop while still deferring production monitors and
  full JVM conveyor/station machinery.
- Concrete fix: Reword the deferred-features sentence to distinguish the new
  supported local `DeliveryLoop` from deferred production/background scheduling,
  retry monitors, conveyor/stations, transport retries, and retained attempt
  history.

## Mandatory Check Notes

- Human-imposed requirements ledger reviewed from
  `build-protocol/tasks/T-0017h-delivery-scheduler-retry/TASK.md`.
- Export/API consistency reviewed in `packages/server/src/index.ts`,
  `scripts/check-api-docs.mjs`, `packages/server/test/index.test.ts`, and
  `docs/api/README.md`; `DeliveryLoop`, `DeliveryLoopOptions`,
  `DeliveryLoopRun`, and `DeliveryLoopStatus` are present in the root export,
  API docs checker allowlist, and runtime export smoke test.
- Type safety and semantics reviewed for options validation, `onMessage`
  callback naming, `run()`/`close()` concurrency, immutable returned result
  shape, and optional limit handling. Findings above cover the remaining
  concerns.
- No Schema-bearing decorator or end-user `Event` envelope regression found in
  the reviewed `DeliveryLoop` public API/docs surface.
- No generated-code policy violation found in the reviewed changes. Generated
  Protobuf files exist in ignored/generated output locations, but `git ls-files
  packages | rg '/generated/'` returned no tracked generated files.

## Verification

- `npx vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/index.test.ts`
  passed: 2 files, 16 tests.
- `pnpm --config.verify-deps-before-run=false docs:check` passed. TypeDoc
  emitted one existing warning about invalid git remote source links.
- `git diff --check` passed.
