# T-0026 Round 40 Fix Report

Status: fix verified; re-review pending

Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Worker commit: none; coordinator commit `9c51b77a`
(`Fix delivery stale offset page rescan`) recorded the verified fix.

## Skill Applicability

Canonical checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

| Checklist item           | Evidence                                                                                                                            | Result                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Session inventory        | Codex session inventory exposed workflow, testing, TypeScript, backend, review, and verification skills.                            | Task-relevant subset triaged.                                    |
| Task-provided skills     | User required `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`.                                                      | Fully read before test or production edits.                      |
| Expected-skill manifest  | Read `build-protocol/skills/EXPECTED_SKILLS.md`.                                                                                    | Expected workflow/backend skills are locally installed.          |
| Installed entrypoints    | `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print \| sort` succeeded over the full user skill directory. | Metadata triaged without reading unrelated skill bodies.         |
| Installed-skill manifest | Read `/Users/armiol/.agents/.skill-lock.json`.                                                                                      | Readable; confirms expected source repositories and local paths. |

Selected skills:

| Skill                            | Source                                                                                     | Why selected                                 | Applied instruction                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `test-driven-development`        | User-provided path                                                                         | Required reliability bug fix and regression. | Add one focused behavioral regression, watch it fail before production changes, then make it pass. |
| `verification-before-completion` | Session inventory / `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md` | Final verification is explicitly prescribed. | Do not claim completion without fresh command evidence.                                            |
| `javascript-testing-patterns`    | Session inventory / `/Users/armiol/.agents/skills/javascript-testing-patterns/SKILL.md`    | Focused Vitest regression.                   | Exercise real delivery behavior with the existing storage-fault fixture.                           |
| `nodejs-backend-patterns`        | Expected manifest / `/Users/armiol/.agents/skills/nodejs-backend-patterns/SKILL.md`        | Server delivery runtime behavior.            | Preserve explicit bounded async control flow and error accounting.                                 |

Skipped relevant-looking skills:

| Skill                     | Metadata/path evidence                                                                                   | Reason                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `security-best-practices` | Session inventory lists the JS/TS security-review skill.                                                 | Review lane is clean and this batch changes no trust boundary or parsing behavior.                        |
| `performance`             | `/Users/armiol/.agents/skills/performance/SKILL.md` was listed by the bounded inventory command.         | The task is a correctness race repair with an existing bounded scan contract, not a performance redesign. |
| `projection-patterns`     | `/Users/armiol/.agents/skills/projection-patterns/SKILL.md` was listed by the bounded inventory command. | No projection behavior changes.                                                                           |

Project protocol and the T-0026 requirements ledger govern over all selected
skill guidance.

## JVM Inspection

Read `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, including its
delivery/inbox source references. No corresponding JVM source file is present
in this worktree (`rg --files` found no Java/Kotlin delivery or inbox sources),
so the local research note is the available task-relevant source. It confirms
single-shard paged delivery, target endpoint routing, and durable delivered
marking. This fix preserves those existing semantics and only corrects the
TypeScript worker's moving-offset rescan.

## TDD Evidence

Red, before production edits:

```text
Focused delivery-loop regression: 1 failed; expected IDLE with one delivery,
received PAUSED with zero deliveries.
```

The final regression expects `PAUSED` because its retained unsupported filler
leaves the bounded skipped scan resumable; the required behavior is the one
supported delivery in that same loop invocation.

Green, after production edits:

```text
Focused delivery-loop regression: 1 passed | 26 skipped.
```

The regression clears 1,000 skipped head rows after the pre-read boundary
validation and before the offset query. It leaves 1,000 unsupported filler rows
behind the moved supported row, so the stale offset page remains full. The
supported row is delivered in the same loop invocation.

## Changes

- `packages/server/src/delivery/delivery.ts`: revalidate a pending boundary
  after an offset-page read; discard a stale page and head-rescan once when it
  moved. The existing scan budget and delivery accounting remain unchanged.
- `packages/server/test/delivery/delivery-loop.test.ts`: focused full stale
  offset-page regression.
- `packages/server/test/delivery/delivery-worker.test.ts`: expected bounded
  paging inbox-query count changed from three to four for the post-read check.
- T-0026 task, work, and review records: Round 39 status correction and Round
  40 implementation/verification trace.

## Verification

- Focused regression: passed, 1 test.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/inbox.test.ts`: passed, 3 files and 178 tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated`: passed.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the existing invalid-origin TypeDoc source-link warning only.
- `pnpm --config.verify-deps-before-run=false lint`: passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `git diff --check`: passed after durable-record formatting.

## Commit

No commit was created by this worker. Coordinator commit: `9c51b77a` (`Fix
delivery stale offset page rescan`).
