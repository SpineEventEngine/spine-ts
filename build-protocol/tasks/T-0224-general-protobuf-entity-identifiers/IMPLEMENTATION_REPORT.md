# T-0224 Implementation Report

## Implemented slice

- Generalized the public package-root `MessageId` type to Buf's generated
  Protobuf `Message` contract and documented that the complete declared message
  identifies the entity.
- General message route admission now requires the declared target type and
  verifies packability through the existing descriptor-aware `Identifiers.pack`
  path before retaining the complete message.
- The prior scalar adapter was removed by the human-superseding decision: a
  message candidate cannot become a primitive Entity ID without an explicit
  application route. The unused message JSON key codec is also removed so it
  cannot become a competing identity format.

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

## Self-review

The implementation preserves the established packed-`Any` canonical identity,
storage, and Inbox paths; it introduces no registry, generated proto change, or
storage format. The route boundary now uses the target schema rather than a
field-name convention.

## Review correction and release alignment

The complete specialist wave found and corrected four substantive concerns.
Message admission now requires an own `$typeName`; generated constraint
validation runs through `Validate.check()` before canonical identifier packing;
route readers return IDs directly; and composite test descriptors are resolved
by name rather than unrelated numeric positions. Codec TSDoc describes shallow
message recognition; its prior scalar-adapter wording is superseded and removed.

The corrected focused suite passes 259 tests. Coverage proves both successful
validation and rejection before handler invocation or persistence, including
the previously uncovered undefined route result. ESLint, cleanup, TSDoc,
tooling typecheck, and full TypeScript typecheck pass. All affected review lanes
are clean after correction.

All 26 workspace versions are aligned at `2.0.0-snapshot.8` in the required
standalone commit `956e570b4`. Forty-six concrete internal dependency pins and
their lockfile importers are aligned in separate commits; the external
`@spine-event-engine/validation@2.0.0-snapshot.7` dependency is unchanged.

## Final verification

The first full release gate correctly rejected two release tests that still
expected snapshot.7 after all actual snapshot.8 artifacts had prepared and
installed successfully. Commit `53b4f44f1` aligns those test expectations; its
focused release suite passed 23 tests.

The complete rerun then passed 287 test files and 4,552 tests. Global coverage
was 93.29% statements, 90.01% branches, 92.83% functions, and 94.45% lines.
The same gate passed generated builds, lint and documentation policy, Proto
checks, production-dependency policy, release readiness, all 18 snapshot.8
tarballs, and the isolated external consumer.

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

`pnpm typecheck` passed after the generated composite fixture addition.

This is not a completion claim. Durable Inbox replay/persistence/reload,
complete produced-event producer IDs, malformed stored-target rejection, guard
isolation, and the specialist review wave remain outstanding.

## Escalated integration proof

`repository-routing.test.ts` now derives a composite Process Manager state
descriptor from the existing Process Manager fixture. Its ID has the generated
`CompositeRouteId` shape: nested `spine.core.UserId reader` plus `int32
number`; the two test IDs differ only in `number`.

- Entity Inbox event handoff persists one typed target for each ID. Replaying
  those delivered rows does not invoke the custom route again, and a freshly
  bound context rehydrates the two states independently.
- A Process Manager command-produced event packs the complete composite ID in
  `EventContext.producerId`.
- Stored inbox targets with a different packed-ID type URL, and targets whose
  matching type URL contains malformed bytes, reject before the handler runs.
- A guarded multi-target route collapses a generated clone of `idA`, keeps
  `idB`, suppresses a true duplicate event independently per target, and
  accepts a distinct event. The persisted event fixtures include the required
  composite producer ID, version, and timestamp.

No production code, generated Protobuf, schema, storage format, manifest,
version, or lockfile changed. The first narrow guard run exposed missing event
history metadata in the test fixture (producer ID, version, timestamp), not a
runtime identity defect; after correcting that fixture, the guard proof passed.

Verification:

```text
pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts \
  --testTimeout=15000 --maxWorkers=1
1 file passed, 252 tests passed

pnpm typecheck
exit 0
```

## Tooling test-type correction

The second explicit `gpt-5.6-luna` / low mechanical gate found two test-only
type errors. Direct object literals annotated as `MessageId` were subject to
TypeScript excess-property checks, so the test now infers each concrete
message first and separately proves it is assignable to imported `MessageId`.
This preserves the general public type rather than adding arbitrary fields to
it. The composite command-route fixture now supplies the existing empty
generated `CommandContext` value required by `SignalEnvelopes.command()`.

```text
pnpm typecheck:tooling
exit 0

pnpm exec vitest run packages/server/test/repository/primitive-id.test.ts \
  packages/server/test/repository/repository-routing.test.ts \
  --testTimeout=15000 --maxWorkers=1
2 files passed, 256 tests passed
```

## Lint declaration correction

The third explicit `gpt-5.6-luna` / low gate reported the repository's
interface-declaration rule at the general identifier contract. `MessageId` is
now a public interface extending Buf `Message` and explicitly requiring its
generated `$typeName`; it still exposes no `value` member. The private legacy
wrapper declaration also uses the repository-required interface form.

```text
pnpm exec eslint packages/server/src/repository/primitive-id.ts \
  packages/server/src/repository/repository.ts \
  packages/server/test/repository/primitive-id.test.ts \
  packages/server/test/repository/repository-routing.test.ts
exit 0

pnpm typecheck:tooling
exit 0

focused repository tests
2 files passed, 256 tests passed
```

## TSDoc property correction

The fifth explicit `gpt-5.6-luna` / low gate required a summary for the public
`MessageId.$typeName` property signature. Its TSDoc now states that it is the
fully qualified Protobuf message type name. The established formatting guard
preserves the blank line required by repository TSDoc checks; no API or runtime
behavior changed.

```text
pnpm lint:cleanup
Cleanup enforcement checks passed

pnpm lint:tsdoc
TSDoc enforcement checks passed

pnpm exec eslint ...
exit 0

pnpm typecheck:tooling
exit 0

focused repository tests
2 files passed, 256 tests passed
```

## Cleanup naming correction

The fourth explicit `gpt-5.6-luna` / low cleanup gate rejected the five-part
name of a then-existing private helper. That helper was subsequently removed
under the human-superseding no-implicit-conversion decision.

```text
pnpm lint:cleanup
Cleanup enforcement checks passed

pnpm exec eslint ...
exit 0

pnpm typecheck:tooling
exit 0

focused repository tests
2 files passed, 256 tests passed
```

## Mechanical typecheck correction

The earlier explicit `gpt-5.6-luna` / low mechanical gate found `TS2339` in
`primitive-id.ts`: a then-existing scalar wrapper reader accessed
`MessageId.value`. That reader was subsequently removed under the
human-superseding no-implicit-conversion decision; the exported `MessageId`
remains Buf's general `Message` contract and has no `value` member.

The focused legacy-wrapper test now also rejects a wrapper with an extra field.
The correction was made by the existing senior TypeScript implementation
function with explicit `gpt-5.6-terra` / high reasoning; runtime
self-introspection is unavailable on this surface.

```text
pnpm exec vitest run packages/server/test/repository/primitive-id.test.ts
1 file passed, 4 tests passed

pnpm exec tsc --noEmit -p packages/server/tsconfig.json
exit 0

pnpm exec vitest run packages/server/test/repository/primitive-id.test.ts \
  packages/server/test/repository/repository-routing.test.ts \
  --testTimeout=15000 --maxWorkers=1
2 files passed, 256 tests passed

pnpm typecheck
exit 0
```

## Accepted routing-admission correction batch

The existing TypeScript implementation owner was explicitly dispatched as
`gpt-5.6-terra` / high reasoning; this surface does not expose runtime model
self-introspection. The correction applies the repository's established
`Validate.check()` schema facility to message-valued route IDs before their
canonical `Identifiers.pack()` durability check. It has no registry,
generated-Protobuf, schema, storage-format, manifest, version, or lockfile
change.

The focused regression supplies a custom Command route with the correct
generated type name but an empty field that violates the generated validation
rule. It rejects before handler invocation and durable persistence. A separate
prototype-pollution regression confirms that both general recognition and the
legacy scalar adapter reject inherited `$typeName` values. Route readers now
return the validated ID itself instead of allocating a one-field wrapper, and
the composite fixture resolves source and exposed declarations by name rather
than mutable descriptor indexes.

```text
pnpm exec vitest run packages/server/test/repository/primitive-id.test.ts \
  packages/server/test/repository/repository-routing.test.ts \
  --testTimeout=15000 --maxWorkers=1
2 files passed, 259 tests passed

pnpm exec eslint packages/server/src/repository/primitive-id.ts \
  packages/server/src/repository/repository.ts \
  packages/server/test/repository/primitive-id.test.ts \
  packages/server/test/repository/repository-routing.test.ts
exit 0

pnpm lint:tsdoc
TSDoc enforcement checks passed

pnpm typecheck:tooling
exit 0

pnpm typecheck
exit 0
```

Focused V8 coverage also passed with temporary zero global thresholds solely
to report the selected files; no coverage configuration or ignore was changed.
It recorded `Validate.check()` at route admission 57 times and its new rejection
catch once (`repository.ts` lines 4858 and 4860); packing followed only 56
times (line 4866). The own-property and exact-wrapper paths in
`primitive-id.ts` were both exercised. Focused source coverage was 96.77%
statements / 97.43% branches for `primitive-id.ts` and 88.70% / 79.95% for
`repository.ts`.

## Fresh-review behavior and reader-documentation correction

The existing implementation owner was explicitly dispatched as
`gpt-5.6-terra` with high reasoning. This surface does not expose runtime model
self-introspection; no visible profile fallback occurred.

Fresh review found missing behavioral proof on two axes: (1) a generated,
one-field `uuid` message identifier must be assignable through the package-root
`MessageId` export and route without a `value` field, and (2) composite IDs
need independent custom Command-routing and durable command-Inbox replay
proofs. The first two new tests passed on their first execution, so their RED
state was missing-test evidence rather than a runtime defect. The first Inbox
test was deliberately scoped to a Projection command path and failed because
that path does not create an Entity Inbox row. The proof was moved to the
existing Process Manager command-Inbox path; it then passed without a production
change.

The final regressions prove that a generated `CommandId` (`uuid` only) is a
public `MessageId` and routes directly, that a custom Command route returns the
complete nested-plus-scalar composite ID, and that a Process Manager command
handoff stores the exact typed composite `Any`, replays without calling custom
routing again, and commits state under the full ID.

Reader-facing server documentation now explains complete generated
message-valued Entity IDs, including nested/composite fields and the
state-first-field declaration; it also distinguishes authoritative generated
validation from the explicit application route required to convert to a
primitive target. README and REFERENCE each include a concise Proto and
TypeScript example without internal documentation markers.

## Default-route matrix correction

Fresh review initially treated the `UserId` event test as implicit message-to-
primitive conversion. Inspection shows its signal's first declared field is the
primitive `string` `value`, so it is valid primitive-first-field routing rather
than message unwrapping. The routing matrix is now explicit: primitive first
field to primitive target is valid; message first field to matching message
target is valid; and message first field to primitive target rejects unless a
custom route deliberately returns a primitive. Command and Event default routes
share `readFirstFieldId()` and then `readRouteId()`; state-update routing calls
`readRouteId()` directly on its selected compatible field, so none unwraps a
message. Release verification is pending the final post-review correction; it
must not be inferred from the earlier historical release result.

```text
selected new regressions
1 file passed, 3 tests passed (254 skipped)

pnpm exec vitest run packages/server/test/repository/primitive-id.test.ts \\
  packages/server/test/repository/repository-routing.test.ts \\
  --testTimeout=15000 --maxWorkers=1
2 files passed, 262 tests passed

pnpm typecheck:tooling
exit 0

pnpm docs:check:generated
API, audience, and generated TypeScript snippet checks passed

pnpm exec eslint packages/server/test/repository/repository-routing.test.ts
pnpm lint:tsdoc
pnpm lint:cleanup
git diff --check
all passed
```

Focused V8 coverage passed for the two affected test files using temporary zero
CLI thresholds only for reporting; no coverage configuration changed. The
result included 96.77% statements / 97.29% branches for `primitive-id.ts` and
88.70% statements / 79.95% branches for `repository.ts`. No unresolved runtime
or documentation concern remains.

## Human-superseding primitive-route correction

The human superseded the earlier compatibility interpretation: no message,
including `{ $typeName, value }`, is converted automatically to a primitive
Entity ID. No backward compatibility for that adapter was requested. The
adapter types, codec method, helper, and primitive-route unwrapping were
removed. A generated `TaskId` now rejects at a primitive target before routing;
an explicit custom Command route returning `message.id.value` remains the
deliberate opt-in mechanism.
