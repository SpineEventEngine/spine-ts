# Vercel and Ax adapter

Application developers use this optional package to register an authenticated Vercel AI SDK model for a Spine Agent capability. The package currently ships as an experimental snapshot.

## Install

Install the adapter with the AI facade and the provider package you use:

```sh
pnpm add @spine-event-engine/ai-vercel-ax@snapshot @spine-event-engine/ai@snapshot @ai-sdk/openai@4.0.84
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

## Anthropic Messages registration

Install `@ai-sdk/anthropic@4.0.72`. Give `createAnthropic` the scoped fetch and a secret supplied by your application. The native-schema mode is tested with the exact model IDs listed in [REFERENCE.md](REFERENCE.md); `prompt-and-validate` can use other Anthropic model IDs, subject to provider access and the usual local validation.

<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { ModelRef } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

/**
 * Credential-free Anthropic deployment selected for support replies.
 */
const identity = {
  provider: "anthropic",
  account: "support-account",
  endpoint: "https://api.anthropic.com/v1",
  model: "claude-sonnet-4-5",
};

/**
 * Registers guarded Anthropic Messages generation for the support capability.
 */
const registration = VercelAx.model({
  ref: ModelRef.of("support-reply", "r1"),
  capabilities: VercelAx.capabilities.anthropicMessages(),
  resolveIdentity: () => identity,
  authorizeUse: () => true,
  connect: (_scope, expected, control) => ({
    model: createAnthropic({
      apiKey,
      baseURL: expected.endpoint,
      fetch: control.fetch,
    }).messages(expected.model),
    identity: expected,
  }),
});
```

Replace the example's identity and authorization callbacks with checks against the authenticated application scope. If your application supplies bearer tokens, pass its scoped token source to this registration function:

<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { ModelRef, type AiScope } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

/**
 * Registers Anthropic Messages with a trusted application token source.
 * @param tokens Application hook that supplies a bearer token for the authenticated scope.
 * @returns Guarded generation registration.
 */
function registerWithToken(tokens: { forScope(scope: AiScope): Promise<string> }) {
  /**
   * Credential-free deployment used for authorization and routing.
   */
  const identity = {
    provider: "anthropic",
    account: "support-account",
    endpoint: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
  };

  return VercelAx.model({
    ref: ModelRef.of("support-reply", "r1"),
    capabilities: VercelAx.capabilities.anthropicMessages(),
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: async (scope, expected, control) => ({
      model: createAnthropic({
        authToken: await tokens.forScope(scope),
        baseURL: expected.endpoint,
        fetch: control.fetch,
      }).messages(expected.model),
      identity: expected,
    }),
  });
}
```

The application implements `forScope` and checks deployment permission in `authorizeUse`. The provider accepts either `apiKey` or `authToken`; the adapter does not provide OAuth login, subscription login, or credential acquisition. Credentials stay in the trusted connection callback and out of the recorded request.

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
