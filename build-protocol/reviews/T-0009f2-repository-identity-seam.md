# Review Log: T-0009f.2 Repository Identity And Entity Ownership Seam

Status: Complete; All Review Lanes Clean; Integrated Into Parent

## Required Review Lanes

- code style/maintainability,
- documentation,
- TypeScript/API docs,
- security,
- performance/reliability.

## Review Rounds

- Implementation sub-agent completed code/docs/tests and full verification.
- First-round reviewer findings received by the review-fix sub-agent:
  - Code style/maintainability P2 and performance/reliability Medium:
    `Repository` froze `this` in the base constructor, preventing future
    subclasses from initializing fields after `super(...)`.
  - TypeScript/API P2: `RepositoryOptions` allowed independent schema and
    entity constructor types, and `RepositoryEntityType` was too structurally
    permissive for TypeScript callers.
  - Docs P3: package README used `Repository({ entityType, schema })` instead
    of constructor syntax.
  - Docs Low: API current-status text omitted the metadata-only repository
    identity seam.
- Fix status:
  - Fixed: removed base `Object.freeze(this)` while preserving immutable
    metadata/detail objects and frozen fresh-copy snapshots.
  - Fixed: tightened public repository entity constructor/options types so
    TypeScript callers must pair aggregate/projection/process-manager
    constructors with the constructor-carried schema; JS/cast inputs still fail
    at runtime with `RepositoryIdentityError`.
  - Fixed: added negative type tests for mismatched schema pairs and plain
    classes, plus a subclass initialization regression test.
  - Fixed: updated `packages/server/README.md` and `docs/api/README.md`.
- Second-round reviewer findings received by the review-fix sub-agent:
  - Documentation Low: `docs/architecture/README.md` still described storage
    metadata as supporting a future repository seam "without introducing
    repository classes in this slice," which was stale after adding the
    metadata-only `Repository` identity class.
  - TypeScript/API P2: bare annotated `RepositoryOptions` still defaulted to a
    broad `RepositoryEntityType`, allowing annotated options to pair an
    aggregate entity constructor with a projection schema.
  - Security Low: runtime accepted a forged non-function object with
    `{ name, prototype }` shaped like an aggregate/projection/process-manager
    constructor.
- Round-2 fix status:
  - Fixed: architecture docs now distinguish deferred repository
    runtime/storage behavior from the present metadata-only `Repository`
    identity class.
  - Fixed: removed the default generic from exported `RepositoryOptions`, so
    bare annotations cannot erase the entity constructor's schema constraint;
    explicit `RepositoryOptions<typeof Entity>` annotations reject mismatched
    schemas.
  - Fixed: added a runtime function/class-constructor guard before schema
    introspection and covered forged non-function prototype-chain objects with a
    regression test.
  - Verified: focused RED reproduced the runtime and type holes; focused
    Vitest, `corepack pnpm typecheck:tooling`, `node scripts/check-api-docs.mjs`,
    and `CI=true corepack pnpm verify` passed after the fixes.
- Third-round reviewer findings received by the review-fix sub-agent:
  - Performance/reliability Medium: the non-function guard called
    `entityTypeName(options.entityType)`, but `entityTypeName` assumed a string
    `.name`, so malformed JS/cast inputs such as `null`, `undefined`, or `{}`
    could throw `TypeError` instead of `RepositoryIdentityError`.
  - Security Medium: the `Repository` constructor reread `options.entityType`
    and `options.schema` after validation, allowing accessor/proxy-backed
    options to diverge between the validated family and stored snapshot values.
  - TypeScript/API P2: `RepositoryEntityType` lacked a construct signature, so
    non-function object literals with a real prototype still type-checked.
- Round-3 fix status:
  - Fixed: `entityTypeName` now accepts `unknown` and falls back to
    `(anonymous)` for nullish, non-object, nameless, or non-string-name values.
  - Fixed: `Repository` captures `const entityType = options.entityType` and
    `const schema = options.schema` once at constructor entry, then validates,
    resolves family, and stores only those locals.
  - Fixed: exported `RepositoryEntityType` is now an abstract construct
    signature intersected with the existing `prototype`/`name` metadata, and
    compile-time tests cover non-function object literals without casts.
  - Verified: focused RED reproduced all three holes; focused Vitest,
    `corepack pnpm typecheck:tooling`, `node scripts/check-api-docs.mjs`, and
    `CI=true corepack pnpm verify` passed after the fixes.
- Fourth-round reviewer findings received by the review-fix sub-agent:
  - Documentation Low: `docs/USER_GUIDE.md` top Current status paragraph omitted
    the metadata-only repository identity seam.
  - Performance/reliability Medium: `Repository` dereferenced
    `options.entityType`/`options.schema` before validating that `options` was a
    non-null object, so nullish JS/cast callers received `TypeError`.
  - TypeScript/API P2: `Repository` still defaulted its generic to broad
    `RepositoryEntityType`, allowing subclasses written as `extends Repository`
    to avoid binding their constructor/schema pair.
- Round-4 fix status:
  - Fixed: user-guide Current status now mentions the repository identity
    metadata layer.
  - Fixed: `Repository` validates the options container before property access
    and returns deterministic `RepositoryIdentityError` details for nullish
    options.
  - Fixed: removed the default `Repository` generic; subclass tests now use
    `extends Repository<typeof TaskProjection>` and negative type tests cover
    unbound and schema-mismatched subclasses.
  - Verified: focused RED reproduced the nullish-options `TypeError` and unused
    subclass `@ts-expect-error`; focused Vitest passed with 18 tests, tooling
    typecheck passed, `node scripts/check-api-docs.mjs` passed, and full verify
    passed.
- Fifth-round reviewer findings received by the review-fix sub-agent:
  - Performance/reliability Medium: `repository.ts` called
    `describeEntityMetadata(schema)` before any schema guard, allowing
    missing/malformed schemas from JS/cast callers to escape through raw
    descriptor/`TypeError` paths.
  - Security Medium: `repository.ts` introspected schemas before proving the
    constructor was a supported aggregate/projection/process-manager type.
  - Security Low: `resolveEntityFamily` trusted only the instance prototype
    chain, so an ordinary function with a forged `.prototype` chain could look
    like a repository entity family.
  - TypeScript/API P2: broad and union repository generic bindings still erased
    constructor/schema pairing for `RepositoryOptions` and subclasses.
- Round-5 fix status:
  - Fixed: `Repository` now validates the options container and function shape,
    resolves the supported family, and rejects unsupported entity types before
    any schema introspection.
  - Fixed: supported entity types with missing or malformed schemas now receive
    deterministic `RepositoryIdentityError` details instead of raw descriptor or
    `TypeError` exceptions.
  - Fixed: family detection now requires both static constructor inheritance and
    prototype inheritance for `Aggregate`, `Projection`, or `ProcessManager`.
  - Fixed: exported repository generic constraints reject broad
    `RepositoryEntityType` and union constructor bindings for both
    `RepositoryOptions` and `Repository` subclasses.
  - Verified: focused RED reproduced the raw schema exceptions and unused
    broad/union type assertions; focused Vitest passed with 19 tests, tooling
    typecheck passed, `corepack pnpm lint` passed, and
    `node scripts/check-api-docs.mjs` passed after the fixes. Full
    `CI=true corepack pnpm verify` passed with 17 test files and 178 tests.
- Sixth-round reviewer findings received by the review-fix sub-agent:
  - Code style/maintainability P2: `hasEntityFamilyInheritance` checked both
    static and instance prototype chains, but an ordinary function could spoof
    both with `Object.setPrototypeOf(Forged, Aggregate)` and
    `Object.setPrototypeOf(Forged.prototype, Aggregate.prototype)`.
  - TypeScript/API P2: family-specific broad generic bindings such as
    `RepositoryEntityType<Aggregate<unknown, DescriptorMessageSchema, number>>`
    could still erase the constructor-carried state schema for
    `RepositoryOptions` and `Repository` subclasses.
- Round-6 fix status:
  - Fixed: repository identity now requires a runtime ES class constructor
    before family resolution, so ordinary functions cannot spoof both
    inheritance chains.
  - Fixed: exported repository generic constraints now reject broad extracted
    schemas in addition to exact broad and union entity constructor bindings.
  - Fixed: regression tests cover the static-plus-prototype forged function
    case, family-broad `RepositoryOptions`, and family-broad subclass bindings.
  - Verified: focused RED reproduced the forged runtime acceptance and unused
    family-broad type assertions; focused Vitest passed with 19 tests and
    `corepack pnpm typecheck:tooling` passed after the fixes. API docs guard
    passed, and full `CI=true corepack pnpm verify` passed with 17 test files
    and 178 tests.
- Seventh-round reviewer findings received by the review-fix sub-agent:
  - Documentation Low: `IMPLEMENTATION_REPORT.md` and
    `docs/architecture/README.md` still described repository family inference
    as constructor/prototype-chain only.
  - Security/performance: a forged ES class could still spoof both static and
    prototype inheritance with `Object.setPrototypeOf(Fake, Aggregate)` and
    `Object.setPrototypeOf(Fake.prototype, Aggregate.prototype)`.
  - Security/performance: diagnostic helpers read malformed input `name` and
    schema `typeName` directly, so accessor/proxy-backed values could throw raw
    errors instead of structured `RepositoryIdentityError` diagnostics.
  - TypeScript/API P2: schema-union entity bindings still erased the concrete
    schema for `RepositoryOptions` and `Repository` subclasses.
  - TypeScript/API P3: exported signatures needed public-facing docs for the
    single concrete constructor/concrete state schema rule rather than exposing
    helper constraints without explanation.
- Round-7 fix status:
  - Fixed: docs now describe family inference as a declared ES class subclass
    relationship plus static and instance prototype-chain checks, and note that
    this remains a metadata-only same-realm guard rather than a sandbox
    boundary.
  - Fixed: repository identity now rejects prototype-reparented ES classes that
    do not declare a subclass relationship, covering the forged class pattern.
  - Fixed: optional diagnostic reads now catch throwing `name` and `typeName`
    accessors, falling back to `(anonymous)` and omitting
    `stateFullTypeName`.
  - Fixed: exported repository generic constraints now reject schema-union
    extracted state schemas for both `RepositoryOptions` and `Repository`
    subclasses.
  - Fixed: `RepositoryOptions` and `Repository` type parameters have JSDoc
    explaining the single concrete constructor and concrete state schema rule.
  - Verified: focused RED reproduced the forged ES class, throwing diagnostic
    accessors, and unused schema-union type assertions; focused Vitest passed
    with 19 tests and `corepack pnpm typecheck:tooling` passed after the fixes.
    API docs guard passed, and full `CI=true corepack pnpm verify` passed with
    17 test files and 178 tests.
- Eighth-round reviewer findings received by the review-fix sub-agent:
  - Performance/security: `Repository` still read `options.entityType` and
    `options.schema` directly, so throwing accessors or revoked proxy options
    could escape raw errors before `RepositoryIdentityError`.
  - Code/security: `declaresSubclass()` only checked source text for `extends`,
    allowing unrelated subclasses or comments/static strings to pass after
    prototype reparenting.
  - TypeScript/API P2: `SingleConcreteRepositoryEntityType` still permitted
    family-broad constructor aliases with concrete schemas for
    `RepositoryOptions` and `Repository` subclass bindings.
  - TypeScript/API P2: `RepositoryIdentitySnapshot` exposed independent
    `Schema` and `EntityType` generics, allowing impossible snapshot types.
- Round-8 fix status:
  - Fixed: repository construction now reads `entityType` and `schema` through
    guarded single-read helpers, wrapping throwing getters and revoked proxy
    options in deterministic `RepositoryIdentityError` diagnostics.
  - Fixed: the runtime declared-subclass check now inspects only the class
    header and requires its direct `extends` identifier to match the resolved
    built-in family base class, covering reparented `class ... extends Other`
    forgeries while preserving the same-realm metadata boundary.
  - Fixed: exported repository generic constraints now reject constructor
    aliases with erased `never[]` constructor parameters, including
    family-broad aliases that carry a concrete state schema.
  - Fixed: `RepositoryIdentitySnapshot` now takes the entity constructor as its
    only generic and derives `stateSchema`, `metadata`, and
    `stateFullTypeName` from that constructor-carried schema.
  - Verified: focused RED reproduced the raw options accessor error, unrelated
    subclass forgery, old independent snapshot generic, and unused
    concrete-schema family-broad type assertions; focused Vitest passed with 20
    tests and `corepack pnpm typecheck:tooling` passed after the fixes. API
    docs guard passed, and full `CI=true corepack pnpm verify` passed with 17
    test files and 179 tests.
- Ninth-round reviewer findings received by the review-fix sub-agent:
  - Code/performance/TypeScript: `declaresSupportedEntitySubclass()` parsed
    source text and rejected valid subclasses using alias imports,
    namespace/member base expressions, or intermediate domain base classes.
  - TypeScript/API P2: manually spelled family-broad constructor aliases with
    real constructor parameters could still satisfy `RepositoryOptions` and
    `Repository` subclass bindings.
  - Documentation/API: if valid same-realm prototype-reparented ES classes
    remain trusted, docs and tests must describe that explicit metadata
    boundary and must not claim those classes are rejected.
- Round-9 fix status:
  - Fixed: removed source-name subclass parsing from repository family
    acceptance. Runtime validation now requires an ES class constructor plus
    same-realm constructor and instance prototype chains reaching `Aggregate`,
    `Projection`, or `ProcessManager`.
  - Fixed: added regression coverage for aliased aggregate bases,
    namespace/member base expressions, and intermediate domain aggregate base
    classes.
  - Fixed: documented and tested the explicit same-realm metadata boundary:
    prototype-reparented ES classes with matching same-realm family prototype
    chains are trusted rather than rejected.
  - Fixed: added a type-only inherited entity-constructor brand to reject
    manually spelled family-broad constructor aliases with real constructor
    parameters for both `RepositoryOptions` and `Repository` subclasses.
  - Verified: focused RED reproduced the source-name parser rejection and
    unused manual-constructor type assertions; focused Vitest passed with 22
    tests, `corepack pnpm typecheck:tooling` passed, and
    `node scripts/check-api-docs.mjs` passed after the fixes. Full
    `CI=true corepack pnpm verify` passed with 17 test files and 181 tests.
- Tenth-round reviewer findings received by the review-fix sub-agent:
  - Code style/TypeScript/API P2: `RepositoryEntityType` relied on the public
    string brand `__spineTsEntityConstructorBrand`, so callers could spell the
    brand structurally and bypass the manually broad constructor alias guard.
  - TypeScript/API P3: public TypeDoc signatures exposed private repository
    helper names and the old internal brand as part of the main contract.
  - Performance/reliability Medium: `hasEntityFamilyInheritance()` let
    exceptions from caller-controlled constructor/prototype chains escape as
    raw errors.
  - Documentation Low: `packages/server/README.md` needed a short note tying
    this identity seam to Spine `core-jvm` `Repository` identity concepts while
    keeping runtime behavior deferred.
- Round-10 fix status:
  - Fixed: replaced the public string-keyed entity-constructor brand with a
    TypeScript-only protected constructor-side marker inherited by built-in
    entity constructors. The marker is not a public `RepositoryEntityType`
    string property and emits no runtime brand property.
  - Fixed: public signatures now use `ConcreteRepositoryEntityType` and
    `RepositoryStateSchema`; the API docs guard rejects the old private helper
    names and old string brand from TypeDoc JSON.
  - Fixed: family inheritance checks catch prototype-chain/proxy exceptions
    and return unsupported-family structured `RepositoryIdentityError`
    diagnostics.
  - Fixed: package README now states that the seam follows Spine `core-jvm`
    `Repository` identity concepts closely while deferring runtime behavior.
  - Verified: focused RED reproduced the hostile prototype-chain raw error and
    unused public-string-brand type assertions; focused Vitest passed with 23
    tests, `corepack pnpm typecheck:tooling` passed, and
    `node scripts/check-api-docs.mjs` passed after the fixes. Full
    `CI=true corepack pnpm verify` passed with 17 test files and 182 tests.
- Eleventh-round reviewer findings received by the review-fix sub-agent:
  - Code style P2: the protected static constructor marker in the built-in
    entity constructor base was not declaration-only under the ES2024 target
    and emitted a runtime static field.
  - Code style P3 / TypeScript/API P2: generated TypeDoc still exposed
    repository type-internal diagnostic pseudo-properties and helper names.
  - Reliability Low: repository diagnostics called `entityTypeName(entityType)`
    multiple times in single failure paths, allowing volatile `name` accessors
    to produce inconsistent messages and details.
- Round-11 fix status:
  - Fixed: renamed the nominal constructor-side marker base to
    `EntityConstructor` and changed the inherited marker to a `declare`
    protected static field, preserving the type-only guard without a runtime
    brand property.
  - Fixed: `ConcreteRepositoryEntityType` now uses `never` invalid branches and
    the built-in `ConstructorParameters` helper, removing the leaked diagnostic
    pseudo-properties and custom helper names from TypeDoc.
  - Fixed: `scripts/check-api-docs.mjs` now rejects the round-11 leaked names
    and replacement constraint-marker names from TypeDoc JSON.
  - Fixed: `Repository` captures the entity type display name once after the
    guarded option read and reuses it in unsupported-type, unreadable-schema,
    malformed-schema, and schema-kind mismatch diagnostics.
  - Verified: focused RED reproduced the runtime marker leak, volatile
    diagnostic mismatch, and TypeDoc leaks. Focused Vitest passed with 25
    tests, tooling typecheck passed, and `node scripts/check-api-docs.mjs`
    passed after the fixes. Full `CI=true corepack pnpm verify` passed with 17
    test files and 184 tests.
- Twelfth-round reviewer findings received by the review-fix sub-agent:
  - TypeScript/API P2: `RepositoryEntityType` still exposed the hidden nominal
    base in generated API docs because it intersected with
    `typeof EntityConstructor`; generated TypeDoc JSON/HTML still contained
    `EntityConstructor` in repository signatures and the `Entity` hierarchy.
  - Code style/TypeScript P3: repository tests only checked the old runtime
    marker name and did not assert that the current declaration-only
    `spineTsEntityConstructor` marker stays out of aggregate/projection/process
    manager constructor values.
- Round-12 fix status:
  - Fixed: renamed the inherited nominal marker base away from
    `EntityConstructor` and changed `RepositoryEntityType` to intersect with
    the neutral `EntityStaticMarkerBase` type, preserving the existing
    constructor nominal guard while removing `EntityConstructor` from generated
    TypeDoc JSON.
  - Fixed: `scripts/check-api-docs.mjs` now rejects `EntityConstructor` from
    TypeDoc JSON, and focused RED showed the guard caught the previous leak.
  - Fixed: repository tests now assert `"spineTsEntityConstructor" in
Aggregate`, `Projection`, and `ProcessManager` is false.
  - Verified: focused Vitest passed with 2 files and 25 tests;
    `corepack pnpm typecheck:tooling` passed; `node scripts/check-api-docs.mjs`
    passed; full `CI=true corepack pnpm verify` passed with 17 test files and
    184 tests.
- Thirteenth-round reviewer findings received by the review-fix sub-agent:
  - Code style / TypeScript/API P2: generated TypeDoc still leaked the
    current nominal marker machinery. `RepositoryEntityType` intersected with
    `EntityStaticMarkerBase`, repository constructor docs expanded that as
    `typeof EntityStaticMarkerBaseClass`, and `Entity` hierarchy docs showed
    the marker base class.
  - API docs guard false-negative: `scripts/check-api-docs.mjs` rejected older
    leaked names but not `EntityStaticMarkerBase` or
    `EntityStaticMarkerBaseClass`, so the guard passed while the current marker
    names remained visible.
- Round-13 fix status:
  - Fixed: removed the separate entity static marker base class from the
    public `Entity` inheritance chain. The declaration-only protected static
    nominal marker now lives on `Entity` itself, so generated hierarchy docs no
    longer need to mention a marker base.
  - Fixed: reshaped `RepositoryEntityType` to intersect with the public
    `typeof Entity<any, DescriptorMessageSchema, any>` static side instead of
    a marker-named helper, preserving the protected static nominal guard and
    the old public string-brand bypass protection without publishing
    implementation marker names.
  - Fixed: expanded the TypeDoc guard to reject the current
    `EntityStaticMarkerBase`/`EntityStaticMarkerBaseClass` names and generic
    marker-shaped leaks (`Entity*Marker*`, `*EntityConstructor*Brand*`, and
    `spineTs*`).
  - Verified RED: after adding the guard checks but before reshaping the types,
    `node scripts/check-api-docs.mjs` failed on `EntityStaticMarkerBase`,
    `EntityStaticMarkerBaseClass`, and the generic marker-name pattern.
  - Verified focused checks: focused Vitest passed with 2 files and 25 tests;
    `corepack pnpm typecheck:tooling` passed; `node scripts/check-api-docs.mjs`
    passed after the marker reshaping.
  - Verified full check: `CI=true corepack pnpm verify` passed with 17 test
    files and 184 tests, coverage, docs check, proto lint/generate, and
    generated-clean.

## Current Review State

- First-, second-, third-, fourth-, fifth-, sixth-, seventh-, eighth-, ninth-,
  tenth-, eleventh-, twelfth-, and thirteenth-round comments are fixed.
- Fourteenth-round reviewer lanes reported no remaining comments:
  code style/maintainability, documentation, TypeScript/API docs, security,
  and performance/reliability.
- T-0009f.2 merged into the parent branch on `2026-06-30 11:28 WEST` as merge
  commit `748798b`, and parent verification passed after integration.
