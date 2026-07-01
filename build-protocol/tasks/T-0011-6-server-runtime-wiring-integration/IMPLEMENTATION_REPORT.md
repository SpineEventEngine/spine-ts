# Implementation Report: T-0011.6 Server Runtime Wiring Integration

Status: Implemented
Task log: `build-protocol/tasks/T-0011-6-server-runtime-wiring-integration/TASK.md`
Work log: `build-protocol/work-logs/T-0011-6.md`
Review log:
`build-protocol/reviews/T-0011-6-server-runtime-wiring-integration.md`
Branch: `task/T-0011-6-server-runtime-wiring-integration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-6-server-runtime-wiring-integration`

## Summary

T-0011.6 begins from parent commit `78346ab` after T-0011.5 integration. The
subtask owns the smallest server/runtime seam that connects existing
`@spine-ts/server` metadata to `@spine-ts/transport` routing contracts. It must
not implement service hosting, handler dispatch, durable delivery, storage, or
process supervision.

Implemented result:

- added `packages/server/src/runtime-routing.ts` with
  `createServerRuntimeRoutingPlan()` plus immutable command/event routing-plan
  types;
- derived command topics plus one competing-consumer command-worker
  registration from `CommandRegistrationReadiness`;
- derived event topics plus fan-out subscriptions and event-worker
  registrations for subscriber/reactor/application receiver groups from
  `EventRegistrationReadiness`;
- recorded explicit deferred seams for query/subscription/system routing; and
- updated package/docs/API guardrails without widening the slice into buses,
  endpoints, dispatch, storage, or service hosting.

## JVM Source Guardrail

Before implementation, the orchestrator inspected task-relevant
`core-jvm/server` notes and source:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/Server.java`.

Conclusion: add only immutable routing-plan metadata for later bus/worker
wiring. Keep actual command/event bus behavior, service hosting, storage,
delivery, scheduling, and process supervision outside this slice.

## Verification

- T-0011.6 setup dependency install on `2026-07-01 03:10 WEST`: sandboxed
  `corepack pnpm install --frozen-lockfile` was interrupted after npm registry
  `ENOTFOUND` retries while populating the fresh worktree. Escalated
  `corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
  reused 197 packages, and ran the approved `zeromq@6.5.0` install script.
- T-0011.6 setup baseline verification passed on `2026-07-01 03:11 WEST`:
  `CI=true corepack pnpm verify` passed with 23 test files / 280 tests,
  coverage 96.16% statements / 90.48% branches / 99.33% functions / 96.10%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  / 46 transport exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only. The command used
  native IPC access because inherited ZeroMQ smoke tests bind `ipc://`
  endpoints.
- RED on `2026-07-01 03:19 WEST`:
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts`
  failed with 4/4 tests red because `createServerRuntimeRoutingPlan` did not
  exist yet.
- GREEN on `2026-07-01 03:32 WEST`:
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts packages/server/src/index.test.ts`
  passed with 2 files / 16 tests.
- Final verification passed on `2026-07-01 03:33 WEST`:
  `corepack pnpm typecheck`, `corepack pnpm docs:check`, and
  `git diff --check` all passed. `CI=true corepack pnpm verify` passed with
  native IPC access: 24 test files / 286 tests, coverage 95.99% statements /
  90.14% branches / 99.38% functions / 95.93% lines, TypeDoc/API checks with
  100 proto / 28 core / 134 server / 26 storage / 46 transport exports, proto
  checksum verification, proto lint/generate, and generated-clean all passed.
  TypeDoc emitted the existing invalid-`origin` warning only.
- Round 1 fix RED/GREEN on `2026-07-01 03:46-03:56 WEST`:
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts`
  first failed against the leaking route shape and custom-lookup acceptance,
  then `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts packages/server/src/index.test.ts`
  passed with 2 files / 18 tests after the planner emitted only sanitized
  route descriptors and planner-local indexed worker IDs.
- Round 1 fix verification passed on `2026-07-01 03:56 WEST`:
  `corepack pnpm typecheck`, `corepack pnpm docs:check`, and
  `git diff --check` all passed. Escalated `CI=true corepack pnpm verify`
  passed with native IPC access: 24 test files / 288 tests, coverage 95.85%
  statements / 90.01% branches / 99.38% functions / 95.79% lines, TypeDoc/API
  checks with 100 proto / 28 core / 130 server / 26 storage / 46 transport
  exports, copied Spine proto checksum verification, proto lint/generate, and
  generated-clean all passed. TypeDoc emitted the existing invalid-`origin`
  warning only.

## Skill Applicability

- Implementation sub-agent re-read these selected skill entrypoints before
  coding on `2026-07-01 03:15 WEST`:
  `test-driven-development`, `typescript-advanced-types`,
  `javascript-testing-patterns`, `codebase-design`,
  `nodejs-backend-patterns`, and `verification-before-completion`.
- Directly applied skills:
  `test-driven-development`, `typescript-advanced-types`,
  `javascript-testing-patterns`, `codebase-design`,
  and `verification-before-completion`.
- `nodejs-backend-patterns` was reviewed for boundary/input-validation guidance
  but not used as the primary design driver because this slice deliberately
  avoids service hosting and broader runtime infrastructure.
- Implementation target: a narrow `runtime-routing` planner that consumes built
  bounded-context metadata plus command/event readiness and emits immutable
  transport topics, subscriptions, worker registrations, and explicit deferred
  seams for unsupported signal kinds.

## Files Changed

- `build-protocol/tasks/T-0011-6-server-runtime-wiring-integration/TASK.md`
- `build-protocol/tasks/T-0011-6-server-runtime-wiring-integration/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0011-6.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `packages/server/package.json`
- `packages/server/src/index.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/runtime-routing.test.ts`
- `packages/server/src/runtime-routing.ts`
- `pnpm-lock.yaml`
- `scripts/check-api-docs.mjs`

## Round 1 Fix Summary

- Repaired `packages/server/src/runtime-routing.ts` so public command/event
  routes no longer retain readiness metadata objects or handler/entity
  internals. Routes now expose only planner-local route IDs, planner-local
  worker IDs, receiver groups, and sanitized message full type names/type URLs
  alongside the transport topic/subscription/worker contracts.
- Narrowed `ServerRuntimeRoutingPlanInput` to concrete
  `CommandRegistrationReadiness` / `EventRegistrationReadiness` instances and
  added explicit validation for handler kind, message full type name, and
  schema/type-name consistency before topic derivation. Malformed schemas now
  fail with deterministic `TypeError` messages instead of raw JS exceptions.
- Dropped the intermediate runtime route-flavor re-exports from the package
  root and updated the API guard/docs to the reduced 130-export server
  surface.
- Added focused regression tests for public-route sanitization, custom-lookup
  rejection, collision-resistant planner-local IDs, and malformed schema
  handling.

## Open Items

- Run all required reviewer lanes and close all participating sub-agents.

## Round 2 Fix Summary

- Closed the remaining proxy gap in `packages/server/src/runtime-routing.ts`
  by rejecting Proxy-wrapped concrete readiness instances before `instanceof`
  checks or readiness method calls, so planning now fails closed with stable
  `TypeError` messages and never triggers attacker-controlled proxy traps.
- Replaced the message-prefix preserve list inside
  `withDeterministicValidation()` with a tagged internal
  `DeterministicValidationError`, removing maintenance coupling to
  human-readable error prefixes while preserving the existing deterministic
  validation surface.
- Slimmed public command/event route descriptors further: routes now expose
  only planner-local route/worker IDs, receiver group, sanitized message
  descriptor, and correlation keys back to the plan-level topics,
  subscriptions, and workers. The full transport contracts now live only in
  the plan-level arrays.
- Tightened `scripts/check-api-docs.mjs` so `docs:check` now rejects
  unexpected `@spine-ts/server` root exports in addition to missing expected
  exports, and refreshed `packages/server/README.md`, `docs/api/README.md`,
  and `docs/architecture/README.md` to describe the smaller route shape and
  stronger API guard.
- Round 2 focused RED/GREEN on `2026-07-01 04:13-04:15 WEST`:
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts`
  first failed, then
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts packages/server/src/index.test.ts`
  passed with 2 files / 20 tests.
- Round 2 verification passed on `2026-07-01 04:16 WEST`:
  `corepack pnpm typecheck`, `corepack pnpm docs:check`, `git diff --check`,
  and escalated `CI=true corepack pnpm verify` all passed. Full verify covered
  24 test files / 290 tests with coverage 95.88% statements / 90.05%
  branches / 99.38% functions / 95.82% lines. TypeDoc emitted the existing
  invalid-`origin` warning only.
