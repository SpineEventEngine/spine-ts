# @spine-event-engine/proto

`@spine-event-engine/proto` supplies the generated Protobuf schemas that Spine
TS itself uses: signal envelopes, contexts, validation messages, options, and
the schemas needed by the supported client and delivery packages. Most
applications use it as a dependency of their own model package rather than
calling it directly.

For the complete export map and model-package contract, see
[REFERENCE documentation for agents](REFERENCE.md).

## Use from this source workspace

```sh
pnpm --filter @spine-event-engine/proto build
```

This private snapshot package is not published to an npm registry. Use it from
this workspace while developing the framework.

## Use a Spine schema

Generated schemas work with the standard Protobuf-ES helpers.

```ts
import { create } from "@bufbuild/protobuf";
import { CommandIdSchema } from "@spine-event-engine/proto";

const commandId = create(CommandIdSchema, { uuid: "command-42" });
```

The package root exports commonly used Spine schemas such as `CommandSchema`,
`EventSchema`, `ActorContextSchema`, `TenantIdSchema`, and the Spine option
extensions.

## Depend on it from an application model

An application-owned model package declares this package both as an npm
dependency and as a model-generation dependency. The generator then resolves
Spine imports such as `spine/options.proto` and includes the Spine schema graph
in the model module.

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

Do not edit the generated output. Generate the model package through its
configured Protobuf workflow.
