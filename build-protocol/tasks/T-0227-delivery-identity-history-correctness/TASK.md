# T-0227: Delivery, Identity, and History Correctness

Status: In progress
Start: `2026-09-10 16:26 WEST`
End: Pending
Baseline commit: `6d64848e0`
Task log path: `build-protocol/tasks/T-0227-delivery-identity-history-correctness/TASK.md`
Branch: `fix-delivery-identity-history-correctness`
Worktree: current checkout at `/Users/armiol/development/experiments/spine-ts`;
the human explicitly required no separate worktree
Authoring sub-agent: Pending existing implementer dispatch
Reviewer sub-agents: Pending
Implementation commit: Pending
Final branch HEAD: Pending

Task classification: High-risk
Classification reason: the corrections affect new-signal identity, generated
handler contracts, Aggregate persistence versions, history continuation, and
local/remote delivery idempotency.

## Objective

Match current Spine JVM behavior for framework-created Command and Event IDs,
Projection handler declarations, Aggregate versions, recent history, and
retained duplicate delivery without adding speculative recovery or validation.

## Required Inputs Read

- `AGENTS.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/PROJECT_COMPLETION_PLAN.md`
- `build-protocol/skills/EXPECTED_SKILLS.md`
- `KNOWN_ISSUES_PRIORITY.md` from the external analysis workspace
- `UUID_HISTORY_RECHECK.md` from the external analysis workspace
- Official Spine JVM `core-jvm@8b3b0498ac847dd33001b8eb94bcdd4123a2e726`
- Official Spine JVM
  `message-delivery@35b4fb5d846044cfe62e5182ec86b8da70743caf`

## Acceptance Criteria

1. Every framework-created new Command and Event receives a fresh UUID-generated
   ID.
2. Existing Command and Event envelopes retain their IDs through transport and
   storage.
3. No UUID-format validation or rejection is added.
4. Projection `@Assign` declarations fail during generation, and invalid
   generated metadata cannot register them if a runtime bypass exists.
5. Projection Event subscriptions and Aggregate/Process Manager assignments
   remain supported.
6. Aggregate version advances exactly once for each successful Command
   dispatch, including a dispatch that emits several Events.
7. A failed/rejected Aggregate dispatch does not advance committed version or
   history.
8. Recent Aggregate history extends across legitimate numeric version gaps
   while retaining defenses against wrong-entity and non-monotonic data.
9. The same signal delivered again to the same typed target during the retained
   delivery window is suppressed in local and remote configurations.
10. The same signal reaches different targets, and independently created
    signals with equal payloads both reach the same target.
11. Public `DeliveryClient.writeMessage` and best-effort remote removal remain
    supported.
12. Focused tests, affected-package checks, relevant specialist review,
    coverage, and `verify:release` pass.

## Skill Applicability

Canonical checklist:
`build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

| Source                                     | Scope Checked                                       | Evidence                          |
| ------------------------------------------ | --------------------------------------------------- | --------------------------------- |
| Session skill inventory                    | Planning, implementation, TDD, review, verification | Current Codex Desktop inventory   |
| Task-provided skill names/paths            | N/A                                                 | No skill named by the human       |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Complete manifest                                   | Read at startup                   |
| `~/.agents/skills/*/SKILL.md`              | Selected task-relevant skills                       | Read before corresponding actions |
| `~/.agents/.skill-lock.json`               | Installed manifest                                  | Read at startup                   |

Selected skills read before task actions:

| Skill                     | Source                                              | Applicability                   | Instructions Applied                                                     |
| ------------------------- | --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `planning-with-files`     | `~/.agents/skills/planning-with-files/SKILL.md`     | Persistent multi-step plan      | Plan, findings, and progress kept in the active local planning directory |
| `implement`               | `~/.agents/skills/implement/SKILL.md`               | Human authorized implementation | TDD, regular focused checks, final review, and commits                   |
| `test-driven-development` | `~/.agents/skills/test-driven-development/SKILL.md` | Every correction is a bug fix   | Observe focused RED before production changes, then minimal GREEN        |

Skills reserved for later gates:

| Skill                               | When                            |
| ----------------------------------- | ------------------------------- |
| `requesting-code-review` / `review` | After deterministic convergence |
| `verification-before-completion`    | Before any completion claim     |

Skipped relevant-looking skills:

| Skill                           | Reason                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `using-git-worktrees`           | Human explicitly required this checkout and no worktree.                                                       |
| `subagent-driven-development`   | Project uses its configured implementer and specialist roles; this task has one overlapping production writer. |
| `architecture-decision-records` | No new architecture decision is authorized; behavior follows current JVM and human decisions.                  |

## Scope

In scope:

- fresh IDs at new-signal creation seams;
- Projection assignment rejection;
- once-per-dispatch Aggregate versions;
- sparse recent-history continuation;
- retained signal-and-target deduplication in local and remote delivery;
- focused tests, narrow TSDoc, task/review evidence, versioning, and release
  verification.

Out of scope:

- changing or removing the public complete-record Delivery client operation;
- remote CAS added solely for the reviewed stale-removal scenario;
- outbox, restart recovery, arbitrary-crash protection, or exactly-once claims;
- UUID validation;
- compatibility with prior Spine TS snapshots;
- payload-based or indefinite deduplication;
- unproved provider rewrites or unrelated cleanup.

## Execution Sequence

1. Record this task and dispatch the single implementation owner.
2. Correct new-signal IDs with focused RED/GREEN tests.
3. Reject Projection `@Assign` with focused RED/GREEN tests.
4. Correct Aggregate versioning before history-cache expectations.
5. Correct sparse history continuation.
6. Reuse the existing local retained-row admission logic in the common
   local/remote delivery path.
7. Run deterministic affected-package checks.
8. Collect one complete specialist review wave and send one accepted correction
   batch to the same implementer.
9. Run final preflight, version commit, release verification, pushes, and
   evidence closure.

## Agent Routing And Acceptance Gate

- Orchestrator: `gpt-5.6-sol`, medium reasoning.
- Completed milestone planning/estimate pass: existing requirements splitter,
  explicitly dispatched as `gpt-5.6-sol`, high reasoning. Runtime
  self-introspection was not exposed; the configured role/profile is the
  available evidence.
- Implementation owner: existing implementer, explicitly
  `gpt-5.6-terra`, medium reasoning. It receives production and focused-test
  responsibility and may not spawn sub-agents.
- Mechanical verification: orchestrator function, explicitly
  `gpt-5.6-luna`, low reasoning; use medium only for classification.
- Style, TypeScript/API, and performance/reliability reviewers:
  `gpt-5.6-terra`, high reasoning.
- Documentation reviewer: immutable `gpt-5.6-luna`, medium reasoning.
- Security: N/A as a separate task review because this task adds no
  authorization, credential, dependency, or new deserialization boundary.

One writer may change overlapping production and test files. Read-only
verification and review may run concurrently only at stable boundaries.

## Human Requirements Ledger

- Current Spine JVM behavior is binding.
- Do not invent an outbox, crash-recovery scheme, validation, migration, or
  speculative protection.
- Generate IDs for new Commands and Events from fresh UUID values.
- Do not validate Command or Event ID format.
- Work in this chat, branch, and checkout; do not create a task chat or
  worktree.
- Push the feature branch to official `origin` often and after every coherent
  commit.
- Do not create or merge a pull request unless explicitly asked.
- Do not create, merge, or push `master`.

## Work Log

- `2026-09-10 16:26 WEST`: Confirmed branch
  `fix-delivery-identity-history-correctness` and baseline exactly match
  `origin/master@6d64848e0`.
- `2026-09-10 16:26 WEST`: Confirmed `origin` resolves only to
  `SpineEventEngine/spine-ts`.
- `2026-09-10 16:26 WEST`: Created task record before production changes.
- `2026-09-10 16:30 WEST`: Implementer began F10 under the explicitly dispatched
  existing implementer / `gpt-5.6-terra` / medium profile. Runtime metadata is
  not exposed; the configured role/profile is the available evidence.
- `2026-09-10 16:31 WEST`: Inspected `packages/server/src/runtime/signal-metadata.ts`
  and its focused test. Local `spine-jvm-docs/` does not contain the corresponding
  factory source, so this slice follows the task's recorded current-JVM requirement
  and limits the correction to the existing `SignalIds` UUID source.
- `2026-09-10 16:31 WEST`: F10 RED confirmed after a locked dependency install and
  generated build: `pnpm exec vitest run packages/server/test/runtime/signal-metadata.test.ts --passWithNoTests`
  failed only because `commandFromCommand()` produced `existing-command-id-1` instead
  of the injected fresh ID `new-command-from-command` (13 passing tests, 1 failing).
- `2026-09-10 16:32 WEST`: F10 GREEN passed. Each framework-created Command or Event
  now asks the existing `SignalIds` source for an ID; causal origins still retain the
  source envelope ID. No UUID-format validation was added.
- `2026-09-10 16:37 WEST`: Review correction F10-API removed caller-selected IDs and
  obsolete causal-sequence parameters from `SignalIds` and `SignalMetadata`. The
  non-empty check remains solely an invariant for values returned by the injected
  internal generator; it performs no UUID-format validation. Existing envelopes in
  tests now construct their protobuf IDs directly.
- `2026-09-10 16:37 WEST`: Correction RED confirmed by the focused runtime test:
  no-sequence event calls reached the obsolete third parameter and threw while reading
  `undefined.producerId` (10 passing, 4 failing). The revised API then passed the
  signal-metadata test (14 passing).

## Decisions

- Review finding F03 receives a documented rejected disposition and no
  production change because current JVM exposes complete-record writes and
  documents remote removal as best-effort.
- Existing retained delivered rows and storage abstractions are reused; no new
  durable subsystem is permitted.
- Aggregate version correction precedes sparse-history correction.

## Human Questions And Answers

- Blocking questions: none.
- The human confirmed JVM parity, prohibited an outbox and UUID validation, and
  removed compatibility requirements for unreleased snapshots.

## Files Changed

- `packages/server/src/runtime/signal-metadata.ts` — F10 fresh framework-created IDs.
- `packages/server/test/runtime/signal-metadata.test.ts` — F10 focused regression test.
- This task record.

## Tests Run

- `pnpm install --frozen-lockfile` — passed; restored the configured locked dependency
  installation after pnpm rejected the initial test run on an `allowBuilds` setting change.
- `pnpm typecheck:build` — passed before RED execution.
- `pnpm exec vitest run packages/server/test/runtime/signal-metadata.test.ts --passWithNoTests`
  — RED confirmed: 13 passing, 1 intended F10 failure; GREEN passed with 14 tests.
- `pnpm typecheck:build` — passed after the correction.
- `pnpm exec prettier --check packages/server/src/runtime/signal-metadata.ts packages/server/test/runtime/signal-metadata.test.ts build-protocol/tasks/T-0227-delivery-identity-history-correctness/TASK.md`
  — initially identified formatting in the runtime file and task record; both were
  normalized; final focused check passed.
- `git diff --check` — passed after the F10 correction.
- Correction checks: `pnpm typecheck:build` passed and
  `pnpm exec vitest run packages/server/test/runtime/signal-metadata.test.ts --passWithNoTests`
  passed (14 tests). The broader focused routing run reports 20 remaining assertions
  coupled to retired causal-ID strings (269 tests passed); their expectation migration
  is pending at this record boundary.
- Final F10 routing expectation maintenance replaces retired causal-ID equality with
  nonempty fresh-ID, distinct-ID, source-origin, semantic-rejection, and unordered
  version assertions. Final focused verification passed: 277 tests across the routing
  and signal-metadata suites; focused Prettier and `git diff --check` passed.
- Default-ID strengthening adds a unit assertion that two new Commands and two new
  Events have UUID-shaped, pairwise distinct IDs through the default `SignalIds`
  source. It does not add production UUID validation. The combined focused suites
  then passed 278 tests; Prettier and `git diff --check` remained clean.

## Coverage Result

- Pending.

## Documentation And Public API Impact

| Area                          | Impact                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Package README                | Update only if current public behavior claims conflict with the correction.                       |
| TypeDoc/API docs              | Correct ID-creation and supported-handler claims where affected.                                  |
| Public API additions/removals | None planned.                                                                                     |
| Framework `USER_GUIDE.md`     | Update only if it documents affected behavior.                                                    |
| Example `USER_GUIDE.md`       | N/A unless an affected example fails.                                                             |
| API examples                  | Preserve public Delivery client usage; adjust only invalid Projection assignment examples if any. |
| Compatibility                 | No compatibility layer for prior snapshot behavior.                                               |

## Security Impact

| Area                    | Impact                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Dependencies            | N/A; no dependency change planned.                                                           |
| Secrets and credentials | N/A.                                                                                         |
| IPC                     | Existing remote delivery path only; no new transport.                                        |
| Validation              | Projection declaration rejection changes configuration correctness; no signal-ID validation. |
| Tenant boundaries       | Must remain unchanged and covered by existing routing tests.                                 |
| `Any`/deserialization   | No new schema or deserialization behavior planned.                                           |
| Logging                 | No sensitive-data logging planned.                                                           |

## Verification

- Pending focused RED/GREEN evidence.
- A2 analyzer RED: `build-time-handler-analyzer.test.ts` reported a Projection
  `@Assign` as `command-assignment`; GREEN: 53 analyzer tests passed after
  `UNSUPPORTED_ASSIGN_HANDLER` was added.
- A2 runtime RED: explicit real-Projection metadata accepted `builder.assign()`;
  GREEN: analyzer, handler metadata, generated registry, and readiness suites passed
  together (101 tests). Focused Prettier and `git diff --check` passed.
- A2 generated-ingestion regression uses the existing real `ProjectionReceiver` and
  confirms centralized metadata rejection of generated `command-assignment` input.
  Final analyzer, metadata, generated-registry, and readiness verification passed
  102 tests; focused Prettier and `git diff --check` passed with no generated churn.
- Pending affected-package checks and cheap preflight.
- Pending specialist review wave.
- Pending final `verify:release`.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                               | Owner                   | Disposition                                                                   | Next Review Point       |
| -------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| Exact shared remote duplicate-admission seam | Implementer             | Resolve inside existing delivery protocol; no new subsystem                   | F02 RED test            |
| Provider continuation semantics              | Implementer             | Inspect first; change only on demonstrated violation                          | HISTORY01 focused tests |
| Public Signal ID creation signatures         | TypeScript/API reviewer | Preserve envelope transport; remove caller choice only at new-signal creation | Review wave             |

## Review Waves And Dispositions

- Pending.

## Integration Result

Pending.
