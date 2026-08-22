# T-0217: Wave 14 Package And SPI Boundaries

Status: Complete
Start: `2026-08-22 Europe/Lisbon`
End: `2026-08-22 Europe/Lisbon` (integration and cleanup complete)
Baseline commit: `e72222053d20a8828ca63aa4c76d7c13dc9216b5`
Task log path: `build-protocol/tasks/T-0217-wave14-package-spi-readmes/TASK.md`
Branch: `codex/wave14-review-corrections`
Worktree: `.worktrees/wave14-review-corrections`
Authoring agent/function: `/root/wave14_review_corrections`, existing `implementer` function
Configured dispatch: `gpt-5.6-terra` / `medium` (explicit; runtime self-telemetry unavailable)
Reviewers: complete clean wave and affected re-reviews recorded in `REVIEW.md`
Implementation history: `159aed14a`, `4d2c3fbd3`, `3ecc9a56d`, and `5d19572f5`
Current review basis: `5d19572f5`; accepted review correction batch: `a4df30c2f`
Integration merge: `2841fbf21` on `origin/main`
Integration closure record: `da40d2caf` on `origin/main`

Task classification: High-risk
Classification reason: the accepted correction narrows a published TypeScript
SPI, changes release tooling behavior, and corrects public package onboarding.

## Objective

Close every confirmed Wave 14 review finding: make the snapshot.2 disposable
publisher's documented prepare-then-publish flow executable; expose only the
stable generated-handler registry data contract at the public server SPI;
document that SPI; make the core, proto, storage, and testing READMEs begin with
a meaningful external-consumer success; reconcile Wave task records; and remove
only clean merged Wave worktrees after durable integration.

## Required Inputs Read

- `AGENTS.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/CONTRIBUTOR_WORKFLOW.md`
- `build-protocol/tasks/T-0216-npm-snapshot-publication/TASK.md`
- `.planning/2026-08-21-wave14-package-spi-readmes/task_plan.md`
- the repository-grounded Wave 14 review against
  `ea7ec5e8cf7f0cbcdfa78befd45a41788aee8c8c..e72222053d20a8828ca63aa4c76d7c13dc9216b5`

## Skill Applicability

Selected skills read before task actions:

| Skill                     | Source                                              | Applicability                                                                  | Instructions Applied                                                                           |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `receiving-code-review`   | `~/.agents/skills/receiving-code-review/SKILL.md`   | The task implements a completed review batch.                                  | Each finding was independently checked against the current tree before acceptance.             |
| `test-driven-development` | `~/.agents/skills/test-driven-development/SKILL.md` | The publisher regression and SPI boundary change require behavior-first proof. | Add focused tests first, observe the expected failures, then implement the minimum correction. |

Skills passed to the implementer: both selected skills and the governing build
protocol. No planning skill is selected because the accepted public-contract
shape is explicit and presents no unresolved architectural choice.

## Scope

In scope:

- focused publisher and SPI regression tests;
- the narrow server handler-registry contract facade, export mapping, and API
  reference;
- beginner-flow corrections in four package READMEs;
- snapshot.2 disposable publisher/instructions outside Git;
- T-0216/T-0217 status, scope, evidence, review, and closure records;
- safe cleanup of verified clean and merged Wave 14 worktrees after integration.

Out of scope:

- new package APIs beyond narrowing the accepted SPI;
- snapshot.4 or another publication;
- NPM registry mutation, credential changes, tags, or pushes to the official
  SpineEventEngine repository;
- deletion of dirty or unmerged worktrees.

## Behavior-Focused Acceptance Criteria

1. A test reproduces the snapshot.2 prepare-then-publish cleanliness failure;
   after correction, ignored install/build outputs do not block a second
   invocation while tracked or non-ignored untracked changes still do.
2. The public `server/spi/handler-registry` declaration exports only the stable
   version/registry/handler-record data-contract types and no ingestion class or
   ingestion error implementation; its reference documentation explains the
   contract and compatibility boundary.
3. Each affected README gives an external installation step and one connected,
   meaningful first success before contributor or advanced material.
4. Durable task records accurately describe integrated Wave work and include
   this Human-Imposed Requirements Ledger and complete review dispositions.
5. Focused checks, relevant specialist review, and one converged
   `verify:release` pass succeed before integration.
6. Feature commits and integration are pushed immediately to `origin`; no NPM
   publication or official-repository push occurs.
7. Only clean Wave worktrees whose commits are contained in `origin/main` are
   removed. Dirty or unmerged worktrees remain for separate assessment.

## Human-Imposed Requirements Ledger

- Address every finding from the repository-grounded Wave 14 review.
- Do not rely on conversational memory; use current repository and planning
  evidence.
- Continue autonomously under the build protocol.
- Preserve the exact version-commit history already established for snapshot.2
  and snapshot.3; this correction does not bump versions.
- Keep publication manual and never publish a package during implementation or
  testing.
- Keep disposable publisher files outside Git and free of credentials.
- Push implementation only to configured `origin`; do not push to the official
  SpineEventEngine repository.
- Preserve unrelated user changes in the primary checkout.

## Assignment Gate

| Existing role/function | Bounded ownership                                                                                             | Explicit model  | Explicit reasoning | Child spawning | Runtime telemetry                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | ------------------------------------------------------------------------------------------------- |
| `implementer`          | All correction files and focused tests in this worktree, plus the two disposable snapshot.2 files outside Git | `gpt-5.6-terra` | medium             | Prohibited     | Desktop immutable dispatch fields are authoritative; child self-introspection may be unavailable. |

## Work Log

- `2026-08-22`: The orchestrator verified all five accepted findings against
  current files, preserved the dirty primary checkout, created this isolated
  branch from `origin/main`, and recorded the assignment before implementation.

## Decisions

- Use a dedicated contract facade rather than annotations such as `@internal`,
  because emitted TypeScript declarations remain importable without
  `stripInternal`.
- Ignore only Git-ignored preparation outputs in the disposable publisher's
  cleanliness gate; tracked and ordinary untracked changes remain fatal.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Tests Run

- RED: `node /Users/armiol/development/experiments/spine-ts-wave14-publication/publish-spine-ts-2.0.0-snapshot.2.mjs --self-test` failed with `Checkout must be completely clean` after ignored `node_modules` output.
- GREEN: the same external self-test passed, proving ignored preparation output is accepted while ordinary untracked and concealed tracked mutations remain rejected.
- RED: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/package-exports.test.ts --passWithNoTests` failed because the SPI runtime exported `HandlerRegistryIngestor` and `HandlerRegistryIngestionError`.
- GREEN: `pnpm typecheck:build:generated && pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/package-exports.test.ts --passWithNoTests` passed 8/8.
- RED: `pnpm --config.verify-deps-before-run=false exec vitest run scripts/check-typescript-snippets.test.mjs --passWithNoTests` failed because core lacked an external install-first path.
- GREEN: the same focused policy suite passed 17/17; `node docs/check-typescript-snippets.mjs packages/core/README.md packages/proto/README.md packages/storage/README.md packages/testing/README.md` passed.
- Orchestrator-independent GREEN: the external `--self-test` passed and the
  combined focused Vitest run passed 25/25.
- Diagnostic correction: cheap preflight initially failed in
  `tsc --noEmit -p tsconfig.eslint.json` because `typeof import(...)` is a
  runtime module namespace and cannot contain the SPI's type-only registry
  contract. The boundary test now directly imports `GeneratedHandlerRegistry`,
  uses a meaningful type assertion, and has `@ts-expect-error` type imports for
  each forbidden ingestion symbol. GREEN: the specified typecheck passed and
  `packages/server/test/package-exports.test.ts` passed 8/8.
- Second diagnostic correction: ESLint required the negative imports to
  participate in a compile-time-only tuple, and Vitest deprecated
  `toMatchTypeOf`. The test now asserts that tuple without creating runtime
  imports and uses `toExtend` for the allowed data-contract shape. GREEN:
  focused ESLint, the tooling typecheck, and the export suite passed 8/8.

## Coverage Result

- Focused policy/export suites pass. No focused coverage run was selected because these are export-map and documentation-policy assertions. The final release result is recorded below.

## Documentation And Public API Impact

| Area                             | Impact                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Package README impact            | Four public package onboarding flows change.                                  |
| TypeDoc/API docs impact          | The handler-registry SPI becomes contract-only and is documented.             |
| Public API additions/removals    | Accidental ingestion implementation exports are removed from the SPI subpath. |
| Framework `USER_GUIDE.md` impact | N/A; no framework workflow changes.                                           |
| Example `USER_GUIDE.md` impact   | N/A; examples are used only as linked source context.                         |
| API examples                     | The testing README receives one connected operation/assertion flow.           |
| Compatibility notes              | Snapshot prerelease surface is narrowed to the already approved contract.     |

## Security Impact

The disposable publisher continues to expose no credentials and permits no
registry mutation without explicit `--publish`. Dependencies, IPC, tenant
boundaries, deserialization, and logging are unaffected.

## Verification

- Selected profile: `verify:release`, because this correction touches a public
  package boundary and release tooling.
- Mandatory cheap preflight and relevant specialist review precede the single
  converged release run.

Final `verify:release` diagnostic reached cleanup and failed only because the
Testing README source used a five-component standalone helper without a
necessity disposition. The snippet is now top-level, preserving connected
create/post/acknowledgement/finally-close behavior. Cleanup, real README snippet
compilation, focused policy, tooling TypeScript, formatting, and diff checks are
green. The final release rerun subsequently passed, as recorded below.

The second final `verify:release` at `b049c3fc9` passed deterministic gates and
reported 4,422 passing and 19 skipped tests, but one covered-suite timeout:
the EntityRecord TypeDoc assertion in `scripts/check-api-docs.test.mjs` exceeded
its 30-second hard limit while a full TypeDoc subprocess contended with parallel
coverage work. The exact isolated file passed 3/3 in 25.41 seconds. Its timeout
is now 60 seconds; the subsequent final release verification passed, as recorded
below.

Final `verify:release` at `41d991152` passed: 277 files passed with 4 skipped;
4,423 tests passed with 19 skipped; duration 180.30 seconds; statement coverage
93.15% (22,221/23,853), branch coverage 90% (13,130/14,588), function coverage
92.81% (5,451/5,873), and line coverage 94.36% (20,608/21,839). Implementation
and review were subsequently integrated through merge `2841fbf21` and recorded
at `da40d2caf` on `origin/main`.

## Review Waves And Dispositions

| Concern                    | Disposition                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Code style/maintainability | Clean: `/root/wave14_correction_style_review`; configured `gpt-5.6-terra` / high.                          |
| Documentation completeness | Clean: `/root/wave14_correction_documentation_review`; configured `gpt-5.6-luna` / medium.                 |
| TypeScript/API docs        | Clean affected re-review: `/root/wave14_correction_api_review`; configured `gpt-5.6-terra` / high.         |
| Performance/reliability    | Clean affected re-review: `/root/wave14_correction_reliability_review`; configured `gpt-5.6-terra` / high. |

No security review is invoked: this is not final release readiness and the external publisher remains credential-free and non-publishing by default.

Complete review wave findings and clean re-reviews are recorded in `REVIEW.md`: one accepted P1
packed-consumer facade assertion, three accepted P2 corrections for the shared
external clean guard/self-test, meaningful testing README first success, and
record-field drift. All corrections, final release verification, integration,
and task closure are complete. Runtime self-introspection was
unavailable for every reviewer; immutable configured dispatch metadata is the
recorded evidence.

## Integration Result

Complete. Post-merge fresh-worktree `pnpm install --frozen-lockfile && pnpm verify:release`
passed after merge `2841fbf21`: 277 files passed/4 skipped; 4,423 tests
passed/19 skipped; duration 195.49 seconds; statement coverage 93.27%
(22,250/23,853), branch coverage 90% (13,130/14,588), function coverage
92.79% (5,450/5,873), and line coverage 94.43% (20,624/21,839). The task is
complete. Clean completed Wave 14 worktrees were removed;
`wave14-npm-publication` is preserved because it has untracked planning state.
