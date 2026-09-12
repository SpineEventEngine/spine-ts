# T-0227: Delivery, Identity, and History Correctness

Status: Reopened for declared rejection subscription support
Start: `2026-09-10 16:26 WEST`
Initial closure: `2026-09-10 20:06 WEST`
Final closure: `2026-09-11 02:19 WEST`
Provenance correction closure: `2026-09-11 12:11 WEST`
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
`fix-delivery-identity-history-correctness`.
Last release-verified implementation HEAD: `9f1bdf057`.
Final release-verified provenance implementation HEAD: `2240709c8`.
Verified implementation HEAD: `caa3a2ae170b68184000287b66d694cd36a8623c`.
Verified completion-record predecessor:
`db82f6d8c3fdb147a605500cff6e5fa892b9c5f9`. Required CI passed for both
commits. The earlier verified checkpoints above are historical only.

## Delivery Admission And Test-Fixture Correction Framing

- `2026-09-11 14:10 WEST`: Reopened this high-risk task after the human rejected
  the remote client-side scan and the opaque fixture representation. Current
  JVM behavior remains binding. A valid pending message must never fail merely
  because 1,000 unrelated inbox rows exist; the literal `1_000` in the JVM is
  the capacity of a recent-delivery cache, not a scan-failure threshold.
- The correction must remove remote admission pagination from
  `RemoteInbox.admit()`, keep exact identity based on signal ID and typed target,
  and preserve valid delivery without an invented outbox, crash-recovery
  mechanism, UUID validation, arbitrary row cap, or retry controller.
- Test fixtures must use readable, role-correct Proto sources and their normal
  generated schemas. The custom module that stores descriptor sets as Base64
  source is prohibited. Commands, Events, Entity states, identifiers, and
  scalar wrappers may not stand in for one another merely because their fields
  fit. Legitimate Base64 encoding required by authentication, wire formats, or
  storage keys is not fixture source and remains in scope only if separately
  incorrect.
- Design pass 1: existing requirements splitter role, explicitly
  `gpt-5.6-sol` / `high`, canonical agent ID
  `/root/admit_design_minimal`.
- Design pass 2: existing performance/reliability reviewer role, explicitly
  `gpt-5.6-terra` / `high`, canonical agent ID
  `/root/admit_design_jvm_cache`.
- Design pass 3: existing TypeScript/API documentation reviewer role,
  explicitly `gpt-5.6-terra` / `high`, canonical agent ID
  `/root/admit_design_server_atomic`.
- Each design pass received no inherited conversation turns and may not spawn
  sub-agents. The dispatch surface fixes the stated role/model/reasoning
  profiles; separate runtime self-introspection is unavailable.
- A previous fresh independent TypeScript/API review, canonical agent ID
  `/root/fresh_independent_api_review`, identified remaining wrong-domain
  signal fixtures across bus, bounded-context, subscription, service,
  repository, integration-broker, lifecycle, runtime metadata, and core tests.
  Those findings are inputs to this correction, not accepted blindly; each
  replacement must be checked against what the test is meant to prove.
- Design disposition: reject the additive `AdmitOne` RPC because it creates a
  stronger server-authoritative protocol than current Spine JVM and changes the
  frozen wire contract. Replace per-message admission scans with one shared
  page-level delivery policy: read each shard page without status filtering,
  deduplicate pending rows against delivered rows in that page and a
  JVM-equivalent 1,000-identity recent-delivery cache, dispatch survivors, then
  persist and clean up through the existing adapters. A private cache registry
  keyed by the long-lived inbox adapter preserves the cache across the
  short-lived `Delivery` wrappers used by remote context handoff without adding
  a public cache API.
- Delivery redesign implementation assignment: existing implementer role,
  explicitly `gpt-5.6-terra` / `medium`, canonical agent ID to be recorded at
  dispatch. It receives the shared delivery policy, direct and remote adapter
  changes, focused tests, and narrow documentation. It may not change fixture
  generation or unrelated test payloads, and may not spawn sub-agents.

## Sigstore Provenance Correction Framing

- `2026-09-11 11:45 WEST`: Classified the provenance correction as **standard**:
  it changes the transitive Sigstore runtime configuration that Lerna uses for
  trusted publication, plus its locked dependency metadata, deterministic
  release check, and runbook. It does not change a public or serialized
  framework contract, persistence, authentication, or the publication workflow
  control flow. The bounded acceptance criteria are: pnpm declares and locks a
  `sigstore@4.1.1` patch; Lerna/libnpmpublish resolves that patched runtime; and
  its effective Rekor witness enables existing-entry fetch on equivalent-entry
  conflict. No publication retry, recovery controller, subprocess supervision,
  timeout, package orchestration, or provenance disablement is allowed.
- Assignment: existing implementer role, explicitly `gpt-5.6-terra` / `medium`;
  canonical agent ID `/root/fix_sigstore_provenance_conflict`. Runtime profile
  is configured by the dispatch surface and cannot be independently
  introspected here.
- Review dispatch at implementation commit `154f3497a`: existing
  performance/reliability reviewer role, explicitly `gpt-5.6-terra` / `high`;
  canonical agent ID `/root/provenance_reliability_review`;
  existing style/maintainability reviewer role, explicitly `gpt-5.6-terra` /
  `high`; canonical agent ID `/root/provenance_style_review`; and existing
  documentation reviewer role, explicitly `gpt-5.6-luna` / `medium`; canonical
  agent ID `/root/provenance_docs_review`. Each review receives no inherited
  conversation turns and may not spawn sub-agents. TypeScript/API review is N/A
  because the correction changes no TypeScript declaration, public API, wire
  contract, or serialized data. Final security review follows correction
  convergence.

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

- `2026-09-11 12:35 WEST`: RED/GREEN implementation evidence for the Sigstore
  provenance correction: the new focused test first failed because neither a
  pnpm patch declaration nor lock entry existed and the actual
  Lerna/libnpmpublish-resolved `sigstore@4.1.1` Rekor witness exposed
  `fetchOnConflict: false`. pnpm's supported `patch` / `patch-commit` workflow
  generated `patches/sigstore@4.1.1.patch`, which changes only the existing
  witness option to `true`; `pnpm install` applied it. The GREEN test constructs
  the effective DSSE bundle builder from the dependency resolution used by
  Lerna/libnpmpublish. A local mock Rekor endpoint returns HTTP 409 with the
  existing entry location, then returns that entry to the follow-up GET. The
  test verifies both requests and the recovered transparency-log material. It
  also checks the declared patch path, patch SHA-256 lock entry, and patched
  snapshot.
- Added narrow release-runbook context for upstream [sigstore-js issue
  #1708](https://github.com/sigstore/sigstore-js/issues/1708) and [PR
  #1709](https://github.com/sigstore/sigstore-js/pull/1709), including the
  removal condition: Lerna/libnpmpublish must resolve an upstream released
  Sigstore version with equivalent-entry recovery before removing this patch.
- Focused validation is green: `pnpm install --frozen-lockfile`; 28 tests over
  `sigstore-provenance-patch`, release readiness, and Lerna workspace behavior;
  targeted ESLint; `pnpm typecheck:tooling`; repository format check; diff
  hygiene; documentation audience; and release-readiness checks. Remaining work
  is the applicable review wave and one converged dependency/release
  verification profile, not further implementation in this bounded context.
- Independent review at `f061cceda` returned one correction batch. All three
  reviewers found that the patch-removal instruction conflicted with the
  patch-specific test. Style/maintainability also found private pnpm path,
  constructor-name, and Sigstore-field assertions and missing canonical agent
  IDs. The correction keeps patch integrity checks while replacing the private
  runtime assertions with a simulated Rekor 409/GET behavior test, makes the
  retirement steps consistent, and records all dispatched agent IDs.
- Fresh correction re-review dispatch at `ffd50900d`: existing
  performance/reliability reviewer role, explicitly `gpt-5.6-terra` / `high`,
  canonical agent ID `/root/provenance_reliability_rereview`; existing
  style/maintainability reviewer role, explicitly `gpt-5.6-terra` / `high`,
  canonical agent ID `/root/provenance_style_rereview`; and existing
  documentation reviewer role, explicitly `gpt-5.6-luna` / `medium`, canonical
  agent ID `/root/provenance_docs_rereview`. Each receives no inherited
  conversation turns and may not spawn sub-agents.
- Correction re-review found that the first HTTP simulation could accept an
  unrelated DSSE entry and could leak its local server if setup failed.
  Documentation re-review was clean. The test now returns the exact posted
  Rekor record, asserts that exact canonical body is recovered, and closes the
  server from a setup-enclosing `finally` block.
- Final affected-lane re-review dispatch at `2240709c8`: existing
  performance/reliability reviewer role, explicitly `gpt-5.6-terra` / `high`,
  canonical agent ID `/root/provenance_reliability_final`; and existing
  style/maintainability reviewer role, explicitly `gpt-5.6-terra` / `high`,
  canonical agent ID `/root/provenance_style_final`. Both receive no inherited
  conversation turns and may not spawn sub-agents. Documentation is unchanged
  from its clean re-review.
- Final affected-lane re-reviews are clean. The documentation re-review was
  already clean; performance/reliability and style/maintainability independently
  confirmed that the exact-entry assertion and server cleanup resolve their
  findings without adding new ones.
- Final security-review dispatch at `2240709c8`: existing final security
  reviewer role, explicitly `gpt-5.6-terra` / `high`, canonical agent ID
  `/root/provenance_security_final`. It receives no inherited conversation turns
  and may not spawn sub-agents.
- Final security review is clean. It confirmed the patch keeps provenance
  enabled, uses Sigstore's existing equivalent-entry lookup, and introduces no
  publication retry, timeout, orchestration, or trusted-publishing bypass.
- Bounded preflight passed with
  `pnpm verify:task --no-coverage scripts/sigstore-provenance-patch.test.mjs`.
  It ran generation, build/type, lint/policy, formatting, documentation/API,
  release-readiness, and focused tests. Coverage is N/A because the changed
  executable file is a pnpm patch to third-party JavaScript rather than an
  instrumentable repository TypeScript source file.
- GitHub Actions run
  [`34591190167`](https://github.com/SpineEventEngine/spine-ts/actions/runs/34591190167)
  passed for implementation commit `2240709c8` in 20m5s. It completed the
  frozen install, `pnpm verify:release`, and
  `node scripts/release-cli.mjs prepare --check`.

- `2026-09-11 11:31 WEST`: Restarted the publication investigation after
  reverting the incorrect retry and process-supervision design in `eb4c60ae9`.
  The resulting tree exactly matched pre-investigation commit `7d95953ff`.
  The complete GitHub job log identifies `@spine-event-engine/server` as the
  first failure: `TLOG_CREATE_ENTRY_ERROR` reported an equivalent Rekor entry.
  Rekor confirms that entry was integrated at `12:43:50Z`, about eight seconds
  before npm reported the conflict. This is the documented retry-after-success
  defect in Sigstore: the first create succeeds, a retry receives 409, and
  Sigstore 4.1.1 treats the equivalent existing entry as fatal because
  `fetchOnConflict` is explicitly false. Lerna finished packages already queued
  in the dependency cycle, then withheld `client-node`, `deployment-gce`,
  `deployment-gke`, and `testing` because each depends on the failed `server`
  package. Prepared a fresh implementation assignment using the existing
  implementer role, explicitly `gpt-5.6-terra` / medium with no inherited
  conversation turns. The correction is limited to enabling Sigstore's existing
  equivalent-entry recovery through pnpm's dependency patch mechanism, focused
  installation/release checks, and narrow release documentation. No publication
  retry, recovery controller, process supervisor, or timeout is permitted. The
  implementer may not spawn sub-agents.

The original delivery, identity, and history corrections were release-verified
at `9f1bdf057`; the npm provenance correction was release-verified at
`2240709c8`. The work was completed in the human-selected current checkout
without a separate worktree. No pull request or merge was created.

## Superseding Delivery And Fixture Correction — 2026-09-11

The earlier retained-delivery admission design and its verification claims are
superseded. A comparison with current Spine JVM showed that `1_000` is the
capacity of an in-process recent-delivery cache, not a row-scan limit. The JVM
identity is the signal ID plus the complete typed Inbox target. A raw page uses
both delivered rows in that page and the recent cache as duplicate evidence;
duplicate pending rows are removed instead of being counted as delivered.

- Implementation checkpoint `d3064916f` replaced the admission scan with the
  JVM page/cache model and was pushed to `origin`.
- Focused delivery evidence at that checkpoint: 9 files and 160 tests passed;
  targeted ESLint and the delivery TypeScript error scan were clean.
- Repository-routing then exposed a local-handoff integration defect: a row
  removed as a duplicate was successful delivery work, but the handoff only
  recognized a delivered transition. The correction reports exact duplicate
  removal separately and lets the handoff resolve that exact in-flight row.
  Four focused files and 351 tests pass with this correction.
- The prior test-only Base64 descriptor bundle was rejected. Test messages are
  moving to ordinary readable `.proto` sources in normal private model
  packages. Generated output may contain protoc-generated encoding; handwritten
  fixtures may not replace readable source declarations with encoded
  descriptors.

Implementation assignments use the existing implementer role and explicitly
configured `gpt-5.6-terra` / `medium`, with no inherited conversation turns and
no child-agent dispatch:

- `/root/finish_server_genfile_consumers`: direct generated-file migration for
  bounded server consumers; completed with 19 files and 544 focused tests.
- `/root/finish_repository_routing_fixtures`: readable repository-routing model
  migration; completed mechanically, then returned seven handoff failures that
  the current implementation context reduced to the resolved handoff defect and
  two stale storage expectations.
- `/root/fix_integration_core_testing_fixtures`: integration, core, and testing
  model packages plus focused generation routing; superseded after repeated
  partial returns.
- `/root/finish_core_testing_fixture_roles`: completed the same bounded core
  and testing migration. Core passed 89 focused tests, the Node BlackBox
  contract passed 16, and generated-source policy passed 9. Long build and
  Proto-workflow summaries were not captured and are not accepted as passing;
  the orchestrator reruns those gates.
- `/root/correct_signal_fixture_roles`: role-correct Command/Event messages for
  bus, context, services, runtime, and lifecycle tests; completed.
- `/root/correct_repository_fixture_roles`: role-correct Command/Event messages
  for repository-routing tests; completed. Proto generation and generated-code
  typechecking passed, the focused file passed 265/265 tests, and its role scan
  found no remaining Command/Event/state substitutions.

The bus, context, services, runtime, and lifecycle role correction also passed
328 focused typechecked tests and 51 lifecycle integration tests. It replaced a
remaining generic string wrapper in a rejection fixture with the actual command
payload. A fresh integrated scan remains required because this bounded pass did
not add new schemas.

The first replacement fixture assignment omitted explicit dispatch fields and
was interrupted before acceptance. Its output is not accepted as review or
verification evidence. Final task/release verification and a new independent
review wave remain required after the fixture corrections converge.

`/root/fix_fixture_lint_cleanup` uses the existing implementer role with
explicit `gpt-5.6-terra` / `medium`, no inherited turns, and no child-agent
dispatch. Its bounded scope is mechanical cleanup of stale imports/types and
the ESLint exclusion for ignored nested generated output after the first
integrated lint run reported 50 errors and 17 generated-file warnings.

The integrated fixture migration and delivery handoff correction now pass the
following deterministic checks:

- The complete affected test set passed in one worker: 35 files and 1,194
  tests. This includes server delivery, handler metadata, entity transitions,
  repository routing, integration, core fixture use, and the testing-package
  BlackBox contract.
- After simplifying the recent-delivery helper, the exact delivery and local
  handoff regression set passed again: 4 files and 101 tests.
- The TSDoc checker regression for deleted tracked sources passed 57/57 tests.
- The copyright checker regression for deleted tracked sources passed 23/23
  tests.
- `pnpm lint` passed. This includes Proto generation and policy checks,
  generated-source build/typechecking, repository-wide ESLint, cleanup rules,
  TSDoc enforcement, and copyright enforcement.
- The ordinary Proto workflow generated private server, core, and testing
  fixture models from readable `.proto` files. Generated fixture directories
  are ignored and are not committed.

The lint run revealed that both the TSDoc and copyright source enumerators
treated tracked files deleted from the working tree as readable current files.
Both enumerators now exclude Git-reported working-tree deletions, while broken
or escaping symlinks remain errors. Focused regression tests cover each
correction.

Implementation and deterministic-check checkpoint `c8bf1fa98` was pushed to
the official feature branch before independent review.

Fresh independent review assignments at `c8bf1fa98` receive no inherited
conversation turns and may not spawn sub-agents:

- `/root/fresh_delivery_reliability_review`: existing
  performance/reliability reviewer role, explicitly `gpt-5.6-terra` / `high`;
  delivery correctness, bounded resources, cache scope, duplicate removal, and
  local-handoff lifecycle.
- `/root/fresh_fixture_style_review`: existing style/maintainability reviewer
  role, explicitly `gpt-5.6-terra` / `high`; delivery clarity, readable fixture
  structure, checker changes, and affected-path maintainability.
- `/root/fresh_delivery_api_review`: existing TypeScript/API documentation
  reviewer role, explicitly `gpt-5.6-terra` / `high`; TypeScript contracts,
  package/export boundaries, wire compatibility, and public documentation.

The desktop surface exposes the immutable configured role/profile but not
separate runtime self-introspection. Each dispatch supplied both required
fields explicitly and matches the configured role profile.

The first fresh review wave returned five proposed findings. Their verified
dispositions are:

- Accepted: `pnpm typecheck:tooling` fails because migrated tests retain
  handwritten `Message<"...">` aliases whose unqualified type names conflict
  with the generated package-qualified message types.
- Accepted: a continued remote read with a logical page size of 1,000 fetches
  the inclusive anchor plus 999 later rows. Returning those 999 rows directly
  makes `Delivery` mistake a full remote wire page for exhaustion. Remote raw
  reads must keep fetching until they fill the requested logical page or the
  source is actually exhausted.
- Accepted: the repository-routing test aliases a handler-registry command
  schema instead of declaring its own domain command.
- Accepted: repository-routing fixtures use `CommandId` and a command payload
  as entity identifiers. Dedicated identifier messages must replace those
  role substitutions while preserving the intended identifier-shape and
  validation tests.
- Rejected: adding context or tenant to the recent-delivery identity. Current
  Spine JVM `DeliveredMessagesCache` is one cache per `Delivery`; that delivery
  may serve multiple bounded contexts and tenants, and `DispatchingId` contains
  only the signal ID and complete Inbox target. Adding scope would diverge from
  the binding implementation. Spine-generated signal IDs provide the global
  signal identity expected by this policy.

The API reviewer also confirmed that the new schemas remain fixture-local:
production Proto output, public package exports, and wire behavior are
unchanged. Its API documentation check and 118 focused delivery/client tests
passed.

Review-correction assignment at `8d7f48634`:
`/root/fix_review_correction_batch`, existing implementer role, explicitly
`gpt-5.6-terra` / `medium`, no inherited conversation turns, and no child-agent
dispatch. Its bounded paths are the remote Inbox adapter and focused tests,
repository-routing fixture Proto sources/generated imports and tests, and the
standalone handler runtime fixture types. It may not change the accepted JVM
deduplication identity, public APIs, production Proto schemas, or introduce
publication/delivery retries, extra timeouts, or encoded fixture source.

Correction evidence recorded 2026-09-11:

- The new `RemoteInbox` regression first failed under
  `pnpm exec vitest run packages/delivery-client/test/remote-inbox-direct.test.ts --maxWorkers=1`:
  an inclusive continuation at logical limit 1,000 returned only 999 rows.
  The regression has an inclusive anchor, 2,000 subsequent raw rows, and a
  pending row on the second raw page. `RemoteInbox` now uses the existing
  continuation collector for both filtered and unfiltered reads, stopping only
  after the logical page is full or the remote source reports completion.
- Repository-routing now declares its fixture-local `TaskCommand`,
  `UuidMessageIdAggregateId`, and required `ValidatedMessageId` messages in
  readable Proto source. The UUID-shaped identifier and required-field route
  validation remain covered without using `CommandId` or a command payload as
  an entity identifier. Generated fixture types replace handwritten
  `Message<"...">` declarations and schema casts in repository-routing and
  standalone handler tests.
- `pnpm proto:generate` passed, including authored-Proto checks and frozen
  descriptor verification. `pnpm typecheck:tooling` passed. The focused test
  command `pnpm exec vitest run packages/delivery-client/test/remote-inbox-direct.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/runtime/standalone-handler-runtime.test.ts --maxWorkers=1`
  passed 287 tests in 3 files. No cache-identity or production/public-export
  changes were made.
- Preflight lint correction: removed stale generated-type aliases/imports and
  replaced unsafe test interpolation/non-null assertions without changing
  behavior. Targeted ESLint for the two corrected tests passed; the same
  three-file one-worker Vitest command passed 287 tests.

- Runtime-build correction: private server, core, and testing fixture packages
  now have composite TypeScript targets for their exported generated modules;
  root build references and clean-output targets include their `dist` roots.
  The managed external-events child imports the compiled server fixture module
  directly, so plain Node no longer resolves an unbuilt `.js` specifier through
  `schemas.ts`. Focused regressions first failed for missing fixture outputs and
  the uncompiled import. `pnpm proto:generate`, `pnpm typecheck:build:generated`,
  and one-worker Vitest for generated-clean, cleaner, and managed external
  events passed 21 tests. No dynamic descriptors, Base64 fixtures, production
  state changes, commits, or pushes were introduced.

The first converged `pnpm verify:release` run passed every non-test gate and
then ran 4,662 tests. It exposed one stale generated-target expectation and a
plain-Node runtime gap: Vitest resolves generated `.js` specifiers to generated
`.ts` source, but the managed child requires compiled `.js`. Three subsequent
managed-child failures were consequences of that missing runtime output. The
correction adds composite build targets for all three private fixture packages,
includes their `dist` roots in deterministic cleanup, imports the compiled
server fixture in the child, and updates the complete generated-target
expectation. The server fixture project explicitly references both its core and
proto dependencies. After a clean generated build, the exact three-file
failure set passes 21/21 tests with one worker.

Runtime-build correction commit `d7efbd44d` was pushed. Affected-lane re-review
was dispatched to `/root/fresh_delivery_api_review` for private package exports,
project references, and public boundary consequences;
`/root/fresh_fixture_style_review` for fixture build and readable-source
maintainability; and `/root/fresh_delivery_reliability_review` for clean-build,
generated-output, and managed-child lifecycle reliability. These are the same
existing reviewer roles with their previously explicit `gpt-5.6-terra` /
`high` configuration and no child-agent dispatch.

The three fixture-build re-review lanes are clean. Final security re-review of
`d7efbd44d` was returned to `/root/final_correction_security_review`, the same
existing final security reviewer with explicit `gpt-5.6-terra` / `high`, for
generated path safety, deterministic cleanup, child loading, package boundaries,
and supply-chain consequences.

The affected final security re-review is clean. No unsafe generated path,
cleanup, child-loading, dependency, package-boundary, credential, provenance,
or public/wire consequence was found.

Correction commit `6c92595fc` was pushed to the official feature branch.
Affected-lane re-review was dispatched to the same independent, initially
zero-context roles: `/root/fresh_delivery_reliability_review`, existing
performance/reliability reviewer at explicit `gpt-5.6-terra` / `high` for
remote logical paging; `/root/fresh_fixture_style_review`, existing
style/maintainability reviewer at explicit `gpt-5.6-terra` / `high` for fixture
domain roles and readability; and `/root/fresh_delivery_api_review`, existing
TypeScript/API documentation reviewer at explicit `gpt-5.6-terra` / `high` for
generated types and public/package boundaries. They may not edit files or
spawn sub-agents.

All three affected-lane re-reviews are clean. Fresh documentation review is
assigned at `8dccfdc07` to `/root/fresh_correction_docs_review`, the existing
documentation reviewer role, explicitly `gpt-5.6-luna` / `medium`, with no
inherited conversation turns and no child-agent dispatch. It covers current
delivery, identity, history, fixture-policy, and compatibility claims and
checks for terminology left by the superseded admission design.

The documentation review found one stale statement in
`packages/delivery-client/REFERENCE.md`: it said raw pages were read once.
The correction now distinguishes one bounded logical page from the multiple
bounded raw-page RPCs sometimes needed to move past an inclusive remote cursor.
The documented timestamp-collision limitation remains unchanged. No other
documentation contradiction was found.

Documentation correction commit `788513686` was pushed. The affected-lane
documentation re-review is clean: the reference now accurately describes the
bounded logical read, bounded raw-page RPC continuation, and unchanged
timestamp-only cursor limitation. All accepted review findings are resolved;
the reliability, style/maintainability, TypeScript/API documentation, and
documentation lanes are clean after their affected corrections.

The first complete cheap-preflight attempts exposed deterministic cleanup that
the narrower checks had missed: stale test type aliases and unsafe assertions,
then two overlong generated-type import lines. Correction commits
`b5772da35` and `805ddfcf6` were pushed; targeted ESLint, cleanup enforcement,
tooling typecheck, and the 287-test focused set pass after those corrections.

GitHub release verification and the local preflight then identified the same
remaining formatting failure: four new private fixture JSON files had not been
formatted. Prettier reformatted the core and testing fixture `package.json` and
`spine-proto.json` files. This is the cause of the red CI runs through
`805ddfcf6`; no runtime or test behavior failed at that point.

Formatting correction commit `9441dd8f0` was pushed. The complete bounded
preflight then passed with `pnpm verify:task -- --no-coverage` over seven
focused files: 417/417 tests passed. The profile also passed Node compatibility,
Proto generation/style/frozen descriptors, generated build and tooling
typechecking, repository-wide ESLint and cleanup enforcement, TSDoc, copyright,
log containment, full formatting, documentation/API exports, Buf lint,
generated-output currency, and release-readiness checks.

Final security-review assignment at `e79dcbb87`:
`/root/final_correction_security_review`, existing final security reviewer role,
explicitly `gpt-5.6-terra` / `high`, with no inherited conversation turns and
no child-agent dispatch. It covers identity generation/preservation, typed
deduplication, remote paging bounds, tenant/shard/session fencing, duplicate
removal and handoff, history/version behavior, fixture/tooling changes,
trusted-publishing provenance, logging, dependency, and public/wire boundaries.

The final security review is clean. It found no release-blocking issue in the
reviewed identity, delivery, history, fixture/tooling, provenance, logging,
dependency, or public/wire behavior.

Final release verification passed after the private fixture build correction.
`pnpm verify:release` passed every release gate and all 4,663 tests in 290 test
files with one Vitest worker. The clean managed child-process scenarios passed,
confirming that plain Node can load the compiled private fixture modules. Total
coverage was 93.22% statements, 90.06% branches, 92.79% functions, and 94.37%
lines. `node scripts/release-cli.mjs prepare --check` also passed, packing all
18 public packages at `2.0.0-snapshot.11` and installing them together in a
clean consumer project.

## Human Review Correction

- The human review rejected the downstream `sigstore@4.1.1` patch. Current
  upstream evidence confirms that released Sigstore 5 still leaves
  `fetchOnConflict` disabled, while sigstore-js issue #1708 and PR #1709 remain
  open. The accepted repository correction is to remove the patch, its focused
  test, and its active runbook claim; retain official unmodified npm trusted
  publishing without retries, custom timeouts, a custom publisher, stored
  credentials, or disabled provenance. Equivalent-entry recovery remains an
  upstream limitation until a released npm/Lerna dependency contains the
  upstream correction.
- The human review also rejected test-mechanical fixture domains, mixed signal
  roles in one Proto file, misuse of `envelope` in payload fixture names, and
  inconsistent Proto spacing. The correction covers every Proto changed from
  the branch merge base, with commands, events, and entity states separated and
  named in concrete domains.
- Implementation assignment: existing implementer role, canonical agent
  `/root/fixture_and_sigstore_correction`, explicitly dispatched with
  `gpt-5.6-terra` / `medium` and no inherited turns. It may not spawn
  sub-agents. Its scope is fixture Proto sources, manifests, direct test
  consumers, Sigstore patch removal, active release documentation, and focused
  verification; it may not commit or push.

The correction removes `patches/sigstore@4.1.1.patch`, both pnpm
`patchedDependencies` entries, and the patch-specific test. The replacement
release-policy test checks the actual workspace and lockfile configuration and
the absence of the patch file. It does not treat documentation prose as an
executable contract. Official trusted publishing and automatic provenance are
unchanged.

The branch-added fixture payloads now use Project and Review domains. Command,
Event, state, identifier, and rejection sources are separated by role. The
misleading `black_box.proto`, `signal_envelopes.proto`, catch-all `main.proto`,
and repository-routing/validation filenames were removed or replaced with
role-specific source names. Direct consumers use the generated domain names;
compatibility aliases that restored generic fixture vocabulary were removed.
The repository's automated Proto formatter did not enforce every requested
section break, so the changed sources were also inspected explicitly for blank
lines after `syntax`, package, and import sections and between declarations.

Correction verification so far:

- `pnpm typecheck:tooling` passes after migrating every stale generated-schema
  import found by the complete tooling project.
- `pnpm format:check`, `git diff --check`, and
  `pnpm proto:check-generated:current` pass.
- Release-policy and Proto-workflow tests pass 105/105 with one worker; the
  release-policy subset passes 7/7.
- Core fixture tests pass 62/62, BlackBox contract tests pass 16/16, and the
  repository-routing suite passes 265/265 with one worker.
- Focused handler and repository consumer runs passed 363/363, 295/295,
  144/144, and 59/59 at their respective correction checkpoints.

Fresh zero-context review at `1ac4b3eb3` is assigned to the existing
style/maintainability reviewer (`gpt-5.6-terra` / `high`) for fixture domain
quality, role separation, naming, formatting, consumer readability, and diff
hygiene; the existing TypeScript/API documentation reviewer
(`gpt-5.6-terra` / `high`) for generated contracts, imports, package boundaries,
public/wire/storage compatibility, and test meaning; and the existing
performance/reliability reviewer (`gpt-5.6-terra` / `high`) for trusted
publishing, dependency/lockfile behavior, deterministic generation, CI
consequences, and bounded verification. All fields are explicit in dispatch,
no conversation turns are inherited, reviewers are read-only, and they may not
spawn sub-agents.

The fresh review wave returned one correction batch:

- update the stale `entity-metadata/main` descriptor assertion and the managed
  child-process import of deleted `main_pb`;
- move `ProjectSubmissionId` from the validation Command file to a dedicated
  identifier source;
- add the required copyright header to the five newly authored core/testing
  Proto sources;
- remove the `entityMetadataMainFile` catch-all descriptor facade and migrate
  positional consumers to named generated Project schemas;
- include the three private nested fixture packages in pnpm workspace
  validation while confirming release packaging still excludes private
  packages;
- wrap newly overlong TypeScript exports/imports; and
- qualify the release guide so “no timeout” means no Sigstore-specific timeout
  workaround, not the existing bounded registry-selection request.

The consolidated correction remains assigned to the existing implementer
`/root/fixture_and_sigstore_correction`, explicitly `gpt-5.6-terra` / `medium`,
with no inherited conversation turns and no child-agent dispatch. Reviewers
were read-only, so runtime metadata beyond the immutable configured role/model
profile is unavailable.

All accepted findings were corrected. Stale descriptor and managed-child
imports now use `entity-metadata/project_states`; `ProjectSubmissionId` has a
dedicated identifier source; all new Protos have standard headers; direct
consumers import named generated schemas rather than catch-all file descriptors;
and all entity-metadata and handler-registry file-descriptor facades have been
removed. The three private fixture packages are pnpm workspace importers and
package metadata tests assert both their private status and exclusion from the
fixed 18-package public release inventory. The release guide now distinguishes
the absence of a Sigstore-specific timeout workaround from the existing
10-second registry-selection timeout.

During correction, direct inspection found one additional domain-role defect:
the server-lifecycle fixture registered a Project state as a Command and
renamed unrelated Project/Review payloads as lifecycle types. It now has
separate `StartServer`, `ServerStarted`, and `ServerStatus` Proto sources and
uses each role directly.

Post-correction evidence: facade scans return zero results; `git diff --check`
and `pnpm proto:check-generated:current` pass; full formatting and tooling
typechecking pass. The focused regression profile passes 208/208 tests across
managed external events, server lifecycle, server package exports, Proto
workflow, copyright, package metadata, and release policy. Additional direct
schema-migration suites passed at each slice, including repository routing
265/265, Spine services 114/114, bounded context 79/79, entity transitions
58/58, Stand 61/61, and handler bus/metadata suites.

Second fresh zero-context review of the complete branch at `973229382` is
assigned to new instances of the existing style/maintainability,
TypeScript/API documentation, and performance/reliability reviewer roles. Each
dispatch explicitly uses `gpt-5.6-terra` / `high`, inherits no conversation
turns, is read-only, and prohibits child-agent dispatch. The review covers the
whole merge-base diff with emphasis on the corrected fixture domains,
role-separated Proto sources, direct generated-schema consumers, private
workspace packages, and unmodified trusted-publishing dependency path.

The second review wave found no release/publishing issue. It found a final
fixture/API correction batch: remove the remaining broad `schemas.ts` facade
and positional file-descriptor imports; align `project_routing_events.proto`
with the `repository_routing` package; remove a stale Review alias for Project
Submission state; add the missing `entity_metadata` package declaration; and
replace remaining tests that register framework envelope schemas or entity
states as application Commands/Events. This work is returned to the same
existing implementer `/root/fixture_and_sigstore_correction`, explicitly
`gpt-5.6-terra` / `medium`, with no inherited turns and no child-agent
dispatch. The new reviewers were read-only; their runtime metadata is limited
to the immutable configured role/model profiles recorded in their explicit
dispatches.

The second-wave findings were corrected. `entity_metadata` now has an explicit
package plus ordinary `CreateProject` and `ProjectCreated` application-signal
fixtures. Reviewed handler, repository, server-index, and services tests no
longer register framework envelopes or entity states as application Commands or
Events. `project_routing_events.proto` now uses the `repository_routing`
package, and Project Submission tests use their actual state name.

The broad server `test-fixtures/schemas.ts` facade was deleted. All consumers
now import named generated schemas or the specific independent invalid-fixture
descriptor directly; scans find no `FixtureSchemas`, `entityMetadata*File`, or
`handlerRegistry*File` references. Full formatting, tooling typechecking, diff
whitespace, and generated-output currency pass. Focused corrections pass:
command/event readiness 14/14 each, handler decorators/metadata 27/27, server
index/repository 33/33, Spine services 114/114, repository routing 265/265,
and final facade consumers 96/96. Intentional entity state-subscription tests
remain because they exercise Spine state-update routing, not application Event
delivery.

Affected-lane re-review at `b75811efd` is assigned to the same second-wave
style/maintainability and TypeScript/API documentation reviewer instances,
whose explicit immutable profiles are `gpt-5.6-terra` / `high`. They remain
read-only and may not spawn sub-agents. The release/reliability lane is not
reopened because its clean Sigstore/workspace findings were not materially
changed by the server test-fixture consumer migration.

## Enforced Protocol Correction And Final Closure

Human review on `2026-09-11` found that several written quality rules were not
reliably enforced. In particular, package test-fixture Proto files were outside
the authored-Proto style check, the 35-line method target was prose only, and
task verification trusted caller-selected tests. The task is reopened until
these enforcement gaps are corrected and the complete branch is re-audited
under the updated protocol.

This is a standard build-tooling and whole-branch correction. It changes shared
verification behavior but does not change a public, wire, or storage contract.
The final branch still requires `verify:release` because the surrounding task
contains runtime, Proto, dependency, and release changes.

### Acceptance criteria

- `BUILD_PROTOCOL.md` contains the enforced execution cycle accepted by the
  human, without duplicating `CODE_QUALITY.md` as another policy source.
- Objective rules have executable checks or are explicitly identified as
  reviewer judgment.
- The authored-Proto checks cover package test fixtures as well as framework
  and example Proto, enforce formatting and signal-file naming/layout, and have
  regression tests for the review escapes.
- New or modified production/example functions, methods, accessors, and
  constructors are mechanically limited to 35 physical lines, with generated,
  frozen, and unchanged baseline code excluded and with focused regression
  tests.
- Ordinary fixture consumers cannot substitute encoded descriptors or
  positional descriptor lookup for named generated schemas when those schemas
  exist.
- Task verification derives its mandatory gates from the complete Git change
  set. Caller-supplied test paths may add coverage but may not suppress required
  checks. Unknown classifications fail closed.
- The complete branch is checked for Proto domain/layout, method length, TSDoc,
  fixture-source, and generated-schema violations and all confirmed findings
  are corrected.
- One complete relevant review wave is resolved, `verify:release` passes, every
  commit is pushed immediately, and required CI is green for the exact final
  commit before the task is described as ready.

### Execution and model routing

- Protocol/checker implementation: existing implementer role, explicit
  `gpt-5.6-terra` / `medium`, test-first, one writer for
  `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, verification/checker scripts, their
  tests, and package script wiring. The implementer may not spawn sub-agents.
- Current-branch rule inventory: orchestrator-dispatched read-only repository
  scan, explicit `gpt-5.6-luna` / `medium`, covering Proto filenames/layout,
  function length, TSDoc, encoded descriptor substitutions, positional schema
  access, and generated leftovers. It may not edit or spawn sub-agents.
- CI and verification audit: orchestrator-dispatched read-only repository and
  public GitHub scan, explicit `gpt-5.6-luna` / `medium`, covering the exact
  pushed SHA, red jobs, local reproduction commands, and process cleanup. It
  may not edit or spawn sub-agents.
- After deterministic convergence, relevant existing reviewers receive one
  whole-branch concern each with explicit configured models and reasoning.

The execution surface supports explicit child model and reasoning dispatch.
Runtime self-introspection may be unavailable; acceptance uses the explicit
dispatch fields and immutable configured role where applicable.

### Applicability matrix

| Changed area                         | Objective checks                                      | Focused tests                               | Review concern                    |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| Build protocol and quality rules     | Markdown format, link/policy consistency              | Documentation-only checker tests            | Documentation and maintainability |
| Proto enforcement                    | Proto formatter, Buf lint, source-role/layout checker | Proto checker and workflow tests            | Domain/API correctness            |
| TypeScript structure enforcement     | Cleanup checker and ESLint                            | Cleanup-checker tests                       | Maintainability                   |
| TSDoc and fixture-source enforcement | TSDoc and generated-source checks                     | Checker regression tests                    | TypeScript/API documentation      |
| Task verification selection          | Git change classifier and fail-closed gate planner    | `verify-task` tests                         | Reliability                       |
| Complete feature branch              | All applicable static and focused gates               | Affected package suites, then release suite | All materially affected concerns  |

### Estimate

- Checker tests and implementation: 2–3 hours.
- Verification integration: 1–2 hours.
- Complete branch audit and corrections: 1–2 hours.
- Review, release verification, commits, pushes, and reporting: about 1 hour of
  agent work, plus external CI waiting.

### Enforcement audit evidence

The read-only CI audit ran with explicit `gpt-5.6-luna` / `medium` dispatch.
Public GitHub evidence identifies one failed `verify` check for exact branch
commit `dca2feae`, in workflow run `34630822700`, job `103366939718`.
Installation passed and `pnpm verify:release` failed after 153 seconds; release
preparation and publication did not run. Public unauthenticated APIs do not
expose the command log, so local release verification must establish the exact
failing subcommand. The audit also found no repeated Proto generation in the
release expansion, but found no CI job timeout and no process timeout around
individual `verify:task` gates.

The read-only whole-branch rule audit ran with explicit `gpt-5.6-luna` /
`medium` dispatch. It found five changed lines over 120 characters, 35 unused
branch-added imports, three remaining positional descriptor lookups where named
generated schemas exist, and abandoned `.generated-*` staging directories. It
found no new encoded descriptor source, no changed production/example callable
over 35 physical lines, and no current TSDoc failure. The mechanical findings
form one correction batch after the enforcement implementation converges.

The first enforcement implementation attempt reached RED then GREEN for Proto
role coverage (4/4) and mandatory task verification (10/10), but the checker
and test edits disappeared from the shared checkout before handoff. The same
explicit `gpt-5.6-terra` / `medium` implementation context was re-dispatched as
the sole writer to reapply its recoverable patch and verify the resulting diff.

The restored enforcement implementation added authored fixture Proto scanning,
changed-callable length checks, generated-schema consumer checks, affected-test
selection, and the enforced protocol boundary. Focused Proto/task-verification
tests pass 16/16. Orchestrator inspection found and returned gaps for untracked
files, Git failure handling, descriptor bypasses, generic fixture filenames,
Buf formatting, and duplicate test selection; those corrections are present.
The original implementation context could not add direct tests for two private
process seams. A replacement bounded implementation assignment is therefore
recorded for `/root/enforcement_test_seams`, explicit `gpt-5.6-terra` /
`medium`, with no inherited turns and no child dispatch. It is the sole writer
for the cleanup and Proto-workflow command-runner seams and their two missing
regressions; it may not change branch runtime behavior, commit, or push.

The replacement enforcement assignment completed. Focused tests established
the Git-failure and Buf-format ordering seams, and follow-up tests narrowed the
descriptor rule to the actual rejected patterns without rejecting ordinary
Base64 data. The final enforcement evidence is 223/223 passing across the
owned-Proto, cleanup, and Proto-workflow suites, followed by 117/117 passing for
the JavaScript descriptor-consumer extension. `git diff --check` passes.

Applying the new checks to the branch produced one frozen mechanical correction
batch: five lines over 120 characters; three positional generated-schema
reconstructions; 14 changed production/example callables over 35 physical
lines; the `optional` keyword and one missing documentation separation in
`entity-metadata/project_states.proto`; and the unused imports reported by
targeted server ESLint. Ten abandoned `.generated-*` staging directories were
moved intact to `/tmp/spine-stale-generated.uZmVzJ`; no tracked source was
deleted.

The branch correction is assigned to `/root/enforced_branch_correction`, the
existing implementer role with explicit `gpt-5.6-terra` / `medium`, no inherited
turns, and no child dispatch. It is the sole writer for the listed production,
Proto, and consumer-test files. It must preserve behavior, use semantic
sub-steps rather than relocation-only helpers, remove unused imports, replace
positional descriptors with named generated schemas, run focused tests, and
return only after the new mechanical gates pass. It may not edit enforcement
scripts, commit, or push.

Orchestrator inspection of the resulting task-test planner found one remaining
efficiency defect: when mandatory package or repository-wide tests already
cover caller-selected focused paths, `verify:task` can run those focused tests
again. A bounded follow-up is assigned to the existing
`/root/enforcement_test_seams` implementer context, whose explicit immutable
profile is `gpt-5.6-terra` / `medium`. It is the sole writer for
`scripts/verify-task.mjs` and its test, may not spawn sub-agents, and must make
the mandatory and additive test plan cover the complete change set without
executing an already-covered path twice.

That planner follow-up completed test-first. `plannedTaskTests()` retains the
mandatory package or repository-wide suite, drops caller-selected paths already
covered by it, and retains focused paths outside a mandatory package scope.
The full `verify-task` test file passes 13/13 and `git diff --check` passes.

The original branch-correction context was stopped after three consecutive
bounded turns returned partial status without completing any requested callable
group. This is a demonstrated execution blocker, not a design change. The
remaining mechanical production correction is reassigned to
`/root/callable_correction`, the existing implementer role with explicit
`gpt-5.6-terra` / `medium`, no inherited turns, and no child dispatch. It is the
sole writer for the delivery-server inbox service, build-time handler analyzer,
server delivery/inbox storage, and repository files until the callable gate is
green. It may not edit enforcement scripts, Proto/test fixtures, commit, or
push.

That replacement reduced the callable gate from twelve findings to two while
keeping the proto-tools, delivery-server, and server TypeScript builds green.
It then stalled twice on the single `Delivery.drain()` decomposition without a
technical blocker. The delivery-only remainder is reassigned to
`/root/delivery_drain_correction`, existing implementer role, explicit
`gpt-5.6-terra` / `medium`, no inherited turns, and no child dispatch. It is the
sole writer for `packages/server/src/delivery/delivery.ts`, may not commit or
push, and must preserve deadline, cancellation, paging, duplicate, and removal
behavior while making the mechanical callable gate pass.

The delivery-only replacement completed. It introduced a stateful
`DeliveryDrain` collaborator without changing the public API; server
typechecking, focused lint, all 266 delivery tests with one worker, diff
whitespace, and the delivery portion of the callable gate pass. The only
remaining callable failure is `createHistoryCache()` in the repository. That
one-file remainder is assigned to `/root/history_cache_correction`, existing
implementer role, explicit `gpt-5.6-terra` / `medium`, no inherited turns, and
no child dispatch. It is the sole writer for
`packages/server/src/repository/repository.ts`, may not commit or push, and
must preserve aggregate-history ordering, version, cache, and error behavior.

The final accepted documentation corrections are assigned to the existing
`/root/tsdoc_correction` implementer context, whose explicit immutable profile
is `gpt-5.6-terra` / `medium`. It is the sole writer for `BUILD_PROTOCOL.md` and
this task record during the batch, may not spawn sub-agents, commit, or push,
and must make the current checkpoint/pending verification state unambiguous
while keeping the exact-final-SHA rule normative in only one section.

All accepted first-wave findings were corrected, and the complete deterministic
preflight passed again in one run. Affected-lane re-review is dispatched without
inherited turns: `/root/maintainability_rereview` uses the existing
style/maintainability reviewer role with explicit `gpt-5.6-terra` / `high`;
`/root/reliability_rereview` uses the existing performance/reliability reviewer
role with explicit `gpt-5.6-terra` / `high`; and `/root/api_rereview` uses the
existing TypeScript/API documentation reviewer role with explicit
`gpt-5.6-terra` / `high`. Each is read-only, restricted to corrected findings
and regression risk, and may not spawn sub-agents. Documentation and final
security affected-lane rechecks follow when capacity becomes available.

The final security gate is clean. Final maintainability/reliability review
identified one shared planner defect and one narrow checker escape: mixed-scope
coverage must run as one Vitest invocation, and descriptor factories aliased in
their import declaration must be recognized. This final test-first correction
returns to `/root/enforcement_test_seams` under its already recorded explicit
`gpt-5.6-terra` / `medium` implementer profile, with sole write scope over the
two enforcement scripts/tests and no child dispatch, commit, or push.

The final enforcement correction passed its focused tests and the complete
deterministic preflight passed once more. Final narrow rechecks are dispatched
without inherited turns: `/root/enforcement_maintainability_close` uses the
existing style/maintainability reviewer role with explicit
`gpt-5.6-terra` / `high`; `/root/enforcement_reliability_close` uses the
existing performance/reliability reviewer role with explicit
`gpt-5.6-terra` / `high`; and `/root/final_documentation_close` uses the
existing documentation reviewer role with explicit `gpt-5.6-luna` / `medium`.
They are read-only, concern-specific, and may not spawn sub-agents.

The narrow close confirmed coverage command composition but found three final
test/planner details: descriptor-factory provenance must follow the actual
`@bufbuild/protobuf/codegenv2` module without flagging unrelated same-named
functions, repeated requested paths must be deduplicated, and shared-path
coverage fallback needs a direct regression. These return test-first to
`/root/enforcement_test_seams` under its recorded explicit
`gpt-5.6-terra` / `medium` profile and existing restricted script/test scope.

The corrected enforcement suites pass 135/135 with full ESLint, cleanup,
tooling typecheck, and diff whitespace green. The exact final planner/checker
changes are returned for narrow read-only closure to the existing
`/root/enforcement_maintainability_close` and
`/root/enforcement_reliability_close` contexts under their recorded explicit
`gpt-5.6-terra` / `high` reviewer profiles. Neither may edit or spawn children.

Final resolution checks are clean. Coverage sources and requested test paths
are deduplicated in first-seen order; mixed and shared coverage plans use one
Vitest process with coverage settings once. Descriptor factories are tied to
the authoritative `@bufbuild/protobuf/codegenv2` binding, including aliases,
while block-local and parameter shadowing are allowed. The paired shadowing
regressions prove both rejection and allowance. The final enforcement suites
pass 139/139; maintainability and reliability reviewers mark their findings
resolved. Documentation, API/Proto, and final security lanes are clean. The
pre-existing unauthenticated delivery control plane and the JVM-equivalent
non-atomic acknowledgement/session boundary remain explicitly out of this
task; neither was changed or partially implemented.

The first release-profile attempt was stopped after the new Proto-format gate
printed diffs for frozen/unchanged baseline sources and continued because
`--exit-code` was missing. No test worker remained. Investigation established
that root `buf.yaml` covers framework/examples but not package test-fixture
roots. The previous enforcement context could not safely complete the required
grouped-command redesign. This demonstrated tooling blocker is reassigned to
`/root/proto_format_gate_correction`, existing implementer role with explicit
`gpt-5.6-terra` / `medium`, no inherited turns, and no child dispatch. It is the
sole writer for `scripts/proto-workflow.mjs` and its test, may not change Proto
sources, commit, or push, and must format-check only changed non-frozen files in
one command per recognized source root with `--exit-code`.

The grouped workflow tests pass 107/107. Direct lint then exposed one conflict
between Buf canonical formatting and the custom style checker: the checker
requires a blank line between a message opening brace and its first documented
field, while Buf removes it. The style-rule compatibility fix is assigned to
`/root/proto_style_compatibility`, existing implementer role with explicit
`gpt-5.6-terra` / `medium`, no inherited turns, and no child dispatch. It is the
sole writer for `scripts/check-owned-proto-style.mjs` and its test, may not edit
Proto sources, commit, or push, and must retain separation checks everywhere
except directly after an opening brace.

The grouped Proto workflow suite passes 107/107, the style compatibility suite
passes 8/8 after a focused RED/GREEN regression, and direct `pnpm proto:lint`
is quiet and green. The new workflow/style surface is dispatched for final
zero-context read-only review: `/root/proto_gate_maintainability_review` uses
the existing style/maintainability reviewer role with explicit
`gpt-5.6-terra` / `high`, and `/root/proto_gate_reliability_review` uses the
existing performance/reliability reviewer role with explicit
`gpt-5.6-terra` / `high`. Neither may edit or spawn sub-agents.

Both final Proto enforcement reviewers mark their findings resolved. External
fixture-root commands now scope to changed repository-relative paths; Git path
classification is NUL-safe and fails closed for unknown roots; execution-order
tests are independent of checkout state; direct role tests reject entity kinds
in both command and event files; and the Buf-compatible brace exception remains
narrow. The workflow suite passes 110/110, the style suite passes 8/8, and
direct `pnpm proto:lint` is green. The earlier release-profile run was stopped
before completion because its formatter gate was invalid; it is not accepted as
release evidence. A fresh complete preflight and release run are required.

The corrected release-profile run passed every static/generated/package gate
but its 4,706-test coverage suite failed five tests: two entity-column generator
tests, one release-workspace discovery test, and two managed-external-event
integration tests. Root-cause investigation is dispatched in three independent
read-only lanes without inherited turns: `/root/debug_entity_columns`,
`/root/debug_release_workspace`, and `/root/debug_managed_external_events`, all
as orchestrator scanning functions with explicit `gpt-5.6-luna` / `medium`.
They may not edit or spawn sub-agents and must reproduce, trace current-diff
causation, compare working patterns, and return a minimal tested hypothesis
before implementation.

All five release-test failures were reproduced and traced. Workspace discovery
correctly includes three new private test-fixture packages, so only stale total
and private-count expectations need updating; the 18 public release boundary
and 26-path release inventory remain unchanged. Entity-column tests import
three removed pre-domain fixture names and must use the current project state
schemas/expected generated names. Managed external-event tests hard-code an
unqualified state type URL while runtime registration uses the schema-derived
canonical URL. One test-only correction batch is assigned to the existing
`/root/domain_fixture_correction` implementer context under its recorded
explicit `gpt-5.6-terra` / `medium` profile. It is the sole writer for the three
failing test files, may not change production or release policy, spawn children,
commit, or push.

The release-test correction batch passed 15/15 focused tests. Lerna discovery
expects 29 total/11 private workspaces and explicitly preserves the exact 18
public packages; entity-column tests use the current project-domain schemas;
and the managed external-event target derives its canonical URL from the named
schema. Production generator/routing and release policy were unchanged. Full
ESLint, cleanup, tooling typecheck, formatting, and diff whitespace pass. These
deterministic test-fixture corrections do not reopen reviewer lanes; a complete
cheap preflight is required before retrying the release profile.

Affected-lane re-review kept the API/Proto lane clean but returned a second
correction batch. Reliability found that the cloned public tenant remained
mutable and that refresh pages bypassed history ordering validation.
Maintainability found one remaining forwarding-only inbox layer, whole-suite
fallback for otherwise classifiable multi-package changes, and namespace/factory
alias escapes in positional descriptor detection. Delivery/tenant plus inbox
factory corrections return first to `/root/delivery_drain_correction`; history
refresh validation then returns to `/root/history_cache_correction`; enforcement
planner/checker corrections then return to `/root/enforcement_test_seams`.
Their previously recorded explicit implementer profiles remain
`gpt-5.6-terra` / `medium`; assignments are sequential, non-overlapping, do not
permit child dispatch, commits, or pushes.

The second correction batch converged and the complete deterministic preflight
passed again. Final affected-lane rechecks are dispatched without inherited
turns: `/root/final_maintainability_gate` uses the existing
style/maintainability reviewer role with explicit `gpt-5.6-terra` / `high`;
`/root/final_reliability_gate` uses the existing performance/reliability
reviewer role with explicit `gpt-5.6-terra` / `high`; and
`/root/final_security_gate` uses the existing security reviewer role with
explicit `gpt-5.6-terra` / `high`. All are read-only, limited to corrected
findings and nearby regressions, and may not spawn sub-agents. The API/Proto
lane remains accepted because the second batch did not change its reviewed
surface. Final documentation review follows when a slot becomes available.

The history-cache assignment completed with a cohesive
`RepositoryHistoryCache` helper. Server typechecking, focused lint, 327
repository tests with one worker, diff whitespace, and the full callable gate
pass. A fresh whole-repository ESLint run then found 44 real errors after one
new abandoned generated staging directory was moved intact to
`/tmp/spine-stale-generated.1k0qFc`: three non-null assertions introduced by
the analyzer extraction, 39 stale imports, and two stand-test typing errors.

The independent domain/API review also identified remaining application-signal
fixtures that still pack entity states, identifiers, WKT scalars, Events as
Commands, or Commands as Events. The affected tests are command bus, event bus,
bounded context, native subscriptions, Spine services, repository routing,
both integration-broker suites, signal metadata, server lifecycle, and core
signal creation. Their correction plus the current ESLint batch is assigned to
`/root/domain_fixture_correction`, existing implementer role, explicit
`gpt-5.6-terra` / `medium`, no inherited turns, and no child dispatch. It is the
sole writer for those tests, their role-specific test-fixture Proto sources and
generated outputs, the stand test, and the build-time analyzer. It may not edit
runtime production outside the analyzer, enforcement scripts, or protocol
documents, and may not commit or push.

After the correction batches converged, the complete deterministic pre-review
profile passed in one run: generated TypeScript build, tooling typecheck, full
ESLint, cleanup/callable enforcement, TSDoc, copyright, logging containment,
formatting, documentation audience/API checks, Buf lint, generated-output
currency, and release readiness.

The complete independent review wave is dispatched without inherited turns.
`/root/final_maintainability_review` uses the existing
style/maintainability reviewer role with explicit `gpt-5.6-terra` / `high`;
`/root/final_reliability_review` uses the existing performance/reliability
reviewer role with explicit `gpt-5.6-terra` / `high`; and
`/root/final_api_contract_review` uses the existing TypeScript/API
documentation reviewer role with explicit `gpt-5.6-terra` / `high`. Each is
read-only, receives concern-specific paths, and may not spawn sub-agents. A
documentation review and the required final security review will follow in the
same wave when execution capacity becomes available.

The first three review lanes completed. Maintainability reported three P2
findings: a forwarding-only inbox factory, forwarding-only analyzer helpers,
and a destructured-generated-descriptor escape in the cleanup checker.
Reliability reported two P1 and three P2 findings: acknowledgement is not
atomically fenced by the current shard session; mandatory test planning drops
an explicit coverage request; history-page ordering checks omit adjacent items;
guard-lane trimming stops behind an active oldest lane; and long delivery
failure runs retain unbounded target/sample state. The API/Proto reviewer
confirmed the oneof wire number, fixture roles, manifests, generated schemas,
and snapshot versions, but reported two P2 internal API leaks from an extracted
public standalone-runtime helper and exported delivery-deduplication helper.

The remaining same-wave lanes are dispatched without inherited turns.
`/root/final_protocol_docs_review` uses the existing documentation reviewer
role with explicit `gpt-5.6-luna` / `medium`, and
`/root/final_security_recheck` uses the existing security reviewer role with
explicit `gpt-5.6-terra` / `high`. Both are read-only, concern-specific, and may
not spawn sub-agents.

The remaining review lanes completed. Documentation reported a stale top-level
checkpoint summary and duplicated exact-SHA readiness wording. Security
reported one relevant mutable-tenant snapshot defect and one broader
unauthenticated cleartext delivery-control-plane concern. The latter is
pre-existing: neither `packages/delivery-server/src/server/config.ts` nor
`delivery-server.ts` differs from `origin/master` in committed or local changes.
Adding TLS/authentication/authorization would be a new subsystem outside this
task and is therefore recorded but not implemented. The mutable nested tenant
snapshot is accepted because it can split inbox access from the shard fence.

The frozen correction batch is returned to the relevant existing
implementation contexts sequentially. Delivery corrections go first to
`/root/delivery_drain_correction`, whose explicit immutable implementer profile
is `gpt-5.6-terra` / `medium`: atomically fence delivered acknowledgement by
the current shard session, bound long-drain failure state, deep-clone the tenant
boundary, and remove the package-internal deduplication export. It is the sole
writer for delivery runtime/storage/provider contracts and focused tests during
this batch, may not spawn sub-agents, commit, or push.

Implementation confirmed that session-fenced acknowledgement crosses an
existing contract boundary: direct storage exposes an atomic session check only
for removal, while `markDelivered` is a separate inbox compare-and-swap, and
the remote Inbox RPC carries no shard session. This is a demonstrated atomicity
and serialized-contract blocker. One architecture pass is assigned to the
existing requirements-splitter role as `/root/ack_fencing_design`, explicit
`gpt-5.6-sol` / `high`, without inherited turns. It is read-only, may not spawn
sub-agents, and must identify the smallest Spine-JVM-aligned direct and remote
contract change without inventing an outbox or unrelated recovery mechanism.
The delivery implementer continues the independent accepted corrections while
that decision is prepared.

The architecture pass established that current Spine JVM also performs the
ordinary inbox delivered write separately from shard-session validation. An
atomic fence would require a new Spine-TS-only RPC plus a broader storage
mutation contract. That would be a stronger new protocol rather than JVM parity
and conflicts with the approved no-overengineering scope. The review's race is
recorded as a real pre-existing JVM/TS limitation, but its proposed P1 change is
rejected for this task. No new acknowledgement RPC, outbox, recovery mechanism,
UUID validation, or persisted fencing concept will be introduced.

The two accepted repository reliability findings are returned to
`/root/history_cache_correction`, whose explicit immutable implementer profile
is `gpt-5.6-terra` / `medium`. It is the sole writer for repository runtime and
focused tests during this batch: validate every adjacent version within history
pages and across page/cache boundaries, and trim the least-recent inactive
guard lane even when an older lane is active. It may not spawn sub-agents,
commit, or push.

The complete deterministic preflight exposed two TSDoc regressions after the
runtime and verification refactors: the new standalone-runtime `outputValues`
method lacks a complete contract, and an internal `verify-task` comment uses a
TSDoc opener. Their bounded correction is assigned to
`/root/tsdoc_correction`, existing implementer role, explicit
`gpt-5.6-terra` / `medium`, no inherited turns, and no child dispatch. It is the
sole writer for those two files until `lint:tsdoc` passes and may not commit or
push.

## Final Local Verification — 2026-09-11 23:25 WEST

- The complete cheap preflight passed after all accepted review corrections.
  It covered generated TypeScript, tooling typechecking, full ESLint, cleanup
  and callable-size enforcement, TSDoc, copyright, logging containment,
  formatting, documentation audience and API checks, Buf lint, generated-file
  currency, and release readiness.
- The one permitted converged `pnpm verify:release` run passed: 289 test files
  and 4,706 tests passed with one Vitest worker. Coverage was 93.25% statements,
  90.07% branches, 92.88% functions, and 94.41% lines.
- Release verification packed all 18 public workspace packages and installed
  them together into a clean consumer project. This proves the release set no
  longer omits the five packages missed by the earlier publication workflow.
- `node scripts/release-cli.mjs prepare --check` separately passed for all 18
  public packages at `2.0.0-snapshot.11`.
- `git diff --check` passed, and no `.generated-*` staging directory remains in
  the working tree.
- No new acknowledgement RPC, outbox, crash-recovery mechanism, UUID
  validation, third-party patch, publication batch controller, or per-package
  timeout was introduced.
- The remaining completion gate is CI success for the exact commit pushed from
  this verified working tree.

## Implementation Commit CI — 2026-09-11 23:48 WEST

- Commit `caa3a2ae170b68184000287b66d694cd36a8623c` was pushed to
  `origin/fix-delivery-identity-history-correctness`, and the remote branch was
  verified to resolve to that exact SHA.
- GitHub Actions run `34654036112`, job `103442423422`, completed successfully
  for that commit. Dependency installation, `pnpm verify:release`,
  `node scripts/release-cli.mjs prepare --check`, cleanup steps, and the final
  job step all passed.
- The implementation is durably ready for human review. The final task-record
  commit must now be pushed and pass CI for its own exact SHA before this task
  is closed in chat.

## Completion-Record CI — 2026-09-12 00:11 WEST

- Completion-record commit `db82f6d8c3fdb147a605500cff6e5fa892b9c5f9`
  was pushed, and the remote branch was verified to resolve to that exact SHA.
- GitHub Actions run `34655654113`, job `103447359048`, completed successfully
  for that commit. `pnpm verify:release`, all-18-package
  `node scripts/release-cli.mjs prepare --check`, and the final job step passed.
- Local `HEAD` and the remote branch matched, and the working tree was clean
  after verification.

## Fresh Independent Review — 2026-09-12

- The human reopened the completed branch for one fresh independent review of
  the complete branch diff and required every confirmed finding to be fixed,
  pushed, and verified by green CI for the exact final SHA.
- Fixed review range: `6d64848e0cb998ddfa4374c7c8a67197a9204048...2da5fe3119caaed72872cb661dd160f8f410e9d6`.
- The lightweight pre-review lint checked current status text, historical versus
  active Sigstore claims, prohibited outbox and `AdmitOne` concepts, accidental
  public helper exports, and overclaims in changed public documentation. The
  Sigstore patch references are historical and explicitly superseded by the
  later correction section; no patch file or active patch configuration exists.
- Reviewer assignment: one orchestrator-dispatched independent senior code
  review function, explicit `gpt-5.6-terra` / `high`, with no inherited turns
  and no child dispatch. The reviewer receives the fixed Git range, this task
  record and its Human Requirements Ledger, `BUILD_PROTOCOL.md`,
  `CODE_QUALITY.md`, current tests and documentation, and must inspect both
  requirement/spec alignment and code quality. It is read-only and must report
  precise P0–P3 findings, distinguish branch-introduced defects from unchanged
  baseline debt, and reject speculative features that conflict with the human
  requirements.
- Applicable review workflow skills are `requesting-code-review`, `review`, and
  `receiving-code-review`. Their fixed-range, fresh-context, two-axis, and
  evidence-before-fixing rules apply. The human requested one independent
  reviewer, so the standards and specification axes are combined in that one
  fresh review rather than dispatched to two reviewers.

The reviewer completed under the explicitly dispatched `gpt-5.6-terra` /
`high` profile. The surface did not expose additional runtime self-inspection;
the explicit dispatch fields are the available metadata. It reported one P1
and no other findings. The P1 is confirmed from current code: page-level
deduplication treats every `DELIVERED` row as active evidence, but cleanup
removes rows whose `keepUntil` is at or before the current time. An expired
retained row can therefore cause a newer pending row with the same signal ID
and typed target to be deleted before endpoint dispatch. The shared drain makes
both direct and remote delivery paths vulnerable.

The correction uses `test-driven-development`. One bounded implementation
writer receives the accepted batch: existing implementer role, explicit
`gpt-5.6-terra` / `medium`, no inherited turns, and no child dispatch. It may
change only `packages/server/src/delivery/delivery.ts`, focused direct and
remote delivery regression tests, and strictly necessary nearby test helpers.
It must first demonstrate RED for both paths, then filter page-level duplicate
evidence to delivered rows whose retention has not expired, without changing
the JVM-equivalent recent cache, adding a clock API, or changing wire/storage
contracts. Focused GREEN evidence is required before returning.

Fresh review dispositions before correction: style/maintainability clean;
documentation clean; TypeScript/API clean; security clean;
performance/reliability blocked by the P1; Human Requirements Ledger blocked by
the same P1. The task remains open until the P1 is fixed, affected review is
rechecked, release verification passes, and exact-final-SHA CI is green.

The implementation writer completed under the explicitly dispatched existing
implementer / `gpt-5.6-terra` / `medium` profile. Additional runtime
self-inspection was unavailable; the explicit dispatch fields are the accepted
metadata. Direct and remote regressions both failed before the production edit
because the new pending message was not dispatched: 2 failures and 46 passes.
After the smallest correction, both files passed with 48 tests. The correction
includes a delivered row in page-level duplicate evidence only when it has a
`keepUntil` later than the evaluation time. It does not change the recent
1,000-identity cache, public API, wire format, storage contract, or cleanup
sequence.

Orchestrator verification repeated both focused regression files with one
worker: 48/48 passed. Focused ESLint, `pnpm lint:cleanup`, focused Prettier, and
`git diff --check` also passed. The correction changes only
`packages/server/src/delivery/delivery.ts`, its direct delivery-worker test, and
the remote in-memory-core response-loss test.

Affected resolution review assignment: one fresh independent senior review
function, explicit `gpt-5.6-terra` / `high`, no inherited turns, no memory use,
and no child dispatch. It is read-only and limited to verifying that the P1 is
fully corrected in both paths without a retention-boundary regression,
overengineering, or conflict with the Human Requirements Ledger. The other
clean lanes are not reopened because the correction does not affect their
reviewed surfaces.

The fresh affected resolution review completed under the explicitly dispatched
`gpt-5.6-terra` / `high` profile. Additional runtime self-inspection was not
exposed; the explicit dispatch fields are the accepted metadata. It reported no
P0–P3 findings and marked the original P1 resolved. Past, equal-to-current-time,
and absent retention deadlines do not seed persisted page evidence; a future
deadline still does. Existing retained-duplicate tests preserve active-window
suppression, while the new direct and remote tests preserve expired-row
delivery and cleanup. The separate recent 1,000-identity cache remains
unchanged and intentionally time-independent, matching the accepted JVM
behavior.

Fresh review convergence: style/maintainability clean; documentation clean;
TypeScript/API clean; performance/reliability clean after correction; security
clean; Human Requirements Ledger compliant. The reviewer repeated the two
focused files with 48/48 tests passing and `git diff --check` passing. The task
may proceed to the complete cheap preflight and one release verification run.

The complete cheap preflight passed after one verification-selection
correction. The first source-scoped coverage selection used only the two new
regression files and covered 81.54% of branches in the much larger
`delivery.ts`; no test failed. The corrected complete preflight expanded to the
existing server delivery suite plus the remote regression. Proto generation and
integrity, generated build, tooling typecheck, full ESLint, callable/cleanup and
TSDoc enforcement, copyright, formatting, TypeDoc/API, documentation audience
and snippets, Buf lint, generated-output currency, logging containment,
production dependencies, release readiness, and `git diff --check` all passed.
The expanded coverage run passed 279/279 tests across 17 files with
`delivery.ts` at 96.88% statements, 91.66% branches, 97.22% functions, and
98.41% lines. The branch is ready for its single post-convergence
`verify:release` run.

The single post-convergence `pnpm verify:release` run passed. It completed 289
test files and 4,708 tests with no failures. Overall coverage was 93.25%
statements, 90.07% branches, 92.88% functions, and 94.41% lines; the corrected
`delivery.ts` branch coverage was 94.64%.

The separate `node scripts/release-cli.mjs prepare --check` gate also passed.
It packed all 18 public packages at `2.0.0-snapshot.11` and installed them
together into a temporary consumer project. This was a preparation check only:
it did not publish packages and did not add a publication batch controller or
per-package timeout.

The final task-record commit is the last planned branch change. CI for its exact
SHA is tracked externally so that recording the CI result cannot create another
untested record-only commit. Completion in chat requires that exact SHA to be
present on `origin/fix-delivery-identity-history-correctness`, a clean local
working tree, and a successful GitHub Actions run for the same SHA.

## Declared Rejection Subscription Extension — 2026-09-12

The human reopened this task because a rejection thrown by an `@Assign` handler
is not a supported remote subscription target unless some server-side handler
also consumes that rejection. Current implementation evidence confirms the
problem. Generated handler records describe the accepted message and normal
returns, but not declared thrown rejections. Repository assembly therefore
cannot register those rejection types before `SpineServices` snapshots the
built contexts' subscription routes. Registering the schema only after the
handler throws is too late and makes public subscription support depend on past
runtime activity.

Current Spine JVM `origin/master` is binding. It reads command receptors'
declared Java `throws` types, includes rejection classes in repository outgoing
events, and exposes them to `SubscriptionService` at startup. TypeScript has no
language-level checked `throws` clause, so the accepted TypeScript declaration
is an order-independent `@Throws(...)` method decorator using generated
rejection companions. Authored code, tests, and documentation must always show
the primary decorator first and the declaration immediately below it:

```typescript
@Assign
@Throws(ResourceNameAlreadyUsed)
onRequestResourceCreation(command: RequestResourceCreation): ResourceCreationRequested {
  throw ResourceNameAlreadyUsed.create({});
}
```

The reverse decorator order remains valid and must generate identical metadata.
Generated rejection companions expose their canonical schema while preserving
the existing `.create(...)` call.

The old generated-record terms `signalSchema` and `emittedSchemas` are replaced,
not supplemented. One input and one outcome model describe method semantics:

```typescript
{
  input: { schema: RequestResourceCreationSchema, origin: "domestic" },
  outcomes: {
    returned: [ResourceCreationRequestedSchema],
    thrown: [ResourceNameAlreadyUsedSchema]
  }
}
```

Normal returned messages and thrown rejections remain disjoint because they
have different transaction behavior, but no schema is copied into overlapping
lists. Generated registries are unversioned build artifacts and must be
regenerated directly; no compatibility adapter for the old record shape is
required during snapshot development. Public Command/Event wire envelopes,
stored rejection events, and client redaction do not change.

Behavior-focused acceptance criteria:

1. A client can subscribe to a declared rejection before posting any Command,
   even when no server-side handler consumes that rejection.
2. The thrown typed rejection reaches that active subscription through the
   existing Event update contract.
3. `@Assign` then `@Throws(...)` is the canonical authored order; reversing the
   two is accepted and produces the same record.
4. Only valid generated rejection declarations are accepted, duplicate and
   misplaced declarations fail clearly, and an actual undeclared rejection is
   a technical handler failure rather than a dynamically discovered public
   contract.
5. The rejection is exposed only by the bounded context containing the command
   receptor. Normal returns, rollback behavior, redaction, and existing
   server-side rejection consumers remain valid.
6. No new RPC, storage format, outbox, retry controller, or runtime-history-
   dependent route refresh is introduced.

This is a high-risk public/generated-contract extension. The accepted design
was compared by three independent read-only architecture functions, each
explicitly dispatched with `gpt-5.6-sol` / `high`, no inherited turns, and no
child dispatch. The selected nested input/outcomes model optimizes ordinary
authoring and keeps analyzer, registry, metadata, repository, and subscription
rules behind one in-process seam.

Implementation assignment: the existing implementer role, explicitly
`gpt-5.6-terra` / `medium`, no inherited turns, and no child dispatch. It is the
single production-code writer for rejection generation, decorators, build-time
analysis, generated registry ingestion, handler outcome metadata, repository
registration/runtime enforcement, focused domain-correct fixtures, and narrow
documentation. It must use RED/GREEN cycles, show the accepted decorator order
in authored specimens, preserve order independence, and return without
committing or pushing. The orchestrator will verify, commit, and push before a
fresh no-memory independent review.
