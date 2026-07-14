# T-0040a Review Log

Status: Wave 10 fixes verified - Wave 11 pending

Baseline: `24d1ef37`

Branch: `task/T-0040a-local-multi-process-todo-mode`

## Review Contract

Every review prompt must reference the complete Human-Imposed Requirements
Ledger in the task brief, the final design disposition, the focused mechanical
evidence, and the review package from `24d1ef37` to the current implementation
head. Reviewers must ignore historical superseded text unless the current task
brief, current status records, or changed documentation claims it as active.

Before reviewer dispatch, the coordinator must run the lightweight docs/status
lint and check stale status, duplicated constants, public API leakage, package-
internal imports, generated-file tracking, and documentation claims that
overstate future production policy.

## Planned Concern Dispositions

- Code style/maintainability: relevant. The child-process fixture, ownership,
  test structure, diagnostics, and cleanup code require an independent Terra
  High review.
- Documentation completeness: relevant. Even if no public guide changes, code
  comments, package metadata, and limitation wording must not overclaim the
  local demonstration; use Luna Medium.
- TypeScript/API docs: relevant. Public-package-only composition, exports,
  declarations, package subpaths, and runtime/type agreement require Terra High.
- Performance/reliability: relevant. Readiness races, timeouts, child/socket
  lifecycle, cleanup, bounded work, and failure diagnostics require Terra High.
- Security: deferred by protocol to the final project-wide T-0041 security
  gate; no T-0040a security reviewer is assigned.

## Assignment State

- Requirements splitter: accepted and closed. Agent
  `019f6102-4708-72b0-97a3-7adf27c5e187` was explicitly dispatched as the
  existing immutable `requirements_splitter` role with `gpt-5.6-sol` / high;
  Desktop role metadata confirmed that actual profile.
- Design disposition: no T-0038 child. The child uses public `Server` and
  caller-owned environment/transport composition; the parent sends a generated
  command through public transport request/reply and proves handling through a
  public query against the child's projection.
- Implementation owner: accepted and closed. Agent
  `019f610b-c8d9-7282-a3ec-9a2d2cc3d84b` was explicitly dispatched and
  coordinator-confirmed as the existing immutable `implementer` role with
  `gpt-5.6-terra` / medium; no subagents.
- Reviewer wave 1: complete and closed; findings fixed and coordinator-verified.
- Reviewer waves 1 and 2: complete, fixed, verified, and closed.
- Reviewer waves 3 and 4: complete, fixed, verified, and closed.
- Reviewer wave 5: complete, fixed, verified, and closed.
- Reviewer wave 6: complete, fixed, verified, and closed.
- Reviewer wave 7: complete, fixed, verified, and closed.
- Reviewer wave 8: complete, fixed, verified, and closed.
- Reviewer wave 9: complete and closed; its accepted finding is fixed and
  coordinator-verified.
- Reviewer wave 10: complete and closed; all accepted findings are fixed and
  coordinator-verified. Wave 11 is pending.

## Coordinator Pre-Review Audit - 2026-07-14T14:45:31Z

The coordinator independently ran the new native IPC test (3/3 passing) and
audited the complete assigned diff before creating a review package.

Accepted implementation profile:

- Agent `019f610b-c8d9-7282-a3ec-9a2d2cc3d84b` used the existing immutable
  `implementer` role.
- Explicit dispatch and Desktop role metadata agree on
  `gpt-5.6-terra` / medium. The agent spawned no subagents and was closed after
  handback.

Pre-review findings returned as one batch:

1. Replace the child worker's relative `../dist/src/index.js` import with the
   package's public `@spine-ts/example-todo` self-reference.
2. Make child shutdown attempt and aggregate running-server, environment, and
   transport close failures instead of stopping after the first failure.
3. Bound listener closure, child control send, and the final post-`SIGKILL`
   exit wait with useful phase diagnostics.
4. Preserve partial-setup primary and cleanup failures together; do not ignore
   transport-close failure or let directory removal replace the setup error.
5. Reconcile implementation records with the coordinator-confirmed actual
   immutable Terra Medium profile rather than treating absent shell variables
   as unavailable runtime metadata.

At this historical checkpoint, review dispatch remained blocked until the same
implementation context fixed the batch and the coordinator reran focused
evidence. The resolution is recorded below.

## Pre-Review Findings Resolved - 2026-07-14T14:57:52Z

- The same Terra Medium implementer fixed all five recorded items and was
  closed after handback.
- Coordinator source inspection confirmed public self-reference, independent
  ordered child closes, bounded control/listener/forced-exit waits, compound
  setup cleanup, and corrected immutable runtime metadata.
- Fresh native focused/regression evidence passed: 7 files and 103 tests.
- Example typecheck, focused ESLint, repository format, generated cleanliness,
  diff whitespace, tracked-generated scan, and lightweight docs/status/API
  leakage/policy-claim lint all passed.
- No unresolved coordinator pre-review finding remains. The four specialist
  concerns may now review one committed package.

## Reviewer Wave 1 Assignments

Implementation endpoint: `08f57537`

Review package:
`.superpowers/sdd/review-24d1ef37..08f57537.diff` (79,334 bytes)

Every reviewer is read-only, may inspect source/tests needed to verify the
package, must not edit or mutate Git, and must not spawn subagents. Findings
must identify severity, exact path/line, concrete behavior or requirement at
risk, and the smallest defensible correction. Historical superseded text is
out of scope unless the current task brief, current status logs, or changed
documentation claims it as active.

- Existing `style_maintainability_reviewer`: explicit immutable
  `gpt-5.6-terra` / high. Review the task ledger and package for concrete
  correctness, file ownership, naming, duplicated fixture machinery, test
  quality, public-import discipline, and maintainability. Do not request broad
  refactors or stylistic preference changes.
- Existing `documentation_reviewer`: explicit immutable
  `gpt-5.6-luna` / medium. Review changed records, package metadata, comments,
  observable workflow completeness, status accuracy, and local-only limitation
  wording. Do not review unrelated docs or demand T-0040c content early.
- Existing `typescript_api_docs_reviewer`: explicit immutable
  `gpt-5.6-terra` / high. Review package exports/imports, self-reference,
  dependency placement, generated declarations/contracts, runtime/type
  agreement, accidental public leaks, and whether any public API/TSDoc change
  is actually required.
- Existing `performance_reliability_reviewer`: explicit immutable
  `gpt-5.6-terra` / high. Review process separation, readiness ordering,
  request/query bounds, child/socket/environment ownership, cleanup under every
  failure path, diagnostics, races, retained resources, and missing behavior
  tests. Avoid speculative optimization.

Actual agent IDs and immutable runtime metadata will be recorded from the
Desktop dispatch results before accepting this wave.

## Reviewer Wave 1 Results - 2026-07-14T15:03:38Z

All four reviewers were explicitly dispatched against the same package,
completed without subagents, and were closed promptly. Desktop immutable role
metadata confirmed:

- Style/maintainability: agent
  `019f6124-2303-7ac3-854e-1a94ec57de34`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f6124-1e98-75c3-b50f-1c786cf9c715`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f6124-1a57-7e40-a436-fb949194eb46`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f6124-2751-7581-8024-da5aee95d57b`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

Documentation result: clean. Residual risk is limited to forced termination,
stalled operations, and genuine transport background failures not yet induced;
the accepted finding batch below adds the required timeout/termination proofs.

Accepted and deduplicated findings:

1. **High, public API:** both parent and child pass ZeroMQ
   `onBackgroundFailure`, whose exported option is explicitly `@internal`.
   Remove this optional diagnostic dependency from example code and records;
   the task does not require a new public framework seam, so a T-0038 child is
   not justified.
2. **High, reliability:** shutdown can race `Server.start()`. Add a stop latch
   that suppresses readiness once stopping begins, waits for or rolls back
   startup, and closes any successfully created running server before the
   environment and transport. Prove shutdown during pending startup leaves no
   listener and does not require forced termination.
3. **High, reliability:** the observation wrapper does not cancel an in-flight
   Connect query and can exceed the five-second observation phase. Pass RPC
   `timeoutMs` capped to the remaining observation budget, bound the wrapper to
   the same remainder, and add a controlled stalled-query cleanup proof.
4. **P2, timeout coverage:** add a controlled no-ready/stalled worker case that
   asserts readiness-timeout diagnostics and complete cleanup.
5. **P2, failure budget:** outer Vitest timeouts are below the legal sum of
   readiness, request/observation, shutdown, termination, and listener phases.
   Set explicit budgets above the worst-case phase sum and add a worker mode
   that ignores shutdown and `SIGTERM`, proving `SIGKILL` cleanup removes the
   child and IPC directory within that budget.
6. **P2, duplicated constant:** define the ZeroMQ receive timeout in the parent
   and pass it through the child environment instead of hard-coding `100` on
   both sides.
7. **P3, naming:** rename five-component `awaitChildExitOrTerminate` to a public-
   name-compliant short explicit name such as `stopChild`.

No finding requests a public export, Protobuf/type-URL change, dependency,
README/user-guide work, production policy, or broad fixture refactor. Return
this complete batch to the same implementation context, rerun the affected
native suite, and then generate a fresh package for a full four-concern wave.

## Wave 1 Fix Verification - 2026-07-14T15:20:40Z

- The same immutable Terra Medium implementer fixed all seven accepted
  findings, used no subagents, and was closed after handback.
- Coordinator source inspection confirmed the internal adapter hook is absent,
  startup/shutdown is serialized, query calls receive a remaining-budget
  timeout, all controlled worker modes remain lifecycle-only, receive timeout
  has one parent owner, and the helper is now `stopChild`.
- Fresh native focused/regression evidence passed: 7 files and 107 tests in
  19.48 seconds, including pending startup, stalled query cancellation,
  no-ready timeout, and bounded `SIGKILL` cleanup.
- Example typecheck, focused ESLint, repository format, generated cleanliness,
  diff whitespace, tracked-generated scan, public/internal leak scan, and
  production-policy scan all passed.
- Every Wave 1 finding is resolved. No T-0038 child or public API change is
  required. Commit the fix endpoint and run all four specialist concerns again
  against one fresh package.

## Reviewer Wave 2 Assignments

Fix endpoint: `9cfc6380`

Review package:
`.superpowers/sdd/review-24d1ef37..9cfc6380.diff` (107,338 bytes)

All Wave 2 reviewers are read-only, may inspect affected source/tests, must not
edit or mutate Git, and must not spawn subagents. Use the same bounded concern
assignments and explicit immutable profiles as Wave 1:

- `style_maintainability_reviewer`: `gpt-5.6-terra` / high. Recheck bounded
  fixture structure, timeout tests, constant ownership, naming, and concrete
  maintainability defects.
- `documentation_reviewer`: `gpt-5.6-luna` / medium. Recheck current status,
  evidence, changed comments/records, and local-only limitations without
  demanding T-0040c documentation.
- `typescript_api_docs_reviewer`: `gpt-5.6-terra` / high. Recheck public-only
  imports/options, self-reference, Connect call contracts, dependencies,
  declarations, and accidental API leaks.
- `performance_reliability_reviewer`: `gpt-5.6-terra` / high. Recheck every
  Wave 1 race/bound/cleanup fix, controlled timing proof, process/socket
  ownership, and any new reliability regression.

Every prompt must prioritize current changed behavior, explicitly regression-
check Wave 1, ignore superseded historical text unless current records claim it
active, and report only concrete actionable findings with exact paths/lines.
Actual Wave 2 agent IDs and immutable runtime metadata remain to be recorded
before accepting the wave.

## Reviewer Wave 2 Results - 2026-07-14T15:25:29Z

All four read-only reviewers completed without subagents and were closed.
Explicit dispatch and Desktop immutable role metadata agreed:

- Style/maintainability: agent
  `019f6138-b131-7321-a500-430c2894d31b`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f6138-b523-77c3-a26f-c7f8bd9b8375`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f6138-b866-7c33-841d-91c8736e9b09`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f6138-bc02-77b0-a365-edb8a1a14c43`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

TypeScript/API result: clean. Every Wave 1 public-contract finding is resolved;
no export, declaration, TSDoc, dependency, or Protobuf change is needed.

Accepted and deduplicated Wave 2 findings:

1. **P2, bounded wait:** `waitForPath()` continues polling after the outer
   `within()` timeout because the losing promise is not canceled. Give the path
   wait its own deadline or abort signal, stop its timer/stat loop on expiry,
   and remove the uncancellable outer race. Add a focused timeout assertion if
   needed to prove the helper settles.
2. **P2, timer cleanup:** `settles()` races a promise against `delay()` but
   retains the losing 5-second or 1-second timer after early child exit.
   Implement it with a retained timeout handle and clear that handle in
   `finally`.
3. **P2, bounded work:** an immediately rejected `QueryService.read()` retries
   without delay for the full observation phase. Add a retry delay capped by
   the remaining observation budget and a controlled immediate-error query
   case that proves bounded attempt count plus clean child shutdown.

The Wave 1 race, API, phase-budget, no-ready, query-cancellation, SIGKILL,
constant-ownership, and naming fixes otherwise passed every concern. Return
only this three-item batch to the same Terra Medium implementation context,
rerun native focused evidence, and then run a fresh complete four-concern wave.

## Wave 2 Fix Verification - 2026-07-14T15:37:00Z

- The same immutable Terra Medium implementer fixed the three accepted
  findings without changing the child worker, dependencies, exports, framework,
  or public contracts; no subagents.
- Coordinator source inspection confirmed `waitForPath()` owns and expires its
  deadline, `settles()` clears the losing timer in `finally`, and every
  immediate query failure waits 20 milliseconds capped to the remaining
  observation budget.
- Fresh native focused/regression evidence passed: 7 files and 110 tests in
  24.80 seconds, including the real late-marker deadline, zero-retained-timer
  proof, and bounded immediate-error attempt count with graceful cleanup.
- Example typecheck, focused ESLint, repository format, generated cleanliness,
  diff whitespace, tracked-generated scan, and internal/public boundary scan
  all passed.
- Every Wave 2 finding is resolved. Commit the fix endpoint and run all four
  specialist concerns against one fresh Wave 3 package.

## Reviewer Wave 3 Assignments

Fix endpoint: `18e964c9`

Review package:
`.superpowers/sdd/review-24d1ef37..18e964c9.diff` (124,990 bytes)

Dispatch the same four existing, read-only, no-subagent concerns with explicit
immutable profiles: style/maintainability Terra High, documentation Luna
Medium, TypeScript/API docs Terra High, and performance/reliability Terra High.
Every prompt must regression-check all prior findings and specifically verify:

- the path poll owns and expires its deadline without abandoned work;
- `settles()` clears every losing timer;
- immediate query failures are paced and capped by the remaining observation
  budget;
- the complete public-contract, startup/shutdown, query-cancellation,
  readiness, phase-budget, force-kill, constant, and naming fixes remain clean.

Scope remains the current package and affected paths. Ignore superseded history
unless current status records claim it active. Report only concrete actionable
findings with exact path/line and smallest correction. Actual Wave 3 agent IDs
and immutable runtime metadata remain to be recorded before accepting results.

## Reviewer Wave 3 Results - 2026-07-14T15:43:21Z

All four read-only reviewers completed without subagents and were closed.
Explicit dispatch and Desktop immutable role metadata agreed:

- Style/maintainability: agent
  `019f6147-82fc-7b80-b938-096c8d99608c`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f6147-86b1-7223-b8fc-326416bfd2db`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f6147-8a6a-7bc3-b3af-81ec450bb364`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f6147-8df2-7b70-ac33-2af059393852`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

Documentation and performance/reliability were clean. Every prior timing,
lifecycle, cleanup, and public-contract finding remains resolved.

Adjudicated Wave 3 findings:

1. **Accepted P2, source/test layout:**
   `examples/todo/src/local-multi-process.test.ts` is a newly added production
   test co-located under `src/`, contrary to the active source/test layout in
   `CODE_QUALITY.md`. Move it to
   `examples/todo/test/local-multi-process.test.ts`, extend root Vitest
   discovery to the example `test/` tree, and update only current assignment
   and future evidence paths. Historical commands remain unchanged as factual
   evidence.
2. **Rejected, duplicate transport close:** the API reviewer claimed
   `cleanupFailedFixtureSetup()` invokes both the injected and default close
   callbacks. Current source has exactly one invocation:
   `(options.closeParentTransport ?? closeTransport)(options.parentTransport)`.
   Nullish coalescing selects one callback and does not call the fallback after
   an injected callback throws. The controlled callback deliberately closes
   the transport and then throws to prove cleanup-error aggregation; this is
   not a second helper invocation. No code change is warranted.

Return the one accepted layout correction to the same Terra Medium implementer,
run the moved test and affected regression suite, commit, and repeat all four
review concerns against a fresh package.

## Wave 3 Fix Verification - 2026-07-14T16:54:20Z

- The same immutable Terra Medium implementer moved the test to
  `examples/todo/test/`, extended Vitest and type-aware ESLint discovery, and
  updated current task evidence. No production behavior, worker fixture,
  dependency, public contract, or historical command record changed; no
  subagents.
- Coordinator native regression passed 7 files and all 110 tests in 26.10
  seconds using the moved path. The example and tooling TypeScript projects,
  full lint plus cleanup enforcement, repository format check, staged diff
  whitespace, tracked-generated scan, and rename inspection all passed.
- Git recognizes the move as a 99% rename; the only source deltas are two
  compile-time `NonNullable` casts required once the moved test entered the
  tooling TypeScript project. Runtime fixture behavior is unchanged.
- The accepted Wave 3 finding is resolved. Commit this endpoint and run every
  canonical reviewer concern against one fresh Wave 4 package.

## Reviewer Wave 4 Assignments

Fix endpoint: `005fadb3`

Review package:
`.superpowers/sdd/review-24d1ef37..005fadb3.diff` (138,415 bytes)

The pre-review docs/status lint corrected the stale review header left after
fix verification but missed stale task/work Wave 3 headers; the Wave 4
documentation reviewer caught that gap. The constant, internal-import/public-
leak, generated-tracking, and future-policy scans were clean. Security remains
deferred to T-0041.

Dispatch all four existing, read-only, no-subagent concerns with explicit
immutable profiles:

- `style_maintainability_reviewer`: `gpt-5.6-terra` / high. Recheck the moved
  test layout, fixture readability, naming, typed casts, discovery configuration,
  and all prior concrete maintainability findings.
- `documentation_reviewer`: `gpt-5.6-luna` / medium. Recheck current statuses,
  evidence, comments, limitation wording, and historical-path accuracy without
  demanding T-0040c guide work.
- `typescript_api_docs_reviewer`: `gpt-5.6-terra` / high. Recheck public-only
  imports, dependency placement, generated/runtime type agreement, the moved
  test's state casts, and accidental public or TypeDoc leakage.
- `performance_reliability_reviewer`: `gpt-5.6-terra` / high. Recheck all
  process, socket, timer, deadline, cleanup, retry, and force-termination paths
  after the move and every prior reliability correction.

Scope each concern to the package and affected paths. Ignore historical or
superseded text unless current status records or changed public docs claim it
as active. Findings must be concrete, actionable, line-specific, and include
the smallest defensible correction. Actual IDs and immutable runtime metadata
will be recorded before accepting the complete wave.

## Reviewer Wave 4 Results - 2026-07-14

All four read-only reviewers completed without subagents and were closed.
Explicit dispatch fields and Desktop immutable role metadata agreed:

- Style/maintainability: agent
  `019f6158-daa8-7d80-ba21-50ac274d70ec`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f6159-02f0-73a0-847e-f4d510f4b75b`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f6159-2624-74e2-9692-9bec9f2fddde`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high. The child shell did
  not expose model metadata, but the selected Desktop role's immutable runtime
  profile supplies the required actual metadata.
- Performance/reliability: agent
  `019f6159-4bec-78f2-81a9-d46b04fb552d`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

Accepted and deduplicated findings:

1. **P2, current status:** task and work-log headers still described Wave 3
   after Wave 4 dispatch. Advance all current mirrors with each review stage.
2. **P2, generated optional state:** two `NonNullable` casts erase the generated
   `state?: Any` contract before `unpackAny()`. Narrow absent state explicitly,
   preserve `<unreadable>` diagnostics, and add a focused row-without-state
   assertion so observation does not turn valid incomplete rows into a
   `TypeError`.
3. **P2, duplicated timeout policy:** the worker hard-codes its lifecycle IPC
   send timeout to the same one-second value owned by the parent fixture. Pass
   the parent value through a validated environment variable and use it for
   the worker timer and diagnostic.
4. **P2, post-ready crash diagnosis:** `#throwChildFailure()` always says the
   child exited before readiness, even after a ready message. Select wording
   from current ready state and add a controlled post-ready-exit assertion.

Everything else was clean: moved-test discovery and typed linting, public-only
imports, dependency placement, internal-option removal, path/timer cancellation,
query bounds and pacing, startup/shutdown serialization, cleanup aggregation,
phase budgets, force termination, and local-only documentation scope. Return
this complete batch to the same Terra Medium implementer, verify natively,
commit, and rerun all four concerns.

## Wave 4 Fix Verification - 2026-07-14

- The same immutable Terra Medium implementer resolved all four accepted
  findings with two focused behavior tests and no public/framework/dependency
  change; no subagents.
- Coordinator source inspection confirmed explicit optional-state narrowing,
  one parent-owned control timeout, ready-before-exit ordering in the controlled
  worker, readiness-aware diagnostics, and preserved cleanup ownership.
- Native affected regression passed 7 files and all 112 tests in 25.84 seconds.
  Both no-emit TypeScript checks, full lint and cleanup enforcement, repository
  formatting, diff whitespace, and generated tracking passed.
- The status-lint assignment wording now accurately records its missed headers
  instead of overclaiming a clean mirror check. Every Wave 4 finding is
  resolved. Commit this endpoint and run all four canonical concerns against a
  fresh Wave 5 package.

## Reviewer Wave 5 Assignments

Fix endpoint: `d4998d2c`

Review package:
`.superpowers/sdd/review-24d1ef37..d4998d2c.diff` (155,308 bytes)

The lightweight pre-review pass found aligned Wave 5 status mirrors, no
`NonNullable` or internal-source leak, one parent-owned receive timeout and
control timeout passed to the worker, no generated tracking, and no new public
or future-policy claim. Security remains deferred to T-0041.

Dispatch the same four existing read-only, no-subagent concerns with explicit
immutable profiles: style/maintainability Terra High, documentation Luna
Medium, TypeScript/API docs Terra High, and performance/reliability Terra High.
Each reviewer must regression-check its complete prior finding set, with
particular attention to optional-state narrowing, control-timeout ownership,
before/after-readiness diagnostics, controlled exit ordering, cleanup, and
accurate current statuses. Scope remains the package and affected paths;
historical superseded text is out of scope unless current records claim it as
active. Record only concrete line-specific defects and the smallest correction.
Actual IDs and immutable runtime metadata remain to be recorded.

## Reviewer Wave 5 Results - 2026-07-14

All four read-only reviewers completed without subagents and were closed.
Explicit dispatch and Desktop immutable role metadata agreed:

- Style/maintainability: agent
  `019f6169-724c-7191-bbd5-73d084ccd559`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f6169-91b8-74a3-a1fe-0c9ea23ba8f1`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f6169-ac71-75a3-a53d-00b83c833677`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f6169-d06d-7b51-9212-8cdf9f6c5cfb`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

TypeScript/API docs and performance/reliability were clean. Every prior public-
contract, process-ordering, timeout, cancellation, retry, cleanup, termination,
and diagnostic finding remains resolved.

Accepted and deduplicated findings:

1. **P2, stale current summaries:** the Assignment State still called the Wave
   3 layout correction pending, while the unlabelled work-log Next section still
   directed Wave 3 verification. Advance both to current Wave 5 state. These
   summaries were corrected in the same durable result step.
2. **P2, missing diagnostic-path proof:** the new absent-state test exercises
   `findTaskList()` but not the separate observation-loop branch that emits
   `<unreadable>` row IDs. Feed a controlled state-less query row through
   `readTaskListEventually()` and assert its bounded timeout diagnostic contains
   `<unreadable>`, preserving clean fixture shutdown.

No public docs, API, dependency, framework source, or production policy change
is warranted. Return the remaining test-only finding to the same Terra Medium
implementer, run focused native evidence, commit, and repeat all four concerns.

## Wave 5 Fix Verification - 2026-07-14

- The same immutable Terra Medium implementer replaced the helper-only
  assertion with a controlled public-Connect observation scenario; no
  production, worker, dependency, API, or public-doc change; no subagents.
- Coordinator source inspection confirmed the interceptor first calls the real
  child query listener and then supplies a generated state-less row to the
  existing observation loop. The bounded diagnostic and complete graceful
  cleanup are asserted together.
- Native affected regression passed 7 files and all 112 tests in 30.98 seconds.
  Both TypeScript checks, full lint and cleanup enforcement, formatting, diff
  whitespace, and generated tracking passed.
- Every Wave 5 finding is resolved. Commit and rerun all four canonical
  concerns against a fresh Wave 6 package.

## Reviewer Wave 6 Assignments

Fix endpoint: `798e9229`

Review package:
`.superpowers/sdd/review-24d1ef37..798e9229.diff` (168,679 bytes)

Lightweight pre-review lint found aligned Wave 6 headers and current summaries,
no unsafe optional-state cast, internal-source import, generated tracking, or
future-policy overclaim, and preserved one-source timeout ownership. Security
remains deferred to T-0041.

Dispatch the same four existing read-only, no-subagent concerns with explicit
immutable profiles. Each reviewer must regression-check all prior findings and
specifically verify that the state-less response travels through the real query
call, observation-loop diagnostics, bounded timeout, and graceful cleanup; that
current status summaries remain current; and that no public or production scope
was added. Scope remains the package and affected paths. Ignore historical
superseded text unless a current record claims it active. Report only concrete,
line-specific actionable defects. Actual IDs/profile metadata remain pending.

## Reviewer Wave 6 Results - 2026-07-14

All four read-only reviewers completed without subagents and were closed.
Explicit dispatch and Desktop immutable role metadata agreed:

- Style/maintainability: agent
  `019f6175-ea6a-7b82-9cf7-d2588e17c77e`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f6176-07c5-7861-9669-db6f90ca7b52`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f6176-236a-7ff0-8441-2d7532a686e3`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f6176-432d-7801-9064-a45565da0b2d`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

Accepted and deduplicated findings:

1. **P2, active summaries:** headers still said Wave 6 was awaited and current
   summaries still directed the completed Wave 5 proof. Advance headers,
   Assignment State, and Next when a review assignment is recorded, not after
   reviewers return. Current summaries are corrected in this result step.
2. **P3, callback naming:** rename the void fixture hook
   `afterResourcesAcquired` to `onResourcesAcquired` at its declaration and all
   call sites, matching the binding callback-name rule.
3. **P2, bounded diagnostics:** the observation loop maps and joins every query
   row ID before rendering a diagnostic. Limit inspected IDs, sanitize and cap
   the rendered summary, indicate truncation, and add an over-limit/malformed
   diagnostic proof so repeated failed observations have bounded work and safe
   single-line output.

The real query call, state-less replacement response, bounded observation,
cleanup, optional-state narrowing, public contracts/imports, and prior
reliability findings otherwise passed. Return the two code/test corrections to
the same Terra Medium implementer, verify natively, commit, and rerun every
canonical concern.

## Wave 6 Fix Verification - 2026-07-14

- The same immutable Terra Medium implementer renamed the callback and added
  bounded, sanitized row diagnostics with controlled over-limit coverage; no
  production, worker, dependency, API, or public-doc change; no subagents.
- Coordinator source inspection confirmed four-row inspection, 64-character ID
  caps, deterministic omission markers, single-line/path sanitization, and the
  480-character final bound while retaining the real-query-first behavior.
- Native affected regression passed 7 files and all 112 tests in 30.79 seconds.
  Both TypeScript checks, full lint and cleanup enforcement, formatting, diff
  whitespace, and generated tracking passed.
- Every Wave 6 finding is resolved. Commit and run all four canonical concerns
  in Wave 7, advancing all current summaries before reviewer dispatch.

## Reviewer Wave 7 Assignments

Fix endpoint: `b4a9a3ef`

Review package:
`.superpowers/sdd/review-24d1ef37..b4a9a3ef.diff` (182,906 bytes)

Pre-review lint advanced the task, work, review, Assignment State, and Next
summaries to active Wave 7 state before dispatch. It also found no stale
callback name, unbounded row-diagnostic path, internal/public leak, tracked
generated output, duplicated policy value, or future-policy overclaim.

Dispatch the same four existing read-only, no-subagent concerns with explicit
immutable profiles. Regress all prior findings, especially active status
accuracy, callback naming, row-inspection and rendered-length bounds,
sanitization/truncation proof, real-query-first behavior, and complete cleanup.
Scope remains the package and affected paths. Historical superseded text is
out of scope unless current records claim it active. Report only concrete,
line-specific defects with the smallest correction. Actual IDs/profile metadata
and complete disposition remain pending.

## Reviewer Wave 7 Results - 2026-07-14

All four read-only reviewers completed without subagents and were closed.
Explicit dispatch and Desktop immutable role metadata agreed:

- Style/maintainability: agent
  `019f6184-aaae-7753-9858-67275bb63d8b`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f6184-cf78-71c2-a27e-9eda3064b90b`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f6184-ef09-7da0-ab8e-e2b528c2797a`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f6185-1fe8-7c52-9ff0-04a08e8fc53a`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

Documentation was clean, including every current status summary and historical
path. Accepted and deduplicated findings:

1. **P3, semantic-name length:** rename five-component
   `maxDiagnosticRowIdLength` to `maxDiagnosticIdLength`.
2. **P3, callback naming:** rename function-valued options
   `closeParentTransport` and `removeIpcDirectory` to
   `onCloseParentTransport` and `onRemoveIpcDirectory` at declarations and all
   uses.
3. **P2, bounded lookup:** the query requests all projection rows and
   `findTaskList()` maps the complete response on every retry. Use the existing
   public `TargetFiltersSchema.idFilter` pattern for the deterministic task-list
   ID, assert the query filter, and scan without allocating a full mapped array.

All other TypeScript/API, diagnostic rendering, sanitization, timing, process,
query-interceptor, cleanup, and termination checks were clean. Return this
complete batch to the same Terra Medium implementer, verify natively, commit,
and repeat every canonical concern.

## Wave 7 Fix Verification - 2026-07-14

- The same immutable Terra Medium implementer added the deterministic public ID
  filter and non-allocating lookup, completed callback naming, and shortened
  the diagnostic constant; no production, worker, dependency, public API, or
  docs change; no subagents.
- Coordinator inspection confirmed the generated filter contract, exact
  focused assertion, real-query-first interceptor, early-return scan, and clean
  callback/name searches.
- Native affected regression passed 7 files and all 113 tests in 30.77 seconds.
  Both TypeScript checks, full lint and cleanup enforcement, formatting, diff
  whitespace, and generated tracking passed.
- Every Wave 7 finding is resolved. Commit and run all four canonical concerns
  in Wave 8 with current summaries advanced before dispatch.

## Reviewer Wave 8 Assignments

Fix endpoint: `2c11401c`

Review package:
`.superpowers/sdd/review-24d1ef37..2c11401c.diff` (195,797 bytes)

Pre-review lint advanced all active summaries before dispatch and found no
stale callback/name, include-all query, full-array lookup, unbounded diagnostic,
internal/public leak, tracked generated output, duplicated policy value, or
future-policy overclaim.

Dispatch the same four existing read-only, no-subagent concerns with explicit
immutable profiles. Regress every prior finding, especially active status
accuracy, exact generated ID filter, non-allocating lookup, all `on*` callback
names, bounded diagnostics, real-query-first behavior, and cleanup. Scope
remains the package and affected paths. Ignore superseded history unless a
current record claims it active. Report only concrete line-specific defects.
Actual IDs/profile metadata and complete disposition remain pending.

## Reviewer Wave 8 Results - 2026-07-14

All four read-only reviewers completed without subagents and were closed.
Explicit dispatch and Desktop immutable role metadata agreed:

- Style/maintainability: agent
  `019f6192-5d3d-7f60-85bd-e1eb9d0e1ebc`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f6192-8fe0-7822-9367-ab0609b6f6c4`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f6192-af18-7742-b582-6b0cfaf2e7ae`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f6192-cf21-70f0-b2a9-3eac43e2dee4`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

Style/maintainability and TypeScript/API docs were clean. Accepted findings:

1. **P2, active assignment scope:** the initial assignment still prohibited all
   build-configuration changes despite the accepted Wave 3 discovery additions
   to `vitest.config.ts` and `tsconfig.eslint.json`. Amend the active ownership
   ledger to allow exactly those entries and no other build configuration. The
   task brief is corrected in this result step.
2. **P2, readiness deadline:** `#eventually()` always sleeps 10 milliseconds,
   even when less remains. Cap each delay to remaining time and extend the
   no-ready proof with lower/upper elapsed bounds around the five-second phase.
3. **P2, absence verification:** `isAbsent()` treats every `stat()` rejection as
   absence. Return true only for `ENOENT`; surface other operational errors so
   cleanup aggregates them without losing a primary failure. Add a controlled
   non-`ENOENT` cleanup-verification test.

The exact ID filter, early-return lookup, diagnostics, real-query-first path,
retry pacing, timers, startup ordering, termination, callback naming, and public
contracts otherwise remain clean. Return the two code/test fixes to the same
Terra Medium implementer, verify natively, commit, and repeat every concern.

## Wave 8 Fix Verification - 2026-07-14

- The same immutable Terra Medium implementer capped readiness polling and
  added ENOENT-specific absence verification plus controlled cleanup-error
  aggregation; no production, worker, dependency, API, docs, or build-config
  change; no subagents.
- Coordinator inspection confirmed remaining-time delay ownership, readiness
  timing assertions, tri-state close behavior, non-ENOENT propagation, primary-
  failure ordering, and actual uninjected directory absence.
- Native affected regression passed 7 files and all 114 tests in 30.67 seconds.
  Both TypeScript checks, full lint and cleanup enforcement, formatting, diff
  whitespace, and generated tracking passed.
- Every Wave 8 finding is resolved. Commit and run all four canonical concerns
  in Wave 9 with current summaries advanced before dispatch.

## Reviewer Wave 9 Assignments

Fix endpoint: `e6f4a058`

Review package:
`.superpowers/sdd/review-24d1ef37..e6f4a058.diff` (211,970 bytes)

Pre-review lint advanced every active summary before dispatch and found no
stale assignment scope, readiness overrun, broad absence result, cleanup-error
loss, callback/name issue, unbounded query/diagnostic path, internal/public leak,
tracked generated output, duplicated policy, or future-policy overclaim.

Dispatch the same four existing read-only, no-subagent concerns with explicit
immutable profiles. Regress every prior finding, especially remaining-deadline
polling, ENOENT-only absence, non-ENOENT cleanup aggregation with primary error,
active statuses, exact ID filter, bounded diagnostics, and process/resource
cleanup. Scope remains the package and affected paths; superseded history is
out of scope unless current records claim it active. Report only concrete
line-specific defects. Actual IDs/profile metadata and disposition remain
pending.

## Reviewer Wave 9 Results - 2026-07-14

All four read-only reviewers completed without subagents and were closed.
Explicit dispatch and Desktop immutable role metadata agreed:

- Style/maintainability: agent
  `019f61a5-9152-74a0-8934-a10aa8e4329f`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: agent `019f61a5-c20a-7b71-b447-c35b2d42b1ce`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f61a5-e03f-79d1-84e7-2c79d463a4ea`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f61a5-fc5b-7d41-b4f6-aab890cf00b1`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

Documentation, TypeScript/API docs, and performance/reliability were clean.
Accepted one finding:

1. **P2, path-poll errors:** `waitForPath()` maps every `stat()` rejection to
   “not present.” Reuse the ENOENT-only absence contract, rethrow other
   operational errors immediately, and add a focused injected non-ENOENT path
   poll test so actionable filesystem failures do not become readiness
   timeouts.

All active records, assignment scope, cleanup verification/aggregation,
readiness timing, ID-filtered query, bounded diagnostics, process lifecycle,
public contracts, and prior findings otherwise remain clean. Return this single
fix to the same Terra Medium implementer, verify, commit, and rerun every
canonical concern.

## Reviewer Wave 9 Fix Verification - 2026-07-14

- The coordinator inspected the full fix and confirmed ENOENT-only path
  polling, unchanged non-ENOENT error propagation, retained deadline ownership,
  and a focused controlled proof of immediate actionable failure.
- Fresh native affected regression passed seven files and all 115 tests in
  31.52 seconds. Both TypeScript checks, full lint and cleanup enforcement,
  formatting, and `git diff --check` passed.
- Wave 9 is fully fixed and verified. Wave 10 must rerun all four canonical
  concerns against a new literal-endpoint package after the fix commit.

## Reviewer Wave 10 Assignments - 2026-07-14

Fix endpoint: `6eb4aa57`

Review package:
`.superpowers/sdd/review-24d1ef37..6eb4aa57.diff` (224,361 bytes)

Pre-review lint found current status mirrors, bounded shared timeout/policy
owners, no package-internal import or public export, no tracked generated
output, and no production-policy overclaim. The parent test's `packCommand()`
is the accepted public transport stimulus, not an end-user handler.

Dispatch these independent read-only, no-subagent assignments:

- Existing `style_maintainability_reviewer`, expected immutable
  `gpt-5.6-terra` / high.
- Existing `documentation_reviewer`, expected immutable `gpt-5.6-luna` /
  medium.
- Existing `typescript_api_docs_reviewer`, expected immutable
  `gpt-5.6-terra` / high.
- Existing `performance_reliability_reviewer`, expected immutable
  `gpt-5.6-terra` / high.

Scope every lane to the package, affected example paths, complete requirements
ledger, and its distinct concern. Regress every accepted prior finding,
especially ENOENT-only path polling and cleanup verification, bounded deadline
delays, exact query ID filters, bounded diagnostics, real-query-first behavior,
process cleanup, active status accuracy, and public/internal boundaries.
Historical superseded text is out of scope unless a current task record or
changed public document claims it as active. Report only concrete line-specific
defects.

Explicit dispatch fields and immutable Desktop role metadata agree:

- Style/maintainability: agent
  `019f61b5-23a7-73e0-b079-7bbab2d9aad4`, existing
  `style_maintainability_reviewer`, actual `gpt-5.6-terra` / high.
- Documentation: agent `019f61b5-47a6-7261-a75c-a4ff8c4e0d11`, existing
  `documentation_reviewer`, actual `gpt-5.6-luna` / medium.
- TypeScript/API docs: agent `019f61b5-6f5d-7ce0-a011-5878ff6780e7`, existing
  `typescript_api_docs_reviewer`, actual `gpt-5.6-terra` / high.
- Performance/reliability: agent
  `019f61b5-9654-7e20-8c87-2c9a2ead2d04`, existing
  `performance_reliability_reviewer`, actual `gpt-5.6-terra` / high.

Complete results and closure remain pending; do not return a partial wave to
implementation.

## Reviewer Wave 10 Results - 2026-07-14

Every read-only reviewer completed without subagents and was closed. Explicit
dispatch and immutable Desktop role metadata agreed:

- Style/maintainability: `019f61b5-23a7-73e0-b079-7bbab2d9aad4`, existing
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high.
- Documentation: `019f61b5-47a6-7261-a75c-a4ff8c4e0d11`, existing
  `documentation_reviewer`, `gpt-5.6-luna` / medium.
- TypeScript/API docs: `019f61b5-6f5d-7ce0-a011-5878ff6780e7`, existing
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high.
- Performance/reliability: `019f61b5-9654-7e20-8c87-2c9a2ead2d04`, existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.

Accepted complete finding batch:

1. **P2, setup absence verification:** partial-setup cleanup removes the IPC
   directory but does not run the active ENOENT-only absence check or report
   retained entries. Pass the existing stat seam, verify absence after removal,
   aggregate operational/non-absent errors, and prove a retained-directory
   setup failure.
2. **P2, stale assignment metadata:** the work log says reviewer IDs/runtime
   metadata will be recorded only after closure even though the review log
   already records them. Reconcile the current statement.
3. **P2, expected-skills path:** the task's skill-applicability record names
   nonexistent `build-protocol/EXPECTED_SKILLS.md`; use
   `build-protocol/skills/EXPECTED_SKILLS.md`.
4. **P3, callback names:** rename callback parameters `predicate`, `next`, and
   `operation` to `onPredicate`, `onNext`, and `onOperation` under the active
   cleanup-era callback rule.

No other documentation, API, public export, type/runtime, query, deadline,
diagnostic, or lifecycle finding remains. Return the entire batch to existing
immutable implementer `019f610b-c8d9-7282-a3ec-9a2d2cc3d84b`, actual
`gpt-5.6-terra` / medium, no subagents or Git mutation. Wave 11 remains required.

## Reviewer Wave 10 Fix Verification - 2026-07-14

- The coordinator confirmed the full batch: ENOENT-only setup absence
  verification with retained-entry diagnostics and ordered aggregation, all
  three callback renames, the corrected expected-skills path, and reconciled
  assignment metadata wording.
- Fresh native affected regression passed seven files and all 116 tests in
  31.88 seconds. Both TypeScript checks, full lint and cleanup enforcement,
  formatting, focused stale scans, and `git diff --check` passed.
- Wave 10 is fully fixed and verified. Wave 11 must rerun every canonical
  concern against a new literal-endpoint package after the fix commit.
