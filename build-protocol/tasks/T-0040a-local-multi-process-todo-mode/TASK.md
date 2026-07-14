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
