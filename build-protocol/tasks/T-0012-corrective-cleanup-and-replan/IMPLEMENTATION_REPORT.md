# Implementation Report: T-0012 Corrective Cleanup And Roadmap Reset

Status: T-0012.7 integrated; T-0012.7b selected
Branch: `task/T-0012-cleanup-replan`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-cleanup-replan`
Baseline commit: `a9769d4`

## Setup Summary

- The user rejected the existing implementation direction as over-engineered.
- The old `T-0012` command-execution work is abandoned.
- The repository has no local `master` ref; `main` is the available trunk and
  was used as the reset base.
- The first corrective commit records binding policy before code cleanup.

## Planned Process

The requirements-splitting sub-agent inspected the current TypeScript layout,
the negative `bounded-context.ts` example, the local Spine JVM research notes,
and task-relevant JVM source. The splitter produced a staged corrective roadmap
and selected the first implementable cleanup subtask.

`T-0012.1 Cleanup Enforcement Baseline` is integrated on this parent branch.
`T-0012.2 Source Folder Repack` is integrated on this parent branch.
`T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions` is integrated on
this parent branch. `T-0012.4 Storage Factory And Record Storage Reset` is
integrated on this parent branch. `T-0012.5 CommandBus, EventBus, And Handler
Registration` is integrated on this parent branch. The next selected subtask is
`T-0012.6 BoundedContext Assembly`.

`T-0012.4` replaced the broad `StorageAdapter` surface with a JVM-like
`StorageFactory` / `RecordStorage` seam, added declarative `RecordSpec` and
`RecordColumn`, implemented multitenant in-memory record storage, added a
storage-only `EventStore` delegate, updated public docs and API checks, passed
all review lanes, and passed escalated `env CI=true corepack pnpm verify`.
Parent verification after integrating `T-0012.4` passed with escalated
`env CI=true corepack pnpm verify`: 32 test files, 294 tests, coverage
statements 95.64%, branches 90.44%, functions 98.31%, lines 95.64%, docs/API
checks with the existing invalid-`origin` TypeDoc warning only, proto
lint/generate, and generated-clean comparison.

`T-0012.5` added small JVM-familiar `CommandBus` and `EventBus` seams,
dispatcher registries, event store-before-dispatch, and focused bus tests. It
removed the public dispatch bypass during review so public intake is only
queued `post()`, switched dispatcher schema contracts to `MessageSchema`, and
documented no-dispatch and dispatcher-failure event semantics. All required
review lanes are clean. Final escalated `env CI=true corepack pnpm verify`
passed with 35 test files, 302 tests, coverage statements 95.61%, branches
90.08%, functions 98.37%, lines 95.60%, docs/API checks with the existing
invalid-`origin` TypeDoc warning only, proto lint/generate, and generated-clean
comparison.

Parent verification after integrating `T-0012.5` passed with escalated
`env CI=true corepack pnpm verify`: 35 test files, 302 tests, coverage
statements 95.61%, branches 90.08%, functions 98.37%, lines 95.60%, docs/API
checks with the existing invalid-`origin` TypeDoc warning only, proto
lint/generate, and generated-clean comparison.

`T-0012.6` replaced the metadata-only bounded-context shell with a small
JVM-familiar assembly surface. `BoundedContextBuilder` collects command/event
dispatchers and a `StorageFactory`, `build()` creates a `BoundedContext` owning
`CommandBus` and `EventBus`, and built contexts expose post-only command/event
endpoints. Repository registration remains a chainable pending seam for
`T-0012.7`; delivery, Stand, gRPC, transport execution, scheduler, import bus,
tenant index, and system context runtime remain deferred. All required review
lanes are clean. Final escalated `env CI=true corepack pnpm verify` passed
with 35 test files, 276 tests, coverage statements 95.45%, branches 90.37%,
functions 96.81%, lines 95.44%, docs/API checks with the existing
invalid-`origin` TypeDoc warning only, proto lint/generate, and generated-clean
comparison.

`T-0012.3` removed bounded-context runtime/detail exports, simplified
repository diagnostics to code/message, removed transport lifecycle/delivery
helper families, preserved the core transport abstraction, passed all review
lanes, and passed escalated `env CI=true corepack pnpm verify`.
Parent verification after integrating `T-0012.3` passed with escalated
`env CI=true corepack pnpm verify`: 28 test files, 291 tests, coverage
statements 96.5%, branches 91.22%, functions 99.31%, lines 96.44%, docs/API
checks with the existing invalid-`origin` TypeDoc warning only, proto
lint/generate, and generated-clean comparison.
Parent verification after integrating `T-0012.2` passed with escalated
`env CI=true corepack pnpm verify`: 28 test files, 307 tests, coverage
statements 96.12%, branches 90.53%, functions 99.38%, lines 96.07%, docs/API
checks with the existing invalid-`origin` TypeDoc warning only, proto
lint/generate, and generated-clean comparison.

## T-0012.1 Integration

The integrated subtask:

- removes tracked generated Protobuf-ES output from `packages/proto/src`;
- regenerates ignored output under `packages/proto/generated`;
- moves package tests under `packages/<package>/test`;
- adds cleanup enforcement for generated-code location, co-located tests,
  semantic name component limits, callback naming, line length, and flat `src`
  growth;
- records clean five-lane review results, including focused documentation
  re-review;
- passes escalated `env CI=true corepack pnpm verify`.

Parent verification after integrating `T-0012.1` passed with escalated
`env CI=true corepack pnpm verify`: 28 test files, 307 tests, coverage
statements 96.12%, branches 90.53%, functions 99.38%, lines 96.07%, docs/API
checks with the existing invalid-`origin` TypeDoc warning only, proto
lint/generate, and generated-clean comparison.

## Skill Applicability Summary

Selected skills:

- `epic-breakdown-advisor`: used to split the reset epic into autonomous
  subtasks. The task already supplied the human answers, so the interaction
  protocol was applied non-interactively.
- `architecture-decision-records`: used to check whether a new architectural
  decision was needed. No new decision was added because `D-0047` already
  captures the reset and corrected implementation order.
- `codebase-design`: used to evaluate which current modules are shallow,
  premature, or exposing seams before real variation exists.

Advisory only:

- TypeScript/code-quality skills were considered for later implementers but not
  applied as implementation guidance in this docs-only split.

Evidence sources:

- `build-protocol/skills/EXPECTED_SKILLS.md`;
- `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`;
- `/Users/armiol/.agents/.skill-lock.json`;
- selected skill files under `/Users/armiol/.agents/skills`.

## Current-Code Findings

- Tracked generated files remain under `packages/proto/src/generated/**`.
- Package tests are co-located under `packages/<package>/src`, rather than
  `packages/<package>/test`.
- `packages/server/src` is flat and contains many root-level files instead of
  semantic folders.
- `bounded-context.ts` contains the named reset defects: long exported detail
  hierarchies, snapshot-centered public contracts, and runtime lifecycle
  concepts before storage and buses are implemented.
- `packages/storage/src/index.ts` exposes a broad adapter surface where JVM
  source points to a smaller `StorageFactory`/`RecordStorage` seam.
- Transport delivery/retry types are ahead of the corrected roadmap and should
  be removed or quarantined before delivery is rebuilt.

## JVM Evidence Summary

Inspected notes and source confirm:

- Storage comes first and should center on `StorageFactory` plus
  `RecordStorage`.
- Event store is framework code built over record storage and is needed before
  `EventBus` dispatch.
- `CommandBus` is unicast; `EventBus` is multicast and stores events before
  dispatch.
- `BoundedContextBuilder` assembles contexts only after storage, buses, stand,
  tenant index, delivery, and registration concepts exist.
- Repositories own storage, routing, lifecycle, context registration, and later
  dispatch; they should not remain metadata snapshots.
- `Inbox`/`Delivery` are durable sharded delivery concepts, separate from
  transport retry helpers.
- `Stand` owns read-side query/subscription behavior. gRPC services are thin
  adapters and must wait for real buses and stand behavior.

## Corrective Roadmap Summary

1. `T-0012.1 Cleanup Enforcement Baseline`: enforce generated-code, test
   layout, naming, callback, and line-length rules.
2. `T-0012.2 Source Folder Repack`: reorganize source/test folders by package
   semantics.
3. `T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions`: remove
   command-execution-first concepts and long detail hierarchies.
4. `T-0012.4 Storage Factory And Record Storage Reset`: rebuild storage on the
   JVM-like mandatory seam and add event store.
5. `T-0012.5 CommandBus, EventBus, And Handler Registration`.
6. `T-0012.6 BoundedContext Assembly`.
7. `T-0012.7 Repository Registration And Storage Opening`.
8. `T-0012.7b Aggregate Storage And Signal Routing`.
9. `T-0012.8 Delivery And Inbox`.
10. `T-0012.9 Stand And Entity Updates`.
11. `T-0012.10 Real gRPC Services`.
12. `T-0012.11 Missing Details And Example Readiness`.
13. `T-0012.12 To-Do Example`.

## First Selected Subtask

Selected: `T-0012.1 Cleanup Enforcement Baseline`.

Rationale:

- It is non-blocked.
- It enforces reset guardrails before feature work.
- It can be implemented without new architectural choices beyond `D-0047`.
- It does not require changing framework behavior except path/import updates
  needed by generated-code and test relocation.

The requirements splitter agent `019f1e60-fd4e-7ef0-b5ec-223d6928f739`
completed the roadmap in commit `62164aa` and is closed.

## Verification

Commands run for this docs-only splitter pass:

- `corepack pnpm exec prettier --write build-protocol/tasks/T-0012-corrective-cleanup-and-replan/TASK.md build-protocol/tasks/T-0012-corrective-cleanup-and-replan/IMPLEMENTATION_REPORT.md build-protocol/work-logs/T-0012-cleanup.md build-protocol/reviews/T-0012-corrective-cleanup-and-replan.md`
- `git diff --check`

Result:

- Prettier completed successfully.
- `git diff --check` reported no whitespace errors.
- No implementation tests were run because no implementation code was changed.
