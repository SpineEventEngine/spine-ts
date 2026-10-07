# Vercel and Ax adapter

Application developers use this optional package to register an authenticated Vercel AI SDK model for a Spine Agent capability. The package currently ships as an experimental snapshot.

## Install

Install the adapter with the AI facade and the provider package you use:

```sh
pnpm add @spine-event-engine/ai-vercel-ax@snapshot @spine-event-engine/ai@snapshot @ai-sdk/openai
```

## First success: prepare a guarded OpenAI Responses registration

The trusted connection callback receives a fetch function scoped to an admitted attempt. Construct the provider with that fetch; the adapter will verify its credential-free identity. Registration alone sends no request.

<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { ModelRef } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

const identity = {
  provider: "openai",
  account: "support-account",
  endpoint: "https://api.openai.com/v1",
  model: "configured-model-id",
};
const registration = VercelAx.model({
  ref: ModelRef.of("support-reply", "r1"),
  capabilities: VercelAx.capabilities.openAIResponses(),
  resolveIdentity: () => identity,
  authorizeUse: () => true,
  connect: (_scope, _expected, control) => ({
    model: createOpenAI({ fetch: control.fetch }).responses(identity.model),
    identity,
  }),
});
```

Supply real authenticated identity and authorization callbacks in an application. The runtime admits requests and persists attempt, budget, and result records before this adapter dispatches; using a registration outside that runtime does not provide those guarantees. To check the adapter's credential-free protocol fixtures in this repository, run `pnpm exec vitest run packages/ai-vercel-ax/test/factory.test.ts` from the root. See [REFERENCE.md](REFERENCE.md) for the supported profiles and boundaries.

## OpenRouter Jev decision registration

Install the pinned provider separately with `pnpm add @openrouter/ai-sdk-provider@3.1.0`. The Decisions endpoint is the credential-free identity endpoint; `evaluationModel()` uses the pinned provider's non-generative Decisions protocol.

<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ModelRef } from "@spine-event-engine/ai";
import { VercelDecision } from "@spine-event-engine/ai-vercel-ax";

const decisionIdentity = {
  provider: "openrouter",
  account: "support-account",
  endpoint: "https://openrouter.ai/api/alpha",
  model: "typesafe/jev-1.13",
};
const decisionRegistration = VercelDecision.model({
  ref: ModelRef.of("support-routing", "r1"),
  capabilities: VercelDecision.capabilities.openRouterJev(),
  resolveIdentity: () => decisionIdentity,
  authorizeUse: () => true,
  connect: (_scope, _expected, control) => ({
    model: createOpenRouter({
      apiKey: "configured-secret",
      decisionsBaseURL: decisionIdentity.endpoint,
      fetch: control.fetch,
    }).evaluationModel(decisionIdentity.model),
    identity: decisionIdentity,
  }),
});
```

Use an application secret source for `apiKey`; the example does not dispatch a request.
