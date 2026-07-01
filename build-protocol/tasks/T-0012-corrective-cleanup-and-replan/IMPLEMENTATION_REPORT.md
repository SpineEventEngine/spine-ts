# Implementation Report: T-0012 Corrective Cleanup And Roadmap Reset

Status: T-0012.1 integrated; T-0012.2 selected
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
The next selected subtask is `T-0012.2 Source Folder Repack`.

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
7. `T-0012.7 Entities, Repositories, Routing, And Aggregate Storage`.
8. `T-0012.8 Delivery And Inbox`.
9. `T-0012.9 Stand And Entity Updates`.
10. `T-0012.10 Real gRPC Services`.
11. `T-0012.11 Missing Details And Example Readiness`.
12. `T-0012.12 To-Do Example`.

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
