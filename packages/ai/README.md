# Describe an AI task for an Agent

An Agent can ask a model to help with a domain task, such as drafting a reply to a support ticket. This package describes the task: the input and result messages, instructions, and checks the result must pass. It does not choose a provider or store credentials. The package is currently an experimental snapshot.

## Install

Install it with the Protobuf package and your generated application messages:

```sh
pnpm add @spine-event-engine/ai@snapshot @spine-event-engine/proto@snapshot @bufbuild/protobuf
```

## Define the task

The support example accepts a `DraftSupportReply` Command containing the ticket facts and expects a typed `SupportReply`. These descriptors come from the application's domain Protos.

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
    instructions: "Draft a reply for a support person to review using the supplied ticket facts.",
});
```

<!-- prettier-ignore-end -->

`prompt-and-validate` asks the provider for a result and checks the parsed message locally. A provider that supports native schema output can use `native-schema` instead; local output validation still applies. The [support application](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/README.md) adds a domain rule so a blank reply cannot become a proposal. Defining a task does not make a model request.

## Connect a deployment

The task above says what input and output mean. A deployment says which permitted provider account and model will do that task. The [adapter guide](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/ai-vercel-ax/README.md) returns a registration with a model reference, credential setup, and authorization check. Build an `AiRegistry` outside the Agent and attach it to the Bounded Context:

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: examples/support/test/support-blackbox.test.ts -->

```ts
import {
    AiRegistry,
    type AiBackendRegistration,
} from "@spine-event-engine/ai";

/**
 * Selects a registered provider model for generation tasks.
 *
 * @param registration Deployment configured by the trusted application.
 * @returns Registry to install while building the Bounded Context.
 */
function generationRegistry(registration: AiBackendRegistration): AiRegistry {
    return AiRegistry.create({
        defaultModels: { generation: registration.ref },
    }).register(registration);
}
```

<!-- prettier-ignore-end -->

The [support context factory](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/src/index.ts) calls `withAi(registry)` when it builds its Agent repository. The [support walkthrough](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/README.md#3-invoke-the-task-from-the-agent) shows the actual handler calling `this.ai.invoke(draftSupportReply, { call, conversation, input })` and turning its result into a domain Event. The [BlackBox step](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/support/README.md#4-configure-and-test-the-full-flow) shows the same path with a controlled test deployment. The handler does not need a provider SDK or credential.

An Agent task can also allow named tools. **MCP** is a protocol that lets a model ask the application to run one of those tools and return its result. The application explicitly lists permitted tools and checks access before a tool runs; model text alone grants no permission. [Release Notes Studio](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/release-notes/README.md#6-let-the-model-ask-for-git-details) uses read-only Git tools to supply evidence for a draft.

For exact definition fields, deployment selection, optional application limits, tool registration, and result types, see the [coding-agent reference](REFERENCE.md).
