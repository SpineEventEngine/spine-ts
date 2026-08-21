# Core Protobuf tools for Spine TS

`@spine-event-engine/core` provides the small Protobuf utilities shared by a
Spine TS application. Use it when application code needs to validate a message,
pack it into `google.protobuf.Any`, create a command or event envelope, or look
up a generated message schema by its Spine type URL.

This is an experimental snapshot package. Use Node 24 or newer and generated
Spine message schemas.

## Message-interface tokens

A generated interface export has one name in two TypeScript namespaces: use it
as a type for message shape and as a value token in a repository `.route(...)`
call. The To-Do `TaskEvent` token groups task events; its authored
`TaskAssignmentEvent` counterpart groups assignment events. Start with the
[To-Do walkthrough](https://github.com/SpineEventEngine/spine-ts/blob/main/examples/todo/USER_GUIDE.md) for the complete path.

For the detailed contract and integration notes, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Reads validation rules directly from generated Protobuf schemas.
- ✅ Packs and unpacks `google.protobuf.Any` with Spine type URLs.
- ✅ Builds registries that understand framework and application messages.
- ✅ Creates the common envelopes used by commands, events, and rejections.

## 🚀 Build it in this workspace

```sh
pnpm typecheck:build
```

Run this workspace-wide TypeScript build from the repository root. For an
experimental npm consumer, install `@spine-event-engine/core@snapshot`.
The snapshot tag can change before a stable release.

## ✅ Validate a message

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

## 📦 Pack and unpack a message

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

## 🗂️ Build a schema registry

Applications normally give model modules to the server, which creates a
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

## 🔤 Turn message IDs into storage values

Storage providers cannot put a JavaScript message object directly into a
database key or query parameter. `Identifiers` packs supported primitive and
generated-message IDs into Spine's typed `Any` form. `Stringifiers` then gives
a generated message one reversible text representation. The default is compact
Proto JSON:

```ts
import { create } from "@bufbuild/protobuf";
import { Stringifiers } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

const id = create(UserIdSchema, { value: "ava" });
const mapping = Stringifiers.forMessage(UserIdSchema);
const stored = mapping.toString(id); // {"value":"ava"}
const restored = mapping.fromString(stored);
```

MySQL and Datastore use the same mapping when they write an ID or `(column)`
value and when they later build a Query operand. This symmetry is what makes
`board == BoardId("general")` find a row whose `board` column was written from
that generated `BoardId`. An application can register another reversible
mapping in `StringifierRegistry`. If compact Proto JSON encounters an `Any`,
also call `setTypeRegistry()` with the application's generated `TypeRegistry`.

## 🚫 Throw a generated domain rejection

The model generator creates typed rejection factories for top-level messages in
an application's `*rejections.proto` files. Application code imports that
generated companion and throws its factory result. This example is from a
source file in the Todo model package's `src` directory.

<!-- docs-snippet-path: examples/todo/src/index.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { TaskIdSchema } from "../generated/spine/examples/todo/task_id_pb.js";
import { TaskAlreadyDone } from "../generated/spine/examples/todo/task_rejections.js";

const id = create(TaskIdSchema, { value: "task-42" });
throw TaskAlreadyDone.create({ id });
```

The generated factory validates the rejection message and returns a
`RejectionThrowable`. The server package decides how a rejection is handled or
published.

## ⚠️ Keep framework behavior in framework packages

Core provides message-level building blocks. It does not run bounded contexts,
store entities, or send requests. Most applications use these helpers through
the server, clients, and generated model code rather than assembling envelopes
by hand.

## 🔗 Learn more

- [Protobuf package](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/proto/README.md)
- [Model-generation tools](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/proto-tools/README.md)
- [Server](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/server/README.md)
- [Reference for coding agents](REFERENCE.md)
