# T-0026 Round 26 Fix Report

Status: verified
Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`

## Canonical Skill Applicability Check

Checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Evidence gathered before this round's code or test changes:

| Source                                     | Scope                                | Evidence                                                                                                                      |
| ------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                    | Task-relevant subset                 | Workflow, TypeScript, implementation, testing, verification, review, and server skills were exposed in the session inventory. |
| Task-provided skills                       | Full list in the Round 26 assignment | The assignment explicitly required five skills listed below.                                                                  |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Full file                            | Read; expected workflow and TypeScript skills are present locally.                                                            |
| User-installed entrypoints                 | Full directory listing               | Ran `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print                                              | sort`; entrypoints were readable. |
| Installed-skill lock                       | Manifest opened                      | Read `/Users/armiol/.agents/.skill-lock.json`; it identifies the expected source repositories and installed paths.            |

Selected skills fully read before governed work:

| Skill                            | Source                                                                 | Round 26 application                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `test-driven-development`        | `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`        | Add focused failing regressions before changing production behavior.                                                                       |
| `implement`                      | `/Users/armiol/.agents/skills/implement/SKILL.md`                      | Implement the assigned findings and run regular type/test checks; task instruction not to commit overrides the skill's commit instruction. |
| `javascript-testing-patterns`    | `/Users/armiol/.agents/skills/javascript-testing-patterns/SKILL.md`    | Use isolated Vitest behavior tests and real delivery/inbox fixtures.                                                                       |
| `typescript-advanced-types`      | `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`      | Keep the public type small and verify excluded keys using compile-time coverage.                                                           |
| `verification-before-completion` | `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md` | Run and inspect every prescribed verification command before reporting completion.                                                         |

Relevant-looking but skipped skills: `nodejs-backend-patterns` (no new Node lifecycle or I/O behavior), `projection-patterns`, `cqrs-implementation`, `event-store-design`, and `saga-orchestration` (this fixes existing delivery controls only), and `security-best-practices` (no new trust boundary or input handling). Their applicability was assessed from the session inventory, expected-skill manifest, and installed entrypoint names; their bodies were not needed for this narrow fix.

Project protocol, task requirements, sandbox rules, and the explicit no-commit instruction take precedence over advisory skill guidance.

## Round 26 Scope

Address the two blocking re-review findings:

1. Keep `scanOffset` and `maxFailures` private to `DeliveryLoop`; public `Delivery.drain()` options and generated API docs must exclude them.
2. Preserve the configured accepted-work limit per drain while supplying the remaining loop failure budget independently, with a regression proving multiple successful callbacks can finish in one loop drain before the first failure exhausts the bound.

The non-blocking note about broad `FaultyDeliveryRecordStorage.compareAndSetRecord()` test-only injection is recorded and left unchanged because it is outside these two seams.

## JVM Guardrail

Round 25's recorded JVM inspection remains applicable: the loop orchestrates the existing direct inbox-drain primitive, keeps shard release in `finally`, and avoids introducing a new station or retry-policy abstraction. This round changes only the TypeScript option boundary and per-drain limits.

## Red/Green Evidence

- Added the public API type assertions before production changes. The focused Vitest typecheck is the coverage mechanism for these assertions because the normal build typecheck excludes test files.
- Replaced the prior one-failure-only loop case with a regression that queues two successful rows, then two failing rows. Before the production change, the focused run failed with `runs: 3` rather than `runs: 1`, proving the default loop failure bound had reduced each drain's accepted-work capacity to one.
- The focused red command was `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/index.test.ts`; it had 1 failure and 28 passing tests.
- Split public `DeliveryDrainOptions` from non-barrel `DeliveryDrainControls`. `deliveryAccess` follows the repository's established internal-capability pattern, allowing `DeliveryLoop` to pass its scan offset and remaining failure budget without exposing either on `Delivery.drain()`.
- `DeliveryLoop.#drainLimit()` now preserves its configured limit or the existing inbox default. The remaining failure count is supplied separately as an internal control.
- Focused green evidence: the same Vitest command passed 29 tests, and `pnpm --config.verify-deps-before-run=false exec vitest run --typecheck packages/server/test/index.test.ts packages/server/test/delivery/delivery-loop.test.ts` passed with no type errors.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts` passed: 5 files, 220 tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated` passed.
- `pnpm --config.verify-deps-before-run=false docs:check` passed. TypeDoc reported the existing invalid `origin` source-link warning and no errors; its expected public export checks passed.
- `pnpm --config.verify-deps-before-run=false format:check` passed after formatting `packages/server/src/delivery/delivery.ts`.
- `git diff --check` passed.

No generated Protobuf output was added to version control. No commit was created.
