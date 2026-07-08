# T-0017 Review Log

Status: complete

Scope: runtime-gap roadmap, selected implementation sequence, durable process
evidence, and first follow-up task handoff.

## Required Lanes

| Lane                       | Status | Result                                       |
| -------------------------- | ------ | -------------------------------------------- |
| Code style/maintainability | Clean  | Final focused re-review clean.               |
| Documentation completeness | Clean  | Re-review clean.                             |
| TypeScript/API docs        | Clean  | Re-review clean after invariant fixes.       |
| Security                   | Clean  | Re-review clean after native evidence fixes. |
| Performance/reliability    | Clean  | Re-review clean after dependency fixes.      |

## Findings

- TypeScript/API docs: `T-0017b` made `T-0017a` conditional even though query
  execution depends on catch-up-populated read-side data. Fixed by making
  `T-0017a` a hard dependency for `T-0017b`.
- Reliability: `T-0017k` owned production server/runtime environment,
  transport, and server lifecycle without explicit native listener/transport
  smoke verification. Fixed by requiring native smoke evidence, escalation, or
  a recorded blocker naming the denied operation, environment, and missing
  evidence.
- Reliability: `T-0017l` softened native ZeroMQ/local IPC verification instead
  of requiring evidence. Fixed by requiring native or escalated IPC/transport
  evidence, with sandbox denial converted to rerun evidence or a recorded
  blocker.
- TypeScript/API docs: the global invariant said no framework-owned handler
  materialization, but framework/generated-registry ownership is the intended
  path. Fixed by stating no application-owned handler materialization.
- TypeScript/API docs: generated registry contract preservation was implicit
  rather than a top-level invariant. Fixed by adding it alongside the
  Protobuf/generated-code policy.
- Code style/maintainability: work-log participants still said reviewer
  sub-agents were not spawned, and the review table still showed pending
  statuses after the review/fix/re-review loop. Fixed by recording reviewer
  provenance and marking the lanes according to their latest result.
- Final style re-review: focused metadata/provenance reviewer
  `019f4314-08fa-7f70-b934-5ffe2dd16f38` reported clean and was closed.

## Roadmap Review Baseline

- Requirements splitter result recorded no blocking questions.
- `T-0016` is described only as closing verified local/example readiness.
  `T-0017` is described as starting production parity and runtime completeness;
  the roadmap does not claim all framework work is done.
- `T-0017a Read-Side Catch-Up` is recorded as the first non-blocked
  implementation slice.
- `T-0017a` through `T-0017l` are recorded as unnecessary for minimal local
  in-memory to-do app readiness and necessary for production parity/runtime
  completeness.
- `T-0017m` is recorded as the docs/example-positioning closure task.
- Every roadmap slice includes goal, dependency, likely files/modules, JVM
  inspection requirement, acceptance criteria, verification, and
  minimal-todo-vs-production-parity classification.
- The end-user code constraints remain visible: no framework `Event` envelopes,
  manual transactions, `@Apply`, schema-bearing decorators, or app-owned handler
  materialization.
- Generated registry contracts are preserved as a top-level invariant, with
  framework/generated-registry ownership as the intended handler-materialization
  path.
- `T-0017b` has a hard dependency on `T-0017a`.
- `T-0017k` requires native listener/transport smoke verification, escalation,
  or a recorded blocker.
- `T-0017l` requires native or escalated IPC/transport verification evidence;
  sandbox denial must produce rerun evidence or a recorded blocker.
- Server-module roadmap entries require close local Spine JVM docs and
  `core-jvm/server` inspection and call out avoiding over-engineering.

## Verification Commands

- `pnpm format:check` passed after installing worktree dependencies.
- `git diff --check` passed.
- Review-fix rerun: `pnpm format:check` passed with
  `All matched files use Prettier code style!`.
- Review-fix rerun: `git diff --check` passed.

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.
