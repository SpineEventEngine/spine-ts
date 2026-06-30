# T-0010.5: Event Registration Readiness

Status: Review Fixes Complete; Verification Passed
Parent task: `T-0010 Single-Process Async Runtime`
Start: `2026-06-30 18:12 WEST`
Baseline commit: `20aaad1`
Branch: `task/T-0010-5-event-registration-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-5-event-registration-readiness`
Authoring sub-agent: `019f198d-7dc2-7641-9abb-4c49d776e370`.
Reviewer sub-agents:

- Maintainability reviewer `019f1999-9c26-7c80-868d-1c54f56daa6e`:
  Important shared helper duplication.
- Documentation reviewer `019f1999-cfd4-7ed3-a88a-f23f3a75c943`:
  Important missing authoring sub-agent ID; Minor stale review log.
- TypeScript/API reviewer `019f199a-0079-7cf3-ab60-78f8c7286dac`:
  clean.
- Security reviewer `019f199a-38dc-7a90-bc98-5a3a08efd62e`:
  Important schema/descriptor mutation poisoning.
- Performance/reliability reviewer
  `019f199a-6696-7061-b129-bdc51f12ef81`: Important custom lookup duplicate
  application bypass; Important entity field identity; Minor repeated cloning.

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

Implementation skill applicability check on `2026-06-30 18:28 WEST`:

- Task prompt provided full bodies for `test-driven-development`,
  `javascript-testing-patterns`, `typescript-advanced-types`,
  `codebase-design`, and `verification-before-completion`; these were selected
  and applied.
- `subagent-driven-development` was listed by the setup brief, but the direct
  human instruction for this implementation was "Do not spawn any sub-agents",
  so it was not used.
- Repo-local expected skills and user-installed skills were not re-enumerated
  during implementation because the orchestrator prompt supplied the applicable
  skill bodies and no additional skill was needed.
- The server-module `core-jvm` guardrail was satisfied from the setup research
  recorded above; implementation used the multicast/deferred-classification
  constraints from those inspected JVM files and did not broaden runtime scope.

## Implementation Notes

- Added `EventRegistrationReadiness` as a metadata-only lookup over
  `HandlerMetadataRegistryLookup` or iterable `EntityHandlersMetadata`.
- Preserved event fan-out for subscribers and reactors by returning all
  registered receivers for an event type.
- Exposed event applications grouped by event type and left duplicate
  per-entity-state/per-event validation with `HandlerMetadataRegistry`.
- Ordered event message full type names with explicit code-unit comparison.
- Returned fresh frozen arrays and fresh outer metadata values backed by
  immutable nested readiness metadata snapshots shared safely across lookups.
- Extracted the deterministic comparator and readiness metadata cloning helpers
  into the private server module
  `packages/server/src/registration-readiness-metadata.ts`, shared by command
  and event readiness and not exported from the package index.
- Canonicalized event readiness `fromRegistry()` through
  `HandlerMetadataRegistry(registry.listEntityHandlers())` before building
  event lookup indexes, preserving public API shape while enforcing event
  application uniqueness for custom lookup implementations.
- Documented domestic/external event classification and integration-broker
  wanted-event publication as deferred because current TS metadata has no
  external-event marker.
- Added no event bus, integration broker, import bus, event store, delivery,
  stand, subscription service, transport, handler invocation, validation,
  repository runtime dispatch, command-result subscription, or `Ack`.

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
- RED on `2026-06-30 18:24 WEST`: `corepack pnpm test
packages/server/src/event-registration-readiness.test.ts` failed with 9/9
  tests failing because `EventRegistrationReadiness` was not exported.
- GREEN on `2026-06-30 18:26 WEST`: `corepack pnpm test
packages/server/src/event-registration-readiness.test.ts` passed with 1 test
  file / 9 tests.
- Focused export GREEN on `2026-06-30 18:27 WEST`: `corepack pnpm test
packages/server/src/event-registration-readiness.test.ts
packages/server/src/index.test.ts` passed with 2 test files / 18 tests.
- Typecheck on `2026-06-30 18:27 WEST`: first `corepack pnpm typecheck`
  failed on one generic cast in the event readiness test helper; after the cast
  was tightened through `unknown`, `corepack pnpm typecheck` passed with
  `tsc -b` and `tsc --noEmit -p tsconfig.eslint.json`.
- Full verification on `2026-06-30 18:31 WEST`: `CI=true corepack pnpm verify`
  passed with 21 test files / 251 tests, coverage 95.95% statements / 90.43%
  branches / 97.78% functions / 95.89% lines, TypeDoc/API checks with 100
  proto / 28 core / 124 server / 26 storage expected exports, proto
  lint/generate checksum verification, and generated proto output clean.
- Review-fix RED on `2026-06-30 18:42 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts
packages/server/src/event-registration-readiness.test.ts` failed as expected
  with 5 focused regressions: schema/descriptor metadata was not frozen,
  entity field metadata identity was split, and a custom event registry lookup
  with duplicate event applications did not throw.
- Review-fix focused GREEN on `2026-06-30 18:45 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts
packages/server/src/event-registration-readiness.test.ts` passed with 2 test
  files / 22 tests.
- Review-fix typecheck on `2026-06-30 18:45 WEST`: `corepack pnpm typecheck`
  passed with `tsc -b` and `tsc --noEmit -p tsconfig.eslint.json`.
- Review-fix full verification attempts on `2026-06-30 18:46-18:47 WEST`:
  `CI=true corepack pnpm verify` first failed on one ESLint
  `no-unsafe-argument` finding in the helper clone utility; after switching to
  `Reflect.getPrototypeOf()`, it failed on Prettier formatting for
  `build-protocol/work-logs/T-0010-5.md`; formatting the touched durable logs
  resolved it.
- Review-fix full verification on `2026-06-30 18:50 WEST`: `CI=true corepack
pnpm verify` passed with 21 test files / 256 tests, coverage 96.45%
  statements / 90.55% branches / 99.24% functions / 96.39% lines, TypeDoc/API
  checks with 100 proto / 28 core / 124 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.

## Human Questions And Answers

- Human note: when creating `server` module code, closely inspect the
  corresponding Spine JVM `core-jvm/server` module code and avoid
  over-engineering. This is recorded in `BUILD_PROTOCOL.md` and is binding for
  this task.
