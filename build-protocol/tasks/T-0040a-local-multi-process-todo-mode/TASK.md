# T-0040a: Local Multi-Process To-Do Mode

Status: In progress - design investigation

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
  last query status/row IDs, and transport background failures. The private
  directory path is replaced with `<ipc-directory>`.
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
  - `examples/todo/src/local-multi-process.test.ts`;
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
