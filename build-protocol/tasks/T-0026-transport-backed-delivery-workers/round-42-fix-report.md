# T-0026 Round 42 Fix Report

Status: fixes verified; re-review pending

Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Worker commit: none; coordinator commit `be299a5d`
(`Close delivery raw callback exports`) recorded the verified fix.

## Skill Applicability

Canonical checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

| Checklist item           | Evidence                                                                                                                    | Result                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Session inventory        | The Codex session exposed workflow, testing, TypeScript, backend, security, review, and verification skills.                | Task-relevant subset triaged.                                    |
| Task-provided skills     | User required `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`.                                              | Fully read before test or production edits.                      |
| Expected-skill manifest  | Read `build-protocol/skills/EXPECTED_SKILLS.md`.                                                                            | Expected workflow/backend skills are locally installed.          |
| Installed entrypoints    | `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` succeeded over the full user skill directory. | Metadata triaged without reading unrelated skill bodies.         |
| Installed-skill manifest | Read `/Users/armiol/.agents/.skill-lock.json`.                                                                              | Readable; confirms expected source repositories and local paths. |

Selected skills:

| Skill                            | Source                                                                                    | Why selected                                 | Applied instruction                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `test-driven-development`        | User-provided path                                                                        | Required for the public API behavior change. | Add a focused export-boundary test, observe its expected failure, then apply the minimal export change. |
| `verification-before-completion` | Session inventory; `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md` | User prescribed final verification commands. | Use fresh command evidence before reporting success.                                                    |

Skipped relevant-looking skills: `javascript-testing-patterns` (the user-provided
TDD workflow governs the test-first change); `nodejs-backend-patterns` (no Node
lifecycle behavior changes); `security-best-practices` (the task-specific public
boundary is more direct); and `typescript-advanced-types` (no advanced type
design is needed for removing exports).

## Scope And Initial Evidence

- Read the applicable build protocol, T-0026 task, work log, review record, and
  TDD instructions before task edits.
- `packages/server/src/index.ts` still exports `Delivery`, `DeliveryLoop`, their
  direct-drain option/result types, and `OnDeliveryMessage`; each exposes the
  raw `onMessage` callback boundary to root-package callers.
- `packages/server/README.md` still documents those direct delivery APIs while
  also claiming no raw worker callback API exists.
- `scripts/check-api-docs.mjs` and `packages/server/test/index.test.ts` still
  expect the same root delivery surface.
- The Round 41 range-check wording is stale after coordinator commits
  `2a673e42` and `d7c9b35e`; this round records the now-passing range check.
- Read `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`; its delivery
  model keeps inbox routing and replay framework-owned. The local research note
  cites the relevant `core-jvm/server` sources, while no local source checkout
  is available. The boundary fix therefore removes root exports rather than
  adding another public replay path.

## Red/Green Evidence

- RED: removed `Delivery` and `DeliveryLoop` from the root export expectation,
  moved the test's internal behavior imports to delivery source modules, and
  ran `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/index.test.ts`. The test failed only because the barrel
  still returned `Delivery` and `DeliveryLoop`.
- GREEN: removed the direct delivery exports from `packages/server/src/index.ts`.
  The same focused test then passed with `10` tests.

## Changed Files

- `packages/server/src/index.ts`: remove the direct raw-callback delivery
  classes and all associated option/result/callback types from the root barrel.
- `packages/server/test/index.test.ts` and nine package-internal delivery,
  context, repository, and server tests: assert the reduced public surface and
  import internal delivery implementation types directly where behavior tests
  need them.
- `scripts/check-api-docs.mjs`: remove the eleven direct delivery API names from
  the root export manifest.
- `packages/server/README.md`, `docs/USER_GUIDE.md`, `docs/api/README.md`, and
  `docs/architecture/README.md`: document public inbox/storage exports and
  framework-owned replay without describing a raw callback API.
- T-0026 task, work, review, and Round 41 report records: mark the resolved
  baseline-to-HEAD diff check and repair the flush-left continuation.

## Verification

- Passed focused red/green root export test: RED failed on the two remaining
  barrel exports; GREEN passed `10` tests.
- Passed prescribed focused Vitest command: `5` files, `194` tests.
- Passed `pnpm --config.verify-deps-before-run=false typecheck:build:generated`.
- Passed `pnpm --config.verify-deps-before-run=false docs:check`; TypeDoc kept
  the existing invalid-`origin` source-link warning and reported `203` expected
  server exports.
- Passed `pnpm --config.verify-deps-before-run=false lint`.
- Passed `pnpm --config.verify-deps-before-run=false format:check`.
- Passed `git diff --check ca8fb2b3..HEAD` and working-tree `git diff --check`.

## Commit

No worker commit was created. Coordinator commit: `be299a5d` (`Close delivery
raw callback exports`).
