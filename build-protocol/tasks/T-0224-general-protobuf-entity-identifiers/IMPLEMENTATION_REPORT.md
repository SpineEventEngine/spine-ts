# T-0224 Implementation Report

## Result

Spine TS now accepts complete generated Protobuf messages as Entity IDs. The
Entity state's first field declares the ID type. Message IDs may contain any
schema-declared fields, including nested messages and multiple scalar fields.

Route admission validates a message ID with the target field's schema, verifies
descriptor-aware serialization, and retains the complete generated message.
Primitive Entity targets accept compatible primitive IDs. When the selected
candidate is a message, applications derive the intended primitive ID through
an explicit custom route.

## Production changes

### Public identifier contract

`MessageId` represents a generated Buf `Message`. `MessageIds.read()` performs
the shallow runtime recognition needed by repository boundaries. Canonical
identity continues to use the existing descriptor-aware packed `Any` path.

### Repository routing

Command and Event default routes read the signal's declared first field. Event
routing first prefers a compatible packed producer ID. State-update routing
selects the first state field compatible with the target Entity ID field.

For message targets, `readMessageRouteId()`:

- requires the expected generated type name;
- runs generated validation through `Validate.check()`;
- verifies serialization through `Identifiers.pack()`; and
- returns the complete validated message.

Scalar targets continue through primitive compatibility checks. All route
sources converge on the same target-field validation boundary.

### Durable identity

Existing storage and Delivery facilities already serialize Entity IDs through
the state ID-field descriptor. The implementation retains that path for:

- Command and Event Entity Inbox handoff;
- stored-target replay;
- current-state persistence and rehydration;
- Entity and System Event producer contexts;
- route deduplication; and
- per-target dispatch guards.

No registry, generated Protobuf, Inbox schema, storage format, or migration was
added.

## Behavioral proof

Generated test descriptors model:

- an identifier with a field named `uuid`; and
- a composite identifier containing a nested `UserId` plus an integer
  discriminator.

Tests prove:

- package-root `MessageId` assignability;
- default Command routing;
- compatible Event producer routing;
- Event declaration-first fallback;
- built-in state-update routing;
- custom Command, Event, and state-update routes;
- stable deduplication of generated clones;
- distinction between composite IDs that differ in one declared field;
- Process Manager Command and Event Inbox handoff and replay;
- state persistence and rehydration under separate composite IDs;
- complete producer IDs in emitted contexts;
- independent dispatch guards;
- rejection of wrong message types, invalid generated messages, malformed
  packed targets, and message candidates for primitive targets; and
- explicit custom primitive routing.

## Review

Fresh specification review confirmed complete-message behavior across routing,
Inbox, persistence, canonical identity, and dispatch guards. Standards and API
documentation review confirmed the public type, TSDoc, tests, and reader
documentation. The final documentation audit confirmed that every identifier
and routing claim states the implemented contract.

The package README and REFERENCE explain:

- how the Entity state declares its ID type;
- that every declared field participates in a message ID;
- where default Command, Event, and state-update routes obtain their targets;
  and
- how to provide a custom route when a message candidate targets a primitive
  Entity ID.

## Version alignment

All 26 workspace manifests use `2.0.0-snapshot.8`. Commit `956e570b4` contains
only those top-level version changes and has the required message
`Bump version -> 2.0.0-snapshot.8`. Internal dependency pins, generated
metadata, and the lockfile are aligned in separate commits. The external
`@spine-event-engine/validation@2.0.0-snapshot.7` dependency remains unchanged.

## Verification

Focused repository tests passed 264 tests with coverage. Generated documentation,
API audience, snippets, TypeScript, ESLint, cleanup, TSDoc, copyright,
formatting, Proto, generated-clean, dependency-policy, and release-readiness
checks passed.

The final `pnpm verify:release` run passed:

- 287 test files;
- 4,557 tests;
- 93.28% statement coverage;
- 90.01% branch coverage;
- 92.82% function coverage;
- 94.45% line coverage;
- all 18 packed snapshot.8 artifacts; and
- the isolated external consumer installation, compilation, imports, and
  runtime proof.

One lifecycle integration assertion exposed by the first full run observed a
client-side HTTP/2 callback as a proxy for server teardown. Its test probe now
records the server-side close completion that production awaits and verifies
client closure separately. The assertion passed 20 repeated runs, and the
complete lifecycle file passed 51 tests before the final release gate.

## Repository state

The feature branch is pushed to
`origin/general-protobuf-entity-identifiers`. No pull request was created and
official `master` was not modified.
