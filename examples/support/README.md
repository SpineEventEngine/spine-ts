# Warehouse support reply example

A warehouse employee reports that neither packing station can print shipping labels. Both printers and PCs were already restarted, and orders are waiting for the carrier. This example opens a support ticket and asks a Spine Agent to draft a reply **for a support person to review**. It neither sends the draft nor marks the incident solved.

The ticket Aggregate records the original incident. `SupportDraftAgent` handles a separate `DraftSupportReply` Command, with a real `SupportTicketId` and an explicit `ConversationId`. A bounded model call proposes a typed `SupportReply`. The Agent emits either `SupportReplySuggested` or `SupportReplyFailed`; `SupportReview` stores the latest outcome for queries. A later request can provide updated facts and continue the same conversation or choose another one.

```text
Synchronous setup: model definition + generated registration + context build
Asynchronous work: OpenSupportTicket -> SupportTicket -> SupportTicketOpened
Asynchronous work: DraftSupportReply -> SupportDraftAgent -> bounded model call
                                                  -> Suggested or Failed Event
                                                  -> SupportReview query state
```

From the repository root, run the credential-free BlackBox story:

```sh
pnpm install
pnpm proto:generate
pnpm exec tsc -b examples/support
pnpm exec vitest run examples/support/test/support-blackbox.test.ts
```

The test registers `AiTestBackend` as the default generation deployment, so it makes no paid request and needs no credentials. It scripts a valid typed reply, malformed output, and a blank reply followed by a correction. Each response goes through Spine's normal serialization and output validation. See [the complete test](test/support-blackbox.test.ts).

The application submits a draft Command with the ticket facts and an explicit conversation:

<!-- docs-snippet-path: examples/support/test/support-blackbox.test.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import { DraftSupportReplySchema } from "../generated/spine/examples/support/commands_pb.js";
import {
  SupportRequestSchema,
  SupportTicketIdSchema,
} from "../generated/spine/examples/support/types_pb.js";

export const draftCommand = create(DraftSupportReplySchema, {
  id: create(SupportTicketIdSchema, { value: "SUP-47" }),
  conversation: create(ConversationIdSchema, { value: "SUP-47-draft-1" }),
  request: create(SupportRequestSchema, {
    incident: "Neither packing station can print shipping labels.",
    attemptedSteps: ["Restarted both printers", "Restarted both PCs"],
    impact: "Orders are waiting for the carrier.",
  }),
});
```

[The Agent handler](src/index.ts) invokes [the model definition](src/model.ts), which supplies typed input and output schemas, instructions, a domain validation callback, two model-request credits, and byte, token, and deadline bounds.

`AiModel.define` and context construction configure capability and routing synchronously. The example's `SupportContext.create` loads generated handler metadata and builds the context asynchronously. Posting `DraftSupportReply` awaits durable acceptance of the Command; that acknowledgement is **not** the draft. Model inference, accepted state and Event persistence, and Projection delivery happen later. The BlackBox test uses `eventually` to observe those results.

The Agent's domain Events say whether a reviewable proposal exists and retain the exact request and conversation. Framework System Events record model selection, attempts, validation and tool/accounting facts; they are distinct from these domain outcomes. `BlackBox.readAgentHistory` reads a bounded newest-first full audit page with an opaque cursor for older entries. The provider also has full, one-conversation, System-Event, and domain-Event indexed views. Continue with the returned cursor; retention of accepted audit records is mandatory, including when a model result fails.

An Agent adds bounded, validated model calls, selected deployment authorization, recorded request and result evidence, and recovery from saved results to ordinary Entity handlers. A Process Manager can coordinate normal signals but does not supply those Agent execution guarantees. Fresh model output is not deterministic, and downstream delivery can retry; this example does not claim exactly-once external effects.

The Agent has no tool in this introductory story. An approved knowledge-article read can be added later through an explicitly configured tool server; printing, sending, or changing an order must not be inferred from a draft. For Protobuf fields, deployment settings, and audit details, see [REFERENCE.md](REFERENCE.md).

For a guided walkthrough of the four BlackBox outcomes, see [USER_GUIDE.md](USER_GUIDE.md).
