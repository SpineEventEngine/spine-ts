# T-0017h TypeScript/API Docs Re-Review

Reviewer: T-0017h TypeScript/API docs re-reviewer
Started: 2026-07-09T09:05:00Z
Worktree: `.worktrees/T-0017h-delivery-scheduler-retry`
Branch: `task/T-0017h-delivery-scheduler-retry`
Scope: Re-review of `build-protocol/reviews/T-0017h-api-round1.md`, the
consolidated first review-fix response in
`build-protocol/reviews/T-0017h-delivery-scheduler-retry.md`, and the requested
TypeScript/API focus checks.

## Canonical Skill Applicability Check

- Checklist source read before review actions:
  `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.
- Session inventory evidence: the live session exposed task-relevant skills
  including `review`, `code-review-excellence`, `typescript-advanced-types`,
  `api-design-principles`, `javascript-testing-patterns`, and
  `verification-before-completion`.
- Task-provided skill names or paths: no explicit file path was provided; the
  assignment requested a TypeScript/API docs re-reviewer and required this
  canonical skill applicability check.
- Repo manifest checked: `build-protocol/skills/EXPECTED_SKILLS.md`. Relevant
  expected installed skills included `typescript-advanced-types`,
  `verification-before-completion`, `requesting-code-review`, and
  `nodejs-backend-patterns`.
- User-installed skill entrypoints checked with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`;
  this was a full bounded scan of the user skill directory and found readable
  entries including `review`, `code-review-excellence`,
  `typescript-advanced-types`, `api-design-principles`,
  `javascript-testing-patterns`, and `verification-before-completion`.
- Installed-skill lock checked with
  `sed -n '1,220p' /Users/armiol/.agents/.skill-lock.json`; the lock was
  reachable and showed expected skill source metadata including
  `mattpocock/skills` and `wshobson/agents`.
- Selected and fully read skills before governed review actions:
  - `review` from `/Users/armiol/.agents/skills/review/SKILL.md`, selected
    because this assignment is explicitly a review. The fixed-point/sub-agent
    mechanics were not used because this is a bounded re-review against prior
    findings and an explicit focus checklist rather than a two-axis review from
    a supplied base ref.
  - `code-review-excellence` from
    `/Users/armiol/.agents/skills/code-review-excellence/SKILL.md`, selected
    for actionable, severity-ranked review findings.
  - `typescript-advanced-types` from
    `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`, selected
    for TypeScript type-safety review.
  - `api-design-principles` from
    `/Users/armiol/.agents/skills/api-design-principles/SKILL.md`, selected for
    public API and developer documentation review.
  - `verification-before-completion` from
    `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`,
    selected to require fresh evidence before reporting status.
- Relevant-looking skills skipped:
  - `javascript-testing-patterns`; skipped because this lane reviews whether
    tests cover API behavior, but does not author test code.
  - `nodejs-backend-patterns`; skipped because no HTTP/backend service API was
    under review except delivery-loop public API surface.
  - `requesting-code-review`; skipped because this role performs re-review and
    does not dispatch additional reviewer agents.
- Governing precedence: selected skills are advisory only. `BUILD_PROTOCOL.md`,
  the task ledger, explicit reviewer prompt, sandbox rules, and repository API
  conventions govern conflicts.

## Review Result

FINDINGS

### P3 - `DeliveryDrainOptions.limit` TypeDoc still omits the positive constraint

- File/line: `packages/server/src/delivery/delivery.ts:94`.
- Rationale: The API README now says `DeliveryDrainOptions.limit`,
  `DeliveryLoopOptions.limit`, and `InboxReadOptions.limit` are positive
  page-size controls, and `DeliveryLoopOptions.limit` / `InboxReadOptions.limit`
  TypeDoc source comments say positive. The public TypeDoc source comment for
  `DeliveryDrainOptions.limit` still says only "Optional bounded page size for
  one drain run." The generated reference therefore leaves the direct drain API
  less precise than the API landing page and adjacent option docs.
- Concrete fix: Change the comment to state the same contract, for example:
  "Optional positive page size for one drain run; defaults to a bounded page
  size when omitted."

## Focus Check Notes

- `DeliveryLoopOptions.limit` is now validated at construction:
  `packages/server/src/delivery/delivery-loop.ts:22` stores either `undefined`
  or `requirePositiveSafeInteger("limit", options.limit)`, and the helper
  rejects non-safe-integers and values `<= 0`.
- Invalid limit tests are present:
  `packages/server/test/delivery/delivery-loop.test.ts:270` covers `0`, `-1`,
  `1.5`, `NaN`, `Infinity`, and `Number.MAX_SAFE_INTEGER + 1`, asserting the
  constructor throws before a run starts.
- Stop/close semantics are now stated accurately in the API README and TypeDoc:
  `docs/api/README.md:291` says `stop()` prevents future drain starts without
  interrupting an in-flight `Delivery.drain()`, and `docs/api/README.md:293`
  says `close()` calls `stop()` and waits for the current drain.
- API export checker/root export tests remain consistent:
  `packages/server/src/index.ts:47`, `scripts/check-api-docs.mjs:218`, and
  `packages/server/test/index.test.ts:221` all include `DeliveryLoop`; the API
  checker allowlist also includes `DeliveryLoopOptions`, `DeliveryLoopRun`, and
  `DeliveryLoopStatus`.
- No generated-code regression found: `git ls-files packages | rg
'/generated/'` returned no tracked generated package files.
- No schema-decorator or end-user `Event` envelope regression found in the
  reviewed delivery-loop/API-doc changes. The new public API surface is limited
  to framework delivery loop exports and does not introduce end-user handler
  materialization, schema-bearing decorators, `@Apply`, manual transactions, or
  framework event envelopes.
- No new type-safety problem found in the reviewed production or test code.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/index.test.ts --passWithNoTests`
  passed: 2 files, 24 tests.
- `pnpm --config.verify-deps-before-run=false exec tsc -b --noEmit` passed.
- `node scripts/check-api-docs.mjs` passed and reported expected API export
  counts, including 198 expected `@spine-ts/server` exports. TypeDoc emitted the
  existing invalid-`origin` warning.
- `git diff --check` passed.
