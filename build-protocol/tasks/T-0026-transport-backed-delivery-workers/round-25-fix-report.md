# T-0026 Round 25 Fix Report

Status: verified
Date: `2026-07-10`

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

| Source                  | Scope and evidence                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory | Task-relevant implementation, TypeScript, testing, verification, and security skills were available in-session.                             |
| Task-provided skills    | The prompt explicitly required five skill files, all selected below.                                                                        |
| Expected-skill manifest | Read `build-protocol/skills/EXPECTED_SKILLS.md`.                                                                                            |
| Installed-skill scan    | Ran `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`; the full readable installed directory listing succeeded. |
| Installed-skill lock    | Read `/Users/armiol/.agents/.skill-lock.json`; it was reachable.                                                                            |

Selected and fully read before implementation:

- `test-driven-development`: add focused behavior regressions and capture red/green evidence.
- `implement`: apply the task findings using the existing module boundaries; no commit because this fix-worker prompt prohibits one.
- `javascript-testing-patterns`: keep Vitest regressions behavior-focused and use existing storage fixtures.
- `typescript-advanced-types`: keep the callback rename and internal drain controls explicit and simple.
- `verification-before-completion`: run every required command afresh before reporting completion.

`security-best-practices` was not selected: the requested lower duration validation is handled by the project security/review finding and existing TypeScript validation patterns; no separate security guidance was consulted. `projection-patterns`, `cqrs-implementation`, and `event-store-design` were skipped because this fix batch preserves those boundaries.

Project protocol, task ledger, and the user prompt take precedence over skill advice.

## Scope

Round 25 addresses the mandatory review findings: public callback contract documentation, expired ownership wording, callback naming, minimum lease validation, finite-scan loop progress, post-read claim-expiry decisions, and loop-only pre-callback failure budgeting. Unsupported valid labels remain pending and do not reach callbacks, failures, acceptance, or failure budgets.

## TDD Evidence

Focused red regressions were added before production changes. The pre-fix run
failed four intended cases: `leaseMs: 1` was accepted; a supported tail row
past the loop scan cap was not invoked; a claim expiring during its storage read
was not reclaimed; and a pre-callback failure still permitted the next callback
with `maxFailures: 1`.

## Implementation

- Renamed the public callback type to `OnDeliveryMessage` and aligned callback
  names with the project `on`/`On` convention.
- Documented and preserved `DeliveryEndpointMessage` as the only callback and
  returned-failure snapshot type for `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and
  `REACT_UPON_EVENT`. The snapshot copies `Date` values and `Any.value` bytes;
  valid `CATCH_UP` rows remain pending without callbacks or failure accounting.
- Added one shared `1000ms` lower lease bound for `Delivery` and
  `ShardedWorkRegistry` while retaining the existing upper limit.
- Refreshed the storage clock after every claim-row read before evaluating claim
  expiry, so expired ownership is reclaimable by the later claim attempt.
- Added loop-only drain controls for the remaining failure budget and a
  continuation offset after a saturated all-skipped scan. Direct `drain()` calls
  retain their original accounting when those controls are omitted.
- Updated the public delivery, API, architecture, package, and user docs to
  distinguish expired-claim reclaim from still-future proactive recovery policy.

## Final Verification

Coordinator verification after the fix worker returned:

- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - 4 test files passed, 210 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - TypeDoc and API docs expectation checks completed with exit code 0.
  - Reported only the existing invalid `origin` source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style.
- PASS: `git diff --check`
  - No whitespace errors.

## Concerns

- `.codex-review-packages/` remained an existing untracked scratch directory
  and was left untouched.
- No commit was created by the fix worker.
