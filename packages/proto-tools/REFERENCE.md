# @spine-event-engine/proto-tools reference

This reference describes the public build-time Proto tooling for coding agents.

## CLI

The `spine-proto` binary is the primary public API. Run it from the package
whose `spine-proto.json` it should read:

- `spine-proto generate` accepts only model configuration and generates model
  outputs and the manifest;
- `spine-proto compose` accepts only application configuration and writes the
  configured model registry source;
- `spine-proto handlers` accepts an application package and writes
  `generated/handler/generated-handler-registry.ts`.

The package also exposes `manifestFormatVersion`, `ProtoConfig`, and
`ProtoManifest` for build tooling that needs to read or validate the same
version-one contracts. Generator, filesystem, parser, and handler-discovery
implementation modules are not public APIs.

## Model configuration and package layout

`ModelConfig` requires `formatVersion: 1`, `mode: "model"`, `packageName`,
`protoRoot`, `generatedRoot`, `exportRoot`, direct model `dependencies`, and
`moduleExport`. Canonical Proto files live under `protoRoot`; generated imports
and the module export live under `generatedRoot`. The package must publish its
compiled generated output, canonical `proto` sources, `spine-proto.json`, and
`spine-proto-manifest.json` with matching exports.

`generate` produces a deterministic manifest containing package identity and
version, sorted Proto files in the package, generated exports, direct dependencies, and
the module export. A model with a top-level `*rejections.proto` also gets a
typed same-directory rejection companion. When such a companion is produced,
the model must directly depend on `@spine-event-engine/core`.

For a cross-model Proto import, declare the other model in both `package.json`
and `spine-proto.json`; import the other model's canonical package path. The
tool keeps package boundaries explicit and does not duplicate the dependency's source or
generated output.

## Application configuration

`ApplicationConfig` requires `formatVersion: 1`, `mode: "application"`, direct
`modelPackages`, and a safe source `registryOutput`. `compose` resolves direct
manifests transitively and writes one registry source. A direct model module is
sufficient because `TypeRegistry.from()` follows declared dependencies.

`handlers` must run after a decorated handler or its generated command, event,
or state types change. Compile the generated registry with the application.

## Safety and atomicity

All package-relative paths must remain inside the package and may not use unsafe
symlink ancestors. Generation rejects invalid configuration, unowned or
undeclared imports, absent manifest/proto exports, graph cycles, duplicate fully
qualified generated messages, and missing required dependencies. It stages
output and manifest replacement: validation or Buf failure preserves the prior
output and manifest. The CLI does not start services and is not a runtime server
dependency.
