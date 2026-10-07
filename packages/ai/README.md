# Spine AI facade

Application developers use this SDK-free package to define typed Agent capabilities and configure deployments. The package currently ships as an experimental snapshot.

## Install

Install it alongside the Protobuf package and generated application messages:

```sh
pnpm add @spine-event-engine/ai@snapshot @spine-event-engine/proto@snapshot @bufbuild/protobuf
```

## First success: define a typed generation capability

The input and output descriptors below are generated from your application's domain Protos. The import points to this repository's support-ticket fixture; replace it with your application's generated path.

<!-- docs-snippet-path: packages/ai/test/public-contracts.test.ts -->

```ts
import { AiModel } from "@spine-event-engine/ai";
import { SupportTicketFactsSchema, ProposedSupportReplySchema } from "../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const draftReply = AiModel.define({
  name: "draft-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a support reply for human review.",
  outputMode: "native-schema",
  limits: {
    modelRequests: 2,
    toolCalls: 0,
    deadlineMs: 30_000,
    maxInputBytes: 8_192,
    maxOutputBytes: 8_192,
    maxOutputTokens: 512,
  },
});
```

`AiModel.define()` validates the capability and snapshots its settings before a model request. To check the facade in this repository without credentials or network access, run `pnpm exec vitest run packages/ai/test` from the root. See [REFERENCE.md](REFERENCE.md) for supported contracts and limits.
