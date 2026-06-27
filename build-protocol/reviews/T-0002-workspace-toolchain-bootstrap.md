# Review Evidence: T-0002 Workspace And Toolchain Bootstrap

Task log: `build-protocol/tasks/T-0002-workspace-toolchain-bootstrap/TASK.md`
Work log: `build-protocol/work-logs/T-0002.md`
Branch: `task/T-0002-toolchain`
Worktree: `.worktrees/T-0002-toolchain`
Baseline commit: `0566998`
Implementation commit: `a937649`
Review round 1 fix commit: `a0638218ec2b5caa786f958333a00af6a9fcbf4c`
Review round 1 handoff evidence commit: `ee611a203ee40387b4ffb09451489d25c98cb01b`
Active reviewed state convention: the review round 2 fix/evidence-log successor follows `ee611a203ee40387b4ffb09451489d25c98cb01b`; recovery must verify the actual branch tip with `git rev-parse HEAD` and rerun recorded checks against `main...HEAD`.
Status: Round 2 findings accepted, fixed, and verified; ready for review round 3 from the evidence-log successor branch tip.

## Reviewer Rounds

| Round | Reviewer ID             | Role                                            | Reviewed Basis                                          | Outcome                                                                                |
| ----- | ----------------------- | ----------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1     | `T-0002-review-round-1` | Protocol/toolchain/governance review            | `d26b016670ae6729d52739d4765977a7bfbbec83` before fixes | Five findings accepted and fixed in `a063821`; handoff evidence recorded in `ee611a2`. |
| 2     | `T-0002-review-round-2` | Protocol evidence and TypeScript/tooling review | `ee611a203ee40387b4ffb09451489d25c98cb01b`              | Three findings accepted and fixed in the evidence-log successor to `ee611a2`.          |

## Round 1 Findings

| Finding                                                | Disposition     | Fix Evidence                                                                                                                                               |
| ------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable final HEAD/current state was not recorded.     | Accepted/fixed. | T-0002 task/work logs now record the pre-review tip and recovery convention.                                                                               |
| Checked-in pnpm freshness bypass and duplicate policy. | Accepted/fixed. | `.npmrc`/`pnpm-workspace.yaml` no longer set release-age bypass defaults; decision text records one-time exception only.                                   |
| Absolute local worktree paths were committed.          | Accepted/fixed. | T-0002 logs use `.worktrees/T-0002-toolchain`; redaction search passed.                                                                                    |
| Formatting globs were task-specific.                   | Accepted/fixed. | `package.json` format scripts cover durable repo areas including future `build-protocol/**/*.md`, with legacy ignored files explicit in `.prettierignore`. |
| Node baseline was warning-only.                        | Accepted/fixed. | Added `.node-version`, `engine-strict`, pnpm `engineStrict`, and `check:node` in `verify`.                                                                 |

## Round 2 Findings

| Finding                                                                                                                         | Disposition     | Fix Evidence                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current/final HEAD wording still depended on moving branch state and could make the prior fix commit look like the active head. | Accepted/fixed. | Task/work/review logs use the evidence-log successor convention: successor follows `ee611a2`; recovery verifies actual tip with `git rev-parse HEAD` and checks `main...HEAD`. |
| Durable T-0002 review evidence was missing and reviewer state was stale.                                                        | Accepted/fixed. | This review evidence log records rounds 1 and 2 with reviewer IDs, roles, findings, and dispositions; task log links it instead of `Pending`.                                  |
| Tests/config/tooling TS was not typechecked.                                                                                    | Accepted/fixed. | Added `typecheck:tooling`, `@types/node@24.13.2`, Node/Vitest/Web ambient types, and removed invalid `coverage.all` from `vitest.config.ts`.                                   |

## Verification Requested For Round 3

- `CI=true pnpm verify`
- `pnpm exec tsc --noEmit -p tsconfig.eslint.json`
- `git diff --check main...HEAD`
- `git status --short --branch`
- Search proof that reviewer state is not `Pending`.
- Search proof that this review evidence file is linked from the task log.
- Search proof that recovery wording no longer treats the prior fix commit as current/final branch head.

## Known Residual Warning

- TypeDoc still reports an invalid local `origin` remote, so source links are broken; docs generation completes with 0 errors.
