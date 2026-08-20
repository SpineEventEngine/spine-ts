# Protobuf contracts used by Spine TS

`@spine-event-engine/proto` supplies the generated Protobuf schemas that Spine
TS itself uses: command and event envelopes, query, subscription, and context
schemas, validation messages, options, and schemas needed by the supported
client and delivery packages. Most applications use it as a dependency of their
model package rather than calling it directly.

## TypeScript interface options

Use `(every_is).ts_type = "TaskEvent"` with `(every_is).generate = true` to
generate a shared interface/token for a Proto file. Use
`(is).ts_type = "TaskAssignmentEvent"` when the model module authors that
interface. Run `pnpm proto:generate` after changing either declaration. The
[To-Do model](../../examples/todo/proto/spine/examples/todo/task_events.proto)
uses both forms.

For the complete export map and model-package contract, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Supplies standard command, event, query, subscription, and context schemas
  used across Spine TS.
- ✅ Supplies Spine Protobuf options for entities, validation, and type URLs.
- ✅ Gives application model packages one stable dependency for Spine imports.

## 🚀 Build it in this workspace

```sh
pnpm typecheck:build
```

Run this workspace-wide TypeScript build from the repository root. For an
experimental npm consumer, install
`@spine-event-engine/proto@2.0.0-snapshot.2` or the explicit
`@spine-event-engine/proto@snapshot` tag.

## 🧱 Use a Spine schema

Generated schemas work with the standard Protobuf-ES helpers.

```ts
import { create } from "@bufbuild/protobuf";
import { CommandIdSchema } from "@spine-event-engine/proto";

const commandId = create(CommandIdSchema, { uuid: "command-42" });
```

The package root exports commonly used Spine schemas such as `CommandSchema`,
`EventSchema`, `ActorContextSchema`, `TenantIdSchema`, and the Spine option
extensions.

Named subpaths group contracts used by a particular framework area. For
example, subscription records are available from
`@spine-event-engine/proto/client`, authenticated subscription records from
`@spine-event-engine/proto/auth`, and application-node discovery records from
`@spine-event-engine/proto/deployment`.

The generated wildcard subpath is a low-level compatibility surface used by
framework packages and advanced model tooling. Prefer the package root or a
named subpath when one exports the schema you need.

## 📦 Depend on it from an application model

An application model package declares this package both as an npm
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

## ⚠️ Generated contracts, not an application API

Most applications use these schemas through generated models, clients, and the
server. Keep domain messages in the application model package. The copied
Spine definitions preserve their original versioned Proto packages.

## 🔗 Learn more

- [Model-generation tools](../proto-tools/README.md)
- [Core message tools](../core/README.md)
- [Reference for coding agents](REFERENCE.md)

## Integration wire contracts

Generated root exports include the frozen external-event broker and typed
message-channel Protobuf contracts. `ExternalMessage`, `ExternalEventsWanted`,
`ExternalEventType`, `BoundedContextOnline`, `ChannelId`, and
`BoundedContextName` are binary infrastructure frames, not JSON application
messages. Empty control payloads are valid where the contract defines no
fields; consumers must not reject a valid zero-byte frame merely because it is
empty.

`ThirdPartyContext` uses the complete application schema universe through the
server's `TypeRegistry` to encode outgoing imported events; the core registry
alone is only a local/test fallback. Incoming events are decoded using the
destination EventBus's admitted generated schemas and retain their explicit
tenant/origin metadata.

The exact copied contracts are recorded in
[`proto/spine-sources.json`](proto/spine-sources.json):

| Contract                                 | Upstream revision                                    | SHA-256                                                            |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `spine/server/integration/broker.proto`  | `core-jvm@0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`  | `76a3b965391d989d32a1a6dbc84a4465d2f8f2386be7ed266fd201483dc9865d` |
| `spine/server/transport/transport.proto` | `core-jvm@0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`  | `92df339007d7dda01a6df5b87c38d988bfedebabd6ac28eb7fbb874bcd5f73bd` |
| `spine/core/event.proto`                 | `core-java@a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b` | `0c385d3fd98d68d35ce1d7887bd564b590daba47b959b99d205c2be56a737d29` |
