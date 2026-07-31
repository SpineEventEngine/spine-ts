# @spine-event-engine/core

`@spine-event-engine/core` provides the small Protobuf utilities shared by a
Spine TS application. Use it when application code needs to validate a message,
pack it into `google.protobuf.Any`, create a command or event envelope, or look
up a generated message schema by its Spine type URL.

For the detailed contract and integration notes, see
[REFERENCE documentation for agents](REFERENCE.md).

## Use from this source workspace

```sh
pnpm --filter @spine-event-engine/core build
```

This private snapshot package is not published to an npm registry. Use it from
this workspace while developing the framework.

## Validate a message

Use `Validate.check()` when an invalid message should stop the current
operation. It reads the validation options from the generated schema and throws
`ValidationException` if a constraint is violated.

```ts
import { create } from "@bufbuild/protobuf";
import { Validate } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

const userId = create(UserIdSchema, { value: "ava" });
Validate.check(UserIdSchema, userId);
```

Use `Validate.message()` when the caller needs the returned violations instead
of an exception.

## Pack and unpack a message

`AnyMessages.pack()` derives the type URL from the schema's Protobuf file and
validates the message by default. `unpack()` returns `undefined` when the URL
or payload does not match the requested schema.

```ts
import { create } from "@bufbuild/protobuf";
import { AnyMessages } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

const userId = create(UserIdSchema, { value: "ava" });
const packed = AnyMessages.pack(UserIdSchema, userId);
const unpacked = AnyMessages.unpack(packed, UserIdSchema);
```

Only pass `{ validate: false }` for data a trusted caller has already
validated.

## Build a schema registry

Applications normally give model modules to the server, which creates its own
registry. A standalone integration can create a registry directly.

```ts
import { TypeRegistry } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

const registry = new TypeRegistry([UserIdSchema]);
const user = registry.getByFullName("spine.core.UserId");
console.log(user.typeUrl);
```

`spineCoreRegistry` is a read-only registry of the Spine schemas supplied by
`@spine-event-engine/proto`. Use `TypeRegistry.spineCore()` if registrations
must be added.

## Domain rejections

The model generator creates typed rejection factories for top-level messages in
an application's `*rejections.proto` files. Application code imports that
generated companion and throws its factory result. This example is from a
source file in the Todo model package's `src` directory.

```ts
// docs-snippet-path: examples/todo/src/index.ts
import { create } from "@bufbuild/protobuf";
import { TaskIdSchema } from "../generated/spine/examples/todo/task_id_pb.js";
import { TaskAlreadyDone } from "../generated/spine/examples/todo/task_rejections.js";

const id = create(TaskIdSchema, { value: "task-42" });
throw TaskAlreadyDone.create({ id });
```

The generated factory validates the rejection message and returns a
`RejectionThrowable`. The server package decides how a rejection is handled or
published.
