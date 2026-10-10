# Vercel and Ax adapter

Application developers use this optional package to register an authenticated Vercel AI SDK model for a Spine Agent capability. The package currently ships as an experimental snapshot.

## Install

Install the adapter with the AI facade and the provider package you use:

```sh
pnpm add @spine-event-engine/ai-vercel-ax@snapshot @spine-event-engine/ai@snapshot @ai-sdk/openai@4.0.84
```

## First success: prepare a guarded OpenAI Responses registration

The trusted connection callback receives a fetch function scoped to an admitted attempt. Construct the provider with that fetch; the adapter will verify its credential-free identity. Registration alone sends no request.

<!-- prettier-ignore-start -->
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
<!-- prettier-ignore-end -->

Supply real authenticated identity and authorization callbacks in an application. The runtime admits requests and persists attempt, budget, and result records before this adapter dispatches; using a registration outside that runtime does not provide those guarantees. To check the adapter's credential-free protocol fixtures in this repository, run `pnpm exec vitest run packages/ai-vercel-ax/test/factory.test.ts` from the root. See [REFERENCE.md](REFERENCE.md) for the supported profiles and boundaries.

## ChatGPT plan Responses registration

Use `VercelAx.chatgptPlanModel()` for an account with ChatGPT plan inference permission.
The application handles sign-in, registration selection, token refresh, and model
discovery. This adapter accepts the selected account and model through the same
trusted identity and authorization callbacks as the API-key profile. Its
connection callback returns a nonempty OAuth access token. The adapter binds
that token and the authorized endpoint explicitly to the pinned OpenAI SDK,
without reading ambient `OPENAI_API_KEY` or `OPENAI_BASE_URL`.

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { ModelRef, type AiConnectionIdentity, type AiScope } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

interface PlanConnectionService {
    identity(scope: AiScope): Promise<AiConnectionIdentity>;
    permits(scope: AiScope, identity: AiConnectionIdentity): Promise<boolean>;
    accessToken(scope: AiScope, identity: AiConnectionIdentity): Promise<string>;
}

/**
 * Registers a selected ChatGPT plan account and discovered model.
 *
 * @param plan Trusted application session and token service.
 * @returns An Agent generation deployment registration.
 */
function registerPlanModel(plan: PlanConnectionService) {
    return VercelAx.chatgptPlanModel({
        ref: ModelRef.of("release-notes-plan", "registration-1-model-1"),
        resolveIdentity: (scope) => plan.identity(scope),
        authorizeUse: (scope, identity) => plan.permits(scope, identity),
        connect: async (scope, expected) => {
            const accessToken = await plan.accessToken(scope, expected);
            return { accessToken, identity: expected };
        },
    });
}
```
<!-- prettier-ignore-end -->

The service must obtain and bind `identity`, `permits`, and `accessToken` to the same
registration and selected model. Use `https://api.openai.com/v1` as the
credential-free endpoint in its identity. Keep tokens in the trusted process;
the adapter records the credential-free deployment identity and request/response history.
Define the generation capability with `outputMode: "prompt-and-validate"` and
omit `maxOutputTokens`. An explicit token ceiling and native-schema mode are
rejected before inference for this profile. Request count, tool count, byte,
and deadline bounds remain mandatory.

The profile sends stateless streamed Responses with developer instructions,
`store: false`, and encrypted reasoning included for local tool continuation.
Only a `response.completed` terminal event can admit output. Corrections and
tool continuations use new recorded attempt tickets. This profile does not
perform sign-in or retry a failed inference outside the Agent runtime.

For local MCP tools, discovery accepts the pinned server SDK's root
`https://json-schema.org/draft/2020-12/schema` declaration and records the
equivalent bounded schema without that dialect marker. Discovery still rejects
unknown dialects, remote references, unsupported keywords, excessive nesting,
and schemas over the configured byte limit before a model request.
Denied MCP connection authorization becomes a saved, nonretryable
`AUTHENTICATION_REQUIRED` Agent result. Unsupported bounded tool discovery
becomes `UNSUPPORTED_CAPABILITY` during setup. Transport, cancellation, journal,
and storage faults in that setup still reject the execution rather than becoming
model results. Later tool-call failures have their separate bounded tool
outcomes.

## Anthropic Messages registration

Install `@ai-sdk/anthropic@4.0.72`. Give `createAnthropic` the scoped fetch and a secret supplied by your application. The native-schema mode is tested with the exact model IDs listed in [REFERENCE.md](REFERENCE.md); `prompt-and-validate` can use other Anthropic model IDs, subject to provider access and the usual local validation.

<!-- prettier-ignore-start -->
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
<!-- prettier-ignore-end -->

Replace the example's identity and authorization callbacks with checks against the authenticated application scope. If your application supplies bearer tokens, pass its scoped token source to this registration function:

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { ModelRef, type AiScope } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

/**
 * Registers Anthropic Messages with a trusted application token source.
 *
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
<!-- prettier-ignore-end -->

The application implements `forScope` and checks deployment permission in `authorizeUse`. The provider accepts either `apiKey` or `authToken`; the adapter does not provide OAuth login, subscription login, or credential acquisition. Credentials stay in the trusted connection callback and out of the recorded request.

## OpenRouter Jev decision registration

Install the pinned provider separately with `pnpm add @openrouter/ai-sdk-provider@3.1.0`. The Decisions endpoint is the credential-free identity endpoint; `evaluationModel()` uses the pinned provider's non-generative Decisions protocol.

<!-- prettier-ignore-start -->
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
<!-- prettier-ignore-end -->

Use an application secret source for `apiKey`; the example does not dispatch a request.
