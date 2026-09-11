# T-0227: Delivery, Identity, and History Correctness

Status: In progress — publish workflow correction
Start: `2026-09-10 16:26 WEST`
Initial closure: `2026-09-10 20:06 WEST`
Final closure: `2026-09-11 02:19 WEST`
Baseline commit: `6d64848e0`
Task log path: `build-protocol/tasks/T-0227-delivery-identity-history-correctness/TASK.md`
Branch: `fix-delivery-identity-history-correctness`
Worktree: current checkout at `/Users/armiol/development/experiments/spine-ts`;
the human explicitly required no separate worktree
Authoring sub-agent: Existing implementer role, explicitly dispatched as
`gpt-5.6-terra`, medium reasoning; runtime metadata was not exposed
Reviewer sub-agents: Existing performance/reliability, style/maintainability,
TypeScript/API, documentation, and final security reviewer roles
Implementation commits: authoritative range `31cfe4f0b..HEAD` on
`fix-delivery-identity-history-correctness`; independent-review correction
checkpoints through `8315b4e64` are pushed to `origin`.
Last release-verified implementation HEAD: `9f1bdf057`.
Last pushed behavior/documentation correction HEAD: `8315b4e64`. Later
task-record-only commits may follow without changing that implementation checkpoint.
Final verification is complete.

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
  and limits the correction to the then-existing internal UUID source. That
  temporary seam was removed by a later public-API correction; current framework
  and core creation paths generate IDs internally.
- `2026-09-10 16:31 WEST`: F10 RED confirmed after a locked dependency install and
  generated build: `pnpm exec vitest run packages/server/test/runtime/signal-metadata.test.ts --passWithNoTests`
  failed only because `commandFromCommand()` produced `existing-command-id-1` instead
  of the injected fresh ID `new-command-from-command` (13 passing tests, 1 failing).
- `2026-09-10 16:32 WEST`: F10 GREEN passed. Each framework-created Command or Event
  then asked the internal ID source for a fresh ID; causal origins retained the
  source envelope ID. No UUID-format validation was added. Later correction commits
  removed caller injection of that source and moved fresh ID creation into the
  owning signal factories.
- `2026-09-10 16:37 WEST`: Review correction F10-API removed caller-selected IDs and
  obsolete causal-sequence parameters from the then-current internal ID seam and
  `SignalMetadata`. Subsequent commits removed the injectable seam itself. Current
  creation APIs generate fresh IDs internally and perform no UUID-format validation;
  tests that need existing envelopes construct their protobuf IDs directly.
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
- `2026-09-11 00:10 WEST`: Reopened the task at the human's request for a fresh,
  memory-free independent review. The performance/reliability reviewer
  (`gpt-5.6-terra`, high) reported no finding after 450 tests. The TypeScript/API
  reviewer (`gpt-5.6-terra`, high) reported four findings: make retained-row
  admission mandatory, replace wrong-domain Protobuf test fixtures, correct stale
  signal-ID documentation, and narrow remote cleanup's atomicity claims. Both model
  and reasoning selections were explicit; the review surface exposed no additional
  runtime metadata.
- `2026-09-11 01:16 WEST`: Required `DeliveryInbox.admit`, removed its bypass,
  migrated all structural test ports, and pushed `169bfc6b2`. Replaced state,
  identifier, WKT, and Command-as-Event test payloads with domain-correct Command
  and Event fixtures across bus, service, lifecycle, metadata, broker, and repository
  suites. All fixture checkpoints through `3eb292b65` were pushed immediately.
  The final repository-routing gate passed TypeScript tooling, ESLint, Prettier,
  diff hygiene, and 265/265 tests.
- `2026-09-11 01:20 WEST`: Prepared a fresh correction review wave with no
  inherited conversation turns. Explicit assignments: existing
  performance/reliability reviewer role, `gpt-5.6-terra`, high; existing
  TypeScript/API reviewer role, `gpt-5.6-terra`, high; existing documentation
  reviewer role, `gpt-5.6-luna`, medium. Each reviewer is read-only and may not
  spawn sub-agents. Runtime self-introspection is not exposed, so the immutable
  configured role/profile is the available runtime evidence.
- `2026-09-11 01:24 WEST`: Fresh performance/reliability review passed 373
  focused tests and reported one P2: local admission dropped operation controls,
  while remote admission restarted the full timeout on every page. Fresh
  TypeScript/API review reported only one P1 release-gate issue: the corrected
  cleanup TSDoc summaries did not start with verbs accepted by the repository
  checker; its diff, API-documentation, and audience checks passed. Returned one
  accepted batch to the existing implementer role, explicitly dispatched as
  `gpt-5.6-terra`, medium, with sole ownership of the affected delivery sources
  and focused tests. The implementer may not spawn sub-agents. Runtime metadata
  beyond the immutable configured role/profile is unavailable.
- `2026-09-11 01:38 WEST`: Accepted the implementation batch after one returned
  correction: abort/expiry must reject rather than use `undefined`, because
  `undefined` means retained-duplicate suppression to the delivery loop. Local
  and remote admission now share one admission-measured budget, stop before
  further I/O, preserve an `Error` abort reason, reject invalid timeout values,
  and pass decreasing remaining time to remote reads and the delivered upsert.
  Independent acceptance passed 52/52 focused tests, TypeScript tooling, TSDoc,
  ESLint, Prettier, and diff hygiene. Documentation review corrections passed
  API-documentation and audience checks. Commits `9e83f43f0` and `9e5ed6718`
  are pushed to `origin`.
- `2026-09-11 01:40 WEST`: Prepared the post-correction review with no inherited
  turns: performance/reliability (`gpt-5.6-terra`, high), TypeScript/API
  (`gpt-5.6-terra`, high), and documentation (`gpt-5.6-luna`, medium). These
  existing read-only reviewer roles may not spawn sub-agents; immutable role
  configuration is the available runtime-profile evidence.
- `2026-09-11 01:44 WEST`: Reliability re-review found a final successful-return
  deadline gap after page scanning. The existing implementer added per-candidate
  checks and a final check before every pending-row return. Independent acceptance
  passed 54/54 focused tests and all static gates; `329446c87` is pushed. Fresh
  TypeScript/API re-review returned clean. Documentation re-review requested one
  remaining remote-cleanup qualification and this checkpoint update.
- `2026-09-11 01:47 WEST`: Qualified server cleanup documentation: direct local
  storage has provider-atomic exact removal, while remote cleanup reads and
  compares before a separate best-effort removal request. API-documentation and
  audience checks passed; `2617fdeb5` is pushed. A final fresh reliability review
  is clean after withdrawing an incorrect response-loss concern: committed remote
  admission suppresses only an already-proven retained duplicate, while an
  uncommitted write leaves the row pending.
- `2026-09-11 01:51 WEST`: A new documentation-reviewer invocation with no
  inherited conversation turns returned clean. It independently confirmed the
  signal-ID generation and preservation wording, typed-target retained
  deduplication, Aggregate history behavior, Projection handler rejection,
  local-versus-remote cleanup guarantees, compatibility statement, and checkpoint
  convention. Tooling typecheck, TSDoc, API-documentation, audience, and diff
  checks also passed. Prepared the final security review with no inherited turns,
  explicitly dispatching the existing security reviewer role as
  `gpt-5.6-terra` / high. The reviewer is read-only and may not spawn sub-agents;
  immutable role configuration is the available runtime-profile evidence.
- `2026-09-11 02:05 WEST`: The zero-memory final security review returned clean
  after 209 focused tests and zero dependency advisories. It confirmed secure
  fresh IDs, preserved existing envelope IDs without validation, Projection
  `@Assign` rejection, typed-target duplicate admission, tenant/session/shard
  fencing, bounded cancellation/deadline behavior, and the absence of an outbox
  or recovery invention. The bounded preflight then exposed and corrected one
  stale test import, one long test title, the missing necessity record for the
  shared secure-ID helper, one previously unformatted test file, and two uses of
  internal wording in reader documentation. Those deterministic changes did not
  alter the reviewed runtime contracts. The complete restarted preflight passed
  all shared gates and 105/105 focused tests across six delivery suites.
- `2026-09-11 02:19 WEST`: Final `pnpm verify:release` passed at `9f1bdf057`:
  every release gate, 290/290 test files, 4,676/4,676 tests, and all global
  coverage thresholds. The independent correction review is complete with no
  open finding.
- `2026-09-11 10:12 WEST`: Reopened after the human reported failed publish job
  `102874382039` for merged `2.0.0-snapshot.10`. Public job metadata proves the
  isolated Lerna publication step failed after preparation succeeded. Public npm
  metadata proves a partial release: 13 packages reached `snapshot.10`, while
  `client-node`, `deployment-gce`, `deployment-gke`, `server`, and `testing`
  remained at `snapshot.8`; those five had previously published through the same
  trusted workflow and repository. The current workflow can select missing
  packages on a later run but makes no bounded retry in the merge-triggered run.
  Prepared an architecture check using the existing requirements-splitter role,
  explicitly dispatched as `gpt-5.6-sol` / high with no inherited conversation
  turns, followed by the existing implementer role as `gpt-5.6-terra` / medium.
  Neither role may spawn sub-agents; immutable role configuration is the available
  runtime-profile evidence.
- `2026-09-11 10:22 WEST`: The architecture check confirmed a bounded same-job
  recovery is sufficient. After a nonzero Lerna result, the job must allow npm
  registry convergence, strictly distinguish complete, partial, and ambiguous
  states, accept nonzero only when all 18 exact versions and selected tags are
  present, and otherwise retry only the exact missing package set in a fresh
  disposable workspace. Preparation and downloaded artifacts remain unchanged.
  Three publication attempts use fixed waits of 90, 180, and a final 360 seconds;
  the last wait can recognize completion but cannot authorize a fourth attempt.
  Timeouts, server errors, malformed records, and wrong tags fail closed. The
  existing implementer role is now explicitly dispatched as `gpt-5.6-terra` /
  medium for the registry seam, bounded controller, workflow wiring, tests, and
  narrow release documentation. The implementer may not spawn sub-agents.
- `2026-09-11 10:27 WEST`: Implemented the bounded same-job publication
  recovery. The controller creates a fresh disposable workspace for each of at
  most three Lerna calls, waits 90, 180, and 360 seconds after nonzero results,
  and performs a strict complete/partial registry inspection after each wait.
  It accepts a delayed complete state, retries only exact missing package names,
  and reports missing names with the final process status and signal on
  exhaustion. Preparation and downloaded release artifacts remain outside this
  controller and occur once. Focused release controller, registry, workflow,
  and local Lerna registry tests passed (34 tests). Static checks remain next;
  `verify:release` was not run.
- `2026-09-11 10:34 WEST`: Independent acceptance found and returned one
  correction batch: signal-triggered parent cleanup, strict validation of every
  retry selection, and complete required GitHub flag pairs. The existing
  implementer corrected all three test-first. Independent acceptance then passed
  37/37 focused release tests, tooling typecheck, TSDoc, formatting, and diff
  hygiene. Implementation commit `4e44f4d6d` is pushed to `origin`. Prepared one
  review wave using existing roles with explicit profiles: performance/reliability
  `gpt-5.6-terra` / high, style/maintainability `gpt-5.6-terra` / high, and
  documentation `gpt-5.6-luna` / medium. Each reviewer is read-only and may not
  spawn sub-agents. TypeScript/API review is N/A because the correction changes no
  published TypeScript declaration or runtime package API. Final security review
  follows after this wave converges.
- `2026-09-11 10:32 WEST`: Accepted the publication-recovery correction batch.
  The controller now uses the existing SIGINT/SIGTERM cleanup pattern for its
  temporary parent, preserves exit codes 130 and 143, validates initial and
  delayed partial selections before mutation, and rejects missing GitHub SHA or
  step-summary inputs before the first Lerna call. Focused tests cover signal
  cleanup, invalid selections, and absent inputs. The existing local Lerna
  registry test already proves that a partial publication retries only the
  missing package and that a stored complete selection performs no PUT; the
  controller tests add the distinct nonzero-process and delayed-registry cases,
  so no duplicate local-registry expansion is needed. Focused release checks
  passed 37/37, plus tooling typecheck, TSDoc, formatting, and diff checks.
- `2026-09-11 10:37 WEST`: The complete review wave found that status zero had
  returned before a strict registry inspection. The controller now waits and
  inspects after every Lerna result, including zero. Only exact complete state
  succeeds; a partial zero result follows the same fresh-workspace,
  missing-only retry path, and wrong tags or other ambiguous states fail closed.
  D-0117 and the release runbook now state the same rule. Controller regressions
  cover zero-plus-partial, zero-plus-wrong-tag, and zero-plus-complete.

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

The authoritative inventory is `git diff --name-only 6d64848e0..HEAD`. Its
behavioral groups are:

- core/server signal factories, metadata, routing, repository version/history,
  handler-analysis, delivery admission, and their focused tests;
- delivery-client and delivery-server adapters, integration tests, and retained
  row behavior;
- client, server, and example callers migrated away from caller-selected new
  signal IDs;
- domain-correct Protobuf fixtures across bus, context, service, lifecycle,
  metadata, broker, and repository tests;
- API, architecture, user, package-reference, and To-Do example documentation;
- workspace version manifests, lockfile/generated version alignment, and this
  task record.

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
  Events have UUID-shaped, pairwise distinct IDs through the then-current default ID
  source. The later API correction removed that injectable seam without changing the
  behavior. It does not add production UUID validation. The combined focused suites
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
  No RPC or arbitrary-depth indexed lookup is claimed. Signal identity documentation
  records internally generated IDs without adding validation of existing envelopes.
  Remote retention, handler
  rejection, Aggregate dispatch version, and sparse history behavior are recorded in
  package references.
- Consolidated acceptance profile: existing implementer, configured `gpt-5.6-terra`
  medium (runtime metadata unavailable). Accepted: fresh Aggregate child IDs, exported
  Assign rejection code, non-progressing remote page rejection, corrected signal-ID and
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

| Area                          | Impact                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package README                | Update only if current public behavior claims conflict with the correction.                                                                      |
| TypeDoc/API docs              | Correct ID-creation and supported-handler claims where affected.                                                                                 |
| Public API additions/removals | New-signal factories no longer accept caller IDs; `DeliveryInbox.admit` is required so normal delivery cannot bypass retained-row deduplication. |
| Framework `USER_GUIDE.md`     | Update only if it documents affected behavior.                                                                                                   |
| Example `USER_GUIDE.md`       | N/A unless an affected example fails.                                                                                                            |
| API examples                  | Preserve public Delivery client usage; adjust only invalid Projection assignment examples if any.                                                |
| Compatibility                 | No compatibility layer for prior snapshot behavior.                                                                                              |

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
- Release triage corrected stale version expectations, remaining new-signal factory
  callers, tooling-only test types, dead Command sequence counters, and TSDoc policy
  coverage. Delivery integration triage then corrected suppressed-row acknowledgement
  and Admin pending-work accounting, including last-write-wins batch coalescing.
- Final strengthened preflight passed 660/660 focused tests across 25 files, all four
  affected-package typechecks, generated-build and tooling typechecks, ESLint across
  36 changed TypeScript/MJS files, Proto source/current-output checks, TSDoc/API/audience
  and release-readiness checks, formatting, diff hygiene, and changed-path coverage
  inspection.
- Final `pnpm verify:release` passed at `47c77cde6`: 290 files and 4,657/4,657 tests;
  93.21% statements, 90.05% branches, 92.77% functions, and 94.37% lines. Proto,
  generated build/tooling, lint, TSDoc, copyright, formatting, documentation, generated
  cleanliness, logging containment, production dependencies, and release readiness all
  passed. Expected volatile stand-registry warnings and two deprecated transitive
  dependencies were non-failing.
- Post-review bounded preflight passed at `8315b4e64`: Proto integrity and
  generation, full build and tooling typechecks, cleanup rules, TSDoc, copyright,
  log containment, repository formatting, documentation audience/API checks,
  Buf lint, generated cleanliness, release readiness, and 105/105 focused tests
  across six local/remote delivery suites. The profile intentionally used
  `--no-coverage`; the required release profile provides repository-wide coverage.
- Final `pnpm verify:release` passed at `9f1bdf057`: 290 files and 4,676/4,676
  tests; 93.22% statements, 90.06% branches, 92.77% functions, and 94.38% lines.
  All Proto, generated build/tooling, lint, cleanup, TSDoc, copyright, formatting,
  documentation, generated-cleanliness, logging-containment, production-dependency,
  release-readiness, packaging, and consumer-install checks passed. Expected
  volatile Stand registry warnings and two deprecated transitive dependencies
  remained non-failing.

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
  the then-current ID-source and `RemoteInbox` TSDoc, and adding direct multi-target
  UUID coverage. This disposition predates the current no-memory review.
- Documentation: clean after replacing stale remote-removal text and documenting handler,
  identity, Aggregate-version, and sparse-history behavior.
- Final security: clean. Atomic typed-target admission, bounded fail-closed remote
  paging, tenant/session/shard checks, generated and preserved identity paths,
  handler rejection, history continuation, wire decoding, storage keys, and logging
  were reviewed. `pnpm audit --prod --json` reported no advisories. Existing
  cleartext behavior when a loopback-default server is deliberately exposed and the
  bounded paging availability tradeoff are unchanged, documented residual constraints.
- Post-release-failure reliability re-review: clean after retained suppression reports a
  durable acknowledgement without endpoint dispatch and Admin counts only pending
  `TO_DELIVER` transitions. Rebuilt managed readiness passed, including RED-28; assembly
  regressions cover retained delivered upserts and repeated-identity batch coalescing.
- Post-correction style/maintainability and documentation re-reviews: clean after exact
  durable acknowledgement-ID assertions and pending-work TSDoc. A proposed edit to the
  frozen upstream Admin Proto comments was rejected; the source was restored and all 50
  pinned checksums passed.
- Repeat final security review at release-verified `47c77cde6`: clean. The reviewer
  reconfirmed durable-before-acknowledgement behavior, no endpoint dispatch for suppressed
  duplicates, bounded local/remote admission, coalesced Admin transitions, and unchanged
  tenant/session/shard boundaries.
- Fresh post-correction documentation review: clean. The reviewer used no inherited
  conversation turns and confirmed all changed behavior claims and task evidence.
- Fresh post-correction final security review: clean. The reviewer used no inherited
  conversation turns and confirmed identity generation/preservation, handler
  rejection, typed-target admission, boundary fencing, bounded resource behavior,
  dependency safety, and prohibited-scope compliance.

## Integration Result

The implementation and independent-review corrections were completed in the
human-selected current checkout without a separate worktree. The corrected tree
was release-verified at `9f1bdf057`. Version `2.0.0-snapshot.11` and all workspace
manifests remain aligned. Fresh zero-memory documentation and final security
reviews are clean, all accepted findings are fixed, and the branch is ready for
human review. No pull request or merge was created.
