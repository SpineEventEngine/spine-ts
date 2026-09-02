# Protobuf tooling for Spine applications

Use this build-time package to generate TypeScript from application Proto
models, assemble model registries, and generate handler registries. Models can
define commands, events, and state used by Aggregates or Projections; this tool
does not run inside a server process.

This is an experimental snapshot. Install the snapshot explicitly while its CLI
and generated-output contract continue to evolve:

```sh
pnpm add -D @spine-event-engine/proto-tools@snapshot
```

For configuration, manifest, and generated-output details, read the
[reference](REFERENCE.md).

## 💡 Who should use it?

- ✅ Authors of Node.js/pnpm Spine model packages and application packages.
- ✅ Teams with canonical `.proto` sources, the `spine-proto` CLI, and the
  required Protobuf compiler/plugins available to their workspace.
- ❌ Runtime application code; import the generated model module and registry
  instead of invoking this CLI from a server.

## 🚀 Generate and compile one model

Start in a Node.js/pnpm workspace with the CLI installed, a model package, and
the Protobuf compiler/plugin toolchain available. A model package keeps its
canonical `.proto` files under `proto/` and declares its generated locations in
`spine-proto.json`:

```json
{
  "formatVersion": 1,
  "mode": "model",
  "packageName": "@acme/tasks-model",
  "protoRoot": "proto",
  "generatedRoot": "generated",
  "exportRoot": "generated",
  "dependencies": ["@spine-event-engine/proto"],
  "moduleExport": "tasksProtoModule"
}
```

From that model package directory, generate the model. The command emits
Protobuf-ES source under `generated/`, an importable `generated/proto-module.ts`,
and `spine-proto-manifest.json`; then compile the package.

```sh
pnpm exec spine-proto generate
tsc -b
```

Do not edit generated output by hand: change the Proto source or configuration,
then run generation again.

## 🧩 Compose an application after the first model succeeds

An application lists its direct model packages and a source location for the
generated registry.

```json
{
  "formatVersion": 1,
  "mode": "application",
  "modelPackages": ["@acme/tasks-model"],
  "registryOutput": "src/model-registry.ts"
}
```

```sh
pnpm exec spine-proto compose
pnpm exec spine-proto handlers
tsc -b
```

`compose` follows declared model dependencies transitively. `handlers` creates
the generated handler registry for decorated application classes. Its emitted
source imports the Server handler-registry contract as a type from
`@spine-event-engine/server/spi/handler-registry`; the CLI itself has no Server
runtime dependency. Run both after the related model or handler changes.

The public CLI is `spine-proto`. Programmatic config and manifest readers are
for build tooling that needs the same validated package contracts; application
code should import generated model modules instead.

## ⚠️ Cleanup and limits

Run this tooling after changing Proto files or decorated handlers. Generated
files are outputs, not source: never edit them by hand. Application runtime code
imports the generated model module and registry; it does not invoke the CLI.

Keep model-package dependencies explicit in both `package.json` and
`spine-proto.json`. `compose` follows declared model dependencies transitively;
it does not discover undeclared packages or create a running application.

## 🔗 Learn more

- [Spine Protobuf package](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/proto/README.md)
- [Core message tools](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/core/README.md)
- [Message Board model example](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/message-board/model/README.md)
- [Reference for coding agents](REFERENCE.md)
