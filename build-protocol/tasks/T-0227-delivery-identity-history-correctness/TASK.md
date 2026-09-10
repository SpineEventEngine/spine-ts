# T-0227: Delivery, Identity, and History Correctness

Status: In progress
Start: `2026-09-10 16:26 WEST`
End: Pending
Baseline commit: `6d64848e0`
Task log path: `build-protocol/tasks/T-0227-delivery-identity-history-correctness/TASK.md`
Branch: `fix-delivery-identity-history-correctness`
Worktree: current checkout at `/Users/armiol/development/experiments/spine-ts`;
the human explicitly required no separate worktree
Authoring sub-agent: Existing implementer role, explicitly dispatched as
`gpt-5.6-terra`, medium reasoning; runtime metadata was not exposed
Reviewer sub-agents: Existing performance/reliability, style/maintainability,
TypeScript/API, documentation, and final security reviewer roles
Implementation commits: `094316a06`, `6a7edf4d6`, `054174f06`, `00f27b8f6`,
`e1772bacf`, and `8c0d06a01`
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
- Final security reviewer: existing configured role, explicitly
  `gpt-5.6-terra`, high reasoning. Runtime metadata was not exposed; the
  immutable configured role/profile is the available evidence.

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
- `2026-09-10 17:10 WEST`: HISTORY01-A RED confirmed after behavior tests changed
  to require one version for all produced events and the committed Aggregate state.
  The command case retained state version `2n` despite both events carrying version
  `1`; the multi-event reactor case likewise retained the prior per-event state
  advancement. GREEN changes commit each successful command or reactor transaction at
  `loaded.version + 1n`, bind all command-produced events to that dispatch version,
  and publish changed state with the same version. Rejections still return before
  persistence and therefore do not advance a version.
- `2026-09-10 17:11 WEST`: Repaired UUID and composite routing fixtures to use
  Aggregate-tagged cloned state descriptors only for command assignment. The original
  UUID and composite Projection descriptors remain Projection fixtures; composite
  Event is optionless and event/state routing uses the Projection repository. No
  option bytes were constructed manually or transferred between unrelated message
  roles.
- `2026-09-10 17:21 WEST`: F10 routing correction replaces stale child-event source-ID
  assertions for Aggregate and Process Manager domain-event handlers with UUID-shaped,
  source-distinct child IDs. Existing source-envelope IDs remain asserted in the same
  stored-event sequences. The Aggregate command binding no longer carries an unused
  sequence counter after its shared dispatch-version correction. The event-producing
  Process Manager test now waits for its already-required asynchronous error log before
  asserting it.
- `2026-09-10 17:24 WEST`: Made the three F10 child/source stored-event checks
  independent of asynchronous persistence ordering. Each requires exactly two records,
  locates one by the retained source ID and one by UUID-shaped child ID, and keeps the
  reactor origin, version, timestamp, producer, and message-context assertions on the
  identified records.
- `2026-09-10 17:27 WEST`: HISTORY01-B RED confirmed that a state-history cache
  cleared records when a valid descending continuation moved from version `4` to `2`.
  GREEN removes only the adjacent-integer condition; continuation still rejects an
  equal or newer version. In-memory and MySQL history conformance passed unchanged,
  confirming their exclusive `startingFromVersion` queries already support sparse,
  descending continuation.
- `2026-09-10 17:29 WEST`: Renamed the internal/testing cache option from
  `requireContiguousVersions` to `requireDescendingVersions` so its name matches the
  sparse-history rule. This seam is not re-exported from a package index, so no public
  compatibility layer is required.
- `2026-09-10 17:33 WEST`: Superseded F02 blocker. Binding JVM evidence establishes
  `DispatchingId` as signal ID plus typed Inbox target; `LiveDeliveryStation` suppresses
  both current-conveyor and retained `DELIVERED` duplicates. Successful normal rows
  remain `DELIVERED` through their existing `keep_until`, and cleanup removes them only
  after expiry. `TargetDelivery.deliverDirectly` bypasses this mechanism and remains
  outside F02. Distributed/shared-storage nodes use the same normal delivery pipeline.
  The existing TS delivery-server `writeOne` upsert supports the required remote
  delivered snapshot, so no new wire or storage lifecycle concept is needed.

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
- `packages/server/src/repository/repository.ts` — HISTORY01-A dispatch version binding
  and one-version Aggregate persistence for command and event-reactor paths.
- `packages/server/test/repository/repository-routing.test.ts` — domain-correct
  UUID/composite Aggregate fixtures and HISTORY01-A command/reactor regression cases.
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
- HISTORY01-A RED: the two new command/reactor version tests failed as intended. The
  command case observed committed state version `2n` where `1n` was required; the
  reactor case showed three version-`1` stored events before its assertion was
  narrowed to the two produced Aggregate events.
- HISTORY01-A GREEN: targeted UUID/composite/version routing tests passed 8 tests;
  full `repository-routing.test.ts` passed 264 tests; and
  `delivery-worker.test.ts` passed 28 tests, including its commit-fence coverage.
- A2 regression verification: `build-time-handler-analyzer`, handler metadata,
  generated handler registry, and command-registration readiness suites passed 102
  tests across 4 files. `pnpm typecheck:build` completed after generated-proto
  validation. Focused Prettier and `git diff --check` passed.
- `pnpm typecheck:build` regenerated the `generationId` in
  `packages/server-blackbox-tests/spine-proto-manifest.json`. The unrelated generated
  value was restored to the branch value with a focused patch; no manifest churn
  remains.
- F10 correction: the three focused domain-event ID cases passed (3 tests). The exact
  serialized seven-file command
  `pnpm exec vitest run packages/proto-tools/test/build-time-handler-analyzer.test.ts packages/server/test/runtime/signal-metadata.test.ts packages/server/test/handler/handler-metadata.test.ts packages/server/test/handler/generated-handler-registry.test.ts packages/server/test/handler/command-registration-readiness.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/delivery/delivery-worker.test.ts --no-file-parallelism --passWithNoTests`
  passed 409 tests across 7 files.
- Final correction checks: standalone `repository-routing.test.ts` passed 264 tests;
  focused Prettier and `git diff --check` passed.
- Ordering correction: focused child/source identity cases passed 3 tests; the same
  exact serialized seven-file command passed 409 tests across 7 files.
- HISTORY01-B: focused history-cache GREEN passed 17 tests; in-memory and MySQL
  provider history conformance passed 43 tests across 2 files. No provider source
  change was warranted.
- HISTORY01-B final regression: `repository-routing.test.ts` passed 264 tests;
  focused Prettier and `git diff --check` passed.
- HISTORY01-B naming correction: `history-cache.test.ts` passed 17 tests; focused
  Prettier and `git diff --check` passed.
- F02 RED/GREEN: the initial local production-entry test failed because normal drain
  never called retained-row admission, and the remote adapter removed its acknowledgement
  rather than retaining `DELIVERED`. GREEN adds the shared normal-drain `admit` seam:
  local `Inbox` delegates to `InboxStorage.admit`; remote scans bounded delivered pages
  for exact signal ID plus typed target and upserts a duplicate as `DELIVERED`. Remote
  acknowledgement now upserts the authoritative `DELIVERED` snapshot, while cleanup
  removes only expired exact snapshots. Focused command `pnpm exec vitest run
packages/server/test/delivery/delivery-worker.test.ts
packages/server/test/delivery/direct-inbox-records.test.ts
packages/server/test/delivery/inbox-provider-cleanup.test.ts
packages/delivery-client/test/remote-inbox-direct.test.ts
packages/delivery-client/test/in-memory-core-response-loss.test.ts
packages/delivery-server/test/core/inbox-service.test.ts --passWithNoTests` passed
  72 tests across 5 files. The remote adapter/core transport path persists, retains,
  and suppresses the duplicate through real RPC codecs. `pnpm typecheck:build` passed.
  Direct delivery bypass is not
  covered or claimed.
- F02 correction acceptance: after separating admission failures from endpoint
  reception recovery and making remote delivered-status retries idempotent, the
  focused delivery command passed 75/75 tests across 5 active files. The runtime
  companion passed 9/9 tests. Independent Luna/low verification repeated both runs;
  focused Prettier, `git diff --check`, and generated-manifest checks were clean.
- F02 pre-acceptance correction: RED showed that an admission exception entered
  reception recovery and its default acknowledgement could mark an undispatched row
  `DELIVERED`. GREEN records the failure and blocks that target without endpoint
  dispatch, acknowledgement, or monitor recovery, leaving the pending row durable.
  Remote `markDelivered` now idempotently returns an exact current `DELIVERED` snapshot
  after a committed response loss; the transport/core fixture covers that retry. Remote
  retained cleanup also requires its `EXCLUSIVE` session and matching shard before any
  remote read or removal. The focused delivery command above passed 75 tests across 5
  files; `pnpm typecheck:build`, focused Prettier, and `git diff --check` passed.
- Consolidated review dispositions: Aggregate multi-target child Events now preserve
  their fresh framework metadata ID (no target suffix); `UNSUPPORTED_ASSIGN_HANDLER`
  is exported in handler metadata; remote timestamp-only pagination rejects a full
  non-progressing cursor page while retaining its existing finite 1000-row scan bound.
  No RPC or arbitrary-depth indexed lookup is claimed. SignalIds documentation now
  states only the non-empty generated-value requirement. Remote retention, handler
  rejection, Aggregate dispatch version, and sparse history behavior are recorded in
  package references.
- Consolidated acceptance profile: existing implementer, configured `gpt-5.6-terra`
  medium (runtime metadata unavailable). Accepted: fresh Aggregate child IDs, exported
  Assign rejection code, non-progressing remote page rejection, corrected SignalIds and
  RemoteInbox TSDoc, and package references. Rejected: a retained-lookup RPC or indexed
  arbitrary-depth remote lookup; JVM remote pagination is timestamp-only and the TS
  retained scan remains finite (1000 rows). The serialized affected-suite command passed
  473 tests across 12 files.
- Final re-review corrected stale remote acknowledgement/removal wording and its
  TSDoc. Duplicate guard tests now distinguish exact retained-signal suppression from
  a new-source-ID retry without a journal marker; package references avoid placing
  handler and repository semantics under dynamic unary discovery.
- The multi-target Aggregate restart regression reads only UUID-shaped stored child
  Events, requires exactly two for one dispatch, and proves they differ from the source
  Event ID and from each other. `repository-routing.test.ts` passed 264 tests.
- Final documentation correction adds a focused Signal identity and Aggregate semantics
  heading, distinguishing fresh framework child Command/Event IDs from preserved
  existing envelope IDs through transport, storage, and envelope returns.
- Version `2.0.0-snapshot.11` uses fixed internal workspace pins at the same version;
  `workspace:*` references remain unchanged and external validation stays at
  `2.0.0-snapshot.7`. `pnpm install --lockfile-only` regenerated the lockfile.
- Independent Luna/low acceptance repeated the serialized seven-file gate with
  409/409 tests passing and the standalone repository-routing suite with 264/264
  tests passing. Focused Prettier, `git diff --check`, and the generated-manifest
  churn check were clean.

## Coverage Result

- No separate coverage-percentage profile was required for this behavior correction.
  Focused production-path regressions cover every accepted issue and preservation case;
  the release profile remains the final integration gate.

## Documentation And Public API Impact

| Area                          | Impact                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Package README                | Update only if current public behavior claims conflict with the correction.                                           |
| TypeDoc/API docs              | Correct ID-creation and supported-handler claims where affected.                                                      |
| Public API additions/removals | New-signal metadata factories no longer accept caller IDs; `DeliveryInbox` gains an optional retained-admission seam. |
| Framework `USER_GUIDE.md`     | Update only if it documents affected behavior.                                                                        |
| Example `USER_GUIDE.md`       | N/A unless an affected example fails.                                                                                 |
| API examples                  | Preserve public Delivery client usage; adjust only invalid Projection assignment examples if any.                     |
| Compatibility                 | No compatibility layer for prior snapshot behavior.                                                                   |

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
- Affected serialized verification passed 473 tests across 12 files;
  `pnpm typecheck:build`, `pnpm docs:api:check`, `pnpm docs:audience:check`, focused
  Prettier, and `git diff --check` passed with generated manifest churn removed.
- Mandatory cheap release preflight passed after formatting this record: 506/506
  focused tests across 14 files; direct affected-package TypeScript checks for
  proto-tools, server, delivery-client, and delivery-server; changed-file Prettier;
  `git diff --check`; API-documentation and audience checks; and changed-production-
  branch coverage inspection were all clean. `pnpm install --frozen-lockfile` then
  refreshed the dependency-state marker from the committed lockfile, and the pnpm-
  mediated server typecheck passed.
- Final `verify:release` remains pending.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                               | Owner                   | Disposition                                                                      | Next Review Point    |
| -------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- | -------------------- |
| Remote scan depth and timestamp continuation | Reliability reviewer    | Existing finite bound retained; non-progress fails closed; no non-JVM lookup RPC | Release verification |
| Provider continuation semantics              | Implementer             | Existing exclusive older-than queries accepted unchanged                         | Closed               |
| Public Signal ID creation signatures         | TypeScript/API reviewer | Fresh child IDs and preserved envelopes documented and reviewed clean            | Closed               |

## Review Waves And Dispositions

- Performance/reliability: clean after admission-failure isolation, idempotent remote
  acknowledgement, session checks, and the remote paging progress guard. The proposed
  indexed retained-lookup RPC was rejected because current JVM has no equivalent.
- Style/maintainability: clean after removing multi-target ID suffix plumbing, restoring
  duplicate-test intent, and correcting reference placement.
- TypeScript/API docs: clean after exporting `UNSUPPORTED_ASSIGN_HANDLER`, correcting
  SignalIds/RemoteInbox TSDoc, and adding direct multi-target UUID coverage.
- Documentation: clean after replacing stale remote-removal text and documenting handler,
  identity, Aggregate-version, and sparse-history behavior.
- Final security: clean. Atomic typed-target admission, bounded fail-closed remote
  paging, tenant/session/shard checks, generated and preserved identity paths,
  handler rejection, history continuation, wire decoding, storage keys, and logging
  were reviewed. `pnpm audit --prod --json` reported no advisories. Existing
  cleartext behavior when a loopback-default server is deliberately exposed and the
  bounded paging availability tradeoff are unchanged, documented residual constraints.

## Integration Result

Pending.
