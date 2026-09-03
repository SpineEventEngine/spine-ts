# T-0224 Implementation Report

## Implemented slice

- Generalized the public package-root `MessageId` type to Buf's generated
  Protobuf `Message` contract and documented that the complete declared message
  identifies the entity.
- General message route admission now requires the declared target type and
  verifies packability through the existing descriptor-aware `Identifiers.pack`
  path before retaining the complete message.
- Kept the legacy exact `{ $typeName, value }` adapter only for scalar targets.
  Removed the unused message JSON key codec so it cannot become a competing
  identity format.

## Files

- `packages/server/src/repository/primitive-id.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/test/repository/primitive-id.test.ts`
- `build-protocol/work-logs/T-0224.md`

## TDD evidence

RED was observed before any production edit:

```text
primitive-id.test.ts > reads message IDs with arbitrary declared fields
expected undefined to be { '$typeName': 'example.UuidId', uuid: 'task-1' }
```

GREEN:

```text
pnpm exec vitest run packages/server/test/repository/primitive-id.test.ts \
  packages/server/test/repository/repository-routing.test.ts
2 files passed, 249 tests passed

pnpm typecheck
passed
```

## Coverage

Focused coverage executed both affected tests. `primitive-id.ts` reached 96.42%
lines and `repository.ts` 89.49% lines. Vitest reported a non-zero exit because
the focused run is evaluated against the workspace-wide 90% global coverage
threshold (19.85% global lines); no test failed.

## Self-review and remaining concerns

The implementation preserves the established packed-`Any` canonical identity,
storage, and Inbox paths; it introduces no registry, generated proto change,
storage format, manifest, version, or lockfile change. The route boundary now
uses the target schema rather than a field-name convention.

## Generated-schema routing follow-up

An in-test generated descriptor fixture now models `CompositeRouteId` with a
nested `spine.core.UserId reader` plus an `int32 number`. It proves complete-ID
preservation through default Command, compatible Event-producer,
incompatible-producer Event fallback, and built-in state-update routing. Custom
Event and state-update routes stably deduplicate an `idA` clone while retaining
`idB` whose second scalar differs. Descriptor key tests prove clone equality
and `idA`/`idB` distinction. `RoutableId.value` was removed as obsolete.

Focused coverage used explicit zero global thresholds so the source run could
complete: 252 tests passed. Relevant line coverage remains `primitive-id.ts`
96.42% and `repository.ts` 89.49%.

This is not a completion claim. Durable Inbox replay/persistence/reload,
complete produced-event producer IDs, malformed stored-target rejection, guard
isolation, and the specialist review wave remain outstanding.
