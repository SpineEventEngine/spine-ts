# T-0040a: Local Multi-Process To-Do Mode

Status: In progress - reviewer Wave 4 fixes verified; awaiting Wave 5

Started: `2026-07-14T14:20:28Z`

Baseline commit: `24d1ef37`

Branch: `task/T-0040a-local-multi-process-todo-mode`

Worktree: `.worktrees/T-0040a-local-multi-process-todo-mode`

Dependency: T-0039c complete, merged, post-merge verified, remotely
synchronized, and cleaned up.

## Objective

Demonstrate real same-host multi-process bus behavior in the to-do example by
using the existing public runtime composition and ZeroMQ transport adapter.

## Human-Imposed Requirements Ledger

- Continue autonomously until project completion or a real protocol blocker.
- Keep this slice limited to the local multi-process demonstration and its
  durable records. T-0040b owns the complete black-box acceptance suite, and
  T-0040c owns example documentation closure.
- Preserve accepted DDD, Spine Protobuf/type-URL, public API, generated-output,
  review, logging, verification, worktree, remote-push, and cleanup rules.
- Use the existing transport abstraction and ZeroMQ adapter. Do not introduce a
  second transport or a new dependency when existing Node and workspace APIs
  suffice.
- Committed example application code must use public package imports and must
  never import `packages/**/src` internals. If a mandatory public framework
  seam is missing, stop example edits and create one tiny T-0038 framework
  child before resuming this task.
- Spawn a real Node child process and route at least one generated to-do signal
  over real local IPC so another process handles it. An in-process mock, fake
  transport, or parent-only handler does not satisfy the requirement.
- Allocate a private temporary IPC directory and deterministic logical IDs.
  Establish readiness before work is sent, bound every wait with useful
  diagnostics, and deterministically close sockets, child processes, temporary
  files, servers, contexts, and environments on success and failure.
- Keep the demonstration explicitly local-only and single-host. Do not claim
  production discovery, topology, authentication, supervision, restart,
  health, or remote-host support.
- Ordinary application handlers remain free of framework `Command`/`Event`
  envelopes, `packCommand()`/`packEvent()`, schema-bearing decorators,
  aggregate `@Apply`, manual transactions, internal IDs/default-target
  extraction, handler materializers, and internal lifecycle APIs.
- Use behavior-focused TDD. Record the failing RED command and expected failure
  before production implementation, then the GREEN and regression evidence.
- Use focused checks in inner loops and reserve full `pnpm verify` for the final
  task and post-merge gates.
- Dispatch every child with an explicit existing role, model, and reasoning;
  record actual immutable runtime metadata before accepting child work; do not
  allow child subagents.
- Run the relevant existing review concerns and record a concrete clean or N/A
  disposition for all four. Per-task security review remains deferred to
  T-0041.
- After acceptance, push the completed task branch and verified `main` to
  `origin`, record remote refs, and remove only the clean merged worktree.
- Never read, edit, stage, delete, or use `human-review-1-jul.md`.

## Acceptance Criteria

- A purpose-specific example worker entry point or fixture runs in a real Node
  child process.
- Parent and child compose only supported public runtime and transport APIs.
- A private temporary IPC directory and deterministic logical context/route
  identifiers isolate the run.
- A readiness handshake completes before the parent sends the generated to-do
  payload.
- At least one generated to-do command or event traverses the real ZeroMQ-backed
  bus transport and is observably handled in the other process.
- The focused test proves process separation, transport routing, and handling;
  it cannot pass through an in-process fallback.
- Success, setup failure, timeout, child failure, and assertion failure paths
  have bounded waits, actionable diagnostics, and deterministic cleanup.
- No package-internal source import, accidental public export, duplicate
  transport constant, generated-file tracking, or future production-policy
  claim is introduced.
- The native child-process/IPC test, affected transport/runtime regressions,
  example typecheck/build, lint/format/diff, generated-clean check, and every
  relevant review concern are clean before the final gate.

## Scope

- Expected write scope: a focused `examples/todo` worker/fixture and test,
  minimal example package/build metadata if required, and these T-0040a
  records.
- Public framework source is excluded unless the design investigation proves a
  mandatory public seam missing. Such a finding triggers a separate tiny
  T-0038 child instead of broadening this branch silently.
- Exclude example README/user-guide closure, full black-box acceptance
  consolidation, production process supervision, remote networking,
  authentication, discovery, deployment topology, dependencies, Protobuf
  contract changes, and unrelated refactors.

## Risk Assumptions

- ZeroMQ IPC and child-process tests require native execution because the
  managed sandbox blocks local IPC/listener operations.
- Readiness must describe actual receiving capacity, not merely child process
  creation; otherwise the first signal can race subscription or responder
  setup.
- Cross-process cleanup failures can mask the original failure. Teardown must
  preserve useful primary diagnostics while still attempting every owned
  resource cleanup.
- The public runtime may expose a sufficient `ContextTransport` or signal-
  transport composition already. The investigation must prove the smallest
  supported path before any example implementation is accepted.

## Planning Trigger And Assignment

This task crosses a process boundary and must establish public runtime,
transport, concurrency, readiness, and cleanup semantics. It therefore meets
the protocol's architecture/public-composition trigger for the existing
requirements-splitter role.

- Existing role: requirements splitter.
- Explicit immutable profile: `gpt-5.6-sol` / high.
- Scope: read-only inspection of the current public server/transport exports,
  existing cross-process transport tests, to-do example, and canonical task
  requirements.
- Required output: the smallest public parent/child composition, exact file
  ownership, RED/GREEN sequence, readiness and cleanup design, bounded timeout
  diagnostics, and a clear determination whether a mandatory public seam is
  missing.
- Constraints: no edits, Git mutation, commits, pushes, or subagents; no new
  dependency proposal unless existing APIs demonstrably cannot satisfy the
  task.
- Acceptance gate: dispatch must explicitly carry the role, model, and
  reasoning, and actual runtime metadata must confirm the immutable profile.

## Accepted Design

The requirements-splitter result was accepted at `2026-07-14T14:31:40Z`.
No mandatory public framework seam is missing, so no T-0038 child is warranted.

- The child starts the existing to-do context through the public `Server` and
  caller-owned `ServerEnvironment.local({ transport })` composition. Server
  startup opens context transport responders before it opens the HTTP/2
  listener and resolves.
- The parent creates a second public ZeroMQ transport over the same private IPC
  directory and deterministic adapter identity. It packs one generated
  `CreateTask` command and sends it through `SignalTransport.request()` on a
  public `createTransportTopic()` command topic.
- Node process IPC is lifecycle-only: `ready`, `failure`, `shutdown`, and
  `stopped`. It must never carry a handled observation or the to-do payload.
- Readiness is sent only after the child `Server.start()` resolves and includes
  the child PID plus listener address. The test verifies the ready PID matches
  the forked child and differs from the parent.
- Successful request/reply proves transport intake, not business handling. The
  parent therefore uses only the public `QueryService` client to poll the
  child's projection until the exact deterministic task appears. It does not
  instantiate `CommandService` or provide an in-process handler fallback.
- `RuntimeTransportBinding` and `createRoutingPlan()` remain public framework
  building blocks but are unnecessary for this example. Internal
  `ContextTransport` and `createContextRoutingPlan()` must not be imported or
  newly exported.
- Phase bounds: 2 seconds for transport request/reply, 5 seconds for readiness,
  5 seconds for eventual query observation, 1 second for control sends,
  5 seconds for graceful shutdown/exit, then 1 second for `SIGTERM` before
  `SIGKILL` as a last-resort cleanup.
- Diagnostics retain phase, child exit code/signal, capped sanitized stderr,
  and last query status/row IDs. The private directory path is replaced with
  `<ipc-directory>`.
- Cleanup preserves a primary failure while attempting every acquired resource
  in deterministic ownership order: parent transport; child shutdown and
  bounded exit/termination; listener-closed check; retained IPC entry report;
  recursive directory removal and absence check. The child closes its running
  server, caller-owned environment, and supplied transport, and also handles
  parent disconnect and `SIGTERM`.

The accepted implementation is one bounded command slice. Event transport,
remote/multi-host operation, production topology/authentication/supervision,
restart/health policy, durable transport retry, exactly-once behavior, example
documentation closure, and full black-box consolidation remain excluded.

## Requirements-Splitter Handback

- Agent: `019f6102-4708-72b0-97a3-7adf27c5e187` (existing
  `requirements_splitter` role).
- Dispatch fields were explicit: `gpt-5.6-sol` / high.
- The Desktop role metadata declares this immutable role as
  `gpt-5.6-sol` / high; this is the actual execution-surface profile accepted by
  the orchestrator. The child correctly did not treat absent shell environment
  variables as runtime metadata.
- The child worked read-only, spawned no subagents, and was closed immediately
  after its complete result was collected.
- Skills/manifests checked included the session inventory,
  `EXPECTED_SKILLS.md`, the lockfile, `codebase-design`,
  `epic-breakdown-advisor`, `architecture-patterns`,
  `nodejs-backend-patterns`, `javascript-testing-patterns`, and
  `test-driven-development`. A companion workshop skill referenced by the epic
  skill was absent and non-blocking for this repository-grounded split.

## Implementation Assignment

- Existing role: implementer.
- Explicit immutable profile: `gpt-5.6-terra` / medium.
- One writer owns:
  - `examples/todo/test/local-multi-process.test.ts`;
  - `examples/todo/test-fixtures/local-multi-process-worker.mjs`;
  - `examples/todo/package.json` and the corresponding `pnpm-lock.yaml`
    importer entry;
  - this task brief and `build-protocol/work-logs/T-0040a.md` for TDD and
    implementation evidence.
- The review log remains coordinator/reviewer-owned. Do not modify example
  domain source, public exports, server/transport source, Protobuf contracts,
  README/user guide, build configuration, or generated output.
- TDD order: add dependency plumbing and the end-to-end test first; run RED
  while the worker is absent and confirm child failure before readiness; add
  the minimal worker; run GREEN; then add bounded startup/primary-failure
  cleanup coverage and refactor only while green.
- Native focused proof must cover readiness, accepted transport intake, exact
  eventual projected state, process separation, and deterministic cleanup.
  Record every RED/GREEN command and result in the work log.
- No Git mutation, commits, pushes, or subagents. Report changed paths, exact
  public imports, behavior evidence, cleanup/failure coverage, focused command
  results, remaining uncertainty, skills used, and actual immutable runtime
  profile.

## Implementation Evidence

### RED - 2026-07-14

- Added the direct `@spine-ts/transport` workspace development dependency and
  the parent end-to-end test before creating the worker fixture.
- Native command: `pnpm exec vitest run examples/todo/src/local-multi-process.test.ts`.
- Result: expected failure. Two scenarios attempting the normal worker failed
  before readiness because Node could not resolve
  `examples/todo/test-fixtures/local-multi-process-worker.mjs`; the child exit
  state was code `1`, signal `null`. The dedicated early-exit scenario passed.
- An initial RED invocation first revealed a test-only wrong generated import;
  it was corrected to the existing public `filters_pb.js` export before the
  recorded RED run. The final RED failure is therefore the required absent
  worker lifecycle failure, not a malformed test import.
- Native dependency refresh used `pnpm install --offline --frozen-lockfile`;
  it changed no lockfile resolution and installed the added workspace link.

### GREEN - 2026-07-14

- Added `examples/todo/test-fixtures/local-multi-process-worker.mjs`. It imports
  only public packages, composes `createTodoContext()` with public `Server` and
  caller-owned `ServerEnvironment.local({ transport, ownsTransport: false })`,
  and explicitly closes the running server, environment, and transport.
- Parent composition is public `createZeroMqAdapterConfig()`,
  `createZeroMqTransport()`, `createTransportTopic()`, generated `CreateTask`
  plus `packCommand()`, then generated `QueryService` over public Connect Node
  transport. The child-process control channel contains only `ready`,
  `failure`, `shutdown`, and `stopped` lifecycle messages; it carries neither
  the signal payload nor a handling observation.
- Native command: `pnpm exec vitest run examples/todo/src/local-multi-process.test.ts`.
- Result: 1 file and 3 tests passed. The proof asserts child PID separation,
  request/reply intake, and exact eventual `TaskList` state queried from the
  child listener. The focused failure cases prove early-exit diagnostics and
  cleanup after an injected assertion-path failure.
- During GREEN, the initial private directory prefix exceeded the macOS local
  socket pathname limit. The directory prefix was shortened to `stmp-`; the
  directory remains mode `0700` and the adapter/logical identifiers remain
  deterministic. A cleanup result-field mismatch was corrected before the
  final passing run.

### Focused Validation - 2026-07-14

- `pnpm exec tsc --noEmit -p examples/todo/tsconfig.json` completed with exit
  `0`.
- `pnpm exec vitest run examples/todo/src/index.test.ts` passed: 1 file, 20
  tests.
- `pnpm exec vitest run packages/server/test/server/server-context-transport-cross-process.test.ts packages/server/test/server/server-context-transport-lifecycle.test.ts packages/server/test/server/server-lifecycle-integration.test.ts packages/transport/test/zeromq/signal-transport.test.ts packages/transport/test/zeromq/local-ipc-smoke.test.ts`
  passed: 5 files, 78 tests.
- The final `pnpm exec vitest run examples/todo/src/local-multi-process.test.ts`
  passed: 1 file, 3 tests. `pnpm proto:check-generated` reported freshly
  generated ignored output. Focused ESLint, repository format check, and
  `git diff --check` were clean.
- The changed paths are exactly the assigned test, worker fixture, todo package
  importer metadata, lockfile importer entry, task brief, and work log. The
  implementation deliberately makes no production supervision, restart,
  topology, authentication, remote-host, or exactly-once claim.
- Coordinator-confirmed actual immutable runtime metadata identifies the
  existing `implementer` role as `gpt-5.6-terra` / medium. No subagents were
  dispatched.

### Coordinator Pre-Review Fix Wave - 2026-07-14

- RED command: `pnpm --config.verify-deps-before-run=false exec vitest run
examples/todo/src/local-multi-process.test.ts`. Result: 5 tests ran; 3 passed
  and the 2 new failure-path scenarios failed because child close injection and
  partial-setup injection were not yet implemented.
- The worker now imports `createTodoContext()` through the public package
  self-reference `@spine-ts/example-todo`. The real Node child success and
  failure-path scenarios prove that Node resolves the package export in the
  forked process.
- Worker shutdown attempts running server, environment, and supplied transport
  closes independently in that deterministic order. It aggregates sanitized
  failures, reports one lifecycle failure, and still attempts `stopped` before
  disconnecting.
- Parent control sends and listener-closure connects have explicit one-second
  bounds. Graceful exit remains five seconds, `SIGTERM` remains one second, and
  the final post-`SIGKILL` exit wait is now explicitly bounded to one second
  with phase diagnostics before cleanup continues.
- Partial fixture setup tracks the child immediately, attempts parent transport
  close, bounded child shutdown/termination, and directory removal in order,
  then preserves the primary setup failure followed by every cleanup failure.
- GREEN command: `pnpm --config.verify-deps-before-run=false exec vitest run
examples/todo/src/local-multi-process.test.ts`. Result: 1 file and 5 tests
  passed. The directly affected example, server lifecycle/cross-process, and
  ZeroMQ regression wave passed 6 files and 98 tests.

### Reviewer Wave 1 Fixes - 2026-07-14

- Removed the internal-only ZeroMQ diagnostic option from both parent and
  worker composition and from active implementation claims. No public API or
  T-0038 child was added.
- Added a worker stop latch around the startup promise. Controlled pending
  startup marks the private directory only for test synchronization; shutdown
  releases the transport registration gate, suppresses `ready`, awaits startup,
  and then closes running server, environment, and transport in order.
- Every `QueryService.read()` uses public Connect call options with `timeoutMs`
  capped to the smaller of the two-second request limit and remaining
  five-second observation budget. The wrapper uses the same bound, stalled
  calls are canceled, and diagnostics retain the last query status.
- Controlled no-ready and shutdown/SIGTERM-resistant worker modes prove the
  readiness timeout and deterministic `SIGKILL` fallback. All tests use one
  25-second outer budget, above the legal 21-second stacked phase maximum.
- The parent owns the single `receiveTimeoutMs` constant and passes its decimal
  value to the worker, which validates it before transport creation.
- Renamed the child-stop helper to `stopChild`.
- RED command: `pnpm --config.verify-deps-before-run=false exec vitest run
examples/todo/src/local-multi-process.test.ts`; 5 existing tests passed and 4
  new tests failed for the intended missing modes.
- Post-refactor GREEN command: the same native command passed 1 file and 9
  tests in 18.86s. Its final post-format rerun passed 1 file and 9 tests in
  19.32s.
- The directly affected native regression command covered this fixture, the
  existing to-do example, three server lifecycle/cross-process files, and two
  ZeroMQ transport files; all 7 files and 107 tests passed in 19.46s.
- Example typecheck, focused ESLint, generated-output cleanliness, formatting,
  diff whitespace, and public/internal source scans passed. Full `pnpm verify`
  and reviewer wave 2 remain coordinator gates.
- Actual immutable implementation metadata remains existing role `implementer`,
  model `gpt-5.6-terra`, reasoning `medium`; no subagents.

### Reviewer Wave 2 Fixes - 2026-07-14

- `waitForPath()` now owns its phase deadline, caps each polling delay to the
  remaining budget, and rejects without an outer `within()` race. A controlled
  late-marker test proves the helper settles before work arriving after its
  deadline.
- `settles()` retains its timeout handle and clears it in `finally`. A focused
  fake-timer test proves an early child-exit result leaves zero timers.
- Immediate `QueryService.read()` failures now wait 20 milliseconds before
  retrying, capped to the remaining five-second observation budget. The
  controlled interceptor produced 218,832 attempts before the fix; GREEN
  enforces more than one and at most 251 attempts, the full observation timeout,
  and graceful child/listener/IPC cleanup.
- Native focused suite passed 1 file and 12 tests in 24.22s; its final
  post-format rerun passed all 12 tests in 24.39s. The directly affected native
  regression wave passed 7 files and 110 tests in 24.81s.
- No worker mode, dependency, export, documentation surface, public API, or
  framework source changed. Actual immutable implementation metadata remains
  existing role `implementer`, model `gpt-5.6-terra`, reasoning `medium`; no
  subagents.

### Reviewer Wave 3 Layout Correction - 2026-07-14

- Moved the integration test unchanged from `examples/todo/src/` to
  `examples/todo/test/`, matching the active source/test layout rule. Its
  generated imports and worker fixture URL remain correct because both target
  sibling directories under the example root.
- Added `examples/*/test/**/*.test.ts` to root Vitest discovery while retaining
  the historical `examples/*/src/**/*.test.ts` pattern. Added the corresponding
  `examples/*/test/**/*.ts` type-aware ESLint project include so the moved test
  remains lintable without disabling repository rules.
- Discovery RED: after the move and before the Vitest include change, `pnpm
--config.verify-deps-before-run=false exec vitest list
examples/todo/test/local-multi-process.test.ts` listed zero tests. Discovery
  GREEN listed all 12 moved tests and all 20 historical `src` tests.
- Native moved-path proof passed 1 file and 12 tests in 24.25 seconds. The
  seven-file affected regression passed all 110 tests in 25.11 seconds.
- Production behavior, worker fixture, dependencies, public contracts, and
  historical evidence paths did not change. Actual immutable implementation
  metadata remains existing role `implementer`, model `gpt-5.6-terra`,
  reasoning `medium`; no subagents.

### Reviewer Wave 4 Fixes - 2026-07-14

- Generated query rows now explicitly narrow an absent optional `state` before
  unpacking. `findTaskList()` skips absent state and returns `undefined`; row
  diagnostics retain `<unreadable>`. A focused generated `QueryResponse` row
  without state proves the lookup is handled without throwing.
- The parent remains the sole owner of the one-second `controlTimeoutMs`
  policy. It passes the decimal value through
  `SPINE_TODO_MULTI_PROCESS_CONTROL_TIMEOUT_MS`; the worker validates it with
  `positiveIntegerEnvironment()` and uses that value for its lifecycle-send
  timer and diagnostic. No second timeout literal remains in the worker.
- The controlled `exit-after-ready` worker mode sends `ready`, then exits with
  code 23 without `stopped`. Parent failure diagnostics now select `before
readiness` or `after readiness` from observed lifecycle state. The existing
  pre-ready proof remains green, and the new proof verifies the post-ready
  wording plus listener and IPC-directory cleanup without forced termination.
- Optional-state RED command: `pnpm
--config.verify-deps-before-run=false exec vitest run
examples/todo/test/local-multi-process.test.ts -t "handles a query row without
state as unreadable"`; 1 test failed and 12 were skipped because unpacking an
  absent state attempted to read `typeUrl`. The same command passed 1 test with
  12 skipped after explicit narrowing.
- Post-ready RED command: `pnpm
--config.verify-deps-before-run=false exec vitest run
examples/todo/test/local-multi-process.test.ts -t "reports a child exit after
readiness"`; 1 test failed and 13 were skipped because the unchanged worker
  rejected the mode and the parent reported an exit before readiness. The same
  command passed 1 test with 13 skipped after the worker and diagnostic fix.
- Native focused GREEN passed 1 file and 14 tests in 25.07 seconds. The native
  post-format rerun passed all 14 tests in 27.56 seconds. The native seven-file
  affected regression passed all 112 tests in 26.41 seconds.
- Both TypeScript no-emit checks, focused ESLint, cleanup enforcement,
  generated-output cleanliness, timeout-ownership scan, and public/internal
  boundary scan passed. Formatting and diff-whitespace checks are recorded in
  the work log after final evidence formatting.
- Actual immutable implementation metadata remains existing role
  `implementer`, model `gpt-5.6-terra`, reasoning `medium`. No subagents were
  dispatched and no Git mutation was performed.

## Skill Applicability

- Inventories checked: `build-protocol/EXPECTED_SKILLS.md`, installed skill
  manifests under `/Users/armiol/.agents/skills`, and
  `/Users/armiol/.agents/.skill-lock.json`.
- Read for coordination/design: `using-git-worktrees`,
  `subagent-driven-development`, `architecture-patterns`,
  `nodejs-backend-patterns`, and `javascript-testing-patterns`.
- Required for implementation/review closure: `test-driven-development`,
  `requesting-code-review`, `receiving-code-review`, and
  `verification-before-completion`.
- No library-search skill is needed at task start because the task requires the
  existing ZeroMQ adapter and Node child-process APIs. Reassess only if the
  investigation proves an unavoidable dependency gap.
