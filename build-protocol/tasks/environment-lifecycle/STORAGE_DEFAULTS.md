# Readable Event Stores and shared stringifier defaults

Accepted implementation contract for the approved continuation of PR #20.
This supersedes D-0160's hashed Event Store naming. No existing-data migration
is part of this work.

## 1. Event Store contract

Keep the existing `StorageGroup` and `EventStoreGroups` concepts. Replace the digest
with the exact runtime Bounded Context name. Do not add a group-registration system,
name catalog in the database, tenant prefix, Event ID prefix, or new storage facade.

`EventStoreGroups.forContext(name, role = "domain")` keeps its present calling
convention: `name` is the actual selected name. For the System Context paired with
`Support`, callers already pass `Support_System` and `"system"`. Do not append another
suffix in this helper. Ordinary EventStore construction still selects domain role.

Provider defaults:

| Selected name                 | MySQL table            | PostgreSQL table       | Datastore kind         |
| ----------------------------- | ---------------------- | ---------------------- | ---------------------- |
| `Support`                     | `Support_Event`        | `support_event`        | `Support-Event`        |
| `Support_System`, system role | `Support_System_Event` | `support_system_event` | `Support_System-Event` |

The database/schema/namespace selector remains unchanged. System Event persistence
remains opt-in. Per-Entity Event history remains separate and retains its current
layout; use the hyphen change for Event Stores only in this slice.

### Public builder additions

Use explicit methods on the existing builders:

```ts
// MysqlStorageFactoryBuilder and PostgresStorageFactoryBuilder
setEventStoreTable(
  boundedContextName: string,
  tableName: string,
  role?: "domain" | "system",
): this;

// DatastoreStorageFactoryBuilder
setEventStoreKind(
  boundedContextName: string,
  kind: string,
  role?: "domain" | "system",
): this;
```

Default role is domain. The first argument is the actual selected name, exactly as
in `EventStoreGroups.forContext`, including `_System` for the paired System Context.
For example, `.setEventStoreTable("Support", "support_events")` and
`.setEventStoreTable("Support_System", "support_audit", "system")` affect only
those Event Stores. A domain Bounded Context named `Support_System` uses the same
first argument with the default domain role and is a different selection.

These are physical-name overrides, not custom Event Store implementations. Preserve
existing `setTableName` and `organizeRecords` APIs. Precedence is specific Event Store
override, existing applicable record/group override, then readable default. Broad
Event-record mappings still cannot make two distinct Event Stores share a physical
destination. Snapshot naming configuration into each built factory so a later builder
change cannot split preparation from reads in an existing factory.

### Domain/System collision without a new public role framework

Retain the existing role distinction as small provider-only metadata attached to
groups made by `EventStoreGroups`. A module-private WeakMap is sufficient. Store
`{ name, role }`; provide the provider entrypoint with a helper returning a stable
logical identity such as `JSON.stringify(["EventStore", role, name])` when this is an
Event Store group. Ordinary `StorageGroup` remains unchanged. Do not put a digest,
discriminator, or extra prefix in the readable group name.

Use that identity for precise overrides and collision claims; use `group.name` for
the physical-name default. Existing resolver identity is insufficient: both roles
currently collapse to the same source/record/group tuple after removing the digest.
`ContextParts.createBoundedContextName` only rejects blank/internal-prefix names;
it does not prevent this collision (`bounded-context.ts:3474`).

Persistent providers must reject equal physical destinations claimed by different
logical Event Store identities, even when record definitions are otherwise identical.
Thus Support's persisted System Events and a domain Bounded Context named
Support_System fail clearly by default; assigning one a distinct physical override
makes both valid. Error text names the physical name and both name/role selections.
Register/check the claim synchronously before table DDL, record acquisition or writes.
Repeated preparation/opening for the same identity is idempotent.

In memory, use this same role-aware logical key in backend declaration and record
binding. In-memory stores have no SQL/kind name to collide and may remain separate
under their logical keys. A shared `InMemoryStorageBackend` must preserve that
separation across factories. Do not make global Bounded Context naming restrictions
or reserve all names ending in `_System`.

### Normalization and collision scope

For Event Store SQL defaults, replace each character outside ASCII letters, digits
and underscore with underscore, then append `_Event`. PostgreSQL passes the result
through its existing physical folding. MySQL retains readable case. Do not truncate
or hash an overlong name; reject it and direct callers to the specific override.
Keep existing explicit-name validators and actual provider limits: PostgreSQL's
63-byte identifier constraint, MySQL's supported 64-character/ASCII-name constraint,
and Datastore's existing 1,500-byte kind constraint. These are existing backend
constraints, not newly chosen application caps. Leading-digit SQL defaults that
fail the existing validator also require an override.

For MySQL collision comparison, fold ASCII names case-insensitively, matching the
JVM's portable treatment of `lower_case_table_names`. Preserve emitted case. For
PostgreSQL use the actual `PostgresNames.physical` result, including its existing
explicit quoted-name behavior. Datastore retains the exact Bounded Context spelling
and compares exact kind strings. Do not sanitize an explicit override silently.

Check Event Store claims against other record families too. Existing SQL resolvers
already claim all resolved names; extend that path, rather than keeping an isolated
Event-only collision table that misses an Entity-history collision. Datastore's
native-definition signature must include the logical role-aware family identity,
so matching column layouts do not permit accidental sharing. The guarantee is for
configured/resolved families in one persistent factory, as in the existing JVM
implementation; this does not add a cross-process database catalog. Same configuration
on separate replicas must resolve deterministically. Tenants retain separate destinations
and use the same names; do not fold tenant identity into names or Event IDs.

### All paths that must converge

- `storage/src/event/event-store.ts`: default creation, append, read and provider helper.
- `server/src/context/bounded-context.ts`: domain/System construction and tenant preparation;
  `server/src/testing/index.ts`: System Event helper.
- `storage/src/memory/in-memory-storage-factory.ts` and
  `in-memory-entity-commit.ts`: declaration, backend key and atomic Event publication.
- Every persistent `storage-factory.ts`: ordinary record creation, preparation,
  Entity atomic commit and Agent atomic commit. MySQL also has direct Event-layout
  resolution at its current lines 790, 901 and 1003.
- SQL `table-resolver.ts`: exact override lookup and full-family collision claims.
- Datastore `storage-factory.ts` and `record-storage.ts`: share one resolved kind
  calculation; their current duplicated defaults must not diverge.

## 2. Shared default StringifierRegistry contract

Export `defaultStringifierRegistry` from `@spine-event-engine/core`. All three storage
builders and lower-level ID/column/record mappings use it by default. Applications
normally only build their factory. Optional custom conversion is:

```ts
defaultStringifierRegistry.register(CustomerIdSchema, customerIdStringifier);
```

Perform this startup configuration before preparing or using that type in storage.
Keep the existing `StringifierRegistry` class and explicit `setStringifierRegistry`
escape hatch for isolated converters. Do not require applications to construct one,
call `setTypeRegistry`, enumerate schemas, or pre-create default converters.

### Mutation, lifetime, and stable identifiers

Separate additive generated descriptors from custom conversion policy:

1. Generated schema registration is additive and idempotent for the same module /
   schema definitions. Conflicting module or full-type definitions fail clearly;
   never silently replace an existing type. Build a candidate descriptor registry
   before publishing it so a failed addition leaves the previous valid lookup intact.
2. Default message stringifiers resolve the current generated descriptor inventory
   when `toString`/`fromString` runs. A factory, ID mapper, or stringifier created before
   application module import therefore sees those descriptors once registration runs.
   Cache the built Protobuf-ES registry by inventory snapshot/revision; do not rebuild
   the entire schema graph for each cell conversion.
3. Unknown nonempty `Any` payload types fail conversion before storage mutation.
   Preserve current Proto JSON strictness; do not add a raw-bytes JSON fallback that
   would change identifier text once the descriptor later arrives.
4. For the shared singleton, pin the custom/default converter choice for a schema
   on the first `forMessage` lookup (also reached through `forField`). Reject attempts
   to register or replace that schema's converter afterwards; re-registering the
   identical converter reference may be idempotent. This allows late unrelated model
   loads while preventing a running store's identifier mapping from changing. A global
   freeze on first factory construction is unnecessary and breaks late module loading.
5. Keep standalone mutable-registry/copy behavior for explicit custom registries.
   Provider `setStringifierRegistry(custom)` snapshots custom converters at configuration
   as today. Default generated descriptor lookup is a live fallback even for these
   copies unless a caller explicitly supplied an isolated `setTypeRegistry` lookup.
   Explicitly supplied descriptor registries retain their existing snapshot semantics.
   Do not let `setTypeRegistry` replace the generated inventory on the shared singleton;
   reject that misuse clearly. No global reset/unregister API is needed for production.

Audit **all** `new StringifierRegistry(source)` calls. ID and column mappings in all
three providers currently copy registries, and Datastore additionally copies in the
factory constructor. Keep the shared singleton reference when it is the default;
retain copies only for intentionally isolated custom conversion configuration. A
copy must not turn the live generated descriptor source into an empty snapshot.

Continue using `AnyJsonUrls.restore` and the existing Proto JSON representation.
Preserve arbitrary original `Any.typeUrl` values, including nested messages, list/map/
oneof fields and nested Any, as current tests require. Adding unrelated descriptors
must not change a previously successful identifier string. Capture one descriptor
registry at the start of each synchronous conversion and use it for JSON parse/write
and URL restoration within that conversion.

### Generated startup without an import cycle

Do not import core from the generated module of `@spine-event-engine/proto`: core
already imports proto, and proto intentionally has no core dependency. Do not require
every schema-only application model to gain a new core dependency merely to register
its inventory.

Add a small generated-code inventory leaf beside the existing `ProtoModule` contract
in the proto package. Expose it on `@spine-event-engine/proto/codegen`, not as a new
ordinary application registry. Its required operations are only:

- `registerProtoModule(module: ProtoModule): ProtoModule`, returning the same module;
- a read-only stable snapshot of registered module roots for core's descriptor lookup.

The leaf imports only types and, if needed, Protobuf descriptor helpers. It must not
import proto's root barrel, core, server, storage or any generated model. Register
the same root idempotently; a conflicting same-name module must be rejected. A changed
snapshot gives core a cheap cache invalidation signal. Core reuses `TypeRegistry.from`
to compose dependencies and preserve its existing duplicate/cycle/metadata validation;
do not invent a second metadata/type-URL system.

`ProtoGenerator.writeModule` emits the registration as part of the exported module
initializer, around the existing frozen object. Generated application composition
continues to import the declared model modules and export `typeRegistry`; evaluating
those imports now automatically installs the whole declared dependency graph. The
framework proto module uses a relative import to the inventory leaf because it is
inside that package; external models use the codegen subpath. This special case
avoids a self-root barrel cycle without adding a dependency.

`TypeRegistry.from` itself stays a pure composition operation: test registries and
ad hoc explicitly scoped registries must not globally install arbitrary schemas.

JavaScript must execute a generated module. Existing application-mode startup imports
the generated `model-registry.ts`; keep that connection. Model-mode applications such
as Todo must retain a runtime import of `generated/proto-module.js` in startup/storage
assembly after removing their manual registry setup. A side-effect import is sufficient.
Directly importing an individual `_pb` leaf cannot discover unrelated declared model
packages and is not a substitute for the generated startup entrypoint. Do not add a
filesystem/package scan or hidden dynamic imports.

Preserve the startup module under bundling: generated registration calls must not be
marked pure. A package with `sideEffects: false` or a restrictive list must include the
generated proto-module / application-registry runtime path. Validate this in proto-tools
and give a clear generation-time error if its metadata would discard registration;
do not silently rewrite unrelated package metadata. Current workspace manifests do
not declare `sideEffects`, so they already retain side effects. Cover a bundler fixture
with an allowed side-effect path and a rejected blanket-false declaration. Imports of
generated dependency modules remain deterministic, as in the existing model graph.

The singleton is shared within the application's loaded canonical core package/module
instance, as normal ESM singletons are. Do not introduce `globalThis` symbols to merge
different installed framework versions or worker isolates.

## 3. Bounded Inbox correction

The follow-up scan in `inbox-and-schema.md` plus inspection confirms no current
predicate, order, cursor, index declaration or package-root API depends on the materialized
`inbox_id` / `signal_id` columns. Remove only those two `RecordColumn` entries from
`server/src/delivery/inbox-records.ts`, and update the focused direct-Inbox-record layout
assertion. Keep the Proto fields, validation, encoding/decoding and delivery semantics.
Keep `shard_index`, `shard_total`, `status`, `when_received`, `version`, `message_id`,
the provider primary key and serialized bytes. This is an ordinary bounded cleanup,
not an additional architecture milestone. No index or Inbox routing redesign.

## Acceptance

Prove readable defaults and exact overrides across providers; collision rejection
for names and domain/System roles; agreement across preparation, atomic commits,
ordinary writes and reads; and unchanged tenant and Event identity. Generated
model imports must supply application Any schemas without manual registry setup,
including when a converter was created before import. Preserve original Any URLs,
stable successful key strings, explicit custom-registry isolation and package
initialization without import cycles. Remove only the unused Inbox materializations.

Use existing behavior tests and narrow native-provider cases. Avoid a duplicate
provider matrix for behavior already demonstrated by shared contract tests.

JVM references: [Event Store](https://github.com/SpineEventEngine/core-jvm/blob/6b6219dc5f10bca1d4b137938b8a0b892fe61099/server/src/main/java/io/spine/server/event/store/DefaultEventStore.java),
[JDBC names](https://github.com/SpineEventEngine/jdbc-storage/blob/a1aff1065ffbd1205ed54f1aae703d5ec9a67bb8/rdbms/src/main/java/io/spine/server/storage/jdbc/record/TableNames.java),
[Datastore kinds](https://github.com/SpineEventEngine/gcloud-jvm/blob/7af1a18105d0cedcb186e76fd22d2a47007468df/datastore/src/main/java/io/spine/server/storage/datastore/Kind.java),
and [StringifierRegistry](https://github.com/SpineEventEngine/base-libraries/blob/bb53ee47fec25874c9fe588f26a1a9e87c21cdde/base/src/main/java/io/spine/string/StringifierRegistry.java).

## Implementation and review record — 29 October 2026

The continuation runs in the existing `environment-lifecycle` worktree from
`b2de1d286f0d3da568368b96d3f04fab60229ca5`. Runtime implementation uses the existing
implementer function with explicitly dispatched `gpt-6-sol` / `medium`. One fresh
requirements-splitter pass used explicit `gpt-6-astra` / `high` to settle this
contract. Desktop supports these explicit profiles; separate runtime model
introspection was not exposed. No child agent spawned another agent.

Readable naming, exact Event Store overrides, generated schema inventory, shared
stringifier defaults, provider adoption, and the two-column Inbox removal are
implemented. Focused core/provider/Inbox tests, native PostgreSQL/MySQL/Datastore
cases, package typechecks, generated-artifact checks, cleanup rules, TSDoc, and
changed-file ESLint passed before specialist review. Focused V8 inspection covered
all changed executable core lines; this is not a substitute for the pending full
release coverage gate.

The first independent review wave used the existing TypeScript/API,
performance/reliability, and style reviewers, each explicitly dispatched as
`gpt-6-sol` / `medium`, plus the documentation reviewer as explicit
`gpt-6-luna` / `medium`. Reviewers received fresh contexts and did not edit files.
The combined accepted correction batch is:

- Reject invalid descriptor graphs before publishing the shared inventory,
  including duplicate types inside one module; retain the previous usable lookup.
- Check package side-effect declarations against emitted runtime JavaScript,
  rather than accepting a source-only TypeScript allowlist.
- Apply that check to application-mode generated registries as well as model modules.
- Complete the narrow codegen/export/startup documentation.
- Replace model-schema declarations in the guide with imports from a real generated
  guide model; explain the concrete in-memory identifier key, Inbox status-filter
  calls, EntityRecord wrapper, and ordered tenant preparation.

The readability finding about in-memory representation is classified as P2
explanatory incompleteness, not a P1 runtime defect. Its proposed claim that memory
never converts IDs to strings was rejected after source inspection: the backend
uses an internal tagged canonical string key. The guide now explains that format.

The guide's model is materialized in
`packages/server-blackbox-tests/proto/example/support/storage_layout.proto`. It represents the
same domain types shown in the document and enables real generated imports in
strictly compiled snippets. It does not alias unrelated existing model types.

A separate source check found that Datastore's source-and-record kind override
matches both Entity current state and state history. The guide documents the
absence of a history-only override and removes the misleading example. This
continuation does not introduce another Datastore layout API.

Documentation follows the human's requested conversational style; documentation,
humanizer, and coauthoring skills are not applied. The guide retains both tenancy
chapters, all provider layouts and creation responsibilities, 90 binary-payload
cells with the requested wording, and a contents list covering every subsection.
The full guide Proto compiled and its initial rewritten TypeScript snippets passed;
all snippets with the real generated imports now compile. Canonical generation and
generated-current checks also pass.

Targeted API and reliability re-review accepted the corrections. The independent
readability re-review accepted the revised guide. Style re-review found one further
P2 in the same output-path calculation: applications without `outDir` emit beside
the source, so checking a presumed `dist` path can lose registration during bundling.
That correction returns to the same implementer with a focused regression.

Final security review is assigned to the existing security reviewer with explicit
`gpt-6-sol` / `high`, fresh read-only context, no child agents. Scope is this
continuation's generated descriptor registration, naming configuration, and changed
persistence paths; the earlier changeset already received its security review.
Actual runtime model introspection remains unavailable; explicit configured dispatch
is the acceptance evidence. Security review completed with no findings. Both full
and production dependency audits reported no known vulnerabilities.

Final mechanical release verification is an orchestrator-dispatched function using
explicit `gpt-6-luna` / `low`, read-only, without child agents. It starts only after
the final cheap preflight and targeted review correction pass. It runs the existing
`verify:release` procedure once, records the result and coverage, and returns any
failure for classification before a retry; it does not invent a verifier role.

All specialist and security concerns converged after the output-path correction.
The first full release run passed generation and compilation, then stopped at
three lint errors in new tests (two void-expression assertions and one non-null
assertion). Tests and coverage were not reached. These deterministic corrections
return to the same implementer, followed by the complete cheap preflight over all
changed code files. No new specialist review is needed for assertion formatting.
An extra documentation check overlapped with the release rebuild and saw missing
declarations; it was stopped. The release log had no declaration failure, and
subsequent verification runs are serialized.

The test-lint corrections passed all changed-file checks and focused tests. The
second release run passed every pre-test gate, then reported seven failures among
6,299 tests: old package export expectations, old example manual-stringifier
assertions, a copied Todo module registration in the registry-retry fixture, and
external-consumer composition while calculating generated output. The same
implementer is correcting the full batch and investigating the two runtime/tooling
triggers before any further release run. No coverage result is claimed from the
failed run.

The two investigated triggers require bounded corrections. The Todo retry fixture
loads a copied physical Protobuf module with the same package identity; it will
reuse the canonical generated module while retaining its private handler-registry
failure/retry scenario. Inventory conflict checks remain unchanged. Composition
can run before its first generated source exists, so output-path calculation must
allow TypeScript diagnostic 18003 (no inputs yet) and reject every other config
diagnostic. The planned generated source then participates in TypeScript's output
calculation. Existing external-consumer coverage and a focused empty-source
regression validate this path.

The seven failure corrections pass 219 affected tests and both packed external
consumer tests. An additional bounded API check confirmed that translating every
glob `*` to `.*` could approve a startup file that a bundler would remove. The
matcher will use Node's existing `path.matchesGlob`, normalize the optional `./`,
and apply the package side-effects basename convention. Focused regressions cover
single-segment `*`, recursive `**`, and basename patterns. No dependency is added.

The glob correction and full cheap preflight passed. The third release run
passed all static/generated gates and all tests: 396 files passed, two skipped;
6,287 tests passed and 14 skipped. It stopped solely at global branch coverage:
20,809 of 23,122 branches (89.99%), below the required 90%. Statements, functions,
and lines passed at 93.54%, 95.61%, and 95.34%. The implementer is inspecting
uncovered branches in changed code and adding a meaningful missing-contract test;
thresholds and coverage scope remain unchanged.

The focused regression proves that an invalid TypeScript target is rejected before
source publication and that valid configuration then composes successfully. V8
confirmed the previously uncovered rejection branch is exercised.

Final `pnpm verify:release` passed in 424.49 seconds: 396 test files passed and two
were skipped; 6,287 tests passed and 14 were skipped. All 39 Node-generated tests
passed. Coverage is 93.54% statements, 90.00% branches (20,810/23,122), 95.61%
functions, and 95.35% lines. Every static/generated/documentation gate passed.
Independent reviewer concerns are accepted, including security; full and production
dependency audits found no known vulnerabilities. The documentation reviewer
accepted the revised reader walkthroughs and all required inventories.

Status: implementation complete, reviewed, and release-verified. Publish this
accepted tree on `environment-lifecycle` and update existing PR #20. The resulting
feature-branch SHA and current-head CI results are recorded by Git/GitHub and the
task conversation, avoiding a follow-up commit merely to record its predecessor.
