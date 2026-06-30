# T-0010.4: Command Registration Readiness

Status: Review Fix Verified
Parent task: `T-0010 Single-Process Async Runtime`
Start: `2026-06-30 17:24 WEST`
Baseline commit: `e5e7b1d`
Task log path:
`build-protocol/tasks/T-0010-4-command-registration-readiness/TASK.md`
Branch: `task/T-0010-4-command-registration-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-4-command-registration-readiness`
Authoring sub-agent: Codex implementation sub-agent.
Reviewer sub-agents: none spawned per handoff.

## Objective

Expose a small command registration readiness surface over existing handler
metadata so later command service/runtime intake can know which command message
types have exactly one effective assignee in a bounded context. This subtask
must reuse `HandlerMetadataRegistry` duplicate-assignment validation and must
not implement a command bus, command service, dispatch, routing, storage,
handler invocation, or `Ack`.

## Required JVM Shape

Setup inspected task-relevant Spine JVM `core-jvm/server` code before selecting
scope:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandDispatcherRegistry.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandDispatcher.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/command/AbstractAssignee.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/command/model/DuplicateHandlerCheck.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/CommandService.java`;
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`;
- existing TS `packages/server/src/handler-metadata.ts`;
- existing TS `packages/server/src/bounded-context.ts`;
- existing TS `packages/server/src/index.ts`, `packages/server/README.md`, and
  `docs/api/README.md`.

Observed JVM shape:

- `CommandDispatcher.messageClasses()` exposes command classes handled by a
  dispatcher.
- `CommandDispatcherRegistry` is unicast and rejects registration if any
  command class already has a dispatcher.
- `AbstractAssignee.messageClasses()` derives handled command classes from the
  assignee model metadata.
- `DuplicateHandlerCheck` verifies duplicate command-handling methods across
  model classes.
- `CommandService.Builder` builds service routing from each context's
  `registeredCommandClasses()`, and no-context posting becomes an unsupported
  command acknowledgement.

T-0010.4 should preserve that shape as metadata/readiness only. It should
produce deterministic lists/lookups of command types and assignee metadata from
the already registered TS handler metadata. It should not add Java-style global
model state, bus registration, command delivery, route calculation, command
validation, services, or `Ack`.

## Acceptance Criteria

- Add a small public TypeScript API for command registration readiness.
- Build readiness from `HandlerMetadataRegistryLookup` or existing
  `EntityHandlersMetadata` without instantiating entities or invoking handlers.
- Report registered command message full type names in deterministic order.
- Expose lookup for the unique command assignee metadata for a command type.
- Preserve duplicate command assignment enforcement through
  `HandlerMetadataRegistry`; do not add a second divergent duplicate policy.
- Freeze/copy returned readiness values so caller mutation cannot affect later
  lookups.
- Unit tests cover empty registry, deterministic registered command list,
  unique assignee lookup, duplicate assignment failure through the registry,
  immutability/copy safety, and absence of bus/service/dispatch members.
- README and TypeDoc/API docs describe the seam and its exclusions.
- All five required review lanes complete cleanly, and all participating
  sub-agents are closed.

## Out Of Scope

- `CommandBus`, `EventBus`, `ImportBus`, `CommandService`, `Ack`, command
  posting, unsupported-command `Ack` mapping, routing by first command field,
  custom routes, dispatch, handler invocation, validation, storage, delivery
  inbox, tenant validation, system context, integration broker, ZeroMQ, worker
  processes, and repository runtime registration.

## Tooling And Dependencies

No new dependencies are selected for this subtask. Use existing TypeScript,
Vitest, TypeDoc, and current server package tests.

## Verification

- Worktree dependency setup on `2026-06-30 17:27 WEST`: the first sandboxed
  `corepack pnpm install --frozen-lockfile` hit npm registry DNS failures while
  checking/fetching dependency packages; the same frozen install was rerun with
  network escalation and completed from the existing pnpm store with 194 reused
  packages, 0 downloads, and no lockfile changes.
- Setup baseline verification passed on `2026-06-30 17:27 WEST`: `CI=true
corepack pnpm verify` passed with 19 test files / 234 tests, coverage 96.21%
  statements / 90.38% branches / 99.16% functions / 96.14% lines, TypeDoc/API
  checks with 100 proto / 28 core / 116 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.
- TDD RED on `2026-06-30 17:34 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts` failed as
  expected because `CommandRegistrationReadiness` was undefined before
  production code existed.
- Focused GREEN on `2026-06-30 17:37 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts` passed 1 file /
  6 tests, and `corepack pnpm test packages/server/src/index.test.ts` passed 1
  file / 9 tests after export wiring.
- Typecheck on `2026-06-30 17:37 WEST`: `corepack pnpm typecheck` passed.
- Full verification on `2026-06-30 17:38 WEST`: `CI=true corepack pnpm verify`
  passed with 20 test files / 240 tests, coverage 96.26% statements / 90.44%
  branches / 99.18% functions / 96.20% lines, TypeDoc/API checks with 100
  proto / 28 core / 119 server / 26 storage expected exports, proto
  lint/generate checksum verification, and generated proto output clean.
- Review-fix RED on `2026-06-30 17:48 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts` failed as
  expected with 3 focused regressions: default-locale sorting differed from
  code-unit command name order, returned nested handler metadata preserved the
  original handler object identity, and nested assignee metadata was not frozen.
- Review-fix GREEN on `2026-06-30 17:51 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts` passed 1 file /
  8 tests after replacing `localeCompare()` with code-unit comparison and
  cloning/freezing returned nested handler, entity-handler, and registered
  handler metadata.
- Review-fix typecheck on `2026-06-30 17:51 WEST`: `corepack pnpm typecheck`
  passed.
- Review-fix full verification on `2026-06-30 17:54 WEST`: `CI=true corepack
pnpm verify` passed with 20 test files / 242 tests, coverage 95.94%
  statements / 90.38% branches / 98.15% functions / 95.87% lines, TypeDoc/API
  checks with 100 proto / 28 core / 119 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.

## Review Fixes

- Addressed Important/reliability and Minor/maintainability sorting feedback:
  command message full type names now use locale-independent code-unit
  comparison, with punctuation/case/underscore/digit regression coverage.
- Addressed Important/reliability copy-safety feedback: readiness lookups now
  return fresh frozen copies of nested handler, entity-handler, registered
  handler, and shallow entity metadata so caller mutation of returned assignee
  metadata cannot affect later lookups.

## Human Questions And Answers

- None.
