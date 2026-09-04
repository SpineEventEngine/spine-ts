# T-0224 Requirements Review

Status: accepted and implemented.

## Decision

A message-valued Entity identifier is the complete generated Protobuf message
declared by the Entity state's ID field. The repository validates it against
that descriptor, preserves it as the routed ID, and uses the existing
descriptor-aware `Identifiers.pack()` and `Identifiers.unpack()` facilities at
serialized boundaries.

Primitive Entity targets accept primitive IDs. When an application needs to
derive such an ID from a message, it declares a custom route that returns the
primitive value.

## Grounded design

- `DescriptorFieldMetadata` provides the authoritative Entity ID schema.
- `EntityIds.pack()`, `entityStorageDescriptor()`, `canonicalEntityIdKey()`,
  `InboxMessages.inboxTargetId()`, and `InboxMessages.targetEntityId()` preserve
  the complete ID through the state schema.
- `InboxTargets.key()` keys the complete typed `Any`, including its type URL and
  bytes.
- Generated validation rules govern message-field validity at route admission.
- Missing or null declaration-first fields remain invalid.
- Scalar-ID repositories accept only compatible primitive candidates.
- The verified Spine JVM model includes structured identifiers containing
  nested messages and scalar discriminators. JVM routing assigns the complete
  ID object after comparing its runtime type with the Entity state ID type.

No additional registry is needed because the target field descriptor already
provides the required schema.

## Public contract

- The package-root `MessageId` type represents a generated Protobuf `Message`.
- The public type exposes no repository descriptor, registry, packed `Any`,
  canonical key, or route-validation implementation detail.
- `CommandRouting<Id>`, `EventRouting<Id>`, `StateUpdateRouting<Id>`, and the
  repository route results retain their existing generic signatures.
- Identity consists of fields declared by the authoritative schema. Unknown
  wire fields are not a distinct Entity identity because the existing packing
  path serializes the declared schema.

## Required behavior

### Route admission

`readMessageRouteId()` receives the target message schema and:

1. accepts only a message with the expected generated type name;
2. validates it with the generated schema rules;
3. verifies that the existing identifier facilities can serialize it;
4. retains the complete message as the route ID; and
5. reports the signal kind and expected ID type when admission fails.

A present default message instance is governed by its generated validation
rules rather than a generic recursive blank-value policy.

### Default and custom routing

- Default Command routing reads the Command's declared first field.
- Event routing uses a compatible packed producer ID when available and
  otherwise reads the Event's declared first field.
- Built-in state-update routing selects the first state field compatible with
  the target Entity ID field.
- Custom Command, Event, and state-update routes retain complete message IDs.
- Multi-target routes deduplicate equivalent generated copies while preserving
  first-seen order and distinct composite IDs.

### Inbox and persistence

- Command handoff stores the exact typed `Any` for a composite target.
- Projection and Process Manager Event handoff preserve the same complete ID.
- Replay reconstructs the stored target without rerunning custom routing.
- Rehydration over the same storage factory distinguishes composite IDs that
  differ in any declared field.
- Produced Entity and System Event contexts carry the descriptor-typed complete
  producer ID.
- Wrong type URLs and malformed packed target bytes fail before handler
  invocation.

### Canonical identity and dispatch guards

- A generated ID and its generated clone produce the same canonical key.
- Composite IDs that differ in a declared field produce distinct keys and
  storage records.
- Guard identities remain independent for distinct composite targets.
- Replaying one source Event suppresses each true duplicate without suppressing
  a different target.

## Verification requirements

- Compile-time package-root coverage proves generated messages satisfy
  `MessageId` without a deep import.
- Focused tests cover Command, Event-producer, Event-fallback, state-update,
  Inbox replay, persistence, canonical keys, guards, wrong types, malformed
  bytes, and primitive targets.
- Generated validation rejects an invalid message before handler invocation or
  persistence.
- The complete server routing suite and changed-source coverage pass before
  review.
- `verify:release` runs after review convergence because this is shared server
  runtime and public-contract work.

## Risks

- **Schema-free acceptance:** a type-name string alone does not prove that a
  candidate is encodable by the declared ID schema. Admission stays bound to the
  target descriptor.
- **Default-message policy:** generic recursive blank checks can invent rules
  that are absent from the schema. Generated validation remains authoritative.
- **Partial routing coverage:** live admission can pass while durable replay is
  wrong. Stored-target replay is tested directly.
- **Competing key formats:** text or JSON keys are unsuitable for general
  Protobuf values. Canonical identity continues to use the existing packed
  `Any` path.
- **Overstated canonicality:** the guaranteed proof covers generated copies and
  declared composite fields. It does not add semantic normalization for maps or
  unknown wire fields.

## Exclusions

- No Protobuf source, generated schema, manifest, package dependency, storage
  provider, durable-key format, or migration change.
- No additional type registry.
- No Delivery wire-envelope or Inbox-record schema change.
- No Query or Subscription contract change.
- No routing declaration API, first-field precedence, cardinality, or route
  invocation timing change.
- No generalized enum-ID or additional primitive-ID support.

## Completion evidence

The implementation and focused tests cover arbitrary field names, nested and
composite message IDs, generated validation, all route sources, durable Inbox
handoff and replay, persistence, producer contexts, canonical keys, and guard
isolation. Reader documentation explains the state ID declaration and default
routing sources.

The final `pnpm verify:release` run passed 287 test files and 4,557 tests.
Coverage passed at 93.28% statements, 90.01% branches, 92.82% functions, and
94.45% lines. All 18 package tarballs and the isolated external consumer also
passed.

## Dispatch metadata

The requirements splitter used `gpt-5.6-sol` with high reasoning. The
implementation and specialist review functions used their explicitly assigned
profiles recorded in the task work log. Runtime self-introspection was not
available; the configured immutable profiles supplied the dispatch evidence.
