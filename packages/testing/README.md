# Black-box testing for Spine applications

Use this package to test a bounded context through the same local server and
Node client boundary used by an application. `BlackBox` is the end-user test
API; applications do not need internal test utilities.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

This is an experimental snapshot package. Use Node 24 or newer and an
application Bounded Context before writing BlackBox tests.

```sh
pnpm add -D @spine-event-engine/testing@snapshot
```

## 💡 Why use it?

- ✅ Tests a complete bounded context through real Spine services.
- ✅ Posts commands, reads query-side views, and observes subscriptions as a
  user.
- ✅ Runs on an ephemeral local server with predictable cleanup.
- ✅ Waits for genuinely asynchronous results with bounded polling.
- ✅ Scripts registered AI deployments without network or provider credentials.

## Script a model dependency

`AiTestBackend` registers through the same `AiRegistry.register()` route as a
provider adapter. Queue responses for a factory-created `AiModel` before posting
the Agent signal through `BlackBox`. A typed `respondWith()` value is serialized
to ProtoJSON and passes through the runtime's normal parse, Protobuf, and
application validation. `respondWithText()` exercises invalid candidates;
`respondWithDecision()` supplies non-generative answers. The backend records only
physical requests that cross the runtime's reservation barrier. `requests()`
returns immutable observations of the named call, input, correction issues, and
permitted tool names. `assertSatisfied()` reports unused scripts and unexpected
requests. A release gate from `delay()` pauses a response without sleeping.

The scripted backend still requires the application Agent context and durable
runtime to execute; it does not call Agent methods or simulate repository state.
See [REFERENCE.md](REFERENCE.md) for its exact queue and failure behavior.

## Test an Agent outcome

The [warehouse support test](../../examples/support/test/support-blackbox.test.ts)
shows the complete setup. Once its context has a registered `AiTestBackend`, the
test supplies a typed reply and posts the same Command that an application would:

<!-- docs-snippet-path: examples/support/test/support-blackbox.test.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { AnyMessages } from "@spine-event-engine/core";
import { AiTestBackend, BlackBox } from "@spine-event-engine/testing";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
} from "../generated/spine/examples/support/commands_pb.js";
import { SupportReplySuggestedSchema } from "../generated/spine/examples/support/events_pb.js";
import { SupportReplySchema } from "../generated/spine/examples/support/types_pb.js";
import { draftSupportReply } from "../dist/src/index.js";

/** Scripts a proposal and submits the request through the application boundary. */
async function submitDraft(box: BlackBox, backend: AiTestBackend, command: DraftSupportReply) {
  backend.forModel(draftSupportReply).respondWith(
    create(SupportReplySchema, {
      subject: "Shipping label printing is blocked",
      body: "Both stations still fail after restarting. What error appears when printing?",
    }),
  );
  const acknowledgement = await box.asGuest().post(DraftSupportReplySchema, command);
  if (acknowledgement.kind !== "ok") throw new Error("Draft request was not accepted.");
  await box.eventually(
    () => box.assertEvents(),
    (events) => events.length > 0,
  );
  backend.assertSatisfied();
}
```

Command acceptance happens before the model finishes. The complete test therefore
waits for `SupportReplySuggested`, checks its reply and conversation, and queries
the review Projection. It also calls `readAgentHistory` to inspect the Agent's
retained records. Script malformed text or a blank proposal to test parsing and
application validation, including the configured correction attempt.

## ✅ Run one command through a BlackBox

Create a `BlackBox` from a built application context, post one command, and
assert its acknowledgement. It starts an ephemeral local server and closes it
when the test is finished.

<!-- docs-snippet-path: examples/todo/src/docs/black-box-command.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { BlackBox } from "@spine-event-engine/testing";
import { CreateTaskSchema } from "../../generated/spine/examples/todo/task_commands_pb.js";
import { createTodoContext } from "../todo-app.js";

const box = await BlackBox.from(await createTodoContext());
try {
  const scope = box.asGuest();
  const acknowledgement = await scope.post(
    CreateTaskSchema,
    create(CreateTaskSchema, { id: { value: "task-42" }, title: "First task" }),
  );
  if (acknowledgement.kind !== "ok") throw new Error("CreateTask was not accepted.");
} finally {
  await box.close();
}
```

Create a named scope when a test needs to act as a particular user. Scopes send
queries, post commands, and create subscriptions through the public client API.

Use `box.onBehalfOf("alice")` when the command must carry a named actor.

## ⏳ Observe an asynchronous result

Use `eventually()` only for a result that becomes visible later. Assert an
immediate command result directly instead of polling for it.

<!-- docs-snippet-path: packages/testing/src/black-box/black-box.ts -->

```ts
async function waitForReady(box: import("@spine-event-engine/testing").BlackBox) {
  return box.eventually(
    async () => "ready",
    (result: string) => result === "ready",
    {
      timeoutMs: 500,
      intervalMs: 5,
    },
  );
}
```

`BlackBox.from()` accepts fixed `tenant`, `zoneId`, `timeoutMs`, and
`intervalMs` options. Time values must be positive integers. `close()` cancels
subscriptions created by the box, closes its client, and then closes the local
server.

## External events and produced signals

Post an imported event through an actor scope, then inspect snapshots of
context-produced output:

```ts
import type { Message, MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { BlackBox } from "@spine-event-engine/testing";

async function inspectPartnerEvent<Schema extends GenMessage<Message>>(
  box: BlackBox,
  schema: Schema,
  event: MessageShape<Schema>,
) {
  await box.onBehalfOf("partner").postExternalEvent(schema, event);
  return { commands: box.assertCommands(), events: box.assertEvents() };
}
```

Snapshots are taken at the call time. Use `eventually()` when detached handling
may produce output later. Input Commands, setup Events, received external
Events, and rejection Events from unsuccessful handlers are excluded; only admitted produced
Commands and committed produced Events appear in their production order.

## ⚠️ Test boundary

`BlackBox` tests one local Node process. It does not prove browser behavior,
cross-process delivery, authentication infrastructure, or a production storage
deployment. Choose the application’s real storage factory only when an
integration test intentionally covers that provider.

## 🔗 Learn more

- [Todo example tests](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/todo/README.md)
- [Server](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/README.md)
- [Reference for coding agents](REFERENCE.md)
