# Spine Protobuf sources

This directory contains exact copies of the Spine `.proto` files used by Spine
TS. Keeping the originals intact lets TypeScript and JVM applications exchange
the same commands, events, queries, subscriptions, and context messages.

> **📌 These files are imported source.** Do not edit them as if they were
> application models. Update them only through the verified source-copy process.

## 💡 Why keep a verified copy?

- ✅ Builds and tests do not need the network.
- ✅ Every file records its upstream repository, commit, URL, and SHA-256.
- ✅ Descriptor checks catch changes to fields, options, type URLs, and imports.
- ✅ Generated TypeScript always comes from a known contract set.

The complete inventory is [`spine-sources.json`](spine-sources.json). It pins
39 source files. Buf adds standard imported descriptors while compiling them,
producing the 48-file descriptor set checked by this repository.

## 🚀 Verify and generate

Run these commands from the repository root:

```bash
pnpm proto:verify
pnpm proto:lint
pnpm proto:generate
pnpm proto:check-generated
```

`proto:verify` checks that the manifest and copied files match exactly and that
every checksum is correct. `proto:lint` checks the copied contracts with the
narrow compatibility exceptions required by the original Spine files.
`proto:generate` rebuilds `packages/proto/generated`; the generated directory
must not be a symlink. `proto:check-generated` rejects missing, stale, orphaned,
tracked, or symlinked generated output.

## 🔒 Descriptor compatibility

Before generation, the workflow builds a complete
`google.protobuf.FileDescriptorSet`, removes only source-location comments,
orders files by name, and compares the result with
`frozen-descriptor-set.sha256`. Custom options and unknown fields remain in the
checksum, so compatibility-relevant changes fail closed.

## ⚠️ Original naming is preserved

Some copied Spine files use legacy enum, field, package, or version names. They
remain unchanged because they are wire contracts shared with Spine JVM. New
application Proto packages should follow the current naming guidance in the
[end-user guide](../../../docs/USER_GUIDE.md).

## 🔗 Learn more

- [Protobuf package](../README.md)
- [Protobuf tooling](../../proto-tools/README.md)
- [JVM compatibility checks](../../../compatibility-tests/jvm/README.md)
