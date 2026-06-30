# T-0009f.1: Context Spec And Builder Shell

Status: Setup; Baseline Verification Passed; Implementation Pending
Start: `2026-06-30 05:31 WEST`
Parent task: `T-0009f Repository Seams And Bounded-Context Registration Skeleton`
Baseline commit: `78b3be1`
Task log path: `build-protocol/tasks/T-0009f1-context-builder-shell/TASK.md`
Branch: `task/T-0009f1-context-builder-shell`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009f1-context-builder-shell`
Authoring sub-agent: pending
Reviewer sub-agents: pending

## Objective

Add the first bounded-context API shell for `@spine-ts/server`: immutable context
name value, tenant mode value, `BoundedContext.singleTenant(name)`,
`BoundedContext.multitenant(name)`, builder shell, name validation, and
immutable built context snapshot.

## Required JVM Shape

Task-relevant JVM/docs evidence:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, builder surface,
  bounded context name, context spec, tenant mode, and build-sequence sections;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ContextSpec.java`;
- `/private/tmp/spine-research/core-jvm/core/src/main/java/io/spine/core/BoundedContextNameMixin.java`
  when available.

Implementation impact: preserve JVM-familiar builder entry points and name
validation, but keep system context, buses, stand, tenant index, storage
factories, and service registration out of this subtask.

## Scope

- `packages/server/src/bounded-context.ts`
- `packages/server/src/bounded-context.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs` if public exports are added
- Minimal public docs as needed
- Parent T-0009f logs

## Out Of Scope

- Repository registration.
- Handler invocation.
- Command/event routing.
- Inbox/delivery writes.
- Storage opening or storage factory selection.
- Query stand execution or subscription updates.
- System context construction.
- Server/gRPC services.
- ZeroMQ or transport integration.
- Tenant index persistence.

## Skill Applicability

The implementer must perform the canonical skill applicability check from
`BUILD_PROTOCOL.md` and record it in this task/report/work log before or in the
same atomic step as implementation.

## Required Tests

- Bounded context names reject empty/blank names and accept valid names.
- `singleTenant()` and `multitenant()` produce builders with the expected tenant
  mode.
- `build()` returns an immutable/copy-safe context snapshot.
- Builder mutation after build does not mutate the already-built context.
- No APIs imply runtime dispatch, storage, stand, gRPC, or transport execution.

## Verification

- Baseline verification passed on `2026-06-30 05:34 WEST`: `CI=true corepack
pnpm verify` passed with 15 test files / 160 tests, coverage 97.25%
  statements / 91.41% branches / 99.16% functions / 97.19% lines, TypeDoc/API
  checks with 100 proto / 28 core / 72 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.
  Repeat verification after recording this evidence remains pending before the
  setup commit.

## Human Questions And Answers

- None.
