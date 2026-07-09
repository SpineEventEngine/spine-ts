# T-0017e Implementation Report

Status: `DONE_WITH_CONCERNS`
Date: `2026-07-09`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017e-reactor-commanders`
Branch: `task/T-0017e-reactor-commanders`

## Summary

Implemented generated `@Command` and `@React` handler execution for aggregate
event intake, preserving Spine JVM-style user handler APIs where handlers
receive domain messages and optional context and return domain messages.
Generated producer handlers now require emitted schema metadata, and the
framework wraps returned domain commands/events internally before dispatching
them only after transactional/storage work succeeds.

## Changed Files

- `packages/server/src/handler/handler-metadata.ts`
- `packages/server/src/handler/generated-handler-registry.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/context/bounded-context.ts`
- `packages/server/test/handler/generated-handler-registry.test.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `build-protocol/work-logs/T-0017e.md`
- `build-protocol/work-logs/T-0017e-implementation-report.md`

No commits were made. `human-review-1-jul.md` was left untouched.

## JVM Sources Inspected

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/command/Command.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/event/React.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/command/model/CommanderClass.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/event/EventDispatcher.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/event/EventDispatcherRegistry.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/model/EventEmitter.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/model/CommandEmitter.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/event/EventFactory.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/event/EventOrigin.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/command/AbstractCommander.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/command/AbstractCommandDispatcher.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/entity/TransactionListener.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/aggregate/AggregateEndpoint.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/aggregate/AggregateEventReactionEndpoint.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/event/EventProducingRepository.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`

## Decisions

- Keep the slice limited to generated `@Command`/`@React` execution and
  framework-owned wrapping of produced domain messages.
- Preserve end-user handler APIs as domain-message oriented; do not expose
  framework `Command`/`Event` envelopes to generated handler signatures.
- Require generated emitted schema metadata for `@Assign`, `@Command`, and
  `@React` producer handlers. Keep `@Subscribe` void-only and reject emitted
  schemas there.
- Wrap produced event domain messages with producer ID, version, and a
  `past_message` origin pointing at the source event.
- Wrap produced command domain messages with actor context derived from source
  event origin and deterministic command IDs derived from source event ID plus
  sequence.
- Dispatch produced commands/events only after handler transaction and storage
  work succeeds.
- Do not add process-manager execution, durable inbox handoff, scheduler loops,
  transport-backed workers, schema-bearing decorator APIs, `@Apply`, app-owned
  materialization, framework envelopes in user handler APIs, or manual
  transactions in end-user code.

## Tests Run

- `pnpm install`
  - Initial sandboxed run failed with registry DNS `ENOTFOUND`.
  - Escalated retry succeeded; package manifests remained unchanged.
- `pnpm --config.verify-deps-before-run=false proto:generate`
  - Passed; verified 25 copied Spine proto source file checksums.
- Red-check focused tests before implementation:
  - Failed as expected because generated emitted schemas were not preserved,
    generated event reactions could omit emitted schemas, and generated
    aggregate event-side handlers were not executed.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - Passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/generated-handler-registry.test.ts packages/server/test/repository/repository-routing.test.ts`
  - Passed; 2 test files, 96 tests.
- `pnpm --config.verify-deps-before-run=false docs:check`
  - Passed. TypeDoc reported only the invalid `origin` remote warning.
- `pnpm --config.verify-deps-before-run=false lint`
  - First rerun found local cleanup issues: one redundant condition, one
    non-null assertion, and cleanup-rule line shifts from expanding pre-existing
    long-name API declarations.
  - Fixed and reran successfully with `tsc -b`, ESLint, and cleanup enforcement
    passing.
- `pnpm --config.verify-deps-before-run=false format:check`
  - Passed.
- `git diff --check`
  - Passed.

Generated output status for `docs/api/reference`, `packages/proto/generated`,
`packages/server/generated`, and `examples/todo/generated` was clean after
verification commands.

## Concerns

- Full repository `pnpm verify` was not run; verification used focused tests
  plus typecheck, lint, docs check, format check, and diff whitespace check.
- Produced event redispatch from generated event reactors is queued to the next
  macrotask so it occurs after successful storage while avoiding the current
  in-process event bus runtime's same-runtime reentrant enqueue guard.
- TypeDoc still warns that the git remote `origin` is invalid, which makes
  source links broken in generated docs. The docs check exits successfully with
  this warning.
