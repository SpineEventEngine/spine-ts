# Try the warehouse support example

A warehouse employee reports that neither packing station can print shipping labels. They already restarted both printers and PCs, and orders are waiting for the carrier. The application records those facts in a ticket, then asks an Agent to draft a reply for a support person to review. It never sends the draft or marks the incident solved.

From the repository root, run:

```sh
pnpm install
pnpm proto:generate
pnpm exec tsc -b examples/support
pnpm exec vitest run examples/support/test/support-blackbox.test.ts
```

The BlackBox test uses `AiTestBackend`, so no credentials or paid model request are needed. It posts `OpenSupportTicket`, then `DraftSupportReply` with a typed `SupportTicketId`, the reported facts, and an explicit `ConversationId`.

The first accepted Command records the ticket. The draft Command's acknowledgement means the Agent has accepted the work; it does not contain a reply. The Agent then calls the bounded model asynchronously. A valid reply produces `SupportReplySuggested` and updates the `SupportReview` Projection for a person's review. Invalid output produces `SupportReplyFailed` without a new reviewable proposal. A later request can supply updated facts and a new conversation ID; if that attempt fails, the previous accepted draft remains available and the Projection marks the latest request as failed.

The test also reads the Agent audit through `BlackBox.readAgentHistory` using the Agent class and its typed identifier. This history is newest first and paginated; the returned cursor continues to older records. Domain Events describe the proposed reply or failure. Framework System Events describe model selection, attempts, validation, and accounting. The local memory provider retains them for this process; use persistent storage for a durable deployment.

See [README.md](README.md) for the flow and code excerpt, and [REFERENCE.md](REFERENCE.md) for the Protobuf types, deployment configuration, and audit contract.
