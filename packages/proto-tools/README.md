# @spine-event-engine/proto-tools

This package generates TypeScript from application-owned Proto models and
assembles those models into an application registry. It runs at build time, not
inside a server process.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

## Create a model package

A model package owns canonical `.proto` files, generated code, and one exported
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
typed rejection companions for owned rejection Proto files, and a deterministic
`spine-proto-manifest.json`. Do not edit generated output by hand.

## Compose an application

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
the generated handler registry for decorated application classes. Run both after
the related model or handler changes.

The public CLI is `spine-proto`. Its programmatic config and manifest readers
are for tooling that needs the same validated package contracts; application
code should import generated model modules instead.

```ts
// docs-snippet-path: packages/proto-tools/src/index.ts
import { ProtoConfig } from "@spine-event-engine/proto-tools";

const config = ProtoConfig.read(".");
void config;
```
