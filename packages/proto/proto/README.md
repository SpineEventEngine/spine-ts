# Spine Protobuf sources

This directory contains the `.proto` files used by Spine TS. Most are exact
copies of Spine JVM contracts, so TypeScript and JVM applications can exchange
the same commands, events, queries, subscriptions, and context messages. A
small number are internal Spine TS contracts.

## 📌 Two kinds of source

[`spine-sources.json`](spine-sources.json) records both kinds of source:

- `sources` are frozen copies from upstream Spine repositories. Each entry has
  the repository, commit, source URL, raw URL, and SHA-256 checksum. Do not
  edit one by hand. Copy it from its pinned raw URL, preserve it byte-for-byte,
  then update its manifest checksum and descriptor lock through the verification
  workflow.
- `ownedSources` are small Spine TS-maintained internal schemas. Edit these as
  normal framework source, update their checksum in the manifest, and regenerate
  the descriptor lock. They are still checked so changes stay deliberate and
  reproducible.

## 💡 Why verify sources?

- ✅ Builds and tests do not need the network.
- ✅ Frozen copies retain their upstream repository, commit, URLs, and SHA-256.
- ✅ Local internal schemas have an explicit checksum and descriptor history.
- ✅ Descriptor checks catch changes to fields, options, type URLs, and imports.
- ✅ Generated TypeScript always comes from a known contract set.

The current inventory has 41 frozen source files and two internal Spine TS
internal schemas. Buf adds standard imported descriptors while compiling them,
producing the 52-file descriptor set checked by this repository.

## 🚀 Verify and generate

Run these commands from the repository root:

```bash
pnpm proto:verify
pnpm proto:lint
pnpm proto:generate
pnpm proto:check-generated
```

`proto:verify` checks that every frozen copy and every maintained schema matches its
manifest checksum. `proto:lint` checks the contracts with the narrow
compatibility exceptions required by frozen original Spine files.
`proto:generate` rebuilds `packages/proto/generated`; the generated directory
must not be a symlink. `proto:check-generated` rejects missing, stale, orphaned,
tracked, or symlinked generated output.

## 🔒 Descriptor compatibility

Before generation, the workflow builds a complete
`google.protobuf.FileDescriptorSet`, removes only source-location comments,
orders files by name, and compares the result with
`frozen-descriptor-set.sha256`. Custom options and unknown fields remain in the
checksum, so compatibility-relevant changes fail closed.

The frozen `spine/options.proto` source is pinned to
[`SpineEventEngine/base-libraries@51cb428771e5af8a944675fb8e26e9eb2c3d0dfe`](https://github.com/SpineEventEngine/base-libraries/blob/51cb428771e5af8a944675fb8e26e9eb2c3d0dfe/base/src/main/proto/spine/options.proto).
It retains its Java option fields and adds the upstream TypeScript-only
`(is).ts_type` and `(every_is).ts_type` declarations. The source manifest and
descriptor lock verify the exact bytes and field numbers; later generator work
owns interpretation and generation of those markers.

## ⚠️ Original naming is preserved

Some frozen Spine files use legacy enum, field, package, or version names. They
remain unchanged because they are wire contracts shared with Spine JVM. New
application Proto packages should follow the current naming guidance in the
[end-user guide](../../../docs/USER_GUIDE.md).

The `spine/system/server` schemas are framework-internal contracts. They are
generated for Spine TS runtime packages but are not curated end-user exports.

## 🔗 Learn more

- [Protobuf package](../README.md)
- [Protobuf tooling](../../proto-tools/README.md)
- [JVM compatibility checks](../../../compatibility-tests/jvm/README.md)
