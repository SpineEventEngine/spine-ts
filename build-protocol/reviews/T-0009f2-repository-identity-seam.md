# Review Log: T-0009f.2 Repository Identity And Entity Ownership Seam

Status: Round-5 findings fixed - Pending Re-review

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

## Current Review State

- First-, second-, third-, fourth-, and fifth-round comments are fixed. Orchestrator reviewer lanes
  should re-run before integration.
