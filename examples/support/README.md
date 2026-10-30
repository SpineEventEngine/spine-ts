# Warehouse support reply example

A warehouse employee reports that neither packing station can print shipping labels. They already restarted both printers and PCs, and orders are waiting for the carrier. This application records the facts and asks a model for a reply **for a support person to review**. It does not send the reply or mark the incident solved.

## What this example demonstrates

The application uses two Commands. `OpenSupportTicket` records the employee's facts in a ticket Aggregate. The application separately posts `DraftSupportReply` to an Agent for the same ticket. The Agent asks for a typed draft, then emits either a proposal or a failure. A Projection makes the latest outcome available to a support person.

```text
Application ──posts──> OpenSupportTicket ──> SupportTicket Aggregate
     │                                           records facts
     └──────posts──> DraftSupportReply ──> SupportDraftAgent
                                          │ awaits model asynchronously
                                          ▼
                            Suggested or Failed domain Event
                                          │ delivered asynchronously
                                          ▼
                               SupportReview query state
```

The Command acknowledgement means work was accepted; it is not the draft. The model call and later Event delivery happen asynchronously, so the client waits for the outcome Event or queries the Projection.

## Run the example

From the repository root:

```sh
pnpm install
pnpm proto:generate
pnpm exec tsc -b examples/support
pnpm exec vitest run examples/support/test/support-blackbox.test.ts
```

The test uses `AiTestBackend` and needs no provider credential or paid model request. It covers a usable draft, malformed output, a blank reply corrected on a second attempt, and a later failed request that leaves the last usable draft available.

## 1. Give the Agent a ticket ID and state

The Agent is a stateful Entity, separate from the ticket Aggregate. Both use the generated `SupportTicketId`, so a draft stays attached to its ticket. The Agent state holds the latest accepted reply; the review Projection exposes the outcome to a reader. In [states.proto](proto/spine/examples/support/states.proto):

```proto
message SupportDraftState {
    option (entity).kind = ENTITY;

    SupportTicketId id = 1;
    SupportRequest request = 2 [(validate) = true];
    SupportReply reply = 3 [(validate) = true];
    spine.ts.agent.ConversationId conversation = 4 [(validate) = true];
}
```

The separate conversation ID identifies which drafting conversation the request belongs to. A later request can continue it or start another. The [domain Protos](proto/spine/examples/support) also define distinct Command, Event, and reply messages.

## 2. Describe the model task

`AiModel.define()` describes what the Agent asks for. The generated Command and reply schemas make the input and result typed. The example uses `prompt-and-validate`, so it parses and checks a model response locally before accepting a reply. This compact version shows the public API; [model.ts](src/model.ts) contains the full instructions and the application's text validation rules.

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: examples/support/src/model.ts -->

```ts
import { AiModel } from "@spine-event-engine/ai";
import { DraftSupportReplySchema } from "../generated/spine/examples/support/commands_pb.js";
import { SupportReplySchema } from "../generated/spine/examples/support/types_pb.js";

const draftSupportReply = AiModel.define({
    name: "draft-support-reply",
    version: "1",
    kind: "generation",
    input: DraftSupportReplySchema,
    output: SupportReplySchema,
    outputMode: "prompt-and-validate",
    instructions: "Draft a reply for human review using only the supplied ticket facts.",
    validation: {
        version: "1",
        check: (reply) => reply.body.trim()
            ? []
            : [{ code: "BODY", path: "body", message: "Write a nonblank reply." }],
    },
});
```

<!-- prettier-ignore-end -->

The application chooses its instructions and validation rules. Defining this task makes no model request and does not select a provider account. For provider setup, see the [adapter guide](../../packages/ai-vercel-ax/README.md).

## 3. Invoke the task from the Agent

The [Agent handler](src/index.ts) receives `DraftSupportReply`. It supplies the Command as typed input and the explicit conversation ID. A successful result updates the Agent's draft and emits `SupportReplySuggested`; a failed result emits `SupportReplyFailed` without overwriting a previous accepted draft.

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: examples/support/src/index.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { Agent, Assign } from "@spine-event-engine/server";
import type { DraftSupportReply } from "../generated/spine/examples/support/commands_pb.js";
import {
    SupportReplyFailedSchema,
    SupportReplySuggestedSchema,
    type SupportReplyFailed,
    type SupportReplySuggested,
} from "../generated/spine/examples/support/events_pb.js";
import { SupportDraftStateSchema } from "../generated/spine/examples/support/states_pb.js";
import type { SupportTicketId } from "../generated/spine/examples/support/types_pb.js";
import { draftSupportReply } from "./model.js";

class SupportDraftAgent extends Agent<SupportTicketId, typeof SupportDraftStateSchema> {
    /**
     * Drafts a reply from the submitted ticket facts.
     *
     * @param command Ticket facts and explicit conversation identity.
     * @returns A reviewable proposal or the failed-request Event.
     */
    @Assign
    async draft(command: DraftSupportReply): Promise<SupportReplySuggested | SupportReplyFailed> {
        if (command.conversation === undefined || command.request === undefined)
            throw new TypeError("A draft requires ticket facts and a conversation.");
        const result = await this.ai.invoke(draftSupportReply, {
            call: "draft-support-reply",
            conversation: command.conversation,
            input: command,
        });
        const outcome = {
            id: this.id,
            request: command.request,
            conversation: command.conversation,
            operation: result.operationId,
        };
        if (!result.ok) return create(SupportReplyFailedSchema, outcome);
        this.update((state) => {
            state.id = this.id;
            state.request = command.request;
            state.reply = result.value;
            state.conversation = command.conversation;
        });
        return create(SupportReplySuggestedSchema, { ...outcome, reply: result.value });
    }
}
```

<!-- prettier-ignore-end -->

The Agent emits a domain Event for the application. The framework records the model request and result separately, so a support person can inspect how a proposal was produced. The [SupportReview Projection](src/index.ts) handles the outcome Events and exposes the latest review state; it sends no message to the employee.

## 4. Configure and test the full flow

The [context factory](src/index.ts) registers the ticket Aggregate, Agent, and review Projection with generated handler metadata. It also installs an `AiRegistry` and persists the Agent's System Events. In the BlackBox test, `AiTestBackend` supplies a controlled model deployment and a typed reply:

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: examples/support/test/support-blackbox.test.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { AiTestBackend } from "@spine-event-engine/testing";
import { SupportReplySchema } from "../generated/spine/examples/support/types_pb.js";
import { SupportContext, draftSupportReply } from "../dist/src/index.js";

/**
 * Configures the support application with a scripted model response.
 *
 * @returns Backend and Bounded Context for a local BlackBox story.
 */
async function configuredSupport() {
    const backend = AiTestBackend.create({
        ref: ModelRef.of("support-scripted", "v1"),
        kind: "generation",
    });
    backend.forModel(draftSupportReply).respondWith(create(SupportReplySchema, {
        subject: "Shipping label printing is blocked",
        body: "Both stations still fail after restarting. What error appears when printing?",
    }));
    const registry = AiRegistry.create({
        defaultModels: { generation: backend.registration.ref },
    }).register(backend.registration);
    const context = await SupportContext.create(registry);
    return { backend, context };
}
```

<!-- prettier-ignore-end -->

The application posts `DraftSupportReply` with the ticket ID, reported facts, and a conversation ID. Start each test with a fresh `BlackBox` built from the configured Bounded Context, then observe the later proposal and Agent history. Close the box when the test finishes, as the complete test does:

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: examples/support/test/support-blackbox.test.ts -->

```ts
import { create, equals } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { BlackBox } from "@spine-event-engine/testing";
import {
    DraftSupportReplySchema,
    OpenSupportTicketSchema,
    type DraftSupportReply,
} from "../generated/spine/examples/support/commands_pb.js";
import { SupportReplySuggestedSchema } from "../generated/spine/examples/support/events_pb.js";
import {
    SupportRequestSchema,
    SupportTicketIdSchema,
} from "../generated/spine/examples/support/types_pb.js";
import { SupportDraftAgent } from "../dist/src/index.js";

/**
 * Posts the ticket and draft request, then observes the Agent's later work.
 *
 * @param box Fresh BlackBox for this test.
 * @param command Draft request with ticket ID, facts, and conversation.
 * @returns The proposal and one page of recorded Agent history.
 */
async function observeDraft(box: BlackBox, command: DraftSupportReply) {
    if (command.id === undefined || command.request === undefined ||
        command.conversation === undefined)
        throw new TypeError("A draft needs a ticket ID, facts, and conversation.");
    const ticketId = command.id;
    const request = command.request;
    const conversation = command.conversation;
    const previousEvents = box.assertEvents().length;
    const scope = box.asGuest();
    await scope.post(OpenSupportTicketSchema, create(OpenSupportTicketSchema, {
        id: ticketId,
        request: command.request,
    }));
    const accepted = await scope.post(DraftSupportReplySchema, command);
    if (accepted.kind !== "ok") throw new Error("Draft request was not accepted.");
    const proposals = await box.eventually(
        () => box.assertEvents().slice(previousEvents)
            .flatMap((event) => event.message === undefined
                ? []
                : [AnyPacker.tryUnpack(event.message, SupportReplySuggestedSchema)])
            .filter((event) => event !== undefined),
        (events) => events.some((event) =>
            event.id !== undefined && event.request !== undefined &&
            event.conversation !== undefined &&
            equals(SupportTicketIdSchema, event.id, ticketId) &&
            equals(SupportRequestSchema, event.request, request) &&
            equals(ConversationIdSchema, event.conversation, conversation)),
    );
    const history = await box.readAgentHistory(SupportDraftAgent, ticketId, {
        pageSize: 10,
    });
    return { proposals, history };
}
```

<!-- prettier-ignore-end -->

The [complete BlackBox test](test/support-blackbox.test.ts) first posts `OpenSupportTicket`, then posts the draft Command, waits for `SupportReplySuggested`, checks the reply and conversation, and queries `SupportReview`. It also calls `BlackBox.readAgentHistory(SupportDraftAgent, ticketId, ...)` to inspect recorded interactions. A failed result produces `SupportReplyFailed`; the review state marks that request as failed while retaining any earlier usable draft.

A model can still be wrong about facts it cannot verify. The proposal remains for a person to review before any reply is sent. The test's memory storage lasts only for its process; a deployed application chooses persistent storage if tickets, drafts, and history must survive restart. For exact Protobuf fields, deployment requirements, and history behavior, see the [coding-agent reference](REFERENCE.md).
