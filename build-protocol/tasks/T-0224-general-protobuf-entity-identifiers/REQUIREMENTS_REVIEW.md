# T-0224 Requirements Review

Status: accepted with contract corrections below; implementation-ready.

## Decision

A message-valued Entity identifier is the complete generated Protobuf message
declared by the Entity state's ID field. The repository must validate it against
that exact descriptor, preserve it as the routed ID, and use the existing
descriptor-aware `Identifiers.pack()` / `Identifiers.unpack()` path at every
serialized boundary.

### Human-superseding compatibility decision

The human explicitly superseded the earlier scalar-wrapper compatibility
decision. A message-valued route candidate must be rejected for a primitive
Entity target unless a custom route deliberately returns a primitive field.
No backward compatibility for implicit message-to-primitive conversion was
requested or retained.

The implementation must not broaden the old shape test from “exactly
`$typeName` plus `value`” into another schema-free structural convention. A
`$typeName` string alone proves neither that all fields are encodable by the
declared ID schema nor that a lookalike is the expected generated message.
`readMessageRouteId()` therefore needs the target message schema (not only its
type name) and must:

1. reject a non-message candidate or a candidate whose `$typeName` differs;
2. encode it with the existing target schema and existing `Identifiers` /
   `AnyMessages` facilities, surfacing an intelligible routing error if it is
   not encodable;
3. retain the complete message as `RoutableId.id`; and
4. never extract a field merely because it is named `value`.

No new registry is needed because `DescriptorFieldMetadata` already owns the
authoritative ID schema.

## Evidence And Corrected Assumptions

- `EntityIds.pack()`, `entityStorageDescriptor()`, `canonicalEntityIdKey()`,
  `InboxMessages.inboxTargetId()`, and `InboxMessages.targetEntityId()` already
  pack, key, and unpack the full ID through the Entity state ID-field schema.
  `InboxTargets.key()` keys the complete typed `Any` (type URL and bytes).
- The actual restriction is shared route admission/replay code:
  `MessageIds.read()` admits only the exact `{ $typeName, value }` shape,
  `readMessageRouteId()` returns only that shape, and `RoutableId.value` encodes
  the obsolete primitive-only assumption. The replay path calls the same
  validator after descriptor-aware `Any` unpacking, so changing only live
  command/event routing would be incomplete.
- `MessageIds.key()` is unused by production routing/storage and encodes only
  one primitive `value`. It must not become a competing durable or
  deduplication-key format. Remove it or narrow it out of the general message-ID
  contract; canonical identity remains the existing packed-`Any` key.
- A present message ID is not blank merely because one
  nested scalar is default/blank. Its generated validation rules, if any, own
  field validity. Missing/null declaration-first message fields remain invalid.
- Scalar-ID repositories accept only primitive candidates. A custom route is
  the sole explicit mechanism for converting a message field to a scalar Entity
  ID.
- The verified local Spine JVM source archive at revision
  `461a8281e484c12636d8cf660a1d6c929fbbd7ec` contains
  `server/src/testFixtures/proto/spine/test/commandservice/customer/customer.proto`.
  It declares aggregate `Customer` with `CustomerId id`, where `CustomerId`
  consists of nested `time.LocalDate registration_date` plus `int32 number`.
  Its sibling `commands.proto` routes `CreateCustomer` by declaration-first
  `CustomerId customer_id`, and `events.proto` carries the same complete ID.
  The same archive contains many valid one-field IDs named `id`, `uuid`,
  `code`, and `reader`, including message-valued `LibraryCardId.reader`.
  `server/src/main/java/io/spine/server/entity/IdField.java` compares the state
  first-field runtime class with the Entity ID class and assigns the complete
  ID object; it contains no `value`-field or primitive-only rule.

The task statement that existing descriptor-aware storage can carry complete
messages is correct. The phrase “only legacy route-value validation” must be
read to include durable replay and the exported `MessageId`/codec declaration,
not just first-pass route calls.

## Public Contract

- Keep the package-root export named `MessageId`, but define/document it as a
  general Buf-generated Protobuf `Message` contract. It must require
  `$typeName` and must not declare a `value` member.
- Do not expose the repository's descriptor, registry, packed `Any`, canonical
  key, or route-validation internals through `MessageId`.
- `CommandRouting<Id>`, `EventRouting<Id>`, `StateUpdateRouting<Id>`, and the
  repository route result types retain their existing generic signatures.
- The identity represented by “complete message” is the set of fields declared
  by the authoritative schema. Existing `AnyMessages.pack()` deliberately omits
  unknown fields, so unknown-field wire baggage is not a distinct Entity ID and
  must not be documented as one.

## Ordered Behavioral Slices

### 1. General-message admission and public declaration

Owner: implementation owner; expected files
`packages/server/src/repository/primitive-id.ts`,
`packages/server/src/repository/repository.ts`, and focused server tests.

RED/GREEN acceptance:

- A generated one-field ID named `uuid` is assignable to public `MessageId` and
  routes without a `value` property.
- A generated composite ID modeled after JVM `CustomerId` (nested message plus
  scalar discriminator) is assignable and retained unchanged by a Command's
  declaration-first route and by a custom Command route.
- A present default message instance is not rejected by generic “blank” logic;
  schema validation options remain authoritative.
- A primitive, array, null, wrong `$typeName`, and an object not encodable by
  the target ID schema fail before route acceptance with the signal kind and
  expected ID type in the diagnostic.
- A message-valued candidate, including generated `TaskId`, is rejected for a
  primitive target unless an explicit custom route returns a primitive value.

### 2. All default and custom route sources preserve the whole value

Owner: implementation owner; expected test file
`packages/server/test/repository/repository-routing.test.ts`.

Use two composite IDs that share their nested/date component and differ only in
the second scalar field. Require:

- default Command first-field routing returns the exact composite ID;
- a compatible packed Event producer wins and returns the full unpacked ID;
- an incompatible producer falls back to the Event's declaration-first full
  composite ID;
- built-in state-update routing selects and returns a compatible full composite
  ID; and
- custom Event and custom state-update routes retain full IDs, stable-deduplicate
  an ID and its generated clone, and do not merge the second distinct ID.

These are separate assertions over the four route sources named by acceptance
criterion 4; a single custom-Event test is not sufficient.

### 3. Typed Inbox and persistence/reload

Owner: implementation owner; reuse existing in-memory storage and repository
test helpers. No delivery/storage production owner is required.

RED/GREEN acceptance:

- Command handoff stores the exact `Any` for the composite target; replay
  reconstructs the complete ID without rerunning the custom route and commits
  state under that ID.
- Projection or Process Manager Event handoff does the same through its durable
  Inbox path; replay uses the stored target.
- Current Entity state can be closed/reopened (or rehydrated through a fresh
  handle over the same factory) and read independently under both composite IDs.
- Produced Entity/System Event contexts contain the descriptor-typed complete
  ID, not one nested field.
- A stored target with the wrong type URL and a stored target with the correct
  type URL but malformed bytes fail before handler invocation.

Direct `EntityRecords.pack()` assertions alone do not satisfy reload or Inbox
replay.

### 4. Canonical identity and dispatch guards

Owner: implementation owner; expected tests in repository routing plus the
existing descriptor/Inbox helpers.

RED/GREEN acceptance:

- `descriptor.id.key(id)` equals the key for a generated clone of `id`.
- IDs differing only in the second composite field produce different packed
  `Any` keys and different storage records.
- A custom multi-target route returning `[idA, clone(idA), idB]` yields
  `[idA, idB]` in first-seen order.
- For a guarded Process Manager/Aggregate event path, `idA` and `idB` acquire
  independent guard identities; replaying the same source Event suppresses each
  duplicate without suppressing the other target.

Do not assert a new text key or snapshot raw base64 as a new format. The proof
is equality/non-collision through the existing key functions.

### 5. Focused regressions and declaration evidence

Owner: implementation owner.

- Retain existing one-field `TaskId`, int64 message ID, primitive int32/int64,
  wrong-message-type, malformed producer, route-once/replay, and message-ID
  query/subscription tests.
- Add a compile-time public-import assertion for `MessageId` through
  `packages/server/src/index.ts`, not a deep import.
- Record RED evidence before production changes, then run the task's focused
  server tests/coverage and prescribed `verify:release` only after review
  convergence.

## Compatibility Traps And Risks

- **Schema-free acceptance:** checking only `$typeName` would allow a forged or
  structurally incompatible candidate to pass direct `routeCommand()` /
  `routeEvent()` before later serialization. Bind validation to the known ID
  schema.
- **Implicit conversion regression:** a message with a `value` field must not
  become a primitive Entity ID without an explicit custom route.
- **Default-message regression:** recursively treating blank/default nested
  fields as an empty ID reintroduces invented policy. Presence and generated
  schema validation are the boundary.
- **Partial fix:** live routing may pass while Inbox replay still calls the old
  restrictive validator. Exercise stored replay explicitly.
- **Competing key formats:** `MessageIds.key()` JSON is neither used nor safe for
  general Protobuf values such as `bigint`, bytes, nested messages, or maps.
  Reuse packed `Any` identity everywhere.
- **Overstated canonicality:** required proof is stable identity for ordinary
  generated copies/clones and distinction of declared composite fields. Do not
  silently promise semantic canonicalization of arbitrary map insertion order
  or unknown fields without separate evidence and a storage-format decision.

## Explicit Exclusions

- No Protobuf source/generation change, registry, schema manifest, dependency,
  package manifest, lockfile, storage provider, durable-key format, or migration.
- No changes to Delivery wire envelopes, Inbox record schemas, Query/Subscription
  contracts, routing declaration APIs, first-field routing precedence, route
  cardinality, or route invocation timing.
- No generalized support for enum Entity IDs or additional primitive Entity ID
  kinds; JVM parity outside message-valued IDs remains separate work.
- No reader-documentation expansion unless implementation changes user-facing
  usage beyond correcting the exported `MessageId` declaration/TSDoc.

## Completion Gate

There is no architectural blocker. Implementation is accepted only if the
schema-aware route boundary, no-implicit-conversion primitive boundary,
complete-value Inbox replay, canonical-key/guard distinctions, and public type
correction all land together.

## Dispatch Metadata

The existing requirements-splitter/architecture role was explicitly dispatched
with `gpt-5.6-sol` and high reasoning. Runtime self-introspection was unavailable;
the immutable configured role/profile is the actual evidence, with no visible
fallback or mismatch.

## Fresh-review two-axis disposition

The fresh review correctly identified proof and reader-documentation gaps, not
a need to broaden the public `MessageId` contract or modify production routing.
The existing implementation owner was explicitly dispatched as
`gpt-5.6-terra` / high; runtime self-introspection is unavailable on this
surface.

- A generated one-field `CommandId` with `uuid` is assigned through the
  package-root `MessageId` import and routed with no `value` field.
- A custom Command route returns and preserves the whole generated composite
  ID, independently of declaration-first routing.
- A Process Manager command handoff persists the exact composite typed `Any`,
  replay does not rerun custom routing, and the state lookup uses the complete
  ID. The initial Projection-path test was RED because Projections do not own
  Entity Inbox command rows; the corrected Process Manager path passed with no
  production change.
- README and REFERENCE now describe complete generated Protobuf IDs, their
  state declaration, authoritative validation, and the explicit custom-route
  conversion required for a primitive target.

Verification after the correction passed the selected three regressions, the
two focused files (262 tests), focused coverage, `typecheck:tooling`, generated
documentation checks, affected-file ESLint, TSDoc, cleanup, formatting, and
`git diff --check`. No fresh-review finding remains open.
