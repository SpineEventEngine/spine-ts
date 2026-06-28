# @spine-ts/server

Descriptor-derived server metadata for Spine entity schemas and explicit handler
metadata.

Current slice exposes:

- `describeEntityMetadata(schema)` for deterministic entity kind/visibility metadata;
- `isEntitySchema(schema)` for pure descriptor checks;
- first-field routing hints from descriptor order;
- `(column)` discovery for projections/process managers, `(set_once)` field discovery for all entity kinds; and
- semantic tags from `(is)` and `(every_is)` with clear extraction errors; and
- `defineEntityHandlers(EntityClass, StateSchema, builder => [...])` for
  explicit, frozen handler metadata that binds generated Protobuf-ES schemas to
  entity method names.

```ts
import { defineEntityHandlers } from "@spine-ts/server";
import { CreateTaskSchema } from "./generated/task_commands_pb.js";
import { TaskCreatedSchema, TaskStateSchema } from "./generated/tasks_pb.js";

class TaskAggregate {
  create(command: unknown): void {}

  onCreated(event: unknown): void {}
}

const taskHandlers = defineEntityHandlers(TaskAggregate, TaskStateSchema, ({ assign, apply }) => [
  assign(CreateTaskSchema, "create"),
  apply(TaskCreatedSchema, "onCreated", { allowImport: true }),
]);

taskHandlers.handlers.map((handler) => handler.kind);
taskHandlers.eventApplications[0]?.allowImport; // true
```

The explicit registration API records command assignments, command reactions,
event subscriptions, event reactions, and event applications in declaration
order. It does not invoke handlers, enforce transactions or `(set_once)`, build
repositories, write storage, register buses, start transport, or implement gRPC
services.
