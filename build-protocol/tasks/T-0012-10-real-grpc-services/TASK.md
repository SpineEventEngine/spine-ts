# T-0012.10: Real gRPC Services

Status: all review lanes clean
Branch: `task/T-0012-10-real-grpc-services`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-10-real-grpc-services`
Baseline commit: `caec16a`

## Objective

Expose the first real public gRPC service slice for the framework:

- `CommandService.Post`;
- `QueryService.Read`;
- `SubscriptionService.Subscribe`, `Activate`, and `Cancel`.

The services must preserve Spine JVM protobuf contracts and stay thin adapters
over the existing command bus and direct `Stand`. This task must not introduce a
client DSL, example app code, broad service facade, or simulated transport.

## Required Scope

- Copy any missing required Spine JVM `.proto` files for these services into
  this repository's proto source tree without rewriting message definitions.
- Generate TypeScript with the existing Buf / Protobuf-ES workflow. Generated
  output remains under package `generated` folders and out of VCS.
- Choose and record the real Node service runtime/tooling needed for these
  gRPC contracts. The dependency decision belongs in `DECISION_LOG.md`.
- Implement server-side service adapters in semantic `packages/server/src`
  folders and mirrored tests under `packages/server/test`.
- Keep transport-specific APIs out of domain/runtime classes.
- Route write-side command posting through the existing `CommandBus`.
- Route read-side query and subscription behavior through the context-owned
  `Stand`.
- Keep subscription identifiers opaque and require explicit activation and
  cancellation.
- Preserve tenant isolation and strict read-side/write-side segregation.
- Update public docs, TypeDoc/API docs, durable task logs, and package exports
  for any new public API.

## Explicitly Out Of Scope

- No to-do example app implementation.
- No client query/subscription DSL.
- No custom protocol that merely simulates gRPC.
- No broad `Server` facade unless the JVM evidence and the small service slice
  require it.
- No worker-thread Stand implementation, projection catch-up engine, scheduler,
  import bus, system context runtime, or production storage implementation.
- No new standalone helper functions unless a concrete caller becomes clearer
  with them.

## JVM Evidence

- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md` defines
  the public service contracts: `CommandService.Post(Command) -> Ack`,
  `QueryService.Read(Query) -> Response`, and the three-step subscription
  service flow.
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` says the server
  exposes bounded contexts over gRPC and routes command, query, and subscription
  services to context-owned buses and stands.
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` preserves the
  separation between write-side command/event dispatch and read-side
  query/subscription handling.
- The human explicitly required that server-module code be compared closely
  with Spine JVM `core-jvm` server code and kept small.

## Current TS Evidence

- `BoundedContext` exposes an owned direct `stand()`.
- `CommandBus` posts commands asynchronously and now exposes accepted command
  message type URLs so services can route without dispatch-probing contexts.
- `Stand` can register known state types, update/read latest states, preserve
  caller-supplied versions for versioned reads, and keep in-process
  subscriptions with explicit cleanup.
- Connect v2 is the selected real Node gRPC-compatible service runtime; see
  `D-0056` in `build-protocol/DECISION_LOG.md`.

## Acceptance Criteria

- The required Spine JVM service protobuf contracts are present and generated.
- Service adapters use a real gRPC-compatible Node runtime, not an in-process
  fake.
- Command posting returns immediate acknowledgement semantics at the protobuf
  contract level.
- Query reads return protobuf `Response` values backed by `Stand` state.
- Subscriptions return opaque IDs, require activation, stream updates after
  activation, and release resources on cancel.
- Unsupported or unpublished command/query/subscription cases are represented
  through the Spine protobuf contract rather than ad-hoc TypeScript error
  trees.
- Public APIs remain small, JVM-familiar, and documented.
- All required review lanes pass with no comments.
- Parent verification after integration keeps branch coverage at or above 90%.

## Verification Plan

- Focused service tests that prove real service invocation, command posting,
  query reads, subscription activation, updates, cancel, tenant isolation, and
  unsupported-type behavior.
- `pnpm typecheck`.
- `pnpm lint`.
- changed-file Prettier check or full `pnpm format:check`.
- `pnpm test`; escalate only for known local loopback/ZeroMQ sandbox failures.
- `pnpm test:coverage`; escalate only for known local loopback/ZeroMQ sandbox
  failures.
- `pnpm docs:check`.
- `pnpm proto:lint`, `pnpm proto:generate`, and
  `pnpm proto:check-generated`.
- `git diff --check`.

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current State

Implementation and review round 1 through round 3 fixes are verified. Round 4
verified the final documentation, TypeScript/API docs, and security fixes. All
required review lanes are clean through commit `dfd1140`. No blocking human
question is known.
