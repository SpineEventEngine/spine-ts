# T-0016h: To-Do Example Final Readiness

Status: in progress
Start: `2026-07-08T16:37:31Z`
Baseline commit: `2966c26`
Branch: `task/T-0016h-todo-final-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0016h-todo-final-readiness`

## Objective

Make the to-do example ready as the first developer-facing Spine TS application
example after the framework-owned assembly and server lifecycle work. This is a
final readiness pass: verify the example uses the simplified framework API,
prove command/query/subscription flows over real gRPC, and make build/run/test
instructions copy-pasteable.

Keep the slice small. Do not add new framework features unless a concrete
example-readiness gap proves the framework is missing a required behavior.

## Requirements

- The example must use bare decorators and framework-owned generated registry
  assembly.
- The example must not import or call handler discovery/materialization,
  `HandlerMetadataRegistry`, `EntityHandlersMetadata`, or `new Repository`.
- The example must not use schema-bearing decorators, `@Apply`, framework
  `Event` returns, manual transactions, internal event ID generation, or
  end-user default-route ID validation.
- The example must start through the framework `Server` lifecycle API and
  expose real `CommandService`, `QueryService`, and `SubscriptionService`
  behavior over Connect/gRPC-compatible HTTP/2.
- The example may use in-memory storage, but docs must say state is process
  local and cleared on restart.
- `examples/todo/README.md` and `examples/todo/USER_GUIDE.md` must contain
  accurate, copy-pasteable build, start, test, command, query, and subscription
  instructions.
- Public framework docs that refer to the example must stay accurate.
- Managed sandbox listener limitations must be documented when tests require
  native loopback approval.
- No generated output may be committed. `examples/todo/generated/**` and
  `examples/todo/dist/**` remain ignored build outputs.

## Spine JVM Inspection

No Spine JVM source inspection is required unless this slice changes framework
server, query, subscription, repository, or handler APIs. If a framework gap is
found, inspect the relevant local JVM notes before changing framework code and
record the source in this task log.

## Likely Files

- `examples/todo/src/index.ts`
- `examples/todo/src/index.test.ts`
- `examples/todo/README.md`
- `examples/todo/USER_GUIDE.md`
- framework and root docs that mention the example, if stale
- cleanup guard or API doc scripts, only if a readiness gap requires them
- this task, work, and review logs

## Acceptance Criteria

- The example source passes a forbidden-pattern audit for ordinary end-user
  code.
- The focused example tests pass, including a real gRPC-compatible server smoke
  test for command, query, and subscription behavior.
- The example can be built and started with documented commands.
- The example guide explains generated output, in-memory storage, local server
  binding, command posting, query reads, subscriptions, and shutdown.
- Cleanup guard and docs checks pass.
- Required review lanes are clean: code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.
- Native `pnpm --config.verify-deps-before-run=false verify` passes, with any
  sandbox-only loopback/IPC limitations recorded.

## Review Plan

After the implementation sub-agent reports completion, run five separate
reviewer sub-agents:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed every finding back to an implementation/fix sub-agent and repeat review
rounds until all lanes are clean. Close every participating sub-agent after its
result is recorded.
