# Wave 3 Proto Model Modules Plan

Status: Approved for autonomous implementation

Task: `T-0073`

## Outcome

An application can develop one or more independently published Protobuf model
packages outside this monorepo, import types across those packages, generate
TypeScript without duplicating dependency messages, and explicitly compose
Spine-native and application-owned schemas for dynamic `Any` decoding.

## Frozen Public Contract

### Ownership

- `@spine-event-engine/proto` owns Spine-native Proto sources, generated
  ESM/declarations, the Spine manifest, `ProtoModule`, and
  `spineProtoModule`.
- `@spine-event-engine/proto-tools` exposes `spine-proto` and owns
  configuration validation, installed-manifest resolution, safe staged
  generation, dependency-import linking, and application composition.
- `@spine-event-engine/core` owns `TypeRegistry.from()` and
  `unpackAnyUsing()`. It scans no installed packages and mutates no global
  registry.
- Each app model owns its `.proto` source tree, generated ESM/declarations,
  manifest, and generated `<model>ProtoModule`.

### Runtime descriptor

```ts
interface ProtoModule {
  readonly name: string;
  readonly schemas: readonly MessageSchema[];
  readonly dependencies: readonly ProtoModule[];
}
```

Generated module values freeze their arrays and object. Dependencies are
direct. Composition is deterministic dependency-first traversal, deduplicates
the same module definition, and fails when the same name has different
content.

```ts
const types = TypeRegistry.from(usersProtoModule, chatProtoModule);
const known = unpackAny(value, ChatMessageSchema);
const dynamic = unpackAnyUsing(types, value);
```

Dynamic unpack returns a Protobuf-ES `Message` or `undefined` for an unknown
exact type URL or malformed payload. It never guesses by suffix/full name.

### Build configuration and manifest

One versioned root `spine-proto.json` has exactly one mode.

Model mode declares the package name, owned Proto root, generated TypeScript
root, compiled export root, direct model dependency package names, and
generated module export name. Application mode declares top-level model
package names and the generated registry output file.

All paths are normalized, relative, contained by the package root, and cannot
pass through symlinks. Direct model dependencies must also be ordinary
dependencies in `package.json`.

The deterministic `spine-proto-manifest.json` ships its format version, package
name/version, owned canonical Proto paths, generated export mapping, direct
model dependencies and compatible manifest format, and the `ProtoModule`
export. It contains no absolute or workspace path. Package exports expose
generated modules, Proto sources, descriptor module, and manifest.

## Failure Rules

Before output replacement, reject duplicate canonical Proto ownership, message
names or type URLs; undeclared dependencies; incompatible/mismatched installed
manifests; cycles; missing import ownership; path or symlink escapes; missing
generated export mappings; and payloads containing absolute, `workspace:`, or
`file:` dependencies. Errors name the package and offending item. Output is
staged and replaced only after all validation and generation/linking succeeds.

## Dependency-Ordered Slices

### A — Runtime model and dynamic `Any`

Ownership: `packages/proto/**` descriptor/exports and `packages/core/**`
registry/`Any`.

TDD: descriptor immutability and exports; transitive order/deduplication and
conflicts; known/unknown/malformed/transitive dynamic unpack; declaration and
package-import fixtures.

### B — External model generator and linker

Ownership: new `packages/proto-tools/**`, shared generation integration, and
tool fixtures.

TDD: config/manifest errors; graph/path ownership/cycles/conflicts; staged
owned-only Buf generation and dependency import linking; deterministic
manifest/module output; rollback and symlink/path containment. Reuse Buf and
Protobuf-ES; do not invent a Proto parser/compiler.

### C — Example model migration

Ownership: `examples/**` model packages/configuration, application composition,
docs, and tests.

Every maintained example uses `spine-proto`. Introduce the continuing Chat
example required for Waves 4-6 with `users-model` and `chat-model`;
`chat-model` imports `UserId` from `users-model`. Application code uses model
package exports and its generated registry. Existing example behavior remains
intact, and generated Spine dependency messages are not duplicated.

### D — Fresh-repository acceptance and closure

Ownership: external-consumer harness, end-user/package/API docs, release scans,
and Wave records.

Pack registry-equivalent Spine artifacts; build and pack `users-model`; install
it to build and pack `chat-model`; install both plus Spine tarballs in a third
fresh Chat application; compile/start it; pack/dynamically unpack Spine,
Users, and Chat messages; and reject monorepo paths, `workspace:`, `file:`, or
duplicated dependency output.

Documentation covers layout, configuration, source imports, npm dependencies,
generation, exports, composition, `Any`, combined-model packages, failures,
clean checkout/CI, and future publication assumptions.

## Gates

Run focused deterministic checks before relevant specialist review. All four
canonical concerns apply across the Wave. Run a final security review for
manifest trust, path containment, generated-import injection, unsafe `Any`
deserialization, and resource exhaustion. Full native verification with at
least 90% branch coverage runs before integration and again on merged `main`.

## Later Waves

- Wave 4: browser client and TS/JVM service interoperability, universal
  gRPC-Web, optional Connect optimization, authentication integration points,
  and cluster-completeness Q&A.
- Wave 5: storage-neutral production packaging/deployment.
- Wave 6: cluster-complete horizontal subscriptions while connected.

Do not publish to npm in Waves 3-6. Revisit publication after all waves.
