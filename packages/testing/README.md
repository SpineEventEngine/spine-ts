# Black-box testing for Spine applications

`BlackBox` tests a Bounded Context through the same local server and Node client path that an application uses. Post a Command, then observe its Event or query result. This matters for asynchronous handlers: accepting a Command does not mean its later work has finished.

This experimental snapshot package needs Node 24 or newer and a built application Bounded Context.

```sh
pnpm add -D @spine-event-engine/testing@snapshot
```

For exact methods and failure behavior, see the [coding-agent reference](REFERENCE.md).

## Test a model-assisted outcome

The [warehouse support example](../../examples/support/README.md) asks an Agent to draft a reply. A test can supply a controlled model response with `AiTestBackend`, post `DraftSupportReply`, and wait for `SupportReplySuggested`. This exercises the real Agent, Event delivery, and output validation without a provider account.

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: examples/support/test/support-blackbox.test.ts -->

```ts
import { create, equals } from "@bufbuild/protobuf";
import { AnyMessages } from "@spine-event-engine/core";
import { AiTestBackend, BlackBox } from "@spine-event-engine/testing";
import {
    DraftSupportReplySchema,
    type DraftSupportReply,
} from "../generated/spine/examples/support/commands_pb.js";
import { SupportReplySuggestedSchema } from "../generated/spine/examples/support/events_pb.js";
import {
    SupportReplySchema,
    SupportTicketIdSchema,
} from "../generated/spine/examples/support/types_pb.js";
import { draftSupportReply } from "../dist/src/index.js";

/**
 * Scripts a proposal and waits for that exact domain outcome.
 *
 * @param box Running application test boundary.
 * @param backend Controlled model deployment.
 * @param command Draft request with ticket facts and conversation.
 * @returns Matching proposal Events after asynchronous delivery.
 */
async function submitDraft(box: BlackBox, backend: AiTestBackend, command: DraftSupportReply) {
    const reply = create(SupportReplySchema, {
        subject: "Shipping label printing is blocked",
        body: "Both stations still fail after restarting. What error appears when printing?",
    });
    backend.forModel(draftSupportReply).respondWith(reply);
    const acknowledgement = await box.asGuest().post(DraftSupportReplySchema, command);
    if (acknowledgement.kind !== "ok") throw new Error("Draft request was not accepted.");
    const suggested = await box.eventually(
        () => box.assertEvents()
            .flatMap((event) => event.message === undefined
                ? []
                : [AnyMessages.unpack(event.message, SupportReplySuggestedSchema)])
            .filter((event) => event !== undefined),
        (events) => events.some((event) =>
            event.reply !== undefined &&
            event.id !== undefined && command.id !== undefined &&
            event.conversation?.value === command.conversation?.value &&
            equals(SupportReplySchema, event.reply, reply) &&
            equals(SupportTicketIdSchema, event.id, command.id)),
    );
    backend.assertSatisfied();
    return suggested;
}
```

<!-- prettier-ignore-end -->

The Command acknowledgement only says the request was accepted. The test waits for the proposed-reply Event and checks its complete reply, ticket ID, and conversation; an earlier ticket-opened Event cannot satisfy that condition. The complete test also queries the review Projection and reads the Agent's recorded interaction history. Script malformed text or a blank reply to check the failure and correction paths.

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
