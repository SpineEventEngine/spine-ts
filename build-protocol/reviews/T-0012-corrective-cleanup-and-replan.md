# Review Log: T-0012 Corrective Cleanup And Roadmap Reset

Task log:
`build-protocol/tasks/T-0012-corrective-cleanup-and-replan/TASK.md`
Branch: `task/T-0012-cleanup-replan`
Baseline commit: `a9769d4`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-cleanup-replan`
Status: T-0012.8 integrated; T-0012.9 selected.

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current Notes

Reviewers must enforce the new human reset:

- simplicity beats speculative precision;
- JVM concept names are preferred;
- generated code is ignored and regenerated;
- tests are outside `src`;
- package structure is semantic rather than flat;
- the implementation order starts with storage/event store and reaches the
  to-do example only after real gRPC/query/subscription support exists.

## Review Setup Adjustment After Split

The splitter selected `T-0012.1 Cleanup Enforcement Baseline` as the first
non-blocked implementable subtask. Reviewers for that subtask should focus on
whether enforcement is real and narrow:

- generated Protobuf-ES output is no longer tracked under `src/generated`;
- tests are no longer co-located under package `src`;
- package source folders move toward semantic structure without unrelated
  behavioral redesign;
- automated checks cover generated-code location, co-located tests, name
  component limits, callback naming, line length, and committed generated
  output;
- path/import changes are the only implementation behavior changes unless a
  specific exception is logged.

For later cleanup subtasks, reviewers should flag:

- public snapshot/detail/error hierarchies that survive without JVM-backed
  justification;
- runtime routing, lifecycle, or transport delivery concepts that remain ahead
  of the corrected storage/bus/bounded-context/repository order;
- storage APIs that keep a broad adapter surface instead of the JVM-like
  `StorageFactory`/`RecordStorage` seam;
- gRPC service work before real buses and `Stand` exist.

## Integrated Subtask Reviews

- `T-0012.1 Cleanup Enforcement Baseline`: all five required review lanes are
  clean. Round 4 left only documentation status comments, which were resolved
  by a focused documentation re-review. Final escalated `env CI=true corepack
pnpm verify` passed.

## T-0012.3 Review Focus

For `T-0012.2 Source Folder Repack`, reviewers must focus on:

- semantic folder grouping without behavioral redesign;
- package-root `src` folders containing only a handful of entry/global files;
- mirrored `packages/<package>/test` structure;
- imports and package exports staying coherent;
- no new helper sprawl or renamed long concepts while moving files.

## T-0012.2 Review Status

The `T-0012.2` implementation is integrated on the parent branch. All required
review lanes are clean, including a focused documentation re-review, and final
escalated `env CI=true corepack pnpm verify` passed.

## Next Review Focus

For `T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions`, reviewers
focused on:

- removal or shrinking of abandoned command-execution-first concepts;
- deletion of over-specific detail/error hierarchies unless JVM evidence
  justifies them;
- no replacement storage, bus, bounded-context, repository, delivery, stand, or
  gRPC behavior before the roadmap reaches those tasks;
- public API shrinkage being documented and deliberate;
- no new helper sprawl while deleting code.

`T-0012.3` is integrated. All required review lanes are clean and final
escalated `env CI=true corepack pnpm verify` passed.

## T-0012.4 Review Focus

For `T-0012.4 Storage Factory And Record Storage Reset`, reviewers must focus
focused on:

- close alignment with Spine JVM `StorageFactory` and `RecordStorage`;
- a small general storage contract with no in-memory-specific leakage;
- event store built over the storage seam, not buses or delivery first;
- no reintroduction of broad adapter surfaces or detail hierarchies;
- generated Protobuf contracts, type URLs, and validation rules preserved.

`T-0012.4` is integrated. All required review lanes are clean and final
escalated `env CI=true corepack pnpm verify` passed.

## Next Review Focus

For `T-0012.5 CommandBus, EventBus, And Handler Registration`, reviewers must
focus on:

- close alignment with Spine JVM `CommandBus`, `EventBus`, command handlers,
  event subscribers, event reactors, and event-producing methods;
- event store-before-dispatch through the new `EventStore`;
- strict write-side/read-side segregation;
- asynchronous signal processing without delivery, gRPC, stand, repositories,
  scheduler, import bus, or system audit behavior;
- handler decorators/metadata staying small and JVM-named.

`T-0012.5` is integrated. All required review lanes are clean, including
focused documentation re-reviews, and final escalated
`env CI=true corepack pnpm verify` passed.

## Next Review Focus

For `T-0012.6 BoundedContext Assembly`, reviewers must focus on:

- close alignment with Spine JVM `BoundedContext` and builder responsibilities;
- using the already implemented storage and bus seams instead of invented
  snapshot/detail hierarchies;
- no repository lifecycle, delivery, stand, gRPC, transport execution,
  scheduler, import bus, or system audit behavior;
- a small public API with JVM-familiar names and simple errors; and
- updated docs/API docs and task logs for every public assembly change.

`T-0012.6` is integrated. All required review lanes are clean and final
escalated `env CI=true corepack pnpm verify` passed.

## Next Review Focus

For `T-0012.7 Entities, Repositories, Routing, And Aggregate Storage`,
reviewers must focus on:

- close alignment with Spine JVM entity and repository ownership;
- repository lifecycle/storage opening built on the existing `StorageFactory`
  and `RecordStorage` seams;
- aggregate storage as snapshots plus events, without inventing a broad storage
  adapter;
- signal routing through already implemented bounded-context buses;
- no delivery, Stand, gRPC, transport execution, scheduler, import bus, or
  system context runtime behavior; and
- keeping public APIs small and JVM-familiar.

`T-0012.7`, `T-0012.7b`, and `T-0012.7c` are integrated. All required review
lanes are clean, and parent tracked-state verification after `T-0012.7c`
passed.

## T-0012.8 Review Status

`T-0012.8 Delivery And Inbox` is integrated. The final reviewed code/docs state
is concrete through `0d6089a`, final task bookkeeping was committed as
`2d0e34e`, and the parent integration merge was prepared on
`2026-07-03 23:10 WEST`. All required review lanes are clean: code
style/maintainability, documentation, TypeScript/API docs, security, and
performance/reliability.

## Next Review Focus

For `T-0012.9 Stand And Entity Updates`, reviewers must focus on:

- close alignment with Spine JVM `Stand` and read-side responsibilities;
- query execution and subscription lifecycle over real read-side state, not
  gRPC service simulation;
- entity-updated system events emitted from entity state changes;
- strict write-side/read-side segregation; and
- no gRPC service adapters until the direct `Stand` API is usable.
