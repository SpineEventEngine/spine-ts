# T-0017h TypeScript/API Docs Second Re-Review

Reviewer: T-0017h TypeScript/API docs second re-reviewer
Date: 2026-07-09
Worktree: `.worktrees/T-0017h-delivery-scheduler-retry`
Branch: `task/T-0017h-delivery-scheduler-retry`
Scope: Focused second re-review of the API follow-up from
`build-protocol/reviews/T-0017h-api-rereview.md`, the fix in
`packages/server/src/delivery/delivery.ts`, and the recorded post-fix
verification in `build-protocol/work-logs/T-0017h.md`.

## Canonical Skill Applicability Check

- Checklist source read:
  `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.
- Session inventory evidence: the live session exposed task-relevant skills
  including `code-review-excellence`, `api-design-principles`,
  `typescript-advanced-types`, `javascript-testing-patterns`,
  `verification-before-completion`, and `review`.
- Task-provided skill names or paths: none explicitly named by path; the
  assignment requested a focused TypeScript/API docs second re-review and
  explicitly required the canonical skill applicability check.
- Repo expected-skill manifest checked:
  `build-protocol/skills/EXPECTED_SKILLS.md`. Relevant expected installed
  skills include `typescript-advanced-types`, `verification-before-completion`,
  and `nodejs-backend-patterns`.
- User-installed skill entrypoints checked with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`;
  this was a full bounded scan of the user skill directory and found readable
  entries including `code-review-excellence`, `api-design-principles`,
  `typescript-advanced-types`, `javascript-testing-patterns`, `review`, and
  `verification-before-completion`.
- Installed-skill lock checked with bounded `rg` over
  `/Users/armiol/.agents/.skill-lock.json`; relevant entries were reachable for
  `review`, `api-design-principles`, `javascript-testing-patterns`,
  `nodejs-backend-patterns`, `typescript-advanced-types`,
  `code-review-excellence`, `requesting-code-review`, and
  `verification-before-completion`.
- Selected and fully read skills before governed review actions:
  - `code-review-excellence` from
    `/Users/armiol/.agents/skills/code-review-excellence/SKILL.md`, selected
    for severity-ranked review findings.
  - `api-design-principles` from
    `/Users/armiol/.agents/skills/api-design-principles/SKILL.md`, selected
    for public API documentation consistency. Its deeper REST/GraphQL reference
    was not needed because this check is a TypeDoc/API README consistency
    review, not an HTTP or GraphQL API design review.
- Relevant-looking skills skipped:
  - `review`; skipped because its fixed-point/sub-agent workflow is broader
    than this single-file, explicitly bounded second re-review report.
  - `typescript-advanced-types`; skipped because the focused follow-up is
    documentation wording for an existing public option, not a type-system
    design change.
  - `javascript-testing-patterns`; skipped because no tests are being authored
    in this no-code-change review lane.
  - `verification-before-completion`; skipped as an action skill because this
    role checks the recorded post-fix verification rather than running a fresh
    implementation verification suite.
  - `nodejs-backend-patterns`; skipped because no backend runtime behavior or
    service API was under review beyond the documented delivery option
    contract.
- Governing precedence: all installed skills are advisory only. The explicit
  reviewer prompt, `BUILD_PROTOCOL.md`, task scope, sandbox rules, and repo API
  documentation conventions govern conflicts.

## Review Result

CLEAN

The API follow-up is resolved. `DeliveryDrainOptions.limit` TypeDoc in
`packages/server/src/delivery/delivery.ts:94` now says "Optional positive page
size for one drain run.", which is consistent with the API README statement in
`docs/api/README.md:294-296` that `DeliveryDrainOptions.limit`,
`DeliveryLoopOptions.limit`, and `InboxReadOptions.limit` are positive
page-size controls with a bounded default when omitted.

The adjacent `DeliveryLoopOptions.limit` implementation remains consistent with
that contract: `packages/server/src/delivery/delivery-loop.ts:20-24` validates a
present limit with `requirePositiveSafeInteger`, and
`packages/server/src/delivery/delivery-loop.ts:170-174` rejects values that are
not positive safe integers.

The recorded post-fix verification in `build-protocol/work-logs/T-0017h.md`
states that the focused delivery/index Vitest command passed with 2 files and
24 tests, `docs:check` passed with only the existing invalid-`origin` TypeDoc
warning, `format:check` passed, and `git diff --check` passed.

No new API-doc findings were found in the touched files reviewed for this
focused follow-up.
