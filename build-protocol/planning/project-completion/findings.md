# Project Completion Planning Findings

## Current Frontier

- Root `main` is at `40329cad` and has only the user-owned
  `human-review-1-jul.md` untracked.
- T-0037a is integrated and post-merge verified.
- Root task records mark T-0037b through T-0037f as candidates because their
  active progress lives outside `main`.
- The active T-0037b worktree is safely stopped after committed Round 5 reviewer
  skill checks; substantive Round 5 review has not started.

## Research Notes

- The authoritative completion surface is spread across `TECHNICAL_SPEC.md`,
  `RUNTIME_ARCHITECTURE.md`, `DEVELOPER_API.md`, `TODO_EXAMPLE_SPEC.md`, quality
  and build protocol documents, decisions D-0085/D-0086, and the T-0037 child
  task records.
- The root task-status inventory contains many historical statuses that are not
  reliable indicators of remaining project work. Integrated `main`, current
  parent roadmaps, accepted decisions, and active worktree status must take
  precedence over stale child headers.
- `questions/UNRESOLVED.md` currently has no blocking or non-blocking product
  questions. The completion plan can therefore be deterministic rather than
  branching on human decisions.
- Security is a final release-readiness gate rather than a per-task reviewer
  lane. Per-task review uses style, documentation, TypeScript/API docs, and
  performance/reliability.
- The remaining accepted environment-delivery roadmap is D-0086's child chain:
  T-0037b, T-0037c, T-0037d, T-0037e1, T-0037e2, T-0037e3, and T-0037f. The
  T-0037e parent is superseded and must not be implemented.
- Final acceptance is broader than passing tests: coverage must remain at least
  90%, package READMEs and both framework/example `USER_GUIDE.md` files must be
  current, TypeDoc must generate, architecture notes must match reality, every
  reviewer lane must be clean, and all subagents/worktrees must be closed.
- The to-do example is a release gate. It must use real command, query,
  subscription, validation, asynchronous delivery, generated registry, gRPC,
  and local multi-process behavior rather than framework internals or mocks.
- End-user audit rules are explicit and automatable: no framework envelopes,
  schema-bearing decorators, `@Apply`, manual transactions, internal event-ID
  construction, default-route ID extraction, or app-owned handler
  materialization in examples/docs.
- The initial compatibility target is behavioral and Protobuf-level, including
  acknowledgement, asynchronous handling, rejection, query/subscription,
  lifecycle, validation, type URLs, and message shapes. Distributed multi-host
  transport remains out of scope.
- D-0086 fixes the runtime order after T-0037b as T-0037c, T-0037d, T-0037e1,
  T-0037e2, T-0037e3, and T-0037f. Each child has exclusive lifecycle ownership
  and depends on its predecessor; the former T-0037e is only a superseded audit
  parent.
- T-0037f is the runtime integration boundary: startup recovery settles before
  listener intake, while network intake stops before registration detach,
  delivery quiescence, and endpoint/facility teardown.
- The accepted lifecycle excludes retry timing/backoff, public monitor/health/
  action APIs, process supervision, transport topology/adapters, CATCH_UP
  delivery, and legacy IMPORT_EVENT support. These are not release blockers.
- The repository already contains the required framework and example guide
  surfaces: root/package READMEs, `docs/USER_GUIDE.md`, architecture/API docs,
  and `examples/todo/{README,USER_GUIDE}.md`. Completion work should audit and
  reconcile these files rather than invent a parallel documentation tree.
- The to-do example currently has one source module and one test module plus
  generated handler-registry output. Its release-gate behavior therefore needs
  a deliberate black-box acceptance task, not an assumption based on file
  presence.
- Root `pnpm verify` includes typecheck, lint/cleanup rules, formatting, all
  tests, coverage, TypeDoc/API checks, Protobuf lint, and generated-cleanliness.
  It is the correct final gate but too broad for inner review/fix loops.
- Git still lists several historical task branches as not merged by ancestry,
  plus preserved worktrees with review-package scratch files or older dirty
  state. Their task records are complete/integrated and their accepted behavior
  is already present on `main`; they are archival cleanup debt, not product
  roadmap dependencies. Only T-0037b is an active unmerged product task.
- Generated and compiled to-do files are present locally but intentionally
  ignored. Planning and release checks must verify reproducibility and Git
  cleanliness, never commit those artifacts.
- The to-do example already proves a real loopback gRPC command/query/
  subscription flow, generated registry loading, validation/refusal, and
  projection delivery. Its docs explicitly describe per-process isolated
  in-memory state, while `TODO_EXAMPLE_SPEC.md` requires a local multi-process
  bus demonstration when available. This is a concrete remaining example slice.
- `T000` and `T001` still have bootstrap-era `In progress`/`Candidate` headers
  whose factual premises predate repository initialization. They are stale
  durable-status debt and belong in final status reconciliation, not runtime
  implementation.
- The completion sequence is now fixed as: close T-0037b; implement the six
  remaining D-0086 children; run one accepted-capability audit; reconcile
  canonical docs, package/API docs, and the framework guide in separate small
  slices; close the example's multi-process, black-box, and guide gates; perform
  one final security gate; then run release/project closure.
- Post-T-0037 audit findings use constrained routing instead of roadmap growth:
  docs to T-0039, example gaps to T-0040, security to T-0041, and only mandatory
  framework defects to tiny T-0038 children.
