# Protobuf tooling for Spine applications

This package generates TypeScript from application Proto models and
assembles those models into an application registry. Those models can define
commands, events, and state used by Aggregates or Projections. It runs at build
time, not inside a server process.

## Generate interface artifacts

`pnpm proto:generate` discovers `ts_type` options and emits model-local
`generated/interfaces/*.ts` artifacts. Generated `TaskEvent` is a complete
generated declaration; generated `TaskAssignmentEvent` binds the token to an
authored interface in the same model module. Do not edit output: rerun the
generator instead.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Generates Protobuf-ES code for application models.
- ✅ Creates one importable `ProtoModule` per model package.
- ✅ Follows dependencies between model packages deterministically.
- ✅ Generates typed rejection helpers and handler registries.

## 🚀 Create a model package

A model package contains canonical `.proto` files, generated code, and one exported
`ProtoModule`. Use separate model packages for independently developed bounded
contexts; a small application may use one combined model package.

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

Run generation from that package directory:

```sh
spine-proto generate
```

Generation creates the generated Protobuf-ES sources, a `proto-module.ts`,
typed rejection companions for rejection Proto files in the package, and a deterministic
`spine-proto-manifest.json`. Do not edit generated output by hand.

## 🧩 Compose an application

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
spine-proto compose
spine-proto handlers
tsc -b
```

`compose` follows declared model dependencies transitively. `handlers` creates
the generated handler registry for decorated application classes. Its emitted
source imports the Server handler-registry contract as a type from
`@spine-event-engine/server/spi/handler-registry`; the CLI itself has no Server
runtime dependency. Run both after the related model or handler changes.

The public CLI is `spine-proto`. Its programmatic config and manifest readers
are for tooling that needs the same validated package contracts; application
code should import generated model modules instead.

```ts
// docs-snippet-path: packages/proto-tools/src/index.ts
import { ProtoConfig } from "@spine-event-engine/proto-tools";

const config = ProtoConfig.read(".");
void config;
```

## ⚠️ Build-time only

Run this tooling after changing Proto files or decorated handlers. Generated
files are outputs, not source: never edit them by hand. Application runtime code
imports the generated model module and registry; it does not invoke the CLI.

## 🔗 Learn more

- [Spine Protobuf package](../proto/README.md)
- [Core message tools](../core/README.md)
- [Message Board model example](../../examples/message-board/model/README.md)
- [Reference for coding agents](REFERENCE.md)
