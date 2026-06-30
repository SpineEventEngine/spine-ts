# T-0010.5: Event Registration Readiness

Status: Setup Baseline Verified; Implementation Pending
Parent task: `T-0010 Single-Process Async Runtime`
Start: `2026-06-30 18:12 WEST`
Baseline commit: `20aaad1`
Branch: `task/T-0010-5-event-registration-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-5-event-registration-readiness`
Authoring sub-agent: pending.
Reviewer sub-agents: pending.

## Objective

Add a metadata-only event registration readiness surface for later runtime
slices. The surface should report event message types that have registered
event subscribers, event reactors, and event appliers, while preserving Spine
event fan-out semantics and domestic/external deferral notes.

This subtask must not add an event bus, integration broker, delivery loop,
event store, import bus, service API, handler invocation, repository dispatch,
transport, `Ack`, or validation behavior.

## Required JVM Shape

The user explicitly requested close inspection of Spine JVM `core-jvm/server`
for server-module work and warned against over-inventing. This setup inspected
the following task-relevant references before implementation handoff:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  event dispatcher registration and context integration sections;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, especially event
  routing, domestic/external filtering, `@Subscribe`, `@React`, and integration
  broker notes;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventDispatcherRegistry.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventDispatcher.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventDispatcherDelegate.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventSubscriber.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventReactor.java`;
- existing TS handler metadata and command readiness code:
  `packages/server/src/handler-metadata.ts` and
  `packages/server/src/command-registration-readiness.ts`.

Implementation impact:

- JVM event dispatch is multicast: multiple dispatchers may receive the same
  event type. T-0010.5 must not enforce uniqueness for subscribers or reactors.
- JVM dispatch distinguishes domestic and external event classes. The current
  TS metadata has event subscriptions/reactions/applications but no external
  event marker yet, so T-0010.5 should record domestic/external routing as a
  deferred classification rather than inventing an external annotation or
  broker.
- JVM import is separate from general event dispatch. TS event appliers already
  have `allowImport`; readiness may expose that metadata, but must not build an
  import bus or replay path.
- Existing `HandlerMetadataRegistry` already validates uniqueness of event
  application per entity state and event type. T-0010.5 should reuse that
  registry and avoid a second duplicate policy.

## Acceptance Criteria

- Build an OOP-style TypeScript readiness lookup from `HandlerMetadataRegistry`
  or `EntityHandlersMetadata` inputs.
- Return deterministic event message full type names using locale-independent
  ordering.
- Expose fan-out metadata for event subscriptions and event reactions.
- Expose event-application metadata by event type and retain the per-entity
  uniqueness enforced by `HandlerMetadataRegistry`.
- Return fresh frozen/copy-safe readiness metadata consistent with
  `CommandRegistrationReadiness`.
- Document that domestic/external event classification, integration broker
  wanted-event publication, event bus dispatch, event storage, import/replay,
  and handler invocation remain later tasks.
- Update package exports, API docs, README docs, API export checks, task logs,
  and tests.

## Out Of Scope

- EventBus, IntegrationBroker, ImportBus, EventStore, Delivery, Stand,
  SubscriptionService, command result subscriptions, ZeroMQ, multi-process
  transport, handler invocation, event validation, event enrichment, event
  storage, tenant indexing, repository runtime dispatch, or `Ack`.
- New decorators or new external-event annotations.
- Duplicate rejection for subscribers or reactors; Spine event handling is
  fan-out.

## Tooling And Skills

- No new dependencies are selected for this subtask; use existing TypeScript,
  Vitest, TypeDoc, and server package tooling.
- Implementation sub-agent must use the installed skills relevant to this
  slice where needed: `subagent-driven-development`,
  `test-driven-development`, `javascript-testing-patterns`,
  `typescript-advanced-types`, `codebase-design`, and
  `verification-before-completion`.
- Review prompts must include the server-module `core-jvm` guardrail from
  `BUILD_PROTOCOL.md`.

## Verification

- Setup install on `2026-06-30 18:15 WEST`: initial sandboxed
  `corepack pnpm install --frozen-lockfile` hit npm DNS restrictions and was
  interrupted before completion; escalated rerun completed with the frozen
  lockfile, 194 packages reused from pnpm store, 0 downloads, and no lockfile
  changes.
- Setup baseline verification on `2026-06-30 18:16 WEST`: `CI=true corepack
pnpm verify` passed with 20 test files / 242 tests, coverage 95.94%
  statements / 90.38% branches / 98.15% functions / 95.87% lines, TypeDoc/API
  checks with 100 proto / 28 core / 119 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.

## Human Questions And Answers

- Human note: when creating `server` module code, closely inspect the
  corresponding Spine JVM `core-jvm/server` module code and avoid
  over-engineering. This is recorded in `BUILD_PROTOCOL.md` and is binding for
  this task.
