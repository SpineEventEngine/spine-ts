# T-0218: Wave 14 Review Remediation

Status: In progress
Start: `2026-08-22 Europe/Lisbon`
Baseline commit: `da40d2cafc39c3aa8c631363308502f1496f7ba9`
Branch: `codex/T-0218-wave14-review-remediation`
Worktree: `.worktrees/T-0218-wave14-review-remediation`
Authoring agent/function: existing `implementer` role
Configured dispatch: `gpt-5.6-terra` / `medium` (explicit)

Task classification: High-risk

The task changes shared child-process lifecycle behavior and narrows a public
TypeScript testing surface. It therefore requires behavior-first regression
tests, reliability and TypeScript/API review, and `verify:release` after review
convergence.

## Objective

Resolve the repository findings from the fresh Wave 14 review, except findings
that concern the disposable external publisher wrapper, which the human
explicitly excluded.

## Scope And Acceptance Criteria

1. Tarball-consumer test timeouts terminate and reap the complete child process
   tree; a regression test proves no descendant survives.
2. The public `@spine-event-engine/server/testing` entrypoint does not expose
   helpers documented as package-only or `@internal`, while retained public test
   helpers remain usable by their real consumers.
3. `BrowserClientOptions.baseUrls` requires at least one URL at compile time and
   retains its runtime validation.
4. T-0217 records and the project completion plan agree with the integrated,
   published Wave 14 state.
5. Remote-branch closure claims are reconciled with the actual protocol without
   deleting or rewriting unrelated, unmerged remote work.
6. Focused tests follow RED/GREEN, the complete relevant review wave converges,
   the mandatory cheap preflight passes, and one final `verify:release` passes.

## Human-Imposed Requirements Ledger

- Fix every fresh Wave 14 review finding except the disposable publisher
  wrapper findings.
- Do not modify, publish, authenticate, or otherwise rely on the disposable
  external publication wrapper.
- Work autonomously under `AGENTS.md` and `BUILD_PROTOCOL.md`.
- Use Standard speed and explicit project model routing; do not use Max or
  Ultra.
- Preserve unrelated user changes in the primary checkout.
- Push every feature-branch commit to configured `origin` immediately.
- Do not delete unmerged remote work solely to satisfy a cleanup claim.

## Finding Dispositions Before Implementation

- Accepted: timed-out external-consumer checks can leave descendant processes.
- Accepted pending usage audit: the server testing entrypoint exports helpers
  whose source documentation says package-only or `@internal`.
- Accepted: the `baseUrls` type permits an empty array despite its documented
  and runtime-enforced non-empty contract.
- Accepted: T-0217 status, end state, and integration result are stale.
- Accepted: the completion plan contains a pre-publication prohibition that is
  now contradicted by the recorded manual snapshot publication.
- The remaining `origin/codex/t0213-release-closure` is unmerged, unrelated
  work. Repository safety preserves it rather than deleting unrelated unmerged
  history, so this remediation does not claim complete remote-branch cleanup.
- Excluded by the human: disposable wrapper trust, checkout cleanliness, and
  signal-cleanup findings.

## Assignment Gate

| Existing role/function | Bounded ownership                                                                           | Explicit model  | Explicit reasoning | Child spawning | Runtime metadata                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | ------------------------------------------------------------------------ |
| `implementer`          | All tests, runtime/API changes, documentation, and task records for this remediation branch | `gpt-5.6-terra` | medium             | Prohibited     | Desktop dispatch fields are explicit; self-telemetry may be unavailable. |

## Verification Plan

- RED/GREEN focused tests for process-tree cleanup, exports, and non-empty URL
  typing.
- Deterministic documentation/status checks and affected TypeScript checks.
- Relevant style/maintainability, TypeScript/API, documentation, and
  performance/reliability review; security is N/A because the publisher is
  excluded and no authentication boundary changes.
- Mandatory cheap preflight, then one converged `pnpm verify:release`.

## Work Log

- `2026-08-22`: The orchestrator verified the review against `origin/main`,
  preserved the dirty primary checkout, created this isolated worktree, and
  recorded the implementation assignment before authoring changes.
- `2026-08-22`: RED: after the frozen install, `pnpm --config.verify-deps-before-run=false exec vitest run scripts/snapshot-artifacts.test.mjs --passWithNoTests` failed because the new `snapshot-test-command-runner.mjs` module was absent. A strengthened RED then used a descendant that installs a `SIGTERM` handler and failed because it survived the timeout. GREEN: the focused `-t "terminates a timed-out command"` test passed 1/1 after adding a detached process-group runner that sends `SIGTERM`, polls, escalates to `SIGKILL`, and fails if the group remains. The regression starts a Node parent that forks a never-ending Node child, forces a 500 ms timeout, and proves the recorded child PID no longer exists. Full tarball-consumer commands now have a realistic 60-second per-command bound and a separate 180-second Vitest aggregate bound. The full artifact-consumer tests remain deferred until their normal generated build prerequisites exist in this fresh worktree; their current failure is missing `@spine-event-engine/auth` packed `dist` targets, not timeout behavior.
- `2026-08-22`: Export-boundary RED: the built package-export test found direct `commitFenced`, `managedServerApplicationAccess`, `serverEnvironmentAccess`, and `toExternalEvent` exports from `@spine-event-engine/server/testing`. Type RED: `pnpm typecheck:tooling` reported an unused `@ts-expect-error`, proving `BrowserBackend` accepted `{ baseUrls: [] }`. GREEN: the public testing entrypoint now retains only reset and documented integration-frame helpers; the one repository-only remote delivery fixture reads its managed-host helpers through non-published `packages/server/test-fixtures/internal.mjs`; the unrelated Proto contract no longer reaches the internal conversion helper. `BrowserBackend.baseUrls` is a non-empty tuple, and Message Board deployment configuration carries that invariant. Focused package export, Proto contract, remote Delivery fixture, and Message Board configuration tests passed 50/50; `pnpm typecheck:tooling` passed.
- `2026-08-22`: Record correction: T-0217 now records its actual integration closure at `da40d2caf` and completed worktree cleanup. The completion plan now distinguishes the human-approved experimental Wave 14 `snapshot` publication from any future automated or `latest` release policy. `git branch -r --no-merged origin/main` identified the unrelated `origin/codex/t0213-release-closure` branch; repository safety preserves unrelated unmerged history, and this task makes no false remote-cleanup claim.

## Pre-Review Assignments

| Concern                    | Existing role                      | Explicit model  | Explicit reasoning | Bounded scope                                                                                         | Child spawning | Runtime telemetry                                                        |
| -------------------------- | ---------------------------------- | --------------- | ------------------ | ----------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| Style/maintainability      | `style_maintainability_reviewer`   | `gpt-5.6-terra` | high               | Process runner/helper structure, server testing boundary, and non-empty tuple implementation          | Prohibited     | Desktop dispatch fields are explicit; self-telemetry may be unavailable. |
| Documentation completeness | `documentation_reviewer`           | `gpt-5.6-luna`  | medium             | Completion plan, T-0217/T-0218 records, and server testing reference                                  | Prohibited     | Desktop dispatch fields are explicit; self-telemetry may be unavailable. |
| TypeScript/API docs        | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` | high               | Testing export narrowing, non-empty backend URL tuple, and repository-only fixture compatibility      | Prohibited     | Desktop dispatch fields are explicit; self-telemetry may be unavailable. |
| Performance/reliability    | `performance_reliability_reviewer` | `gpt-5.6-terra` | high               | Process-group timeout cleanup, escalation/reaping, and external-consumer command/suite timeout bounds | Prohibited     | Desktop dispatch fields are explicit; self-telemetry may be unavailable. |

- Orchestrator pre-review lint: `git diff --check` and `git status --short`
  are clean. The public testing entrypoint contains no direct forbidden
  internal names; repository-wide matches are the non-published fixture,
  negative export test, and historical task evidence. T-0217 `ready` and
  `pending` phrases are chronological evidence superseded by its completed
  header and integration result; they are not active task status and are
  intentionally preserved.

## Review Dispositions

- Code style/maintainability: pending.
- Documentation completeness: pending.
- TypeScript/API docs: pending.
- Performance/reliability: pending.
- Security: N/A; the human excluded the publisher and this task changes no
  credential, authentication, deserialization, dependency, or tenant boundary.

## Integration Result

Pending.
